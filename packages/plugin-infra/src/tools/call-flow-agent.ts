/**
 * Shared CallFlowAgent Tool Factory
 *
 * Creates the call_flow_agent, flowagent_output, and flowagent_cancel tool definitions.
 * Used by iflow-plugin-factory, sflow-plugin-factory, and combined-plugin-factory
 * to avoid duplicating the same session creation/polling/background task logic.
 */

import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { SFlowClient, BackgroundTaskEntry, BackgroundTaskRegistry, AgentModelMap } from '../types.js';
import { generateTaskId, formatToolError } from '../types.js';
import { pollSessionCompletion } from '../helpers/polling.js';
import { createNotificationManager } from '../features/notification-manager.js';
import { createSubagentStore } from '../features/subagent-store.js';
import { extractJsonBlock, getSchemaHint } from '../helpers/output-extractor.js';
import { hasCompletionSignal, performCompletionRetry, REMINDER_MESSAGE } from '../helpers/completion-detector.js';

/** Maximum concurrent subagent sessions of the same type */
const MAX_CONCURRENT_SUBAGENTS = 3;

/** Tracks running subagent count per subagent type */
const runningSubagentCounts = new Map<string, number>();

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
  validateAgent: (subagentType: string, context: Record<string, unknown>) => Promise<string | null> | string | null;
  /** Tool description prefix for the call_flow_agent tool */
  workflowName: string;
}

/**
 * Create the three call-flow-agent-related tool definitions:
 * - call_flow_agent: invoke a subagent (sync or async)
 * - flowagent_output: retrieve background task results
 * - flowagent_cancel: cancel a running background task
 */
export function createCallFlowAgentTools(options: CallFlowAgentOptions): Record<string, ToolDefinition> {
  const { client, backgroundTaskRegistry, backgroundTaskCounter, agentModelMap, sessionLabelPrefix, validateAgent, workflowName } = options;

  // Resolve session label: support both static string and dynamic function
  const resolveSessionLabel = (subagentType: string, context: Record<string, unknown>): string => {
    const prefix = typeof sessionLabelPrefix === 'function'
      ? sessionLabelPrefix(subagentType, context)
      : sessionLabelPrefix;
    return `${prefix} → ${subagentType}`;
  };

  const callFlowAgentTool: ToolDefinition = {
    description: `Invoke a specialized ${workflowName} subagent. Supports sync (run_in_background=false) and async (run_in_background=true) modes. Async mode returns a task_id; use flowagent_output to retrieve results when complete.`,
    args: {
      description: z.string().describe('Short (3-5 words) description of the task'),
      prompt: z.string().describe('The task for the subagent to perform'),
      subagent_type: z.string().describe(`The subagent to invoke (e.g. ${workflowName.toLowerCase()}-plan-executor, build-executor)`),
      run_in_background: z.boolean().describe('true=async (returns task_id for flowagent_output), false=sync (waits for completion)'),
      session_id: z.string().optional().describe('Existing session to continue (sync mode only)'),
      agent_id: z.string().optional().describe('Resume a previous subagent by agent_id. When provided, context from the previous run is injected into the prompt.'),
      output_mode: z.enum(['last_message', 'structured']).optional().describe('Output mode: last_message (default, return raw text) or structured (extract JSON block from output)'),
    },
    execute: async (args, context) => {
      const changeDir = context.directory || '';
      const { subagent_type, prompt, run_in_background, session_id, description, agent_id, output_mode } = args;

      // Validate agent name
      const validationError = await validateAgent(subagent_type as string, context as Record<string, unknown>);
      if (validationError) {
        return await formatToolError(validationError);
      }

      const sessionLabel = resolveSessionLabel(subagent_type as string, context as Record<string, unknown>);

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
            return await formatToolError('session_id is not supported in background mode. Use run_in_background=false to continue an existing session.');
          }
          sessionID = session_id as string;
        } else {
          const subagentModel = agentModelMap[subagent_type as string];
          if (!subagentModel) {
            return await formatToolError(
              `No model configured for subagent "${subagent_type}". Available agents: ${Object.keys(agentModelMap).join(', ')}`,
            );
          }

          const createResult = await (client.session.create as (args: {
            body: Record<string, unknown>;
            query?: Record<string, unknown>;
          }) => Promise<{ data?: { id?: string } }>)({
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
            finalPrompt = effectivePrompt + '\n\n' + hint;
          }
        }

        await (client.session.prompt as (args: {
          path: { id: string };
          body: Record<string, unknown>;
        }) => Promise<unknown>)({
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
            output: JSON.stringify({
              success: true,
              task_id: taskId,
              session_id: sessionID,
              status: 'running',
              description,
              agent: subagent_type,
            }, null, 2),
          };
        }

        let lastOutput = await pollSessionCompletion(
          client as unknown as { session: import("../helpers/polling.js").SFlowClientSession },
          sessionID,
        ) || '(no output)';

        // P3: 同步模式完成检测与重试
        const retryResult = await performCompletionRetry(
          typeof lastOutput === 'string' ? lastOutput : '',
          // injectReminder: 注入 system reminder 到 session
          async () => {
            await (client.session.prompt as (args: {
              path: { id: string };
              body: Record<string, unknown>;
            }) => Promise<unknown>)({
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
              client as unknown as { session: import("../helpers/polling.js").SFlowClientSession },
              sessionID,
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
            summary: typeof lastOutput === 'string'
              ? lastOutput.slice(0, 200)
              : '(no output)',
            has_completion_signal: hasSignal,
          });
        } catch (err) {
          // 通知写入失败不阻塞 agent 结果返回
          console.warn('[CallFlowAgent] 同步模式写入通知失败:', err);
        }

        // P1: 同步模式完成时更新 subagent-store
        if (resolvedAgentId) {
          try {
            await store.updateOutput(resolvedAgentId, typeof lastOutput === 'string' ? lastOutput : '');
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
        const structuredOutput = output_mode === 'structured'
          ? extractJsonBlock(typeof lastOutput === 'string' ? lastOutput : '')
          : undefined;

        // NH-3: structured 提取失败时传播 warning
        const structuredWarning = output_mode === 'structured' && structuredOutput === null
          ? 'structured output extraction failed, fallback to raw text'
          : undefined;

        // NH-3: 合并所有 warnings 为数组（避免字段覆盖）
        const syncWarnings: string[] = [];
        if (completionWarning) syncWarnings.push(completionWarning);
        if (structuredWarning) syncWarnings.push(structuredWarning);

        return {
          title: sessionLabel,
          output: JSON.stringify({
            success: true,
            subagent: subagent_type,
            sessionID,
            task_id: syncTaskId,
            output: lastOutput,
            ...(structuredOutput !== undefined && { structured_output: structuredOutput }),
            ...(syncWarnings.length > 0 && { warnings: syncWarnings }),
          }, null, 2),
        };
      } catch (error) {
        return {
          title: sessionLabel,
          output: JSON.stringify({
            success: false,
            subagent: subagent_type,
            error: error instanceof Error ? error.message : String(error),
          }, null, 2),
        };
      }
    },
  };

  const flowagentOutputTool: ToolDefinition = {
    description: `Retrieve results from a background ${workflowName} subagent task (call_flow_agent async mode). Call this when a <system-reminder> notifies you that a background task completed. Use block=true to wait for completion (timeout: 120s).`,
    args: {
      task_id: z.string().describe('The task ID returned by call_flow_agent (run_in_background=true, prefix: sf_)'),
      block: z.boolean().optional().describe('Wait for completion (default: false)'),
    },
    execute: async (args: { task_id: string; block?: boolean }, _context) => {
      const { task_id, block } = args;

      const pollAndComplete = async (task: BackgroundTaskEntry): Promise<BackgroundTaskEntry> => {
        const output = await pollSessionCompletion(
          client as unknown as { session: import("../helpers/polling.js").SFlowClientSession },
          task.sessionID,
        );

        // P3: 异步模式仅检测完成状态用于通知，不重试（规格明确：异步模式不触发完成强制）
        const asyncHasSignal = hasCompletionSignal(typeof output === 'string' ? output : '');
        const finalOutput = typeof output === 'string' ? output : '(no output)';

        const now = Date.now();
        const updated: BackgroundTaskEntry = {
          ...task,
          status: 'completed',
          result: finalOutput,
          completedAt: now,
        };
        backgroundTaskRegistry.set(task_id, updated);
        // Release concurrency slot when background task completes
        releaseSubagentSlot(task.subagentType);

        // P0: 异步模式完成时写入通知
        try {
          const nm = createNotificationManager({ changeDir: _context.directory || '' });
          await nm.writeNotification({
            type: 'async_completed',
            subagent: task.subagentType,
            task_id,
            session_id: task.sessionID,
            summary: finalOutput.slice(0, 200),
            has_completion_signal: asyncHasSignal,
          });
        } catch (err) {
          // 通知写入失败不阻塞 agent 结果返回
          console.warn('[CallFlowAgent] 异步模式写入通知失败:', err);
        }

        // P1: 异步模式完成时更新 subagent-store
        try {
          const asyncStore = createSubagentStore({ changeDir: _context.directory || '' });
          // 查找该 session 对应的 agent
          const agents = await asyncStore.listAgents();
          const matchedAgent = agents.find(a => a.session_id === task.sessionID);
          if (matchedAgent) {
            await asyncStore.updateOutput(matchedAgent.agent_id, typeof finalOutput === 'string' ? finalOutput : '');
            await asyncStore.appendEvent(matchedAgent.agent_id, {
              timestamp: new Date().toISOString(),
              event_type: 'completed',
              detail: `Async task ${task_id} completed`,
            });
          }
        } catch (err) {
          // subagent-store 更新失败不阻塞 agent 结果返回
          console.warn('[CallFlowAgent] 异步模式更新 subagent-store 失败:', err);
        }

        return updated;
      };

      const buildResponse = (task: BackgroundTaskEntry) => {
        // P2: structured 模式下提取 JSON block
        const structuredOutput = task.output_mode === 'structured'
          ? extractJsonBlock(typeof task.result === 'string' ? task.result : '')
          : undefined;

        // NH-3: structured 提取失败时传播 warning
        const structuredWarning = task.output_mode === 'structured' && structuredOutput === null
          ? 'structured output extraction failed, fallback to raw text'
          : undefined;

        // NH-3: 合并所有 warnings 为数组（避免字段覆盖）
        const asyncWarnings: string[] = [];
        if (task.warning) asyncWarnings.push(task.warning);
        if (structuredWarning) asyncWarnings.push(structuredWarning);

        return {
          title: 'FlowAgent Output',
          output: JSON.stringify({
            success: task.status !== 'error',
            task_id,
            status: task.status,
            session_id: task.sessionID,
            result: task.result,
            error: task.error,
            ...(structuredOutput !== undefined && { structured_output: structuredOutput }),
            ...(asyncWarnings.length > 0 && { warnings: asyncWarnings }),
          }, null, 2),
        };
      };

      try {
        const existingTask = backgroundTaskRegistry.get(task_id);
        if (!existingTask) {
          return { title: 'FlowAgent Output', output: JSON.stringify({ success: false, error: `Task ${task_id} not found` }, null, 2) };
        }

        if (!block) {
          return buildResponse(existingTask);
        }

        const completed = existingTask.status !== 'running'
          ? existingTask
          : await pollAndComplete(existingTask);
        return buildResponse(completed);
      } catch (error) {
        return {
          title: 'FlowAgent Output',
          output: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }, null, 2),
        };
      }
    },
  };

  const flowagentCancelTool: ToolDefinition = {
    description: `Cancel a running ${workflowName} subagent task by task_id (call_flow_agent async mode). Use this when you no longer need the result.`,
    args: {
      taskId: z.string().describe('Task ID to cancel (required, prefix: sf_)'),
    },
    execute: async (args: { taskId: string }, _context) => {
      const { taskId } = args;
      try {
        const task = backgroundTaskRegistry.get(taskId);
        if (!task) {
          return { title: 'FlowAgent Cancel', output: JSON.stringify({ success: false, error: `Task ${taskId} not found` }, null, 2) };
        }
        if (task.status !== 'running') {
          return { title: 'FlowAgent Cancel', output: JSON.stringify({ success: true, message: `Task ${taskId} already in status: ${task.status}` }, null, 2) };
        }

        try {
          await client.session.abort({ path: { id: task.sessionID } });
        } catch (err) {
          // session.abort may not be available; mark cancelled anyway
          console.warn('[CallFlowAgent] 取消 session 失败:', err);
        }

        // Release concurrency slot
        releaseSubagentSlot(task.subagentType);
        backgroundTaskRegistry.delete(taskId);
        return { title: 'FlowAgent Cancel', output: JSON.stringify({ success: true, message: `Task ${taskId} cancelled and removed` }, null, 2) };
      } catch (error) {
        return {
          title: 'FlowAgent Cancel',
          output: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }, null, 2),
        };
      }
    },
  };

  return {
    call_flow_agent: callFlowAgentTool,
    flowagent_output: flowagentOutputTool,
    flowagent_cancel: flowagentCancelTool,
  };
}