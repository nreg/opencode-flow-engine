/**
 * Workflow transition-related guard checks.
 * Extracted from guard.ts for maintainability.
 */

import type { HookResult } from "../../types.js";
import { fileExists, readJsonFile, readFile } from "@opencode-flow-engine/shared";
import { getStateFilePath } from "../../../features/state-manager.js";
import { readExecutionPlan as readExecutionPlanFeature } from "../../../features/execution-plan.js";

/**
 * Block fast-path transitions when the current workflow mode does not allow them.
 * - full mode: block exploring→bridging (hotfix path) and exploring→approved-for-build (tweak path)
 * - hotfix mode: block exploring→approved-for-build (tweak path)
 * - tweak mode: all transitions are valid
 */
export async function checkWorkflowModeTransition(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  if (activeWorkflow !== 'sflow') return { success: true };

  // Only check when a state transition is being attempted
  const newState = data?.newState as string | undefined;
  if (!newState) return { success: true };

  const stateData = await readJsonFile<{ state?: string; mode?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  const currentState = stateData?.state || 'exploring';
  const mode = stateData?.mode || 'full';

  const transitionKey = `${currentState}:${newState}`;

  // Fast-path transitions only allowed for specific modes
  const fastPathRestrictions: Record<string, string[]> = {
    'exploring:bridging': ['hotfix'],
    'exploring:approved-for-build': ['tweak'],
  };

  const allowedModes = fastPathRestrictions[transitionKey];
  if (allowedModes && !allowedModes.includes(mode)) {
    const modeNames = allowedModes.join(' or ');
    const properPath = mode === 'full'
      ? 'exploring → specifying → bridging → approved-for-build'
      : 'exploring → bridging → approved-for-build';
    return {
      success: false,
      block: true,
      blockReason: `[SFLOW] Workflow mode guard: transition "${currentState} → ${newState}" is a ${modeNames}-only fast-path, but current mode is "${mode}". Route through the proper path: ${properPath}.`,
    };
  }

  return { success: true };
}

/**
 * Debugging state check — blocks non-debugging operations from non-debugging agents.
 * Uses both action string (from tool.execute.before) and agent name (from context.data).
 */
export async function checkDebuggingState(changeDir: string, action?: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const hasSflowState = await fileExists(`${changeDir}/${getStateFilePath('sflow')}`);
  if (!hasSflowState) return { success: true };

  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  if (stateData?.state !== "debugging") return { success: true };

  const agent = (data?.agent as string) || '';
  const isDebugAction =
    action?.includes("bug-investigator") ||
    action?.includes("debugging") ||
    action?.includes("tool:workflow_router") ||
    action?.includes("build-executor") ||
    (agent !== '' && (agent.includes("bug-investigator") || agent.includes("build-executor")));

  if (!isDebugAction) {
    return {
      success: false, block: true,
      blockReason: "Workflow is in debugging state. Only bug-investigator and build-executor (for fix verification) can operate. Fix the bug and transition back to executing before continuing.",
    };
  }
  return { success: true };
}

export async function checkTaskCompletion(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // IFlow uses PLAN.md (GSD-style) rather than SFlow's tasks.md
  if (activeWorkflow === 'iflow') return { success: true };

  const tasksContent = await readFile(`${changeDir}/tasks.md`);
  if (!tasksContent) return { success: true };

  const taskLines = tasksContent.split("\n").filter((line: string) => line.match(/^-\s*\[.\]\s+/));
  const incompleteTasks = taskLines.filter((line: string) => line.match(/^-\s*\[\s\]\s+/));

  if (incompleteTasks.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `${incompleteTasks.length} task(s) are incomplete. Complete all tasks before closing.`,
    };
  }

  // CG-3: Also check wave completion when execution-plan.json exists
  const plan = await readExecutionPlanFeature(changeDir);
  if (plan && plan.waves && plan.waves.length > 0) {
    const wavesMissingReceipts: string[] = [];
    for (const wave of plan.waves) {
      const receiptPath = `${changeDir}/.flow-engine/sflow/reviews/${wave.id}.json`;
      const receiptExists = await fileExists(receiptPath);
      if (!receiptExists) {
        wavesMissingReceipts.push(wave.id);
        continue;
      }
      const receipt = await readJsonFile<{ status?: string }>(receiptPath);
      if (!receipt || receipt.status !== 'pass') {
        wavesMissingReceipts.push(wave.id);
      }
    }
    if (wavesMissingReceipts.length > 0) {
      return {
        success: false,
        block: true,
        blockReason: `Wave completion check: ${wavesMissingReceipts.length} wave(s) lack passing receipts (${wavesMissingReceipts.join(', ')}). All waves must have passing review receipts before closing.`,
      };
    }
  }

  return { success: true };
}
