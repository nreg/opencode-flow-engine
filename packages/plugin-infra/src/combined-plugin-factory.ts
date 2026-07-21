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
import { createIFlowRouterTool } from './tools/iflow-router.js';
import { createCallFlowAgentTools } from './tools/call-flow-agent.js';

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
import { IFLOW_AGENT_NAMES } from '../../../workflows/iflow/index.js';
import { SFLOW_AGENT_NAMES } from '../../../workflows/sflow/index.js';
import { SHARED_AGENT_NAMES } from '../../../workflows/shared/index.js';
import { createAgnesTools } from './agnes-tools.js';
import { getCurrentWorkflowState, executeContractValidator, executeArtifactInspector } from './sflow-tool-helpers.js';

// ─── Background task registry (shared for combined plugin) ────────────────────

const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
let backgroundTaskCounter = { value: 0 };

// ─── Agent model map (populated during config hook) ───────────────────────────

const AGENT_MODEL_MAP: AgentModelMap = {};

// ─── Combined tool definitions (SFlow + IFlow) ────────────────────────────────

function createCombinedTools(client: SFlowClient): Record<string, ToolDefinition> {
  const callFlowAgentTools = createCallFlowAgentTools({
    client,
    backgroundTaskRegistry,
    backgroundTaskCounter,
    agentModelMap: AGENT_MODEL_MAP,
    sessionLabelPrefix: (subagentType, context) => {
      // Determine workflow prefix based on context
      const changeDir = (context.directory as string) || '';
      const isIFlowCtx = changeDir ? true : false; // context available from execute
      // Use agent name from context to determine prefix
      const callerAgent = (context.agent as string) || '';
      const lower = callerAgent.toLowerCase();
      if (lower === 'iflow' || lower.startsWith('iflow-')) return 'iFlow';
      if (lower === 'sflow' || lower.startsWith('sflow-')) return 'sFlow';
      // Fallback: check directory
      if (changeDir.includes('.flow-engine/iflow')) return 'iFlow';
      if (changeDir.includes('.flow-engine/sflow')) return 'sFlow';
      return 'WF';
    },
    workflowName: 'workflow',
    validateAgent: async (subagentType, context) => {
      const changeDir = (context.directory as string) || '';

      // Detect workflow context
      const isSFlowContext = await directoryExists(`${changeDir}/.flow-engine/sflow`);
      const isIFlowContext = await directoryExists(`${changeDir}/.flow-engine/iflow`);

      let callerWorkflow: 'iflow' | 'sflow' | 'unknown' = 'unknown';
      if (isIFlowContext && !isSFlowContext) {
        callerWorkflow = 'iflow';
      } else if (isSFlowContext && !isIFlowContext) {
        callerWorkflow = 'sflow';
      } else if (isIFlowContext && isSFlowContext) {
        const callerAgent = (context.agent as string) || '';
        const lower = callerAgent.toLowerCase();
        if (lower === 'iflow' || lower.startsWith('iflow-')) {
          callerWorkflow = 'iflow';
        } else if (lower === 'sflow' || lower.startsWith('sflow-')) {
          callerWorkflow = 'sflow';
        }
      }

      const sharedNames = SHARED_AGENT_NAMES as readonly string[];

      if (callerWorkflow === 'iflow') {
        if (sharedNames.includes(subagentType as string)) return null;
        const validIFlowAgents = IFLOW_AGENT_NAMES as readonly string[];
        if (!validIFlowAgents.includes(subagentType as string)) {
          return `无效的 IFlow agent: "${subagentType}"。可用的 IFlow agent: ${validIFlowAgents.join(', ')}`;
        }
        return null;
      } else if (callerWorkflow === 'sflow') {
        if (sharedNames.includes(subagentType as string)) return null;
        const validSFlowAgents = SFLOW_AGENT_NAMES as readonly string[];
        if (!validSFlowAgents.includes(subagentType as string)) {
          return `无效的 SFlow agent: "${subagentType}"。可用的 SFlow agent: ${validSFlowAgents.join(', ')}`;
        }
        return null;
      } else {
        // Unknown context: allow all registered + shared agents
        const allAgents = [...new Set([...IFLOW_AGENT_NAMES, ...SFLOW_AGENT_NAMES, ...SHARED_AGENT_NAMES])];
        if (!allAgents.includes(subagentType as string)) {
          return `无效的 agent: "${subagentType}"。可用 agent: ${allAgents.join(', ')}`;
        }
        return null;
      }
    },
  });

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
      description: 'Detect current IFlow state from .flow-engine/iflow/ directory artifacts and route to the appropriate agent. Supports IFlow-specific intent patterns.',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
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

    ...callFlowAgentTools,
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

          } else {
            try {
              await ensureDir(`${workDir}/.flow-engine/iflow`);
              await writeJsonFile(`${workDir}/${getStateFilePath('iflow')}`, {
                state: newState,
                updatedAt: new Date().toISOString(),
              });
            } catch {}
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
