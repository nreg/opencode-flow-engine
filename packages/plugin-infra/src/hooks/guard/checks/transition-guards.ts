/**
 * Workflow transition-related guard checks.
 * Extracted from guard.ts for maintainability.
 */

import type { HookResult } from "../../types.js";
import { fileExists, readJsonFile, readFile } from "@opencode-flow-engine/shared";
import { getStateFilePath } from "../../../features/state-manager.js";
import { readExecutionPlan as readExecutionPlanFeature } from "../../../features/execution-plan.js";
import { readArtifactContent } from "../../../features/state-manager/artifact-paths.js";
import { formatGuardFixHint, GUARD_FIX_ENTRIES } from "../../../features/guard-fix-hint.js";

/**
 * Fast-path transition restriction table（快路径准入表）。
 * 表中的转换**仅**允许列出的 mode；命中表但 mode 不在列表中 → 明确报错，
 * 不得静默套用 full 主表放行（unknownTransitionFailure 原则，FP-R2）。
 *
 * 与 `workflow-recommendation.ts` 的 `WORKFLOW_MODES`（full/hotfix/tweak/quick）保持一致：
 * - exploring → bridging：仅 hotfix
 * - exploring → approved-for-build：tweak 与 quick（D2：quick 直达，不新增第五种模式）
 */
export const FAST_PATH_RESTRICTIONS: Record<string, string[]> = {
  'exploring:bridging': ['hotfix'],
  'exploring:approved-for-build': ['tweak', 'quick'],
};

/** 未知 / 空 mode 的展示值，保证报错里能看出实际读到了什么。 */
const EMPTY_MODE_PLACEHOLDER = '(empty)';

function resolveMode(rawMode: unknown): string {
  if (typeof rawMode === 'string') {
    const trimmed = rawMode.trim();
    return trimmed === '' ? EMPTY_MODE_PLACEHOLDER : trimmed;
  }
  if (rawMode === undefined || rawMode === null) return 'full';
  return String(rawMode);
}

/**
 * 判定某转换是否在快路径限制表内、以及当前 mode 是否被放行。
 * 跨批次契约函数（供 workflowPolicy / Wave 2 复用）。
 *
 * @returns `{ allowed, allowedModes }`；`allowedModes` 为空数组表示**不受快路径限制**
 */
export function isFastPathAllowed(from: string, to: string, mode: string): { allowed: boolean; allowedModes: string[] } {
  const allowedModes = FAST_PATH_RESTRICTIONS[`${from}:${to}`] ?? [];
  if (allowedModes.length === 0) return { allowed: true, allowedModes: [] };
  return { allowed: allowedModes.includes(mode), allowedModes };
}

/** 各 mode 应走的「正确路径」，用于报错与 Fix 指引。 */
function properPathFor(mode: string): string {
  if (mode === 'full') return 'exploring → specifying → bridging → approved-for-build';
  if (mode === 'quick') return 'exploring → approved-for-build';
  return 'exploring → bridging → approved-for-build';
}

/**
 * Block fast-path transitions when the current workflow mode does not allow them.
 * - full mode: block exploring→bridging (hotfix path) and exploring→approved-for-build (tweak/quick path)
 * - hotfix mode: block exploring→approved-for-build (tweak/quick path)
 * - quick mode: allow exploring→approved-for-build, block exploring→bridging
 * - tweak mode: all transitions are valid
 *
 * 命中限制表但 mode 不匹配时 MUST 明确报错（success:false + block:true），
 * MUST NOT 静默回落 full 主表；报错含当前 mode、允许集合、正确路径与 `Fix:` 入口。
 */
export async function checkWorkflowModeTransition(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  if (activeWorkflow !== 'sflow') return { success: true };

  // Only check when a state transition is being attempted
  const newState = data?.newState as string | undefined;
  if (!newState) return { success: true };

  const stateData = await readJsonFile<{ state?: string; mode?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  const currentState = stateData?.state || 'exploring';
  const mode = resolveMode(stateData?.mode);

  const { allowed, allowedModes } = isFastPathAllowed(currentState, newState, mode);

  // 命中快路径限制表但 mode 不在允许集合 → 明确报错（不套用 full 主表）
  if (allowedModes.length > 0 && !allowed) {
    const modeNames = allowedModes.join(' or ');
    const properPath = properPathFor(mode);
    const reason = `[SFLOW] Workflow mode guard: transition "${currentState} → ${newState}" is a ${modeNames}-only fast-path, but current mode is "${mode}". Route through the proper path: ${properPath}.`;
    return {
      success: false,
      block: true,
      blockReason: `${reason}\n${formatGuardFixHint(`走 ${properPath}`, GUARD_FIX_ENTRIES.contractBuilderRouter)}`,
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

  const tasksContent = await readArtifactContent(changeDir, 'tasks.md');
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
