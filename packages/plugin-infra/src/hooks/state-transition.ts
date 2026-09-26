import type { HookHandler, HookContext, HookResult } from './types.js';
import { isValidTransition, getValidTransitions } from '@opencode-flow-engine/core';
import { fileExists, directoryExists, readJsonFile, readFile } from '@opencode-flow-engine/shared';
import { checkArtifactPreflight, findPreflightState } from '../features/artifact-preflight.js';
import { writeStateFile } from '../features/state-manager.js';
import { recommendExecutionMode } from '../features/execution-plan.js';
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

