import type { PluginInput, PluginOptions, Hooks, PluginModule } from '@opencode-ai/plugin';

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

export const PLUGIN_ID = 'opencode-sflow';
export const PLUGIN_VERSION = '0.1.0';

async function sflowPlugin(input: PluginInput, _options?: PluginOptions): Promise<Hooks> {
  const cascadedConfig = await loadCascadedSFlowConfig();
  const configOverrides = agentOverridesFromConfig(cascadedConfig);

  console.log(`[sFlow] Initializing in ${input.directory}`);

  const toolRegistry = createToolRegistry();
  const hookComposer = createHookComposer();

  return {
    dispose: async () => {
      console.log('[sFlow] Plugin disposed');
    },

    config: async (cfg) => {
      cfg.agent = cfg.agent || {};
      for (const name of getAgentNames()) {
        const override = configOverrides[name];
        const agentCfg = await createAgent(name);
        cfg.agent[name] = {
          model: agentCfg.model,
          mode: getAgentMode(name),
          prompt: agentCfg.instructions,
          ...(override?.temperature ? { temperature: override.temperature } : {}),
        };
      }
    },

    tool: {
      workflow_router: {
        description: 'Detect current workflow state and route to the appropriate agent',
        args: {
          state: { type: 'string', description: 'Target workflow state to transition to' },
        },
        execute: async (args, context) => {
          const tool = toolRegistry.getTool('workflow_router');
          if (!tool) return { title: 'Error', output: 'Tool not found' };
          const result = await tool.execute(args, {
            changeDir: context.directory || '',
            stateFile: `${context.directory || ''}/.sflow/state.json`,
            pluginRoot: '',
          });
          return { title: 'Workflow Router', output: JSON.stringify(result.data || result.error) };
        },
      },

      contract_validator: {
        description: 'Validate execution contract for correctness and completeness',
        args: {
          contract_path: { type: 'string', description: 'Path to the contract file' },
        },
        execute: async (args, context) => {
          const tool = toolRegistry.getTool('contract_validator');
          if (!tool) return { title: 'Error', output: 'Tool not found' };
          const result = await tool.execute(args, {
            changeDir: context.directory || '',
            stateFile: '',
            pluginRoot: '',
          });
          return { title: 'Contract Validator', output: JSON.stringify(result.data || result.error) };
        },
      },

      artifact_inspector: {
        description: 'Inspect planning artifacts for completeness and consistency',
        args: {
          artifact_path: { type: 'string', description: 'Path to the artifact file' },
        },
        execute: async (args, context) => {
          const tool = toolRegistry.getTool('artifact_inspector');
          if (!tool) return { title: 'Error', output: 'Tool not found' };
          const result = await tool.execute(args, {
            changeDir: context.directory || '',
            stateFile: '',
            pluginRoot: '',
          });
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
