import type { HookHandler, HookContext, HookResult } from './types.js';
import { isValidTransition, getValidTransitions } from '@opencode-flow-engine/core';
import { fileExists, directoryExists, readJsonFile, readFile } from '@opencode-flow-engine/shared';
import { checkArtifactPreflight, findPreflightState } from '../features/artifact-preflight.js';
import { writeStateFile } from '../features/state-manager.js';
import { recommendExecutionMode, recordReviewBase } from '../features/execution-plan.js';
import { resolveArtifactLanguage, checkAndDetectLanguage } from '../features/artifact-language.js';
import { formatGuardFixHint } from '../features/guard-fix-hint.js';
import { readArtifactContent } from '../features/state-manager/artifact-paths.js';
import { Logger } from '../utils/logger.js';

const STATE_FILE_PATH = '.flow-engine/sflow/state.json';

/**
 * Create the state transition hook
 */
export function createStateTransitionHook(): HookHandler {
  return {
    name: 'state_transition',
    description: 'Manage workflow state transitions and validate transitions',
    execute: async (context) => {
      const { changeDir, data } = context;

      try {
        const currentState = await getCurrentState(changeDir);
        const newState = data?.newState as string;

        if (!newState) {
          return { success: true, data: { currentState } };
        }

        if (!currentState) {
          await updateState(changeDir, newState);
          return {
            success: true,
            data: { from: null, to: newState, timestamp: new Date().toISOString() },
          };
        }

        if (!isValidTransition(currentState, newState)) {
          const valid = getValidTransitions(currentState);
          return {
            success: false,
            error: `Invalid transition from ${currentState} to ${newState}`,
            block: true,
            blockReason: `Cannot transition from ${currentState} to ${newState}. Valid transitions: ${valid.join(', ')}`,
          };
        }

        // P2 (guard-diagnostics): debugging → specifying/bridging 回退维度显式化
        // 回退必须显式提供原因；缺原因被拒（报错含 Fix 指引），有原因则记录到 state 转换记录
        const extra = await checkDebuggingRollbackReason({
          currentState,
          newState,
          data,
        });
        if (extra.blocked) {
          return {
            success: false,
            error: 'Debugging rollback requires an explicit reason',
            block: true,
            blockReason: extra.blockReason,
          };
        }

        // P1 fix: Preflight gate — check target state's required artifacts BEFORE transitioning
        const pf = await checkArtifactPreflight({
          changeDir,
          targetState: newState,
          fileExists,
          directoryExists,
          readJson: readJsonFile,
        });
        if (!pf.passed) {
          const route = findPreflightState(pf.missing);
          return {
            success: false,
            error: `Preflight gate: missing artifacts for state "${newState}": ${pf.missing.join(', ')}`,
            block: true,
            blockReason: '[SFLOW] Preflight gate: missing ' + pf.missing.join(', ') + '. Route to "' + route + '" first.',
          };
        }

        // DP-4: Auto-recommend execution mode on bridging→approved-for-build
        const dp4extra: Record<string, unknown> = extra.extra || {};
        if (currentState === 'bridging' && newState === 'approved-for-build') {
          try {
            const tasksMdContent = await readArtifactContent(changeDir, 'tasks.md');
            if (tasksMdContent) {
              const dp4Result = recommendExecutionMode(tasksMdContent);
              dp4extra.dp_4_result = dp4Result;
            }
          } catch {
          }
        }

        // T3.5: DP-0 语言检测 — 仅在 exploring→specifying 时检测一次
        // DP-0 确认后持久化到 state.json 的 artifact_language 字段，之后不再变更
        if (currentState === 'exploring' && newState === 'specifying') {
          try {
            const artifactLanguage = await resolveArtifactLanguage({ projectRoot: changeDir });
            dp4extra.artifact_language = artifactLanguage;
          } catch (error) {
            // 检测失败不影响状态转换，使用默认值 'en'
            dp4extra.artifact_language = 'en';
            Logger.warn(`[T3.5] Artifact language detection failed, using default "en": ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // T3.6: 补检测逻辑 — 路由到 spec-writer 前检查
        // 如果 DP-0 已确认（从其他状态转换到 specifying）但 artifact_language 缺失，则补检测
        if (currentState !== 'exploring' && newState === 'specifying') {
          try {
            const stateData = await readStateFile(changeDir);
            const currentLanguage = stateData?.artifact_language as 'zh' | 'en' | undefined;
            const detectedLanguage = await checkAndDetectLanguage(changeDir, currentLanguage);
            if (detectedLanguage) {
              dp4extra.artifact_language = detectedLanguage;
            }
          } catch (error) {
            // 补检测失败不影响状态转换
            Logger.warn(`[T3.6] Artifact language backfill detection failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // P1-5: Record review_base when entering executing (WRITE_ONCE)
        const rb = await checkReviewBaseRecording({ changeDir, currentState, newState, data });
        if (rb.blocked) {
          return {
            success: false,
            error: 'Failed to record review base',
            block: true,
            blockReason: rb.blockReason,
          };
        }
        Object.assign(dp4extra, rb.extra);

        await updateState(changeDir, newState, Object.keys(dp4extra).length > 0 ? dp4extra : undefined);

        return {
          success: true,
          data: {
            from: currentState,
            to: newState,
            timestamp: new Date().toISOString(),
          },
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

async function getCurrentState(changeDir: string): Promise<string | null> {
  const state = await readStateFile(changeDir);
  if (state) {
    return (state.state as string) || (state.currentState as string) || 'exploring';
  }
  return null;
}

async function readStateFile(changeDir: string): Promise<Record<string, unknown> | null> {
  if (!changeDir) return null;
  return await readJsonFile(`${changeDir}/${STATE_FILE_PATH}`);
}

async function updateState(changeDir: string, newState: string, extra?: Record<string, unknown>): Promise<void> {
  await writeStateFile(changeDir, newState, extra);
}

/**
 * P2 (guard-diagnostics): debugging → specifying/bridging 回退维度显式化。
 *
 * - 回退必须显式提供 data.rollbackReason；缺原因被拒（报错含 Fix 指引）
 * - 有原因时构造记录字段（rollback_from / rollback_target / rollback_reason），
 *   由 writeStateFile 写入 state 转换记录，供追溯
 */
export function checkDebuggingRollbackReason(input: {
  currentState: string;
  newState: string;
  data?: { rollbackReason?: unknown } & Record<string, unknown>;
}): { blocked: boolean; blockReason?: string; extra: Record<string, unknown> } {
  const { currentState, newState, data } = input;
  const isRollback = currentState === 'debugging' && (newState === 'specifying' || newState === 'bridging');
  if (!isRollback) return { blocked: false, extra: {} };

  const reason = typeof data?.rollbackReason === 'string' ? data.rollbackReason.trim() : '';
  if (!reason) {
    const hint = formatGuardFixHint(
      '重试状态转换时携带 data.rollbackReason（回退原因与整改摘要）',
      'state_transition(data.newState=..., data.rollbackReason=...)',
    );
    return {
      blocked: true,
      blockReason: `[SFLOW] Debugging rollback to "${newState}" requires an explicit rollback reason. Provide data.rollbackReason describing why the rollback is needed (e.g. missing spec boundary, design assumption failure).\n${hint}`,
      extra: {},
    };
  }

  return {
    blocked: false,
    extra: {
      rollback_from: currentState,
      rollback_target: newState,
      rollback_reason: reason,
      rollback_at: new Date().toISOString(),
    },
  };
}

/**
 * P1-5: Resolve the current HEAD commit SHA in a git environment.
 * Returns undefined when git is unavailable (non-git environment).
 */
async function resolveHeadSha(changeDir: string): Promise<string | undefined> {
  // P3: 异步 execGitAsync 替代 execFileSync，避免阻塞事件循环
  const { execGitAsync } = await import('../helpers/git-async.js');
  const stdout = await execGitAsync(['rev-parse', 'HEAD'], changeDir);
  return stdout?.trim();
}

/**
 * P1-5 (spec: execution-plan review_base): 进入 executing 时记录 review_base（WRITE_ONCE）。
 *
 * - 仅 approved-for-build → executing 转换触发；其他转换为 no-op
 * - base SHA 优先取 data.reviewBase（显式提供），否则在 git 环境取 HEAD
 * - 非 git 环境或无 execution plan：降级为 no-op，绝不阻断状态转换
 * - data.reviewBase 无效时阻断（显式提供的 SHA 无法解析是调用方错误）
 */
export async function checkReviewBaseRecording(input: {
  changeDir: string;
  currentState: string;
  newState: string;
  data?: { reviewBase?: unknown } & Record<string, unknown>;
}): Promise<{ blocked: boolean; blockReason?: string; extra: Record<string, unknown> }> {
  const { changeDir, currentState, newState, data } = input;

  // Only wire on approved-for-build → executing
  if (!(currentState === 'approved-for-build' && newState === 'executing')) {
    return { blocked: false, extra: {} };
  }

  // Resolve the base SHA: explicit data.reviewBase wins, else HEAD in git environments
  const explicitSha = typeof data?.reviewBase === 'string' && data.reviewBase.trim()
    ? data.reviewBase.trim()
    : undefined;
  const sha = explicitSha ?? await resolveHeadSha(changeDir);

  try {
    const reviewBase = await recordReviewBase(changeDir, sha);
    return {
      blocked: false,
      extra: reviewBase ? { review_base: reviewBase } : {},
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Explicit SHA provided but invalid → block (caller error must surface)
    if (explicitSha) {
      return {
        blocked: true,
        blockReason: `[SFLOW] Failed to record review base: ${reason}`,
        extra: {},
      };
    }
    // Non-git environment or no execution plan: degrade gracefully
    Logger.warn(`[P1-5] Skipping review_base recording: ${reason}`);
    return { blocked: false, extra: {} };
  }
}

