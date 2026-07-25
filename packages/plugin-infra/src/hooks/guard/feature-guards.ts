/**
 * Feature-based guard implementations — guards that leverage feature detectors.
 *
 * These guards integrate schema-migration-detector and abstraction-grep-tracker
 * into the guard chain, providing runtime checks during workflow execution.
 *
 * READ-ONLY: These guards NEVER write state or artifacts. They only detect and report.
 *
 * NOTE: checkBreakingChangeGuard has been moved to agent-guards.ts with enhanced
 * blocking behavior (T2.1). The old warning-only version is removed.
 */

import type { HookResult } from "../types.js";
import { fileExists, readFile, readJsonFile } from "@opencode-flow-engine/shared";
import { detectSchemaChanges, checkMigrationFileExists } from "../../features/schema-migration-detector.js";
import { detectNewAbstraction, hasGrepRecord } from "../../features/abstraction-grep-tracker.js";
import { getStateFilePath } from "../../features/state-manager.js";

// ─── checkSchemaMigrationGuard ───────────────────────────────────────────────

/**
 * Schema Migration Guard — BLOCKS when schema files are modified without
 * corresponding migration files.
 *
 * This guard:
 * 1. Detects if the file being written matches schema file patterns
 * 2. Checks if a corresponding migration file already exists
 * 3. BLOCKS if no migration file is found for the schema change
 *
 * F2: Changed from WARN to BLOCK — schema changes without migrations
 * are a deployment risk and must be addressed before proceeding.
 * Only applies during executing/debugging states in sflow workflow.
 *
 * READ-ONLY: never writes state.
 */
export async function checkSchemaMigrationGuard(
  changeDir: string,
  data?: Record<string, unknown>,
): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  const toolName = (data.toolName as string) || '';
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

  // Detect schema changes from the file path
  const schemaChanges = detectSchemaChanges([filePath]);
  if (schemaChanges.length === 0) return { success: true };

  // Check if migration files exist for each detected schema change
  const missingMigrations: string[] = [];
  for (const change of schemaChanges) {
    const migrationExists = await checkMigrationFileExists(changeDir, change);
    if (!migrationExists) {
      missingMigrations.push(
        `${change.tableName} (${change.framework}, ${change.type})`,
      );
    }
  }

  if (missingMigrations.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: '[SFLOW] Schema migration guard: schema changes detected without corresponding migration files: ' +
        missingMigrations.join('; ') +
        '. Generate migration files before deploying schema changes.',
    };
  }

  return { success: true };
}

// ─── checkAbstractionGrepGuard ───────────────────────────────────────────────

/**
 * Abstraction Grep Guard — warns when new abstraction files are created
 * without performing grep self-checks.
 *
 * This guard:
 * 1. Detects if the file being written is a new abstraction (utils, helpers, services, etc.)
 * 2. Checks if the corresponding grep self-check has been recorded in progress.md
 * 3. Warns if no grep record exists for the detected abstraction category
 *
 * The guard only WARNS (does not block) — the grep self-check is a best practice,
 * not a hard requirement.
 * Only applies during executing/debugging states in sflow workflow.
 *
 * READ-ONLY: never writes state.
 */
export async function checkAbstractionGrepGuard(
  changeDir: string,
  data?: Record<string, unknown>,
): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  const toolName = (data.toolName as string) || '';
  // Only check for new file creation (write), not edits
  if (toolName !== 'write') return { success: true };

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
      success: true,
      warnings: [
        `[SFLOW] Abstraction grep guard: new abstraction file "${filePath}" detected ` +
        `as category "${abstraction.label}" (${abstraction.category}), ` +
        'but no grep self-check record found in progress.md. ' +
        'Run grep to check for existing similar implementations before creating new abstractions.',
      ],
    };
  }

  return { success: true };
}
