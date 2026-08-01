/**
 * Schema-related guard checks.
 * Extracted from guard.ts for maintainability.
 */

import type { HookResult } from "../../types.js";
import { fileExists, readJsonFile } from "@opencode-flow-engine/shared";
import { getStateFilePath } from "../../../features/state-manager.js";
import { detectSchemaChanges, checkMigrationFileExists } from "../../../features/schema-migration-detector.js";
import { detectNewAbstraction, hasGrepRecord } from "../../../features/abstraction-grep-tracker.js";

/**
 * Options for checkSchemaMigrationGuard — allows dependency injection for testing.
 */
export interface SchemaMigrationGuardOptions {
  /**
   * Override for child_process.execSync — used to run `git diff --cached --name-only`.
   * If not provided, the real execSync is used.
   */
  execSync?: (command: string, options?: { cwd?: string; encoding?: string; stdio?: string }) => string;
}

/**
 * Check if staged files contain schema changes without corresponding migration files.
 *
 * Flow:
 * 1. Run `git diff --cached --name-only` to get staged file list
 * 2. Use detectSchemaChanges() to filter schema-related files
 * 3. For each schema-type change, check if a migration file exists via checkMigrationFileExists()
 * 4. If any schema change lacks a migration file → block with blockReason
 * 5. If all schema changes have migrations, or no schema changes → pass
 *
 * READ-ONLY (C4): never writes state.
 */
export async function checkSchemaMigrationGuard(
  changeDir: string,
  options?: SchemaMigrationGuardOptions,
): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // Step 1: Get staged file list from git diff --cached
  let stagedOutput: string;
  try {
    const { execSync: realExecSync } = await import('child_process');
    const execFn = options?.execSync ?? realExecSync;
    const result = execFn('git diff --cached --name-only', {
      cwd: changeDir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    // 确保返回值为 string 类型（encoding: 'utf8' 时应为 string，但类型定义可能包含 Buffer）
    stagedOutput = typeof result === 'string' ? result : result.toString('utf8');
  } catch {
    // Not a git repo or git not available — skip gracefully
    return { success: true };
  }

  if (!stagedOutput || !stagedOutput.trim()) return { success: true };

  const stagedFiles = stagedOutput.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  if (stagedFiles.length === 0) return { success: true };

  // Step 2: Detect schema changes from staged file list
  const schemaChanges = detectSchemaChanges(stagedFiles);
  if (schemaChanges.length === 0) return { success: true };

  // Step 3: Filter to schema-type changes only (migration-type changes are already migrations)
  const schemaOnlyChanges = schemaChanges.filter(c => c.type === 'schema');
  if (schemaOnlyChanges.length === 0) return { success: true };

  // Step 4: Check each schema change for corresponding migration file
  const missingMigrations: string[] = [];
  for (const change of schemaOnlyChanges) {
    const hasMigration = await checkMigrationFileExists(changeDir, change);
    if (!hasMigration) {
      missingMigrations.push(change.filePath + ' (table: ' + change.tableName + ', framework: ' + change.framework + ')');
    }
  }

  // Step 5: Block if any schema change lacks a migration file
  if (missingMigrations.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: '[SFLOW] Schema migration guard: schema changes detected without corresponding migration files: ' + missingMigrations.join('; ') + '. Create migration files before committing.',
    };
  }

  return { success: true };
}

/**
 * Abstraction Grep Guard — blocks write/edit operations that create new
 * abstraction files (utils, helpers, services, etc.) without first performing
 * a grep self-check recorded in progress.md.
 *
 * Flow:
 * 1. Detect if the file being written/edited is a new abstraction file
 *    (using detectNewAbstraction from abstraction-grep-tracker)
 * 2. If the file already exists (edit, not new creation) → allow
 * 3. If a new abstraction is detected, check progress.md for the corresponding
 *    grep record (using hasGrepRecord from abstraction-grep-tracker)
 * 4. No grep record → block the write, require grep first
 * 5. Has grep record → allow
 *
 * Only applies during executing/debugging states in sflow workflow.
 * READ-ONLY (C4): never writes state.
 */
export async function checkAbstractionGrepGuard(
  changeDir: string,
  data?: Record<string, unknown>,
): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  const toolName = (data.toolName as string) || '';
  // Only check for write/edit operations
  if (toolName !== 'write' && toolName !== 'edit') return { success: true };

  const filePath = (data.filePath as string) || '';
  if (!filePath) return { success: true };

  // Only check during executing/debugging states
  const stateData = await readJsonFile<{ state?: string }>(
    `${changeDir}/${getStateFilePath('sflow')}`,
  );
  const currentState = stateData?.state || '';
  if (currentState !== 'executing' && currentState !== 'debugging') {
    return { success: true };
  }

  // Detect if the file is a new abstraction
  const abstraction = detectNewAbstraction(filePath);
  if (!abstraction) return { success: true };

  // Check if the file already exists (edit, not new creation)
  const fullPath = filePath.replace(/\\/g, '/');
  const absolutePath = fullPath.startsWith('/') || fullPath.includes(':')
    ? fullPath
    : `${changeDir}/${fullPath}`;
  const alreadyExists = await fileExists(absolutePath);
  if (alreadyExists) return { success: true };

  // Check if grep self-check has been recorded for this category
  const hasRecord = await hasGrepRecord(changeDir, abstraction.category);
  if (!hasRecord) {
    return {
      success: false,
      block: true,
      blockReason:
        `[SFLOW] Abstraction grep guard: new abstraction file "${filePath}" detected ` +
        `as category "${abstraction.label}" (${abstraction.category}), ` +
        'but no grep self-check record found in progress.md. ' +
        'Run grep to check for existing similar implementations before creating new abstractions.',
    };
  }

  return { success: true };
}
