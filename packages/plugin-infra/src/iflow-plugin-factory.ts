/**
 * IFlow Plugin Factory
 *
 * Creates an IFlow-only plugin with:
 * - IFlow agents (iFlow, iflow-discuss-planner, iflow-plan-executor,
 *   iflow-verifier, iflow-researcher, iflow-shipper)
 * - IFlow tools (iflow_router, call_flow_agent, flowagent_output, flowagent_cancel)
 * - IFlow hooks (iflow_state_transition, iflow_guard, session_start, session_end)
 */

import type { PluginInput, PluginOptions, Hooks, PluginModule, ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';

import type { SFlowClient, BackgroundTaskEntry, BackgroundTaskRegistry, AgentModelMap } from './types.js';
import { IFLOW_STATES, AGENT_COLORS, generateTaskId, formatToolError, detectOmoPlugin, detectAgnesProvider } from './types.js';

import { getAgentMode, createAgent } from './agents/index.js';
import { loadCascadedSFlowConfig, agentOverridesFromConfig } from './agents/config-loader.js';
import { createHookComposer } from './hooks/hook-composer.js';
import { createSkillLoader } from './features/skill-loader.js';
import type { HookContext } from './hooks/types.js';
import { directoryExists, ensureDir, writeJsonFile } from '@opencode-flow-engine/shared';
import { getStateFilePath } from './features/state-manager.js';
import { createMcpManager, loadProjectMcpConfig } from './features/mcp-manager.js';
import { setHasOmoPlugin, setHasAgnesProvider } from './agents/agent-tools.js';
import { pollSessionCompletion } from './helpers/polling.js';
import { IFLOW_AGENT_NAMES } from '../../../workflows/iflow/index.js';
import { SFLOW_AGENT_NAMES } from '../../../workflows/sflow/index.js';

// ─── Background task registry (per-factory instance) ──────────────────────────

const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
let backgroundTaskCounter = { value: 0 };

// ─── Agent model map (populated during config hook) ───────────────────────────

const AGENT_MODEL_MAP: AgentModelMap = {};

// ─── IFlow tool definitions ──────────────────────────────────────────────────

function createIFlowTools(client: SFlowClient): Record<string, ToolDefinition> {
  return {
    iflow_router: {
      description: 'Detect current IFlow state from .iflow/ directory artifacts and route to the appropriate agent. Supports IFlow-specific intent patterns.',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
        const { createIFlowRouterTool } = await import('./tools/iflow-router.js');
        return createIFlowRouterTool().execute({ ...args, changeDir: context.directory || '' }, context);
      },
    },

    call_flow_agent: {
      description: 'Invoke a specialized IFlow subagent. Supports sync (run_in_background=false) and async (run_in_background=true) modes. Async mode returns a task_id; use flowagent_output to retrieve results when complete.',
      args: {
        description: z.string().describe('Short (3-5 words) description of the task'),
        prompt: z.string().describe('The task for the subagent to perform'),
        subagent_type: z.string().describe('The subagent to invoke (e.g. iflow-plan-executor, iflow-verifier)'),
        run_in_background: z.boolean().describe('true=async (returns task_id for flowagent_output), false=sync (waits for completion)'),
        session_id: z.string().optional().describe('Existing session to continue (sync mode only)'),
      },
      execute: async (args, context) => {
        const changeDir = context.directory || '';
        const { subagent_type, prompt, run_in_background, session_id, description } = args;

        const isSFlowContext = await directoryExists(`${changeDir}/.sflow`);
        const isIFlowContext = await directoryExists(`${changeDir}/.iflow`);

        if (isIFlowContext && !isSFlowContext) {
          const validIFlowAgents = IFLOW_AGENT_NAMES as readonly string[];
          if (!validIFlowAgents.includes(subagent_type as string)) {
            return await formatToolError(
              `Invalid IFlow agent: "${subagent_type}". Available IFlow agents: ${validIFlowAgents.join(', ')}`,
            );
          }
        } else if (isSFlowContext && !isIFlowContext) {
          const validSFlowAgents = SFLOW_AGENT_NAMES as readonly string[];
          if (!validSFlowAgents.includes(subagent_type as string)) {
            return await formatToolError(
              `Invalid SFlow agent: "${subagent_type}". Available SFlow agents: ${validSFlowAgents.join(', ')}`,
            );
          }
        }

        const sessionLabel = `iFlow → ${subagent_type}`;

        try {
          let sessionID: string;
          let isNew = false;

          if (session_id) {
            if (run_in_background) {
              return await formatToolError('session_id is not supported in background mode. Use run_in_background=false to continue an existing session.');
            }
            sessionID = session_id as string;
          } else {
            const subagentModel = AGENT_MODEL_MAP[subagent_type as string];
            if (!subagentModel) {
              return await formatToolError(
                `No model configured for subagent "${subagent_type}". Available agents: ${Object.keys(AGENT_MODEL_MAP).join(', ')}`,
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
            const taskId = generateTaskId(backgroundTaskCounter);
            backgroundTaskRegistry.set(taskId, {
              sessionID,
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
            client as unknown as { session: import("./helpers/polling.js").SFlowClientSession },
            sessionID,
            { isNew },
          ) || '(no output)';

          const syncTaskId = generateTaskId(backgroundTaskCounter);
          backgroundTaskRegistry.set(syncTaskId, {
            sessionID,
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
    },

    flowagent_output: {
      description: 'Retrieve results from a background IFlow subagent task (call_flow_agent async mode). Call this when a <system-reminder> notifies you that a background task completed. Use block=true to wait for completion (timeout: 120s).',
      args: {
        task_id: z.string().describe('The task ID returned by call_flow_agent (run_in_background=true, prefix: sf_)'),
        block: z.boolean().optional().describe('Wait for completion (default: false)'),
      },
      execute: async (args: { task_id: string; block?: boolean }, _context) => {
        const { task_id, block } = args;

        const pollAndComplete = async (task: BackgroundTaskEntry): Promise<BackgroundTaskEntry> => {
          const output = await pollSessionCompletion(
            client as unknown as { session: import('./helpers/polling.js').SFlowClientSession },
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
    },

    flowagent_cancel: {
      description: 'Cancel a running IFlow subagent task by task_id (call_flow_agent async mode). Use this when you no longer need the result.',
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
    },
  };
}

// ─── IFlow plugin module (server function) ────────────────────────────────────

function createIFlowPluginServer(pluginId: string): (input: PluginInput, _options?: PluginOptions) => Promise<Hooks> {
  return async (input: PluginInput, _options?: PluginOptions) => {
    const cascadedConfig = await loadCascadedSFlowConfig();
    const configOverrides = agentOverridesFromConfig(cascadedConfig);

    const workDir = input.directory;
    const sflowClient = input.client;

    const hookComposer = createHookComposer();
    const skillLoader = await createSkillLoader();
    const mcpManager = createMcpManager();

    // Build IFlow tool definitions
    const tools = createIFlowTools(sflowClient);

    return {
      dispose: async () => {
        for (const server of mcpManager.getRunningServers()) {
          try {
            await mcpManager.stopServer(server.name);
          } catch (err) {
            console.warn(`[iFlow] Failed to stop MCP server ${server.name}: `, err);
          }
        }
      },

      // event hook: session lifecycle events
      event: async (input) => {
        const event = input.event;
        if (event.type === 'session.created') {
          const sessionStartHook = hookComposer.getHook('session_start');
          if (sessionStartHook) {
            await sessionStartHook.execute({
              changeDir: workDir,
              stateFile: `${workDir}/${getStateFilePath('iflow')}`,
              pluginRoot: '',
              action: 'session.created',
            });
          }
        } else if (event.type === 'session.deleted') {
          const sessionEndHook = hookComposer.getHook('session_end');
          if (sessionEndHook) {
            await sessionEndHook.execute({
              changeDir: workDir,
              stateFile: `${workDir}/${getStateFilePath('iflow')}`,
              pluginRoot: '',
              action: 'session.deleted',
            });
          }
        }
      },

      // config hook: register IFlow agents only, MCP servers, detect plugins
      config: async (cfg) => {
        const hasOmo = detectOmoPlugin(cfg.plugin);
        setHasOmoPlugin(hasOmo);

        const hasAgnes = await detectAgnesProvider({ provider: cfg.provider as Record<string, unknown> | undefined, plugin: cfg.plugin });
        setHasAgnesProvider(hasAgnes);

        if (!cfg.agent) cfg.agent = {};

        // Register only IFlow agents
        const iflowAgentNames = IFLOW_AGENT_NAMES as readonly string[];
        for (const name of iflowAgentNames) {
          const override = configOverrides[name as import('./agents/types.js').BuiltinAgentName];

          let skillContent = skillLoader.getSkill(name)?.content;
          if (name === 'iflow-plan-executor') {
            const uiSkill = skillLoader.getSkill('ui-implementer');
            if (uiSkill?.content) {
              skillContent = skillContent
                ? `${skillContent}\n\n---\n\n## Frontend UI Expertise\n\n${uiSkill.content}`
                : uiSkill.content;
            }
          }

          const agentCfg = await createAgent(name as import('./agents/types.js').BuiltinAgentName, undefined, undefined, skillContent);

          const instructions = (typeof agentCfg.instructions === 'string' ? agentCfg.instructions : '') || (typeof agentCfg.prompt === 'string' ? agentCfg.prompt : '');
          const modelName = typeof agentCfg.model === 'string' ? agentCfg.model : undefined;
          const temperature = typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined;
          const agentTools = agentCfg.tools ?? undefined;

          cfg.agent[name] = {
            model: modelName,
            prompt: instructions,
            mode: getAgentMode(name as import('./agents/types.js').BuiltinAgentName),
            tools: agentTools,
            color: AGENT_COLORS[name],
            temperature: override?.temperature ?? temperature,
            description: (typeof agentCfg.id === 'string')
              ? `${agentCfg.id} agent from iFlow plugin`
              : undefined,
          };

          if (modelName) {
            AGENT_MODEL_MAP[name] = modelName;
          }
        }

        // Register skill-embedded MCPs (Tier 3)
        if (!cfg.mcp) cfg.mcp = {};
        const skillsWithMcp = skillLoader.getSkillsWithMcp();
        for (const skill of skillsWithMcp) {
          if (skill.metadata.mcp?.servers) {
            for (const server of skill.metadata.mcp.servers) {
              cfg.mcp[server.name] = {
                type: 'local',
                command: [server.command, ...(server.args || [])],
                environment: server.env,
              };
              mcpManager.startServer(server.name, server).catch(err => {
                console.warn(`[iFlow] Failed to start MCP server ${server.name}: ${err.message}`);
                if (cfg.mcp) delete cfg.mcp[server.name];
              });
            }
          }
        }

        // Register project-level MCPs (Tier 2)
        const projectMcpConfig = (await loadProjectMcpConfig()) as Record<string, { command: string | string[]; environment?: Record<string, string> }>;
        for (const [name, server] of Object.entries(projectMcpConfig)) {
          const srv = server as { command: string | string[]; environment?: Record<string, string> };
          if (srv && srv.command) {
            cfg.mcp[name] = {
              type: 'local',
              command: Array.isArray(srv.command) ? srv.command : [srv.command],
              environment: srv.environment,
            };
            const cmd = Array.isArray(srv.command) ? srv.command[0] : srv.command;
            const cmdArgs = Array.isArray(srv.command) ? srv.command.slice(1) : [];
            if (cmd) {
              mcpManager.startServer(name, { name, command: cmd, args: cmdArgs, env: srv.environment }).catch(err => {
                console.warn(`[iFlow] Failed to start project MCP server ${name}: ${err.message}`);
                if (cfg.mcp) delete cfg.mcp[name];
              });
            }
          }
        }
      },

      // tool hook: register IFlow tools
      tool: tools,

      // command.execute.before hook — skill content injection
      "command.execute.before": async (input, output) => {
        const command = input.command;
        if (!command.startsWith('/')) return;
        const skillName = command.slice(1);
        const skill = skillLoader.getSkill(skillName);
        if (!skill) return;
        const skillContent = skill.content;
        if (!skillContent) return;
        output.parts.push({
          id: `iflow-skill-${Date.now()}`,
          sessionID: input.sessionID,
          messageID: '',
          type: 'text',
          text: skillContent,
        });
      },

      // tool.execute.before hook — IFlow guard
      "tool.execute.before": async (input, output) => {
        const toolName = input.tool;
        const lowerTool = toolName?.toLowerCase();

        // IFlow-specific guard logic
        const guardHook = hookComposer.getHook('guard');
        if (guardHook) {
          const guardResult = await guardHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${getStateFilePath('iflow')}`,
            pluginRoot: '',
            action: `tool:${toolName}`,
            data: {
              toolName: lowerTool,
              agent: (input as Record<string, unknown>).agent,
            },
          });

          if (guardResult.block) {
            output.args = {
              ...(output.args ?? {}),
              _iflow_guard_blocked: true,
              _iflow_guard_reason: guardResult.blockReason ?? guardResult.error ?? 'IFlow guard condition not met',
            };
            return;
          }
        }
      },

      // tool.execute.after hook — IFlow state transition
      "tool.execute.after": async (input, output) => {
        const toolName = input.tool;

        // IFlow state transition via hook
        const outputStr = output.output ?? '';
        const stateMatch = outputStr.match(/"state"\s*:\s*"(\w[\w-]*)"/);
        if (stateMatch) {
          const newState = stateMatch[1];
          const isIFlowState = newState && IFLOW_STATES.has(newState);
          if (isIFlowState) {
            const iflowTransitionHook = hookComposer.getHook('iflow_state_transition');
            if (iflowTransitionHook) {
              const result = await iflowTransitionHook.execute({
                changeDir: workDir,
                stateFile: `${workDir}/${getStateFilePath('iflow')}`,
                pluginRoot: '',
                action: 'state-transition',
                data: { newState },
              });
              if (!result.success && result.block) {
                console.warn('[iFlow] State transition blocked:', result.blockReason ?? result.error);
              }
            } else {
              try {
                await ensureDir(`${workDir}/.iflow`);
                await writeJsonFile(`${workDir}/${getStateFilePath('iflow')}`, {
                  state: newState,
                  updatedAt: new Date().toISOString(),
                });
              } catch (err) {
                console.warn('[iFlow] Failed to write IFlow state:', err);
              }
            }
          }
        }
      },
    };
  };
}

// ─── IFlow plugin module ──────────────────────────────────────────────────────

export function createIFlowPluginModule(pluginId: string = 'opencode-iflow'): PluginModule {
  return {
    id: pluginId,
    server: createIFlowPluginServer(pluginId),
  };
}

// Default export: IFlow plugin module
export default createIFlowPluginModule('opencode-iflow');
