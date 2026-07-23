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
 * Execute all agent-specific guards in priority order.
 * Returns the first blocking result, or null if all guards pass.
 *
 * Priority: intel → architect → restyle
 * (More precise blocking conditions first)
 */
export async function createAgentSpecificGuards(
  changeDir: string,
  data: Record<string, unknown>,
): Promise<AgentGuardResult | null> {
  const guards = [checkFlowIntelScanGuard, checkFlowArchitectWriteGuard, checkFlowRestyleFrontendGuard];
  for (const guard of guards) {
    const result = await guard(changeDir, data);
    if (!result.success && result.block) {
      return result;
    }
  }
  return null;
}
