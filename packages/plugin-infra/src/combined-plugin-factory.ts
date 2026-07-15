/**
 * Combined Plugin Factory
 *
 * Creates a combined plugin that includes both SFlow and IFlow workflows.
 * This is the default export for backward compatibility with 'opencode-sflow' / 'opencode-flow-engine'.
 *
 * - Merges all agents from both SFlow and IFlow
 * - Merges all tools from both SFlow and IFlow
 * - Has a shared MCP Manager
 * - PLUGIN_ID = 'opencode-sflow' for backward compat (when used as default)
 */

import type { PluginInput, PluginOptions, Hooks, PluginModule, ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';

import type { SFlowClient, BackgroundTaskEntry, BackgroundTaskRegistry, AgentModelMap } from './types.js';
import { SFLOW_TOOLS, IFLOW_STATES, AGENT_COLORS, generateTaskId, formatToolError, detectOmoPlugin, detectAgnesProvider } from './types.js';

import { getAgentNames, getAgentMode, createAgent } from './agents/index.js';
import { createWorkflowRouterTool } from './tools/index.js';

import { loadCascadedSFlowConfig, agentOverridesFromConfig } from './agents/config-loader.js';
import { createHookComposer } from './hooks/hook-composer.js';
import { createSkillLoader } from './features/skill-loader.js';
import type { HookContext } from './hooks/types.js';
import { directoryExists, ensureDir, writeJsonFile } from '@opencode-flow-engine/shared';
import { getStateFilePath } from './features/state-manager.js';
import { createMcpManager, loadProjectMcpConfig } from './features/mcp-manager.js';
import { createValidatorTools, createWorkflowTools } from './features/builtin-mcp.js';
import { setHasOmoPlugin, setHasAgnesProvider } from './agents/agent-tools.js';
import { markOmoUsed, resetOmoTracking } from './hooks/guard.js';
import { pollSessionCompletion } from './helpers/polling.js';
import { IFLOW_AGENT_NAMES } from '../../../workflows/iflow/index.js';
import { SFLOW_AGENT_NAMES } from '../../../workflows/sflow/index.js';
import { createAgnesTools } from './agnes-tools.js';
import { getCurrentWorkflowState, executeContractValidator, executeArtifactInspector } from './sflow-tool-helpers.js';

// ─── Background task registry (shared for combined plugin) ────────────────────

const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
let backgroundTaskCounter = { value: 0 };

// ─── Agent model map (populated during config hook) ───────────────────────────

const AGENT_MODEL_MAP: AgentModelMap = {};

// ─── Combined tool definitions (SFlow + IFlow) ────────────────────────────────

function createCombinedTools(client: SFlowClient): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {
    workflow_router: {
      description: 'Detect current workflow state and route to the appropriate agent. Supports GO.md-style intent matching.',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
        return createWorkflowRouterTool().execute({ ...args, changeDir: context.directory || '' }, context);
      },
    },

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

    contract_validator: {
      description: 'Validate execution contract for correctness and completeness',
      args: {
        contract_path: z.string().optional().describe('Path to the execution contract file'),
      },
      execute: async (args: { contract_path?: string }, context) => {
        const changeDir = args.contract_path
          ? args.contract_path.replace(/[/\\]execution-contract\.md$/, '')
          : context.directory || '';
        const result = await executeContractValidator(changeDir);
        return { title: 'Contract Validator', output: JSON.stringify(result, null, 2) };
      },
    },

    artifact_inspector: {
      description: 'Inspect planning artifacts for completeness and consistency',
      args: {
        artifact_path: z.string().optional().describe('Path to the artifact or change directory'),
      },
      execute: async (args: { artifact_path?: string }, context) => {
        const changeDir = args.artifact_path
          ? args.artifact_path.replace(/[/\\](proposal|design|tasks)\.md$/, '').replace(/[/\\]specs$/, '')
          : context.directory || '';
        const result = await executeArtifactInspector(changeDir);
        return { title: 'Artifact Inspector', output: JSON.stringify(result, null, 2) };
      },
    },

    call_flow_agent: {
      description: 'Invoke a specialized sFlow subagent. Supports sync (run_in_background=false) and async (run_in_background=true) modes. Async mode returns a task_id; use flowagent_output to retrieve results when complete.',
      args: {
        description: z.string().describe('Short (3-5 words) description of the task'),
        prompt: z.string().describe('The task for the subagent to perform'),
        subagent_type: z.string().describe('The subagent to invoke (e.g. build-executor, spec-writer)'),
        run_in_background: z.boolean().describe('true=async (returns task_id for flowagent_output), false=sync (waits for completion)'),
        session_id: z.string().optional().describe('Existing session to continue (sync mode only)'),
      },
      execute: async (args, context) => {
        const changeDir = context.directory || '';
        const { subagent_type, prompt, run_in_background, session_id, description } = args;

        const isSFlowContext = await directoryExists(`${changeDir}/.sflow`);
        const isIFlowContext = await directoryExists(`${changeDir}/.iflow`);

        if (isSFlowContext && !isIFlowContext) {
          const validSFlowAgents = SFLOW_AGENT_NAMES as readonly string[];
          if (!validSFlowAgents.includes(subagent_type as string)) {
            return await formatToolError(
              `Invalid SFlow agent: "${subagent_type}". Available SFlow agents: ${validSFlowAgents.join(', ')}`,
            );
          }
        } else if (isIFlowContext && !isSFlowContext) {
          const validIFlowAgents = IFLOW_AGENT_NAMES as readonly string[];
          if (!validIFlowAgents.includes(subagent_type as string)) {
            return await formatToolError(
              `Invalid IFlow agent: "${subagent_type}". Available IFlow agents: ${validIFlowAgents.join(', ')}`,
            );
          }
        }

        const workflowPrefix = isIFlowContext ? 'iFlow' : 'sFlow';
        const sessionLabel = `${workflowPrefix} → ${subagent_type}`;

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
      description: 'Retrieve results from a background sFlow subagent task (call_flow_agent async mode). Call this when a <system-reminder> notifies you that a background task completed. Use block=true to wait for completion (timeout: 120s).',
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
      description: 'Cancel a running sFlow subagent task by task_id (call_flow_agent async mode). Use this when you no longer need the result.',
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

  const agnesTools = createAgnesTools();
  Object.assign(tools, agnesTools);

  return tools;
}

// ─── Combined plugin server function ──────────────────────────────────────────

async function combinedPlugin(input: PluginInput, _options?: PluginOptions): Promise<Hooks> {
  const cascadedConfig = await loadCascadedSFlowConfig();
  const configOverrides = agentOverridesFromConfig(cascadedConfig);

  const workDir = input.directory;
  const sflowClient = input.client;

  const hookComposer = createHookComposer();
  const skillLoader = await createSkillLoader();
  const mcpManager = createMcpManager();

  // Build combined tool definitions
  const tools = createCombinedTools(sflowClient);
  const validatorTools = createValidatorTools();
  const workflowTools = createWorkflowTools();
  Object.assign(tools, validatorTools, workflowTools);

  return {
    dispose: async () => {
      for (const server of mcpManager.getRunningServers()) {
        try {
          await mcpManager.stopServer(server.name);
        } catch (err) {
          console.warn(`[sFlow] Failed to stop MCP server ${server.name}: `, err);
        }
      }
    },

    event: async (input) => {
      const event = input.event;
      if (event.type === 'session.created') {
        const sessionStartHook = hookComposer.getHook('session_start');
        if (sessionStartHook) {
          await sessionStartHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${getStateFilePath('sflow')}`,
            pluginRoot: '',
            action: 'session.created',
          });
        }
      } else if (event.type === 'session.deleted') {
        const sessionEndHook = hookComposer.getHook('session_end');
        if (sessionEndHook) {
          await sessionEndHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${getStateFilePath('sflow')}`,
            pluginRoot: '',
            action: 'session.deleted',
          });
        }
      }
    },

    config: async (cfg) => {
      const hasOmo = detectOmoPlugin(cfg.plugin);
      setHasOmoPlugin(hasOmo);

      const hasAgnes = await detectAgnesProvider({ provider: cfg.provider as Record<string, unknown> | undefined, plugin: cfg.plugin });
      setHasAgnesProvider(hasAgnes);

      if (!cfg.agent) cfg.agent = {};

      // Register ALL agents (both SFlow and IFlow)
      for (const name of getAgentNames()) {
        const override = configOverrides[name];
        const skill = skillLoader.getSkill(name);
        const agentCfg = await createAgent(name, undefined, undefined, skill?.content);

        const instructions = (typeof agentCfg.instructions === 'string' ? agentCfg.instructions : '') || (typeof agentCfg.prompt === 'string' ? agentCfg.prompt : '');
        const modelName = typeof agentCfg.model === 'string' ? agentCfg.model : undefined;
        const temperature = typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined;
        const agentTools = agentCfg.tools ?? undefined;

        cfg.agent[name] = {
          model: modelName,
          prompt: instructions,
          mode: getAgentMode(name),
          tools: agentTools,
          color: AGENT_COLORS[name],
          temperature: override?.temperature ?? temperature,
          description: (typeof agentCfg.id === 'string')
            ? `${agentCfg.id} agent from sFlow plugin`
            : undefined,
        };

        if (modelName) {
          AGENT_MODEL_MAP[name] = modelName;
        }
      }

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
              console.warn(`[sFlow] Failed to start MCP server ${server.name}: ${err.message}`);
              if (cfg.mcp) delete cfg.mcp[server.name];
            });
          }
        }
      }

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
              console.warn(`[sFlow] Failed to start project MCP server ${name}: ${err.message}`);
              if (cfg.mcp) delete cfg.mcp[name];
            });
          }
        }
      }
    },

    tool: tools,

    "command.execute.before": async (input, output) => {
      const command = input.command;
      if (!command.startsWith('/')) return;
      const skillName = command.slice(1);
      const skill = skillLoader.getSkill(skillName);
      if (!skill) return;
      const skillContent = skill.content;
      if (!skillContent) return;
      output.parts.push({
        id: `sflow-skill-${Date.now()}`,
        sessionID: input.sessionID,
        messageID: '',
        type: 'text',
        text: skillContent,
      });
    },

    "tool.execute.before": async (input, output) => {
      const toolName = input.tool;
      const lowerTool = toolName?.toLowerCase();

      if (lowerTool === 'call_omo_agent') {
        markOmoUsed();
      }

      const filePath = (lowerTool === 'write' || lowerTool === 'edit')
        ? (((output.args ?? {}) as Record<string, unknown>).filePath
          ?? ((output.args ?? {}) as Record<string, unknown>).path
          ?? ((output.args ?? {}) as Record<string, unknown>).file_path
          ?? '') as string
        : '';

      const guardHook = hookComposer.getHook('guard');
      if (guardHook) {
        const guardResult = await guardHook.execute({
          changeDir: workDir,
          stateFile: `${workDir}/${getStateFilePath('sflow')}`,
          pluginRoot: '',
          action: `tool:${toolName}`,
          data: {
            toolName: lowerTool,
            agent: (input as Record<string, unknown>).agent,
            filePath,
          },
        });

        if (guardResult.block) {
          output.args = {
            ...(output.args ?? {}),
            _sflow_guard_blocked: true,
            _sflow_guard_reason: guardResult.blockReason ?? guardResult.error ?? 'Guard condition not met',
          };
          return;
        }
      }
    },

    "tool.execute.after": async (input, output) => {
      const toolName = input.tool;
      if (!SFLOW_TOOLS.has(toolName)) return;

      const validationHook = hookComposer.getHook('artifact_validation');
      if (validationHook) {
        const currentState = await getCurrentWorkflowState(workDir);
        const validationCtx: HookContext = {
          changeDir: workDir,
          stateFile: `${workDir}/${getStateFilePath('sflow')}`,
          pluginRoot: '',
          action: `tool:${toolName}:after`,
          data: { newState: currentState },
        };
        const validationRes = await validationHook.execute(validationCtx);
        if (!validationRes.success && validationRes.block) {
          output.output = `[sFlow validation] ${validationRes.blockReason ?? validationRes.error ?? 'Artifact validation failed'}\n${output.output}`;
        }
      }

      const outputStr = output.output ?? '';
      const stateMatch = outputStr.match(/"state"\s*:\s*"(\w[\w-]*)"/);
      if (stateMatch) {
        const newState = stateMatch[1];

        const isIFlowTool = toolName === 'iflow_router';
        const isIFlowState = newState && IFLOW_STATES.has(newState);
        if (isIFlowTool || (isIFlowState && !SFLOW_TOOLS.has(toolName))) {
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
              console.warn('[Combined] IFlow state transition blocked:', result.blockReason ?? result.error);
            }
          } else {
            try {
              await ensureDir(`${workDir}/.iflow`);
              await writeJsonFile(`${workDir}/${getStateFilePath('iflow')}`, {
                state: newState,
                updatedAt: new Date().toISOString(),
              });
            } catch (err) {
              console.warn('[sFlow] Failed to write IFlow state:', err);
            }
          }
          return;
        }

        const transitionHook = hookComposer.getHook('state_transition');
        if (transitionHook) {
          await transitionHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${getStateFilePath('sflow')}`,
            pluginRoot: '',
            action: 'state-transition',
            data: { newState },
          });
        }
        if (newState !== 'exploring') {
          resetOmoTracking();
        }
      }

      const postProcessHook = hookComposer.getHook('post_process');
      if (postProcessHook) {
        const ppResult = await postProcessHook.execute({
          changeDir: workDir,
          stateFile: `${workDir}/${getStateFilePath('sflow')}`,
          pluginRoot: '',
          action: `tool:${toolName}:after`,
          data: { output: outputStr },
        });
        if (ppResult.success) {
          const ppData = ppResult.data as { stateTransitionSignal?: { from?: string; to: string } } | null;
          if (ppData?.stateTransitionSignal) {
            const transitionHook = hookComposer.getHook('state_transition');
            if (transitionHook) {
              await transitionHook.execute({
                changeDir: workDir,
                stateFile: `${workDir}/${getStateFilePath('sflow')}`,
                pluginRoot: '',
                action: 'state-transition',
                data: { newState: ppData.stateTransitionSignal.to },
              });
            }
            if (ppData.stateTransitionSignal.to !== 'exploring') {
              resetOmoTracking();
            }
          }
        }
      }
    },

    "experimental.compaction.autocontinue": async (input, output) => {
      const continuationHook = hookComposer.getHook('continuation');
      if (!continuationHook) return;
      const result = await continuationHook.execute({
        changeDir: workDir,
        stateFile: `${workDir}/${getStateFilePath('sflow')}`,
        pluginRoot: '',
        action: 'autocontinue',
      });
      const shouldContinue = result.success && (result.data as { shouldContinue?: boolean })?.shouldContinue === true;
      output.enabled = shouldContinue;
    },
  };
}

// ─── Re-export factory functions from individual factories ─────────────────────

export { createSFlowPluginModule } from './sflow-plugin-factory.js';
export { createIFlowPluginModule } from './iflow-plugin-factory.js';

// ─── Combined plugin module ───────────────────────────────────────────────────

/**
 * Create a combined PluginModule with both SFlow and IFlow workflows.
 * Uses 'opencode-sflow' as default ID for backward compatibility.
 */
export function createCombinedPluginModule(pluginId: string = 'opencode-sflow'): PluginModule {
  return {
    id: pluginId,
    server: combinedPlugin,
  };
}

// Default export: Combined plugin module with backward-compatible ID
const combinedPluginModule: PluginModule = {
  id: 'opencode-sflow',
  server: combinedPlugin,
};

export default combinedPluginModule;
