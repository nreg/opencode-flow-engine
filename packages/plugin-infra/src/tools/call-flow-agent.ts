/**
 * Shared CallFlowAgent Tool Factory
 *
 * Creates the call_flow_agent, flowagent_output, and flowagent_cancel tool definitions.
 * Used by iflow-plugin-factory, sflow-plugin-factory, and combined-plugin-factory
 * to avoid duplicating the same session creation/polling/background task logic.
 */

import { z } from 'zod';
import { createNotificationManager } from '../features/notification-manager.js';
import { createSubagentStore } from '../features/subagent-store.js';
import {
  hasCompletionSignal,
  performCompletionRetry,
  REMINDER_MESSAGE,
} from '../helpers/completion-detector.js';
import { extractJsonBlock, getSchemaHint } from '../helpers/output-extractor.js';
import {
  pollSessionCompletion,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_SYNC_MAX_WAIT_MS,
} from '../helpers/polling.js';
import { resolveChangeDir } from '../helpers/resolve-change-dir.js';
import type {
  AgentModelMap,
  BackgroundTaskEntry,
  BackgroundTaskRegistry,
  SFlowClient,
} from '../types.js';
import { formatToolError, generateTaskId } from '../types.js';
import type { ToolDefinition } from './types.js';

/** Maximum concurrent subagent sessions of the same type */
const MAX_CONCURRENT_SUBAGENTS = 3;

/** Tracks running subagent count per subagent type */
const runningSubagentCounts = new Map<string, number>();

/** Reset running subagent counts (for testing) */
export function resetRunningSubagentCounts(): void {
  runningSubagentCounts.clear();
}

/**
 * Increment the running count for a subagent type.
 * Returns true if the limit was not exceeded, false otherwise.
 */
function acquireSubagentSlot(subagentType: string): boolean {
  const current = runningSubagentCounts.get(subagentType) ?? 0;
  if (current >= MAX_CONCURRENT_SUBAGENTS) {
    return false;
  }
  runningSubagentCounts.set(subagentType, current + 1);
  return true;
}

/**
 * Decrement the running count for a subagent type.
 */
function releaseSubagentSlot(subagentType: string): void {
  const current = runningSubagentCounts.get(subagentType) ?? 0;
  if (current <= 1) {
    runningSubagentCounts.delete(subagentType);
  } else {
    runningSubagentCounts.set(subagentType, current - 1);
  }
}

// ─── BackgroundTaskWatcher ─────────────────────────────────────────────────────

/**
 * BackgroundTaskWatcher - 自动检测后台任务完成/错误
 *
 * 定期扫描 registry 中 running 状态的 task，委托 Polling Layer 检测完成/错误，
 * 自动更新 registry、释放并发槽位、写通知、更新 subagent-store。
 */
export interface BackgroundTaskWatcher {
  start(): void;
  stop(): void;
}

export interface CreateWatcherOptions {
  client: SFlowClient;
  registry: BackgroundTaskRegistry;
  pollIntervalMs?: number;
}

export function createBackgroundTaskWatcher(options: CreateWatcherOptions): BackgroundTaskWatcher {
  const { client, registry, pollIntervalMs = 200 } = options;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function checkTasks(): Promise<void> {
    const runningTasks = Array.from(registry.entries()).filter(
      ([, task]) => task.status === 'running',
    );

    for (const [taskId, task] of runningTasks) {
      // P1-1: Check processing flag to prevent race with pollAndComplete
      const currentTask = registry.get(taskId);
      if (!currentTask || currentTask.status !== 'running' || currentTask._processing) {
        continue;
      }

      // Set processing flag
      currentTask._processing = true;
      registry.set(taskId, currentTask);

      try {
        const output = await pollSessionCompletion(
          client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
          task.sessionID,
          { maxWaitMs: 1000 },
        );

        if (output === null) {
          const now = Date.now();
          const updated: BackgroundTaskEntry = {
            ...task,
            status: 'error',
            error: 'Task failed after max retries',
            completedAt: now,
            slotReleased: task.slotReleased ?? false,
          };
          registry.set(taskId, updated);

          if (!updated.slotReleased && updated.status !== 'running') {
            releaseSubagentSlot(task.subagentType);
            updated.slotReleased = true;
            registry.set(taskId, updated);
          }

          try {
            const nm = createNotificationManager({ changeDir: task.changeDir || '' });
            await nm.writeNotification({
              type: 'async_error',
              subagent: task.subagentType,
              task_id: taskId,
              session_id: task.sessionID,
              summary: 'Task failed after max retries',
            });
          } catch (err) {
            console.warn('[BackgroundTaskWatcher] 写入错误通知失败:', err);
          }

          try {
            const store = createSubagentStore({ changeDir: task.changeDir || '' });
            const agents = await store.listAgents();
            const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
            if (matchedAgent) {
              await store.updateOutput(matchedAgent.agent_id, '', { status: 'error' });
              await store.appendEvent(matchedAgent.agent_id, {
                timestamp: new Date().toISOString(),
                event_type: 'error',
                detail: `Async task ${taskId} failed: max retries exceeded`,
              });
            }
          } catch (err) {
            console.warn('[BackgroundTaskWatcher] 更新 subagent-store 失败:', err);
          }
        } else if (output !== null) {
          const asyncHasSignal = hasCompletionSignal(output);
          const now = Date.now();
          const updated: BackgroundTaskEntry = {
            ...task,
            status: 'completed',
            result: output,
            completedAt: now,
            slotReleased: task.slotReleased ?? false,
            _errorCount: 0,
          };
          registry.set(taskId, updated);

          if (!updated.slotReleased && updated.status !== 'running') {
            releaseSubagentSlot(task.subagentType);
            updated.slotReleased = true;
            registry.set(taskId, updated);
          }

          try {
            const nm = createNotificationManager({ changeDir: task.changeDir || '' });
            await nm.writeNotification({
              type: 'async_completed',
              subagent: task.subagentType,
              task_id: taskId,
              session_id: task.sessionID,
              summary: output.slice(0, 200),
              has_completion_signal: asyncHasSignal,
            });
          } catch (err) {
            console.warn('[BackgroundTaskWatcher] 写入完成通知失败:', err);
          }

          try {
            const store = createSubagentStore({ changeDir: task.changeDir || '' });
            const agents = await store.listAgents();
            const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
            if (matchedAgent) {
              await store.updateOutput(matchedAgent.agent_id, output);
              await store.appendEvent(matchedAgent.agent_id, {
                timestamp: new Date().toISOString(),
                event_type: 'completed',
                detail: `Async task ${taskId} completed`,
              });
            }
          } catch (err) {
            console.warn('[BackgroundTaskWatcher] 更新 subagent-store 失败:', err);
          }
        }
      } catch (err) {
        console.warn('[BackgroundTaskWatcher] 检查任务失败:', err);
        const currentTaskForError = registry.get(taskId);
        if (currentTaskForError && currentTaskForError.status === 'running') {
          const now = Date.now();
          const errorCount = currentTaskForError._errorCount ?? 0;
          
          if (errorCount >= 3) {
            // F-2: Re-fetch latest state before updating to avoid overwriting concurrent changes
            const latestTaskBeforeUpdate = registry.get(taskId);
            if (latestTaskBeforeUpdate && latestTaskBeforeUpdate.status === 'running') {
              const updated: BackgroundTaskEntry = {
                ...latestTaskBeforeUpdate,
                status: 'error',
                error: `Task monitoring failed after ${errorCount + 1} attempts: ${err instanceof Error ? err.message : String(err)}`,
                completedAt: now,
                slotReleased: latestTaskBeforeUpdate.slotReleased ?? false,
              };
              registry.set(taskId, updated);
              
              if (!updated.slotReleased) {
                releaseSubagentSlot(latestTaskBeforeUpdate.subagentType);
                updated.slotReleased = true;
                registry.set(taskId, updated);
              }
            }
          } else {
            // F-2: Re-fetch latest state before updating to avoid overwriting concurrent changes
            const latestTaskBeforeUpdate = registry.get(taskId);
            if (latestTaskBeforeUpdate && latestTaskBeforeUpdate.status === 'running') {
              latestTaskBeforeUpdate._errorCount = errorCount + 1;
              registry.set(taskId, latestTaskBeforeUpdate);
            }
          }
        }
      } finally {
        const latest = registry.get(taskId);
        if (latest && latest._processing) {
          latest._processing = false;
          registry.set(taskId, latest);
        }
      }
    }
  }

  return {
    start() {
      if (intervalId !== null) return;
      intervalId = setInterval(checkTasks, pollIntervalMs);
    },
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}

export interface CallFlowAgentOptions {
  /** SFlow client for session management */
  client: SFlowClient;
  /** Background task registry (shared across tools in the same factory) */
  backgroundTaskRegistry: BackgroundTaskRegistry;
  /** Background task counter (shared across tools in the same factory) */
  backgroundTaskCounter: { value: number };
  /** Agent model map (populated during config hook) */
  agentModelMap: AgentModelMap;
  /** Session label prefix (e.g. "iFlow", "sFlow"). Can be a static string or a function that returns a string. */
  sessionLabelPrefix: string | ((subagentType: string, context: Record<string, unknown>) => string);
  /**
   * Validate that the given subagent_type is allowed.
   * Return an error message string if invalid, or null if valid.
   */
  validateAgent: (
    subagentType: string,
    context: Record<string, unknown>,
  ) => Promise<string | null> | string | null;
  /** Tool description prefix for the call_flow_agent tool */
  workflowName: string;
}

/**
 * Create the three call-flow-agent-related tool definitions:
 * - call_flow_agent: invoke a subagent (sync or async)
 * - flowagent_output: retrieve background task results
 * - flowagent_cancel: cancel a running background task
 */
export function createCallFlowAgentTools(
  options: CallFlowAgentOptions,
): Record<string, ToolDefinition> {
  const {
    client,
    backgroundTaskRegistry,
    backgroundTaskCounter,
    agentModelMap,
    sessionLabelPrefix,
    validateAgent,
    workflowName,
  } = options;

  // Resolve session label: support both static string and dynamic function
  const resolveSessionLabel = (subagentType: string, context: Record<string, unknown>): string => {
    const prefix =
      typeof sessionLabelPrefix === 'function'
        ? sessionLabelPrefix(subagentType, context)
        : sessionLabelPrefix;
    return `${prefix} → ${subagentType}`;
  };

  const callFlowAgentTool: ToolDefinition = {
    name: 'call_flow_agent' as never,
    description: `Invoke a specialized ${workflowName} subagent. Supports sync (run_in_background=false) and async (run_in_background=true) modes. Async mode returns a task_id; use flowagent_output to retrieve results when complete.`,
    parameters: {
      description: z.string().describe('Short (3-5 words) description of the task'),
      prompt: z.string().describe('The task for the subagent to perform'),
      subagent_type: z
        .string()
        .describe(
          `The subagent to invoke (e.g. ${workflowName.toLowerCase()}-plan-executor, build-executor)`,
        ),
      run_in_background: z
        .boolean()
        .describe(
          'true=async (returns task_id for flowagent_output), false=sync (waits for completion)',
        ),
      session_id: z.string().optional().describe('Existing session to continue (sync mode only)'),
      agent_id: z
        .string()
        .optional()
        .describe(
          'Resume a previous subagent by agent_id. When provided, context from the previous run is injected into the prompt.',
        ),
      output_mode: z
        .enum(['last_message', 'structured'])
        .optional()
        .describe(
          'Output mode: last_message (default, return raw text) or structured (extract JSON block from output)',
        ),
    } as Record<string, unknown>,
    execute: async (args, context) => {
      const changeDir = resolveChangeDir(undefined, context.directory);
      const {
        subagent_type,
        prompt,
        run_in_background,
        session_id,
        description,
        agent_id,
        output_mode,
      } = args;

      // Validate agent name
      const validationError = await validateAgent(
        subagent_type as string,
        context as unknown as Record<string, unknown>,
      );
      if (validationError) {
        return await formatToolError(validationError);
      }

      // Detect multi-wave packing in build-executor prompts (constraint violation)
      if (subagent_type === 'build-executor') {
        const waveExecutionPattern = /(?:Execute|Run|Perform|Dispatch)\s+Wave\s+\d+/gi;
        const waveMatches = (prompt as string).match(waveExecutionPattern);
        const uniqueWaves = waveMatches ? new Set(waveMatches.map(w => w.toLowerCase())).size : 0;
        
        if (uniqueWaves > 1) {
          return await formatToolError(
            `Wave Orchestration Constraint Violation: Detected ${uniqueWaves} waves in single build-executor prompt. ` +
            `Waves MUST be dispatched one at a time with Review Gate checks between them. ` +
            `Please delegate waves sequentially: Wave 1 → Review Gate → Wave 2 → Review Gate → ...`
          );
        }
        
        if ((prompt as string).toLowerCase().includes('code-reviewer')) {
          console.warn(
            `[Wave Orchestration] WARNING: build-executor prompt contains 'code-reviewer'. ` +
            `Cross-wave code review is sFlow's responsibility, not build-executor's. ` +
            `Consider delegating code-review tasks to sFlow orchestrator instead.`
          );
        }
      }

      const sessionLabel = resolveSessionLabel(
        subagent_type as string,
        context as unknown as Record<string, unknown>,
      );

      // P1: subagent-store 实例
      const store = createSubagentStore({ changeDir });

      try {
        let sessionID: string;
        let isNew = false;
        let effectivePrompt = prompt as string;
        let resolvedAgentId = agent_id as string | undefined;

        // P1: Resume 模式 — 传入 agent_id 时从 subagent-store 恢复上下文
        if (agent_id) {
          try {
            const resumeResult = await store.resumeAgent(agent_id as string, prompt as string);
            effectivePrompt = resumeResult.prompt;
            resolvedAgentId = agent_id as string;
          } catch (resumeErr) {
            const msg = resumeErr instanceof Error ? resumeErr.message : String(resumeErr);
            return await formatToolError(msg);
          }
        }

        if (session_id) {
          if (run_in_background) {
            return await formatToolError(
              'session_id is not supported in background mode. Use run_in_background=false to continue an existing session.',
            );
          }
          sessionID = session_id as string;
        } else {
          const subagentModel = agentModelMap[subagent_type as string];
          if (!subagentModel) {
            return await formatToolError(
              `No model configured for subagent "${subagent_type}". Available agents: ${Object.keys(agentModelMap).join(', ')}`,
            );
          }

          const createResult = await (
            client.session.create as (args: {
              body: Record<string, unknown>;
              query?: Record<string, unknown>;
            }) => Promise<{ data?: { id?: string } }>
          )({
            body: {
              parentID: context.sessionID,
              title: sessionLabel,
              agent: subagent_type as string,
            },
            query: { directory: changeDir },
          });
          const id = createResult.data?.id;
          if (!id) {
            return await formatToolError('Failed to create subagent session');
          }
          sessionID = id;
          isNew = true;
        }

        // P2: structured 模式下注入 schema hint
        let finalPrompt = effectivePrompt;
        if (output_mode === 'structured') {
          const hint = getSchemaHint(subagent_type as string);
          if (hint) {
            finalPrompt = `${effectivePrompt}\n\n${hint}`;
          }
        }

        await (
          client.session.prompt as (args: {
            path: { id: string };
            body: Record<string, unknown>;
          }) => Promise<unknown>
        )({
          path: { id: sessionID },
          body: {
            agent: subagent_type as string,
            parts: [{ type: 'text', text: finalPrompt }],
          },
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to send prompt: ${msg}`);
        });

        // P1: 首次调用（无 session_id）时创建 agent store 记录
        if (isNew && !resolvedAgentId) {
          resolvedAgentId = `agent_${Date.now()}_${subagent_type}`;
          try {
            await store.createAgent({
              agent_id: resolvedAgentId,
              subagent_type: subagent_type as string,
              session_id: sessionID,
              prompt: prompt as string,
            });
          } catch (err) {
            // subagent-store 创建失败不阻塞 agent 执行
            console.warn('[CallFlowAgent] 创建 agent store 失败:', err);
          }
        }

        if (run_in_background) {
          // Check concurrency limit: max 3 parallel subagents of the same type
          if (!acquireSubagentSlot(subagent_type as string)) {
            return await formatToolError(
              `Concurrency limit reached for subagent "${subagent_type}". Maximum ${MAX_CONCURRENT_SUBAGENTS} parallel instances allowed. Wait for a running task to complete before starting another.`,
            );
          }

          const taskId = generateTaskId(backgroundTaskCounter);
          backgroundTaskRegistry.set(taskId, {
            sessionID,
            subagentType: subagent_type as string,
            status: 'running',
            createdAt: Date.now(),
            output_mode: output_mode as 'last_message' | 'structured' | undefined,
            changeDir,
          });

          // P1: 追加 started 事件
          if (resolvedAgentId) {
            try {
              await store.appendEvent(resolvedAgentId, {
                timestamp: new Date().toISOString(),
                event_type: 'started',
                detail: `Background task ${taskId} started`,
              });
            } catch (err) {
              // 事件追加失败不阻塞
              console.warn('[CallFlowAgent] 追加事件失败:', err);
            }
          }

          return {
            title: sessionLabel,
            output: JSON.stringify(
              {
                success: true,
                task_id: taskId,
                session_id: sessionID,
                status: 'running',
                description,
                agent: subagent_type,
              },
              null,
              2,
            ),
          };
        }

        let lastOutput = await pollSessionCompletion(
          client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
          sessionID,
          { maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS },
        );

        // Task 3.2: Handle null output (retry exhausted) in sync mode
        if (lastOutput === null) {
          const syncTaskId = generateTaskId(backgroundTaskCounter);
          backgroundTaskRegistry.set(syncTaskId, {
            sessionID,
            subagentType: subagent_type as string,
            status: 'error',
            error: 'Session retry exhausted or polling failed',
            createdAt: Date.now(),
            completedAt: Date.now(),
            slotReleased: false,
          });

          return {
            title: sessionLabel,
            output: JSON.stringify(
              {
                success: false,
                subagent: subagent_type,
                sessionID,
                task_id: syncTaskId,
                error: 'Session retry exhausted or polling failed',
              },
              null,
              2,
            ),
          };
        }

        // P3: 同步模式完成检测与重试
        const retryResult = await performCompletionRetry(
          lastOutput || '',
          // injectReminder: 注入 system reminder 到 session
          async () => {
            await (
              client.session.prompt as (args: {
                path: { id: string };
                body: Record<string, unknown>;
              }) => Promise<unknown>
            )({
              path: { id: sessionID },
              body: {
                agent: subagent_type as string,
                parts: REMINDER_MESSAGE.parts,
              },
            });
          },
          // pollOutput: 重新轮询子 agent 输出
          async () => {
            return await pollSessionCompletion(
              client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
              sessionID,
              { maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS },
            );
          },
          undefined,
          subagent_type as string, // 传入 agent 类型，豁免列表中的 agent 跳过重试
        );
        lastOutput = retryResult.output;
        const completionWarning = retryResult.warning;

        const syncTaskId = generateTaskId(backgroundTaskCounter);
        backgroundTaskRegistry.set(syncTaskId, {
          sessionID,
          subagentType: subagent_type as string,
          status: 'completed',
          result: lastOutput,
          createdAt: Date.now(),
          completedAt: Date.now(),
        });

        // P3: 检测完成信号状态（用于通知）
        const hasSignal = hasCompletionSignal(typeof lastOutput === 'string' ? lastOutput : '');

        // P0: 同步模式完成时写入通知
        try {
          const nm = createNotificationManager({ changeDir });
          await nm.writeNotification({
            type: 'sync_completed',
            subagent: subagent_type as string,
            task_id: syncTaskId,
            session_id: sessionID,
            summary: typeof lastOutput === 'string' ? lastOutput.slice(0, 200) : '(no output)',
            has_completion_signal: hasSignal,
          });
        } catch (err) {
          // 通知写入失败不阻塞 agent 结果返回
          console.warn('[CallFlowAgent] 同步模式写入通知失败:', err);
        }

        // P1: 同步模式完成时更新 subagent-store
        if (resolvedAgentId) {
          try {
            await store.updateOutput(
              resolvedAgentId,
              typeof lastOutput === 'string' ? lastOutput : '',
            );
            await store.appendEvent(resolvedAgentId, {
              timestamp: new Date().toISOString(),
              event_type: 'completed',
              detail: `Sync task ${syncTaskId} completed`,
            });
          } catch (err) {
            // subagent-store 更新失败不阻塞 agent 结果返回
            console.warn('[CallFlowAgent] 同步模式更新 subagent-store 失败:', err);
          }
        }

        // P2: structured 模式下提取 JSON block
        const structuredOutput =
          output_mode === 'structured'
            ? extractJsonBlock(typeof lastOutput === 'string' ? lastOutput : '')
            : undefined;

        // NH-3: structured 提取失败时传播 warning
        const structuredWarning =
          output_mode === 'structured' && structuredOutput === null
            ? 'structured output extraction failed, fallback to raw text'
            : undefined;

        // NH-3: 合并所有 warnings 为数组（避免字段覆盖）
        const syncWarnings: string[] = [];
        if (completionWarning) syncWarnings.push(completionWarning);
        if (structuredWarning) syncWarnings.push(structuredWarning);

        return {
          title: sessionLabel,
          output: JSON.stringify(
            {
              success: true,
              subagent: subagent_type,
              sessionID,
              task_id: syncTaskId,
              output: lastOutput,
              ...(structuredOutput !== undefined && { structured_output: structuredOutput }),
              ...(syncWarnings.length > 0 && { warnings: syncWarnings }),
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          title: sessionLabel,
          output: JSON.stringify(
            {
              success: false,
              subagent: subagent_type,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        };
      }
    },
  };

  const flowagentOutputTool: ToolDefinition = {
    name: 'flowagent_output' as never,
    description: `Retrieve results from a background ${workflowName} subagent task (call_flow_agent async mode). Call this when a <system-reminder> notifies you that a background task completed. Use block=true to wait for completion (timeout: 120s).`,
    parameters: {
      task_id: z
        .string()
        .describe('The task ID returned by call_flow_agent (run_in_background=true, prefix: sf_)'),
      block: z.boolean().optional().describe('Wait for completion (default: false)'),
    } as Record<string, unknown>,
    execute: async (args: Record<string, unknown>, _context) => {
      const { task_id, block } = args as { task_id: string; block?: boolean };
      const changeDir = resolveChangeDir(undefined, _context.directory);

      const pollAndComplete = async (task: BackgroundTaskEntry): Promise<BackgroundTaskEntry> => {
        const currentTask = backgroundTaskRegistry.get(task_id);

        // G1: 显式处理 currentTask 不存在的情况（防止任务"复活"）
        if (!currentTask) {
          return {
            ...task,
            status: 'error',
            error: 'Task not found in registry',
            completedAt: Date.now(),
            slotReleased: task.slotReleased ?? false,
          };
        }

        // G2: 提前返回分支的 _processing 语义显式化
        // _processing=true 表示 watcher/pollAndComplete 正在处理中，本分支不清理该标志（由处理方 finally 负责）
        // status 非 running 表示已完成/已错误，直接返回结果
        if (currentTask.status !== 'running' || currentTask._processing) {
          return currentTask;
        }

        currentTask._processing = true;
        backgroundTaskRegistry.set(task_id, currentTask);

        try {
          const output = await pollSessionCompletion(
            client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
            task.sessionID,
            { maxWaitMs: DEFAULT_MAX_WAIT_MS },
          );

          const now = Date.now();

          let updated: BackgroundTaskEntry;
          if (output === null) {
            updated = {
              ...task,
              status: 'error',
              error: 'Session retry exhausted or polling failed',
              completedAt: now,
              slotReleased: task.slotReleased ?? false,
            };
            backgroundTaskRegistry.set(task_id, updated);

            if (!updated.slotReleased) {
              releaseSubagentSlot(task.subagentType);
              updated.slotReleased = true;
              backgroundTaskRegistry.set(task_id, updated);
            }

            try {
              const nm = createNotificationManager({ changeDir });
              await nm.writeNotification({
                type: 'async_error',
                subagent: task.subagentType,
                task_id,
                session_id: task.sessionID,
                summary: 'Task failed: session retry exhausted or polling failed',
              });
            } catch (err) {
              console.warn('[CallFlowAgent] 异步模式写入错误通知失败:', err);
            }

            try {
              const asyncStore = createSubagentStore({ changeDir });
              const agents = await asyncStore.listAgents();
              const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
              if (matchedAgent) {
                await asyncStore.updateOutput(matchedAgent.agent_id, '', { status: 'error' });
                await asyncStore.appendEvent(matchedAgent.agent_id, {
                  timestamp: new Date().toISOString(),
                  event_type: 'error',
                  detail: `Async task ${task_id} failed: session retry exhausted or polling failed`,
                });
              }
            } catch (err) {
              console.warn('[CallFlowAgent] 异步模式更新 subagent-store 失败:', err);
            }

            return updated;
          }

          const asyncHasSignal = hasCompletionSignal(output);
          const finalOutput = output || '(no output)';
          updated = {
            ...task,
            status: 'completed',
            result: finalOutput,
            completedAt: now,
            slotReleased: task.slotReleased ?? false,
            _errorCount: 0,
          };
          backgroundTaskRegistry.set(task_id, updated);

          if (!updated.slotReleased) {
            releaseSubagentSlot(task.subagentType);
            updated.slotReleased = true;
            backgroundTaskRegistry.set(task_id, updated);
          }

          try {
            const nm = createNotificationManager({ changeDir });
            await nm.writeNotification({
              type: 'async_completed',
              subagent: task.subagentType,
              task_id,
              session_id: task.sessionID,
              summary: finalOutput.slice(0, 200),
              has_completion_signal: asyncHasSignal,
            });
          } catch (err) {
            console.warn('[CallFlowAgent] 异步模式写入通知失败:', err);
          }

          try {
            const asyncStore = createSubagentStore({ changeDir });
            const agents = await asyncStore.listAgents();
            const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
            if (matchedAgent) {
              await asyncStore.updateOutput(
                matchedAgent.agent_id,
                typeof finalOutput === 'string' ? finalOutput : '',
              );
              await asyncStore.appendEvent(matchedAgent.agent_id, {
                timestamp: new Date().toISOString(),
                event_type: 'completed',
                detail: `Async task ${task_id} completed`,
              });
            }
          } catch (err) {
            console.warn('[CallFlowAgent] 异步模式更新 subagent-store 失败:', err);
          }

          return updated;
        } catch (err) {
          // F-1: Handle pollSessionCompletion exceptions (network errors, etc.)
          console.warn('[CallFlowAgent] pollAndComplete failed:', err);
          
          const now = Date.now();
          const errorMessage = err instanceof Error ? err.message : String(err);
          
          const updated: BackgroundTaskEntry = {
            ...task,
            status: 'error',
            error: `Polling failed: ${errorMessage}`,
            completedAt: now,
            slotReleased: task.slotReleased ?? false,
          };
          backgroundTaskRegistry.set(task_id, updated);

          if (!updated.slotReleased) {
            releaseSubagentSlot(task.subagentType);
            updated.slotReleased = true;
            backgroundTaskRegistry.set(task_id, updated);
          }

          try {
            const nm = createNotificationManager({ changeDir });
            await nm.writeNotification({
              type: 'async_error',
              subagent: task.subagentType,
              task_id,
              session_id: task.sessionID,
              summary: `Task failed: polling error - ${errorMessage}`,
            });
          } catch (notificationErr) {
            console.warn('[CallFlowAgent] 异步模式写入错误通知失败:', notificationErr);
          }

          try {
            const asyncStore = createSubagentStore({ changeDir });
            const agents = await asyncStore.listAgents();
            const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
            if (matchedAgent) {
              await asyncStore.updateOutput(matchedAgent.agent_id, '', { status: 'error' });
              await asyncStore.appendEvent(matchedAgent.agent_id, {
                timestamp: new Date().toISOString(),
                event_type: 'error',
                detail: `Async task ${task_id} failed: polling error - ${errorMessage}`,
              });
            }
          } catch (storeErr) {
            console.warn('[CallFlowAgent] 异步模式更新 subagent-store 失败:', storeErr);
          }

          return updated;
        } finally {
          const latest = backgroundTaskRegistry.get(task_id);
          if (latest && latest._processing) {
            latest._processing = false;
            backgroundTaskRegistry.set(task_id, latest);
          }
        }
      };

      const buildResponse = (task: BackgroundTaskEntry) => {
        // P2: structured 模式下提取 JSON block
        const structuredOutput =
          task.output_mode === 'structured'
            ? extractJsonBlock(typeof task.result === 'string' ? task.result : '')
            : undefined;

        // NH-3: structured 提取失败时传播 warning
        const structuredWarning =
          task.output_mode === 'structured' && structuredOutput === null
            ? 'structured output extraction failed, fallback to raw text'
            : undefined;

        // NH-3: 合并所有 warnings 为数组（避免字段覆盖）
        const asyncWarnings: string[] = [];
        if (task.warning) asyncWarnings.push(task.warning);
        if (structuredWarning) asyncWarnings.push(structuredWarning);

        return {
          title: 'FlowAgent Output',
          output: JSON.stringify(
            {
              success: task.status !== 'error',
              task_id,
              status: task.status,
              session_id: task.sessionID,
              result: task.result,
              error: task.error,
              ...(structuredOutput !== undefined && { structured_output: structuredOutput }),
              ...(asyncWarnings.length > 0 && { warnings: asyncWarnings }),
            },
            null,
            2,
          ),
        };
      };

      try {
        const existingTask = backgroundTaskRegistry.get(task_id);
        if (!existingTask) {
          return {
            title: 'FlowAgent Output',
            output: JSON.stringify({ success: false, error: `Task ${task_id} not found` }, null, 2),
          };
        }

        if (!block) {
          return buildResponse(existingTask);
        }

        const completed =
          existingTask.status !== 'running' ? existingTask : await pollAndComplete(existingTask);
        return buildResponse(completed);
      } catch (error) {
        return {
          title: 'FlowAgent Output',
          output: JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        };
      }
    },
  };

  const flowagentCancelTool: ToolDefinition = {
    name: 'flowagent_cancel' as never,
    description: `Cancel a running ${workflowName} subagent task by task_id (call_flow_agent async mode). Use this when you no longer need the result.`,
    parameters: {
      taskId: z.string().describe('Task ID to cancel (required, prefix: sf_)'),
    } as Record<string, unknown>,
    execute: async (args: Record<string, unknown>, _context) => {
      const { taskId } = args as { taskId: string };
      try {
        const task = backgroundTaskRegistry.get(taskId);
        if (!task) {
          return {
            title: 'FlowAgent Cancel',
            output: JSON.stringify({ success: false, error: `Task ${taskId} not found` }, null, 2),
          };
        }
        if (task.status !== 'running') {
          return {
            title: 'FlowAgent Cancel',
            output: JSON.stringify(
              { success: true, message: `Task ${taskId} already in status: ${task.status}` },
              null,
              2,
            ),
          };
        }

        try {
          await client.session.abort({ path: { id: task.sessionID } });
        } catch (err) {
          // session.abort may not be available; mark cancelled anyway
          console.warn('[CallFlowAgent] 取消 session 失败:', err);
        }

        // P1-A: Check slotReleased to prevent double release
        if (!task.slotReleased) {
          releaseSubagentSlot(task.subagentType);
        }
        backgroundTaskRegistry.delete(taskId);
        return {
          title: 'FlowAgent Cancel',
          output: JSON.stringify(
            { success: true, message: `Task ${taskId} cancelled and removed` },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          title: 'FlowAgent Cancel',
          output: JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        };
      }
    },
  };

  const watcher = createBackgroundTaskWatcher({
    client,
    registry: backgroundTaskRegistry,
    pollIntervalMs: 200,
  });
  watcher.start();

  // P0-3: Expose watcher.stop() for resource cleanup (prevents interval leak in tests)
  const tools: Record<string, ToolDefinition> & { _stopWatcher?: () => void } = {
    call_flow_agent: callFlowAgentTool,
    flowagent_output: flowagentOutputTool,
    flowagent_cancel: flowagentCancelTool,
  };
  
  // Attach _stopWatcher for test cleanup (not part of ToolDefinition, excluded from return type)
  tools._stopWatcher = () => watcher.stop();

  return tools as Record<string, ToolDefinition>;
}
