/**
 * IFlow Guard Rules - Scope reduction, deviation compliance, artifact completeness, cyclic transitions
 * These guards are only active when .iflow/ directory exists.
 * Each guard returns a HookResult, and they are integrated into the main guard.ts
 * via conditional check for .iflow/ directory existence.
 */

import type { HookResult } from "./types.js";
import { fileExists, directoryExists, readFile, readJsonFile } from "@opencode-sflow/shared";

const IFLOW_STATES = ['discussing', 'researching', 'planning', 'executing', 'verifying', 'shipping'] as const;
type IFlowState = typeof IFLOW_STATES[number];

/**
 * Valid cyclic transitions
 */
const VALID_TRANSITIONS: Record<IFlowState, IFlowState[]> = {
  discussing: ['researching'],
  researching: ['planning', 'discussing'],  // can go back to discuss if research reveals issues
  planning: ['executing', 'researching'],   // can go back to research if plan reveals unknowns
  executing: ['verifying', 'planning'],     // can go back to planning if execution blocked
  verifying: ['shipping', 'executing'],     // can go back to execute if verification fails
  shipping: ['discussing'],                 // always return to discussing for next cycle
};

/**
 * Required artifacts for each state transition
 */
const REQUIRED_ARTIFACTS: Record<IFlowState, string[]> = {
  discussing: [],
  researching: [],
  planning: ['CONTEXT.md'],
  executing: ['PLAN.md'],
  verifying: ['PLAN.md', 'SUMMARY.md'],
  shipping: ['PLAN.md', 'SUMMARY.md', 'VERIFICATION.md'],
};

/**
 * Check if .iflow/ directory exists
 */
export async function iflowDirectoryExists(changeDir: string): Promise<boolean> {
  return directoryExists(`${changeDir}/.iflow`);
}

/**
 * Check all IFlow guards
 */
export async function checkIFlowGuards(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  const guards = [
    await checkScopeReductionGuard(changeDir, data),
    await checkArtifactCompletenessGuard(changeDir, data),
    await checkCyclicTransitionGuard(changeDir, data),
  ];

  const allWarnings: string[] = [];
  for (const g of guards) {
    if (g.warnings?.length) {
      allWarnings.push(...g.warnings);
    }
  }

  const blockingGuards = guards.filter(g => g.block);
  if (blockingGuards.length > 0) {
    return {
      success: false,
      error: 'IFlow guard conditions not met',
      block: true,
      blockReason: blockingGuards.map(g => g.blockReason).join('; '),
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    };
  }

  return {
    success: true,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
  };
}

/**
 * Scope Reduction Prohibition Guard
 * Blocks removal of stated requirements from PLAN.md without user approval
 */
async function checkScopeReductionGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!data) return { success: true };

  const toolName = (data.toolName as string) || '';
  if (toolName !== 'write' && toolName !== 'edit') return { success: true };

  const filePath = (data.filePath as string) || '';
  if (!filePath.includes('PLAN.md')) return { success: true };

  // Read current PLAN.md if it exists
  const planContent = await readFile(`${changeDir}/.iflow/PLAN.md`);
  if (!planContent) return { success: true };

  // Read CONTEXT.md for original requirements
  const contextContent = await readFile(`${changeDir}/.iflow/CONTEXT.md`);
  if (!contextContent) return { success: true };

  // Check for scope reduction language patterns
  const reductionPatterns = [
    /v1|simplified\s*version|placeholder|basic\s*version|minimal\s*implementation/i,
    /future\s*enhancement|will\s*be\s*wired\s*later|skip\s*for\s*now/i,
    /static\s*for\s*now|hardcoded\s*for\s*now/i,
  ];

  // Extract requirements from CONTEXT.md (lines under ## Goals or ## Constraints)
  const contextLines = contextContent.split('\n');
  const requirements: string[] = [];
  let inGoalSection = false;
  for (const line of contextLines) {
    if (line.startsWith('## ')) {
      inGoalSection = line.includes('Goal') || line.includes('Constraint') || line.includes('Requirement');
      continue;
    }
    if (inGoalSection && line.trim().startsWith('-')) {
      requirements.push(line.trim());
    }
  }

  // Check if PLAN.md has reduction language
  for (const pattern of reductionPatterns) {
    const match = planContent.match(pattern);
    if (match) {
      return {
        success: false,
        block: true,
        blockReason: `[IFLOW] Scope reduction detected: "${match[0]}" in PLAN.md. Requirement reduction without user approval is prohibited.`,
      };
    }
  }

  return { success: true };
}

/**
 * Artifact Completeness Guard
 * Blocks state transitions when required .iflow/ artifacts are missing
 */
async function checkArtifactCompletenessGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!data) return { success: true };

  const targetState = data.targetState as string;
  if (!targetState || !IFLOW_STATES.includes(targetState as IFlowState)) return { success: true };

  const required = REQUIRED_ARTIFACTS[targetState as IFlowState];
  if (!required || required.length === 0) return { success: true };

  const missing: string[] = [];
  for (const artifact of required) {
    const exists = await fileExists(`${changeDir}/.iflow/${artifact}`);
    if (!exists) missing.push(artifact);
  }

  if (missing.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `[IFLOW] Missing required artifacts for "${targetState}": ${missing.join(', ')}. Complete these before transitioning.`,
    };
  }

  return { success: true };
}

/**
 * Cyclic Transition Validation Guard
 * Blocks invalid state jumps (e.g., executing → shipping without verifying)
 */
async function checkCyclicTransitionGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!data) return { success: true };

  const currentState = data.currentState as string;
  const targetState = data.targetState as string;

  if (!currentState || !targetState) return { success: true };
  if (!IFLOW_STATES.includes(currentState as IFlowState) || !IFLOW_STATES.includes(targetState as IFlowState)) {
    return { success: true };
  }

  const allowed = VALID_TRANSITIONS[currentState as IFlowState];
  if (!allowed) {
    return {
      success: false,
      block: true,
      blockReason: `[IFLOW] Invalid transition: "${currentState}" is not a valid IFlow state.`,
    };
  }

  if (!allowed.includes(targetState as IFlowState)) {
    const validTargets = allowed.join(', ');
    return {
      success: false,
      block: true,
      blockReason: `[IFLOW] Invalid transition: "${currentState}" → "${targetState}". Valid targets: ${validTargets}`,
    };
  }

  return { success: true };
}