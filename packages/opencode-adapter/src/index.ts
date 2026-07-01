/**
 * sFlow OpenCode Plugin
 * Integrates OpenSpec planning engine with Superpowers execution discipline
 */

import type { PluginInput } from '@opencode-ai/plugin';
import { tool } from '@opencode-ai/plugin';

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

/**
 * Plugin ID
 */
export const PLUGIN_ID = 'opencode-sflow';

/**
 * Plugin version
 */
export const PLUGIN_VERSION = '0.1.0';

/**
 * Create the sFlow plugin
 */
export function createSFlowPlugin(ctx: PluginInput) {
  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    
    /**
     * Initialize the plugin
     */
    async initialize() {
      console.log(`[sFlow] Initializing plugin v${PLUGIN_VERSION}`);
      
      // Register agents
      // Register tools
      // Register hooks
      // Register features
      
      return { success: true };
    },
    
    /**
     * Get plugin info
     */
    getInfo() {
      return {
        id: PLUGIN_ID,
        version: PLUGIN_VERSION,
        name: 'sFlow',
        description: 'OpenSpec planning engine + Superpowers execution discipline',
        agents: [
          'sflow',
          'need-explorer',
          'spec-writer',
          'contract-builder',
          'build-executor',
          'bug-investigator',
          'code-reviewer',
          'release-archivist',
          'spec-merger',
        ],
        tools: [
          'workflow_router',
          'contract_validator',
          'artifact_inspector',
        ],
        hooks: [
          'state_transition',
          'artifact_validation',
          'guard',
        ],
        features: [
          'workflow_manager',
          'state_manager',
        ],
      };
    },
  };
}

/**
 * Default export for OpenCode plugin system
 */
export default createSFlowPlugin;
