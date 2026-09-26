/**
 * Guard hook - Guard state transitions and block invalid operations
 * READ-ONLY: This hook NEVER writes state or artifacts. It only detects and reports.
 * State mutations (upgrades, repairs) happen through state-manager or workflow-manager.
 *
 * All file-level write guards (C4, C5, terminal state, illegal phase jump)
 * are consolidated here. Callers (index.ts) pass tool/agent/filePath info
 * through context.data and check the returned block flag.
 */

import type { HookHandler, HookContext, HookResult } from "./types.js";
import { fileExists, directoryExists, readJsonFile } from "@opencode-flow-engine/shared";
import { getStateFilePath } from "../features/state-manager.js";
import { iflowDirectoryExists, checkIFlowGuards } from "./iflow-guard.js";
import {
  checkArtifactAndPhaseConsistency,
  checkPresetUpgrade,
  checkContractStalenessGuard,
  checkWaveDependencies,
  checkReceiptIntegrity,
  checkClosingGate,
  checkSpecsMerged,
  checkFileWriteGuard,
  checkReadFilesBoundary,
  checkGitCommitBoundary,
  checkSchemaMigrationGuard,
  checkLessonsGuard,
  checkProgressAntiRepeatGuard,
  checkWorkflowModeTransition,
  checkDebuggingState,
  checkTaskCompletion,
  checkAbstractionGrepGuard,
} from "./guard/checks/index.js";
import type { SchemaMigrationGuardOptions } from "./guard/checks/index.js";
import { checkDirectShortPath, isDirectShortPathTransition } from "../features/guard-checks/check-direct-short-path.js";
import { formatGuardFixHint, GUARD_FIX_ENTRIES } from "../features/guard-fix-hint.js";

export async function detectActiveWorkflow(changeDir: string): Promise<'iflow' | 'sflow' | 'none'> {
  const iflowExists = await directoryExists(`${changeDir}/.flow-engine/iflow`);
  if (iflowExists) return 'iflow';
  const sflowExists = await directoryExists(`${changeDir}/.flow-engine/sflow`);
  if (sflowExists) return 'sflow';
  return 'none';
}

/**
 * GI-1: Warn when on main/master branch during execution.
 * Warns build-executor about working on main/master branches during executing/debugging
 * states. Does NOT block — personal/solo projects may intentionally work on main.
 * READ-ONLY (C4): never writes state.
 */
async function checkGitBranchIsolation(
  changeDir: string,
  data: Record<string, unknown> | undefined,
  activeWorkflow: 'iflow' | 'sflow' | 'none',
): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // C7: Only apply for sflow workflow
  if (activeWorkflow !== 'sflow') return { success: true };

  // Only check during executing/debugging states
  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  const currentState = stateData?.state;
  if (currentState !== 'executing' && currentState !== 'debugging') return { success: true };

  // Only check for build-executor agent (the agent writing code)
  const agent = data?.agent as string | undefined;
  if (agent !== 'build-executor') return { success: true };

  try {
    const { execSync } = await import('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: changeDir,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (branch === 'main' || branch === 'master') {
      return {
        success: true,
        warnings: [
          `[SFLOW] Git branch isolation: currently on "${branch}" branch. Consider using a feature branch for team projects.`,
        ],
      };
    }
  } catch {
    // Not a git repo or git not available — skip silently
  }

  return { success: true };
}

/**
 * Get IFlow guards — only active when .flow-engine/iflow/ directory exists.
 * This ensures IFlow guards never interfere with SFlow workflows.
 */
async function getIFlowGuards(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult[]> {
  if (!changeDir) return [];
  if (activeWorkflow === 'sflow') return [];
  if (activeWorkflow !== 'iflow') {
    const hasIflow = await iflowDirectoryExists(changeDir);
    if (!hasIflow) return [];
  }

  const iflowResult = await checkIFlowGuards(changeDir, data);
  return [iflowResult];
}

/**
 * Direct 短路径门禁（编排挂载版，F2 死代码修复）。
 *
 * `checkDirectShortPath` 此前只有函数级单测、从未出现在 `createGuardHook()` 的检查数组里，
 * 属于「写好了但没生效」的死代码（lessons L-002）。本函数把它接入编排：
 * - 仅 sflow 工作流、且转换属于 direct short path（quick/tweak/hotfix 的快路径）时参与判定
 * - 证据裁决统一来自 `workflowPolicy`，本函数只负责把结论翻译成 HookResult
 * - 非快路径场景（如 full 的常规转换）直接放行，不误伤
 */
async function checkDirectShortPathGuard(
  changeDir: string,
  data: Record<string, unknown> | undefined,
  activeWorkflow: 'iflow' | 'sflow' | 'none',
): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };
  if (activeWorkflow !== 'sflow') return { success: true };

  const newState = data.newState as string | undefined;
  if (!newState) return { success: true };

  const stateData = await readJsonFile<{ state?: string; mode?: string; workflow?: string }>(
    `${changeDir}/${getStateFilePath('sflow')}`,
  );
  const currentState = stateData?.state || 'exploring';
  const workflow = String(stateData?.workflow ?? stateData?.mode ?? '').trim() || 'full';

  if (!isDirectShortPathTransition(currentState, newState, workflow)) return { success: true };

  const result = await checkDirectShortPath(changeDir, workflow);
  if (result.pass) return { success: true };

  return {
    success: false,
    block: true,
    blockReason: `[SFLOW] direct-short-path guard: ${result.failures.join('; ')}\n${formatGuardFixHint(
      `补齐 ${workflow} 工作流所需的 workflow-selection 收据`,
      GUARD_FIX_ENTRIES.contractBuilderRouter,
    )}`,
  };
}

/**
 * Create the guard hook
 */
export function createGuardHook(): HookHandler {
  return {
    name: "guard",
    description: "Guard state transitions and block invalid operations (read-only)",
    execute: async (context) => {
      const { changeDir, data } = context;

      try {
        const activeWorkflow = await detectActiveWorkflow(changeDir);

        const guards = [
          await checkArtifactAndPhaseConsistency(changeDir, activeWorkflow),
          await checkPresetUpgrade(changeDir, activeWorkflow),
          await checkContractStalenessGuard(changeDir, activeWorkflow),
          await checkWorkflowModeTransition(changeDir, data, activeWorkflow),
          await checkDirectShortPathGuard(changeDir, data, activeWorkflow),
          await checkTaskCompletion(changeDir, activeWorkflow),
          await checkWaveDependencies(changeDir, activeWorkflow),
          await checkReceiptIntegrity(changeDir, activeWorkflow),
          await checkClosingGate(changeDir, activeWorkflow),
          await checkSpecsMerged(changeDir, activeWorkflow),
          await checkGitBranchIsolation(changeDir, data, activeWorkflow),
          await checkDebuggingState(changeDir, context.action, data, activeWorkflow),
          await checkProgressAntiRepeatGuard(changeDir, data, activeWorkflow),
          await checkFileWriteGuard(changeDir, data, activeWorkflow),
          await checkReadFilesBoundary(changeDir, data, activeWorkflow),
          await checkGitCommitBoundary(changeDir, data, activeWorkflow),
          await checkSchemaMigrationGuard(changeDir),
          await checkLessonsGuard(changeDir, data, activeWorkflow),
          await checkAbstractionGrepGuard(changeDir, data),
          ...(await getIFlowGuards(changeDir, data, activeWorkflow)),
        ];

        const allWarnings: string[] = [];
        for (const g of guards) {
          if (g.warnings && g.warnings.length > 0) {
            allWarnings.push(...g.warnings);
          }
        }

        const blockingGuards = guards.filter((g) => g.block);
        if (blockingGuards.length > 0) {
          return {
            success: false,
            error: "Guard conditions not met",
            block: true,
            blockReason: blockingGuards.map((g) => g.blockReason).join("; "),
            warnings: allWarnings.length > 0 ? allWarnings : undefined,
          };
        }

        return {
          success: true,
          warnings: allWarnings.length > 0 ? allWarnings : undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

// Re-export from checks for backward compatibility
export { checkSchemaMigrationGuard, checkAbstractionGrepGuard };
export type { SchemaMigrationGuardOptions };
