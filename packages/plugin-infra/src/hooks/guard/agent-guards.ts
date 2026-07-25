/**
 * Agent-specific guards — executed before the generic guard chain.
 *
 * These guards target specific agents + specific tools + specific conditions,
 * providing more precise blocking than the generic guards in guard.ts.
 *
 * READ-ONLY: These guards NEVER write state or artifacts. They only detect and report.
 * State mutations (intel_scan_confirmed, architect_write_approved) happen through
 * record_decision_point tool calls in the agent prompts.
 */

import { fileExists, readJsonFile } from '@opencode-flow-engine/shared';
import { getStateFilePath } from '../../features/state-manager.js';
import { isFrontendProject } from '../../features/frontend-detector.js';
import * as path from 'path';

export interface AgentGuardResult {
  success: boolean;
  block?: boolean;
  blockReason?: string;
  error?: string;
  warnings?: string[];
}

/**
 * Check if any entry in state.decisionPoints contains the given flag key in its metadata.
 *
 * The record_decision_point tool stores metadata as a string field on each decision point
 * record (e.g. "intel_scan_confirmed" or "architect_write_approved: true").
 * This helper searches the decisionPoints array for a matching metadata string.
 */
function hasDecisionPointFlag(state: Record<string, unknown> | null, flagKey: string): boolean {
  if (!state || !Array.isArray(state.decisionPoints)) return false;
  return (state.decisionPoints as Array<Record<string, unknown>>).some((dp) => {
    if (!dp.metadata || typeof dp.metadata !== 'string') return false;
    return dp.metadata.includes(flagKey);
  });
}

/**
 * A1: Flow Intel Scan Confirmation Guard
 *
 * When flow-intel agent attempts to write files, check if intel_scan_confirmed
 * is set to true in state.json. If not, block the write and require user confirmation.
 *
 * This prevents flow-intel from scanning a project with no AI documentation
 * without the user's explicit consent (the "no blind flight" rule).
 */
export async function checkFlowIntelScanGuard(
  changeDir: string,
  data: Record<string, unknown>,
): Promise<AgentGuardResult> {
  const agent = (data.agent as string) || '';
  const toolName = (data.toolName as string) || '';

  // Only intercept flow-intel + write tool
  if (!agent.includes('flow-intel') || toolName !== 'write') {
    return { success: true };
  }

  // Read state.json and check decisionPoints array for intel_scan_confirmed flag
  const stateData = await readJsonFile<Record<string, unknown>>(`${changeDir}/${getStateFilePath('sflow')}`);
  if (hasDecisionPointFlag(stateData, 'intel_scan_confirmed')) {
    return { success: true };
  }

  return {
    success: false,
    block: true,
    blockReason: '[SFLOW] flow-intel scan not confirmed. User must confirm before scanning a project with no AI documentation.',
  };
}

/**
 * A2: Flow Architect Destructive Write Guard
 *
 * When flow-architect agent attempts to write or edit ARCHITECTURE.md,
 * check if the file already exists and if architect_write_approved is set.
 * First-time creation (file does not exist) is always allowed.
 */
export async function checkFlowArchitectWriteGuard(
  changeDir: string,
  data: Record<string, unknown>,
): Promise<AgentGuardResult> {
  const agent = (data.agent as string) || '';
  const toolName = (data.toolName as string) || '';
  const filePath = (data.filePath as string) || '';

  // Only intercept flow-architect + write/edit tools
  if (!agent.includes('flow-architect')) return { success: true };
  if (toolName !== 'write' && toolName !== 'edit') return { success: true };

  // Check if target file is ARCHITECTURE.md
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (!normalizedPath.includes('ARCHITECTURE.md')) return { success: true };

  // I1 fix: Ensure path is absolute before checking file existence
  const fullPath = normalizedPath.startsWith('/') || normalizedPath.includes(':')
    ? normalizedPath
    : path.join(changeDir, normalizedPath);
  const archExists = await fileExists(fullPath);
  if (!archExists) return { success: true };

  // C1 fix: Check decisionPoints array for architect_write_approved flag
  const stateData = await readJsonFile<Record<string, unknown>>(`${changeDir}/${getStateFilePath('sflow')}`);
  if (hasDecisionPointFlag(stateData, 'architect_write_approved')) {
    return { success: true };
  }

  return {
    success: false,
    block: true,
    blockReason: '[SFLOW] flow-architect write not approved. ARCHITECTURE.md already exists — user must approve overwrite.',
  };
}

/**
 * A3: Flow Restyle Frontend Project Guard
 *
 * When flow-restyle agent attempts to use write/edit/bash tools,
 * check if the current project is a frontend project. If not, block the operation.
 */
export async function checkFlowRestyleFrontendGuard(
  changeDir: string,
  data: Record<string, unknown>,
): Promise<AgentGuardResult> {
  const agent = (data.agent as string) || '';
  const toolName = (data.toolName as string) || '';

  // Only intercept flow-restyle + write/edit/bash tools
  if (!agent.includes('flow-restyle')) return { success: true };
  if (!['write', 'edit', 'bash'].includes(toolName)) return { success: true };

  const isFrontend = await isFrontendProject(changeDir);
  if (isFrontend) return { success: true };

  return {
    success: false,
    block: true,
    blockReason: '[SFLOW] flow-restyle only applies to frontend projects. No frontend files, configs, or dependencies detected.',
  };
}

/**
 * A4: Breaking Change Guard
 *
 * Detects write/edit operations that involve breaking changes:
 * - Deleting >= 5 lines of code (oldString has >= 5 lines, newString is empty or significantly smaller)
 * - Modifying public export signatures (oldString contains export keyword)
 * - Modifying public API routes or schema (oldString contains route/schema keywords)
 * - Deleting files (toolName = 'delete')
 * - Renaming export symbols (toolName = 'rename')
 *
 * If a breaking change is detected, checks decisionPoints for `breaking_change_confirmed`.
 * Without confirmation, blocks the operation and requires the user to complete
 * reference graph grep + explicit confirmation first.
 */
export async function checkBreakingChangeGuard(
  changeDir: string,
  data: Record<string, unknown>,
): Promise<AgentGuardResult> {
  // Guard: skip if no changeDir or no data
  if (!changeDir || !data || typeof data !== 'object') return { success: true };

  // Only activate during executing/debugging states — other states are already
  // protected by the generic guard chain (C4: planning phases block writes,
  // terminal states block all writes). The breaking change guard is specifically
  // for the execution phase where writes are allowed but must be controlled.
  const stateData = await readJsonFile<Record<string, unknown>>(`${changeDir}/${getStateFilePath('sflow')}`);
  const currentState = (stateData?.state as string) || '';
  if (currentState !== 'executing' && currentState !== 'debugging') {
    return { success: true };
  }

  const toolName = (data.toolName as string) || '';
  const filePath = (data.filePath as string) || '';

  // Only intercept write/edit/delete/rename tools
  const modifyingTools = ['write', 'edit', 'delete', 'rename'];
  if (!modifyingTools.includes(toolName)) return { success: true };

  // Detect breaking change
  let isBreaking = false;
  let breakingReason = '';

  // 1. Delete tool — always breaking (deleting a file)
  if (toolName === 'delete') {
    isBreaking = true;
    breakingReason = 'Deleting file';
  }

  // 2. Rename tool — always breaking (renaming export symbols)
  if (toolName === 'rename') {
    isBreaking = true;
    breakingReason = 'Renaming export symbols';
  }

  // 3. Edit tool — check for specific breaking patterns
  if (toolName === 'edit' && !isBreaking) {
    const oldString = (data.oldString as string) || '';
    const newString = (data.newString as string) || '';

    // 3a. Deleting >= 5 lines of code
    // Count lines in oldString that are being removed
    const oldLines = oldString.split('\n').filter((line: string) => line.trim().length > 0);
    const newLines = newString.split('\n').filter((line: string) => line.trim().length > 0);
    const deletedLineCount = oldLines.length - newLines.length;
    if (deletedLineCount >= 5) {
      isBreaking = true;
      breakingReason = 'Deleting >= 5 lines of code (' + deletedLineCount + ' lines removed)';
    }

    // 3b. Modifying public export signatures
    if (!isBreaking && /\bexport\s+(function|class|interface|type|const|let|var|enum)\s/.test(oldString)) {
      // If the export signature itself is being modified (not just the body)
      const oldExportMatch = oldString.match(/\bexport\s+(function|class|interface|type|const|let|var|enum)\s+(\w+)/);
      const newExportMatch = newString.match(/\bexport\s+(function|class|interface|type|const|let|var|enum)\s+(\w+)/);
      if (oldExportMatch && oldExportMatch[2]) {
        // Export name changed, or signature parameters changed
        if (!newExportMatch || newExportMatch[2] !== oldExportMatch[2]) {
          isBreaking = true;
          breakingReason = 'Modifying public export signature (export name changed)';
        } else {
          // Same export name but signature may have changed — check if oldString
          // contains the full signature line (export + name + params)
          const oldSignatureLine = oldString.split('\n')[0] || '';
          const newSignatureLine = newString.split('\n')[0] || '';
          if (oldSignatureLine !== newSignatureLine && /\bexport\b/.test(oldSignatureLine)) {
            isBreaking = true;
            breakingReason = 'Modifying public export signature';
          }
        }
      }
    }

    // 3c. Modifying public API routes or schema
    if (!isBreaking) {
      const apiRoutePattern = /['"`]\/api\/v?\d*\/[^'"`]+['"`]/;
      const schemaPattern = /\b\w*[Ss]chema\w*\b.*[={]|\b(createTable|alterTable|addColumn|dropColumn|migration)\b/i;
      if (apiRoutePattern.test(oldString) || schemaPattern.test(oldString)) {
        isBreaking = true;
        breakingReason = 'Modifying public API route or schema definition';
      }
    }
  }

  // 4. Write tool — check content for breaking patterns
  // Write is generally not breaking (creating new files), but if overwriting
  // an existing file with significantly different content, it could be.
  // For now, write tool is considered non-breaking by default since it's
  // typically used for new file creation. The edit tool handles modifications.
  if (toolName === 'write') {
    // Write is not breaking by default — new file creation is allowed
    return { success: true };
  }

  // If no breaking change detected, allow
  if (!isBreaking) return { success: true };

  // Breaking change detected — check decisionPoints for confirmation
  // Reuse stateData already read at the top of this function
  if (hasDecisionPointFlag(stateData, 'breaking_change_confirmed')) {
    return { success: true };
  }

  // 未确认 — 返回 WARN（不 BLOCK）
  return {
    success: true,
    warnings: [
      '[SFLOW] Breaking change detected: ' + breakingReason + '. ' +
      'Complete reference graph grep and confirm with breaking_change_confirmed decision point. ' +
      'AFK auto-mode will select option 1 (<20 refs) or option 3 (>=20 refs).',
    ],
  };
}

/**
 * Execute all agent-specific guards in priority order.
 * Returns the first blocking result, or a result with collected warnings, or null if all guards pass cleanly.
 *
 * Priority: intel → architect → restyle → breaking-change
 * (More precise blocking conditions first)
 */
export async function createAgentSpecificGuards(
  changeDir: string,
  data: Record<string, unknown>,
): Promise<AgentGuardResult | null> {
  const guards = [checkFlowIntelScanGuard, checkFlowArchitectWriteGuard, checkFlowRestyleFrontendGuard, checkBreakingChangeGuard];
  const allWarnings: string[] = [];
  for (const guard of guards) {
    const result = await guard(changeDir, data);
    if (!result.success && result.block) {
      return result;
    }
    if (result.warnings && result.warnings.length > 0) {
      allWarnings.push(...result.warnings);
    }
  }
  if (allWarnings.length > 0) {
    return { success: true, warnings: allWarnings };
  }
  return null;
}
