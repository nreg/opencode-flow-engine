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
    },
    execute: async (args, context) => {
      const changeDir = context.directory || '';
      const { subagent_type, prompt, run_in_background, session_id, description } = args;

      // Validate agent name
      const validationError = await validateAgent(subagent_type as string, context as Record<string, unknown>);
      if (validationError) {
        return await formatToolError(validationError);
      }

      const sessionLabel = resolveSessionLabel(subagent_type as string, context as Record<string, unknown>);

      try {
        let sessionID: string;
        let isNew = false;

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

        await (client.session.prompt as (args: {
          path: { id: string };
          body: Record<string, unknown>;
        }) => Promise<unknown>)({
          path: { id: sessionID },
          body: {
            agent: subagent_type as string,
            parts: [{ type: 'text', text: prompt as string }],
          },
        }).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to send prompt: ${msg}`);
        });

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
          });
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

        const lastOutput = await pollSessionCompletion(
          client as unknown as { session: import("../helpers/polling.js").SFlowClientSession },
          sessionID,
        ) || '(no output)';

        const syncTaskId = generateTaskId(backgroundTaskCounter);
        backgroundTaskRegistry.set(syncTaskId, {
          sessionID,
          subagentType: subagent_type as string,
          status: 'completed',
          result: lastOutput,
          createdAt: Date.now(),
          completedAt: Date.now(),
        });

        return {
          title: sessionLabel,
          output: JSON.stringify({
            success: true,
            subagent: subagent_type,
            sessionID,
            task_id: syncTaskId,
            output: lastOutput,
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
          { maxWaitMs: 120000 },
        );
        const now = Date.now();
        const updated: BackgroundTaskEntry = {
          ...task,
          status: 'completed',
          result: output || '(no output)',
          completedAt: now,
        };
        backgroundTaskRegistry.set(task_id, updated);
        // Release concurrency slot when background task completes
        releaseSubagentSlot(task.subagentType);
        return updated;
      };

      const buildResponse = (task: BackgroundTaskEntry) => ({
        title: 'FlowAgent Output',
        output: JSON.stringify({
          success: task.status !== 'error',
          task_id,
          status: task.status,
          session_id: task.sessionID,
          result: task.result,
          error: task.error,
        }, null, 2),
      });

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
        } catch {
          // session.abort may not be available; mark cancelled anyway
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