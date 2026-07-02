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
} from './agents/index.js';

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
} from './features/index.js';

// Shared
export { deepMerge, fileExists, readFile, writeFile, listFiles } from '@opencode-sflow/shared';

// Config
import {
  loadCascadedSFlowConfig,
  agentOverridesFromConfig,
} from './agents/config-loader.js';

export const PLUGIN_ID = 'opencode-sflow';
export const PLUGIN_VERSION = '0.1.0';

interface SflowAgentEntry {
  model: string;
  mode: 'primary' | 'subagent';
  description: string;
  temperature?: number;
  color?: string;
}

const AGENT_DEFINITIONS: Record<string, SflowAgentEntry> = {
  sflow: {
    model: 'deepseek-v4-flash',
    mode: 'primary',
    description: 'Workflow orchestrator, routes to subagents',
    color: '#6366f1',
  },
  'need-explorer': {
    model: 'kimi-k2.6',
    mode: 'subagent',
    description: 'Requirement clarification',
    color: '#22c55e',
  },
  'spec-writer': {
    model: 'glm-5.1',
    mode: 'subagent',
    description: 'Artifact generation with validation',
    color: '#f59e0b',
  },
  'contract-builder': {
    model: 'glm-5',
    mode: 'subagent',
    description: 'Bridge contract creation',
    color: '#ec4899',
  },
  'build-executor': {
    model: 'step-3.7-flash',
    mode: 'subagent',
    description: 'TDD execution',
    color: '#3b82f6',
  },
  'bug-investigator': {
    model: 'minimax-m2.7',
    mode: 'subagent',
    description: 'Systematic debugging',
    color: '#ef4444',
  },
  'code-reviewer': {
    model: 'deepseek-v4-flash',
    mode: 'subagent',
    description: 'Code quality review',
    color: '#a855f7',
  },
  'release-archivist': {
    model: 'mimo-v2.5-pro',
    mode: 'subagent',
    description: 'Closure and archiving',
    color: '#14b8a6',
  },
  'spec-merger': {
    model: 'mimo-v2.5',
    mode: 'subagent',
    description: 'Delta spec synchronization',
    color: '#f97316',
  },
};

/**
 * sFlow Plugin - registers agents and tools with OpenCode
 */
async function sflowPlugin(input: PluginInput, _options?: PluginOptions): Promise<Hooks> {
  const cascadedConfig = loadCascadedSFlowConfig();
  const configOverrides = agentOverridesFromConfig(cascadedConfig);

  console.log(`[sFlow] Initializing in ${input.directory}`);

  return {
    dispose: async () => {
      console.log('[sFlow] Plugin disposed');
    },

    config: async (cfg) => {
      // Register sFlow agents with OpenCode via config hook
      cfg.agent = cfg.agent || {};
      for (const [name, def] of Object.entries(AGENT_DEFINITIONS)) {
        const override = configOverrides[name as keyof typeof configOverrides];
        const model = override?.model || def.model;
        cfg.agent[name] = {
          model,
          mode: def.mode,
          description: def.description,
          color: def.color,
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
