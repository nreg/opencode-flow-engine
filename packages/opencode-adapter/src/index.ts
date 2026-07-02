/**
 * sFlow OpenCode Plugin
 * OpenSpec planning engine + Superpowers execution discipline
 */

import type { PluginInput, PluginOptions, Hooks, PluginModule } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';
import { z } from 'zod';

// Core
export { Validator } from '@opencode-sflow/core';
export type {
  Scenario,
  Requirement,
  Spec,
  DeltaOperationType,
  Rename,
  Delta,
  Change,
  WorkflowState,
  WorkflowMode,
  WorkflowStateFile,
  ValidationReport,
  ValidationIssue,
  VerificationReport,
  ConflictReport,
} from '@opencode-sflow/core';

// Agents
import {
  createSFlowAgent,
  createNeedExplorerAgent,
  createSpecWriterAgent,
  createContractBuilderAgent,
  createBuildExecutorAgent,
  createBugInvestigatorAgent,
  createCodeReviewerAgent,
  createReleaseArchivistAgent,
  createSpecMergerAgent,
  getAgentNames,
  getAgentMode,
  getDefaultModel,
} from './agents/index.js';
export {
  createSFlowAgent,
  createNeedExplorerAgent,
  createSpecWriterAgent,
  createContractBuilderAgent,
  createBuildExecutorAgent,
  createBugInvestigatorAgent,
  createCodeReviewerAgent,
  createReleaseArchivistAgent,
  createSpecMergerAgent,
};

// Tools
export {
  createWorkflowRouterTool,
  createContractValidatorTool,
  createArtifactInspectorTool,
} from './tools/index.js';

// Hooks
export {
  createStateTransitionHook,
  createArtifactValidationHook,
  createGuardHook,
} from './hooks/index.js';

// Features
export {
  createWorkflowManager,
  createStateManager,
  BuiltinMcpRegistry,
  createValidatorMcpServer,
} from './features/index.js';
export type { BuiltinMcpServer } from './features/index.js';

// Shared
export { deepMerge, fileExists, readFile, writeFile, listFiles } from '@opencode-sflow/shared';

// Config
import {
  loadCascadedSFlowConfig,
  agentOverridesFromConfig,
} from './agents/config-loader.js';

export const PLUGIN_ID = 'opencode-sflow';
export const PLUGIN_VERSION = '0.1.0';

/**
 * sFlow Plugin - registers agents and tools with OpenCode
 */
async function sflowPlugin(input: PluginInput, _options?: PluginOptions): Promise<Hooks> {
  const cascadedConfig = await loadCascadedSFlowConfig();
  const configOverrides = agentOverridesFromConfig(cascadedConfig);

  console.log(`[sFlow] Initializing in ${input.directory}`);

  const DEFAULT_MODELS: Record<string, string> = {};
  for (const name of getAgentNames()) {
    DEFAULT_MODELS[name] = getDefaultModel(name);
  }

  return {
    dispose: async () => {
      console.log('[sFlow] Plugin disposed');
    },

    config: async (cfg) => {
      cfg.agent = cfg.agent || {};
      for (const name of getAgentNames()) {
        const override = configOverrides[name];
        const model = override?.model || DEFAULT_MODELS[name];
        cfg.agent[name] = {
          model,
          mode: getAgentMode(name),
          description: `sFlow workflow agent`,
          ...(override?.temperature ? { temperature: override.temperature } : {}),
        };
      }
    },

    tool: {
      workflow_router: tool({
        description: 'Detect current workflow state and route to the appropriate agent',
        args: {
          state: z.string().optional().describe('Target workflow state to transition to'),
        },
        async execute(args) {
          const state = args.state || 'exploring';
          return {
            title: 'Workflow Router',
            output: `Routing to workflow state: ${state}`,
          };
        },
      }),

      contract_validator: tool({
        description: 'Validate execution contract for correctness and completeness',
        args: {
          contract_path: z.string().describe('Path to the contract file'),
        },
        async execute(args) {
          return {
            title: 'Contract Validator',
            output: `Validating contract: ${args.contract_path}`,
          };
        },
      }),

      artifact_inspector: tool({
        description: 'Inspect planning artifacts for completeness and consistency',
        args: {
          artifact_path: z.string().describe('Path to the artifact file'),
        },
        async execute(args) {
          return {
            title: 'Artifact Inspector',
            output: `Inspecting artifact: ${args.artifact_path}`,
          };
        },
      }),
    },
  };
}

/**
 * sFlow Plugin Module - matches OpenCode PluginModule format
 */
const sflowPluginModule: PluginModule = {
  id: PLUGIN_ID,
  server: sflowPlugin,
};

export default sflowPluginModule;
