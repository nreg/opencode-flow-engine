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
import { createIFlowRouterTool } from './tools/iflow-router.js';
import { createCallFlowAgentTools } from './tools/call-flow-agent.js';
import { createHookComposer } from './hooks/hook-composer.js';
import { createSkillLoader } from './features/skill-loader.js';
import type { HookContext } from './hooks/types.js';
import { ensureDir, writeJsonFile } from '@opencode-flow-engine/shared';
import { getStateFilePath } from './features/state-manager.js';
import { createMcpManager, loadProjectMcpConfig } from './features/mcp-manager.js';
import { setHasOmoPlugin, setHasAgnesProvider } from './agents/agent-tools.js';
import { pollSessionCompletion } from './helpers/polling.js';
import { IFLOW_AGENT_NAMES } from '../../../workflows/iflow/index.js';
import { SHARED_AGENT_NAMES } from '../../../workflows/shared/index.js';

// ─── Background task registry (per-factory instance) ──────────────────────────

const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
let backgroundTaskCounter = { value: 0 };

// ─── Agent model map (populated during config hook) ───────────────────────────

const AGENT_MODEL_MAP: AgentModelMap = {};

// ─── IFlow tool definitions ──────────────────────────────────────────────────

function createIFlowTools(client: SFlowClient): Record<string, ToolDefinition> {
  const sharedTools = createCallFlowAgentTools({
    client,
    backgroundTaskRegistry,
    backgroundTaskCounter,
    agentModelMap: AGENT_MODEL_MAP,
    sessionLabelPrefix: 'iFlow',
    workflowName: 'IFlow',
    validateAgent: (subagentType) => {
      const sharedNames = SHARED_AGENT_NAMES as readonly string[];
      if (sharedNames.includes(subagentType as string)) return null;
      const validIFlowAgents = IFLOW_AGENT_NAMES as readonly string[];
      if (!validIFlowAgents.includes(subagentType as string)) {
        return `无效的 IFlow agent: "${subagentType}"。可用的 IFlow agent: ${validIFlowAgents.join(', ')}，共享 agent: ${sharedNames.join(', ')}`;
      }
      return null;
    },
  });

  return {
    iflow_router: {
      description: 'Detect current IFlow state from .flow-engine/iflow/ directory artifacts and route to the appropriate agent. Supports IFlow-specific intent patterns.',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
        return createIFlowRouterTool().execute({ ...args, changeDir: context.directory || '' }, context);
      },
    },

    ...sharedTools,
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

        // Register shared agents (cross-workflow, standalone)
        // These are not bound to any IFlow workflow state.
        const sharedNames = SHARED_AGENT_NAMES as readonly string[];
        for (const name of sharedNames) {
          const override = configOverrides[name as import('./agents/types.js').BuiltinAgentName];
          const agentCfg = await createAgent(name as import('./agents/types.js').BuiltinAgentName, undefined, undefined, undefined);

          const instructions = (typeof agentCfg.instructions === 'string' ? agentCfg.instructions : '') || (typeof agentCfg.prompt === 'string' ? agentCfg.prompt : '');
          const modelName = typeof agentCfg.model === 'string' ? agentCfg.model : undefined;
          const temperature = typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined;
          const agentTools = agentCfg.tools ?? undefined;

          cfg.agent[name] = {
            model: modelName,
            prompt: instructions,
            mode: 'subagent',
            tools: agentTools,
            color: AGENT_COLORS[name],
            temperature: override?.temperature ?? temperature,
            description: `${name} agent from iFlow plugin (shared, cross-workflow)`,
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

            } else {
              try {
                await ensureDir(`${workDir}/.flow-engine/iflow`);
                await writeJsonFile(`${workDir}/${getStateFilePath('iflow')}`, {
                  state: newState,
                  updatedAt: new Date().toISOString(),
                });
              } catch {}
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
