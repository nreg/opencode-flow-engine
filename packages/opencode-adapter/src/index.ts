import type { PluginInput, PluginOptions, Hooks, PluginModule } from '@opencode-ai/plugin';
import { z } from 'zod';

export { Validator } from '@opencode-sflow/core';
export type {
  Scenario, Requirement, Spec, DeltaOperationType, Rename, Delta, Change,
  WorkflowState, WorkflowMode, WorkflowStateFile,
  ValidationReport, ValidationIssue, VerificationReport, ConflictReport,
} from '@opencode-sflow/core';

import {
  getAgentNames, getAgentMode, getDefaultModel, createAgent, createAllAgents,
} from './agents/index.js';
export {
  createSFlowAgent, createNeedExplorerAgent, createSpecWriterAgent,
  createContractBuilderAgent, createBuildExecutorAgent, createBugInvestigatorAgent,
  createCodeReviewerAgent, createReleaseArchivistAgent, createSpecMergerAgent,
} from './agents/index.js';

export {
  createWorkflowRouterTool, createContractValidatorTool, createArtifactInspectorTool,
} from './tools/index.js';

export {
  createStateTransitionHook, createArtifactValidationHook, createGuardHook,
  createSessionStartHook, createSessionEndHook,
  createPreProcessHook, createPostProcessHook, createContinuationHook,
} from './hooks/index.js';

export {
  createWorkflowManager, createStateManager,
  BuiltinMcpRegistry, createValidatorMcpServer,
} from './features/index.js';
export type { BuiltinMcpServer } from './features/index.js';

export { deepMerge, fileExists, readFile, writeFile, listFiles } from '@opencode-sflow/shared';

import { loadCascadedSFlowConfig, agentOverridesFromConfig } from './agents/config-loader.js';
import { createToolRegistry } from './tools/tool-registry.js';
import { createHookComposer } from './hooks/hook-composer.js';
import { createSkillLoader } from './features/skill-loader.js';
import { readJsonFile } from '@opencode-sflow/shared';
import type { HookContext } from './hooks/types.js';

export const PLUGIN_ID = 'opencode-sflow';
export const PLUGIN_VERSION = '0.1.0';

const SFLOW_TOOLS = new Set(['workflow_router', 'contract_validator', 'artifact_inspector']);

async function getCurrentWorkflowState(changeDir: string): Promise<string | null> {
  const state = await readJsonFile<{ state?: string }>(`${changeDir}/.sflow/state.json`);
  return state?.state ?? null;
}

async function sflowPlugin(input: PluginInput, _options?: PluginOptions): Promise<Hooks> {
  const cascadedConfig = await loadCascadedSFlowConfig();
  const configOverrides = agentOverridesFromConfig(cascadedConfig);

  const workDir = input.directory;
  console.log(`[sFlow] Initializing in ${workDir}`);

  const toolRegistry = createToolRegistry();
  const hookComposer = createHookComposer();
  const skillLoader = await createSkillLoader();

  return {
    dispose: async () => {
      console.log('[sFlow] Plugin disposed');
    },

    config: async (cfg: Record<string, unknown>) => {
      // --- Register agents ---
      (cfg as Record<string, unknown>).agent = (cfg as Record<string, unknown>).agent || {};
      const agentMap = (cfg as Record<string, unknown>).agent as Record<string, unknown>;
      for (const name of getAgentNames()) {
        const override = configOverrides[name];
        const agentCfg = await createAgent(name);
        agentMap[name] = {
          model: agentCfg.model,
          mode: getAgentMode(name),
          prompt: agentCfg.instructions,
          ...(override?.temperature ? { temperature: override.temperature } : {}),
        };
      }

      // --- Register tools ---
      (cfg as Record<string, unknown>).tool = (cfg as Record<string, unknown>).tool || {};
      const toolMap = (cfg as Record<string, unknown>).tool as Record<string, unknown>;
      for (const toolName of toolRegistry.getEnabledTools()) {
        const tool = toolRegistry.getTool(toolName);
        if (tool) {
          toolMap[toolName] = {
            description: tool.description,
          };
        }
      }

      // --- Register skill-embedded MCPs (Tier 3) ---
      (cfg as Record<string, unknown>).mcp = (cfg as Record<string, unknown>).mcp || {};
      const mcpMap = (cfg as Record<string, unknown>).mcp as Record<string, unknown>;
      const skillsWithMcp = skillLoader.getSkillsWithMcp();
      for (const skill of skillsWithMcp) {
        if (skill.metadata.mcp?.servers) {
          for (const server of skill.metadata.mcp.servers) {
            mcpMap[server.name] = {
              type: 'local',
              command: server.command,
              args: server.args,
              env: server.env,
            };
          }
        }
      }
    },

    // ── OpenCode native hook: command.execute.before ──
    // Intercept /sflow slash commands and inject skill content
    "command.execute.before": async (_input, output) => {
      const command = _input.command;
      if (!command.startsWith('/')) return;

      const skillName = command.slice(1); // strip leading /
      const skill = skillLoader.getSkill(skillName);
      if (!skill) return;

      const skillContent = skill.content;
      if (!skillContent) return;

      output.parts.push({
        type: 'text',
        text: skillContent,
      } as any);
    },

    // ── OpenCode native hook: tool.execute.before ──
    // For sflow tools, run the guard hook to check state allows execution
    "tool.execute.before": async (_input, output) => {
      const toolName = _input.tool;
      if (!SFLOW_TOOLS.has(toolName)) return;

      const guardHook = hookComposer.getHook('guard');
      if (!guardHook) return;

      const guardResult = await guardHook.execute({
        changeDir: workDir,
        stateFile: `${workDir}/.sflow/state.json`,
        pluginRoot: '',
        action: `tool:${toolName}`,
        data: { toolName },
      });

      if (guardResult.block) {
        // Prepend guard block reason to args so the tool knows it was blocked
        const existingArgs = output.args ?? {};
        output.args = {
          ...existingArgs,
          _sflow_guard_blocked: true,
          _sflow_guard_reason: guardResult.blockReason ?? guardResult.error ?? 'Guard condition not met',
        };
      }
    },

    // ── OpenCode native hook: tool.execute.after ──
    // Run artifact-validation after sflow tool execution;
    // if tool output signals a state change, run state-transition
    "tool.execute.after": async (_input, output) => {
      const toolName = _input.tool;
      if (!SFLOW_TOOLS.has(toolName)) return;

      // Artifact validation
      const validationHook = hookComposer.getHook('artifact_validation');
      if (validationHook) {
        const currentState = await getCurrentWorkflowState(workDir);
        const validationCtx: HookContext = {
          changeDir: workDir,
          stateFile: `${workDir}/.sflow/state.json`,
          pluginRoot: '',
          action: `tool:${toolName}:after`,
          data: { newState: currentState },
        };
        const validationRes = await validationHook.execute(validationCtx);
        if (!validationRes.success && validationRes.block) {
          output.output = `[sFlow validation] ${validationRes.blockReason ?? validationRes.error ?? 'Artifact validation failed'}\n${output.output}`;
        }
      }

      // State transition — detect from tool output
      const outputStr = output.output ?? '';
      const stateMatch = outputStr.match(/"state"\s*:\s*"(\w[\w-]*)"/);
      if (stateMatch) {
        const newState = stateMatch[1];
        const transitionHook = hookComposer.getHook('state_transition');
        if (transitionHook) {
          await transitionHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/.sflow/state.json`,
            pluginRoot: '',
            action: 'state-transition',
            data: { newState },
          });
        }
      }
    },

    // ── OpenCode native hook: chat.message ──
    // When message is sent to sflow agent, inject current workflow state info
    "chat.message": async (_input, output) => {
      const agent = _input.agent;
      // Only inject for sflow agents
      if (!agent) return;

      const currentState = await getCurrentWorkflowState(workDir);
      if (!currentState) return;

      const stateInfo = `[sFlow] Current workflow state: ${currentState}`;
      // Find or create a text part to inject context
      const textParts = output.parts.filter((p): p is typeof p & { text: string } => p.type === 'text');
      const firstText = textParts[0];
      if (firstText) {
        firstText.text = `${stateInfo}\n\n${firstText.text}`;
      }
    },

    // ── OpenCode native hook: experimental.compaction.autocontinue ──
    // Enable auto-continue if workflow state is not closing/abandoned
    "experimental.compaction.autocontinue": async (_input, output) => {
      const continuationHook = hookComposer.getHook('continuation');
      if (!continuationHook) return;

      const result = await continuationHook.execute({
        changeDir: workDir,
        stateFile: `${workDir}/.sflow/state.json`,
        pluginRoot: '',
        action: 'autocontinue',
      });

      const shouldContinue = result.success && (result.data as { shouldContinue?: boolean })?.shouldContinue === true;
      output.enabled = shouldContinue;
    },

    // ── OpenCode native hook: experimental.chat.messages.transform ──
    // Inject workflow context into messages
    "experimental.chat.messages.transform": async (_input, output) => {
      const currentState = await getCurrentWorkflowState(workDir);
      if (!currentState) return;

      const transformHook = hookComposer.getHook('pre_process');
      if (!transformHook) return;

      const result = await transformHook.execute({
        changeDir: workDir,
        stateFile: `${workDir}/.sflow/state.json`,
        pluginRoot: '',
        action: 'messages.transform',
        data: { currentState },
      });

      if (result.success) {
        const transformData = result.data as { context?: string } | null;
        if (transformData?.context) {
          // Inject workflow state as a synthetic system-like message
          output.messages.push({
            info: {
              id: 'sflow-context',
              role: 'user',
              createdAt: new Date().toISOString(),
            } as any,
            parts: [{
              type: 'text',
              text: transformData.context,
            } as any],
          });
        }
      }
    },

    tool: {
      workflow_router: {
        description: 'Detect current workflow state and route to the appropriate agent',
        args: {
          state: z.string().optional(),
        },
        execute: async (args, context) => {
          const resolvedDir = context.directory || process.cwd();
          const result = await toolRegistry.executeTool(
            'workflow_router',
            { changeDir: resolvedDir },
            {
              changeDir: resolvedDir,
              stateFile: `${resolvedDir}/.sflow/state.json`,
              pluginRoot: '',
            },
          );
          return { title: 'Workflow Router', output: JSON.stringify(result.data || result.error) };
        },
      },

      contract_validator: {
        description: 'Validate execution contract for correctness and completeness',
        args: {
          contract_path: z.string().optional(),
        },
        execute: async (args, context) => {
          const contractPath = (args as { contract_path?: string }).contract_path;
          const changeDir = contractPath
            ? contractPath.replace(/\/execution-contract\.md$/, '')
            : context.directory || process.cwd();
          const result = await toolRegistry.executeTool(
            'contract_validator',
            { changeDir },
            {
              changeDir,
              stateFile: `${changeDir}/.sflow/state.json`,
              pluginRoot: '',
            },
          );
          return { title: 'Contract Validator', output: JSON.stringify(result.data || result.error) };
        },
      },

      artifact_inspector: {
        description: 'Inspect planning artifacts for completeness and consistency',
        args: {
          artifact_path: z.string().optional(),
        },
        execute: async (args, context) => {
          const artifactPath = (args as { artifact_path?: string }).artifact_path;
          const changeDir = artifactPath
            ? artifactPath.replace(/\/(proposal|design|tasks)\.md$/, '').replace(/\/specs$/, '')
            : context.directory || process.cwd();
          const result = await toolRegistry.executeTool(
            'artifact_inspector',
            { changeDir },
            {
              changeDir,
              stateFile: `${changeDir}/.sflow/state.json`,
              pluginRoot: '',
            },
          );
          return { title: 'Artifact Inspector', output: JSON.stringify(result.data || result.error) };
        },
      },
    },
  };
}

const sflowPluginModule: PluginModule = {
  id: PLUGIN_ID,
  server: sflowPlugin,
};

export default sflowPluginModule;
