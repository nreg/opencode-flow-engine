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

export const PLUGIN_ID = 'opencode-sflow';
export const PLUGIN_VERSION = '0.1.0';

async function sflowPlugin(input: PluginInput, _options?: PluginOptions): Promise<Hooks> {
  const cascadedConfig = await loadCascadedSFlowConfig();
  const configOverrides = agentOverridesFromConfig(cascadedConfig);

  console.log(`[sFlow] Initializing in ${input.directory}`);

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
