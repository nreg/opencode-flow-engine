/**
 * Agent index exports for sFlow
 * Imports agent factories from workflow definitions
 */

// Re-export SFlow agents from workflow definition
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
  createUiDirectorAgent,
  createUiImplementerAgent,
} from '../../../../workflows/sflow/index.js';

// Re-export IFlow agents from workflow definition
export {
  createIFlowAgent,
  createIFlowDiscussPlannerAgent,
  createIFlowPlanExecutorAgent,
  createIFlowVerifierAgent,
  createIFlowResearcherAgent,
  createIFlowShipperAgent,
} from '../../../../workflows/iflow/index.js';

// Re-export Shared agents (cross-workflow, standalone)
export {
  createTestEngineerAgent,
  createReviewEngineerAgent,
  SHARED_AGENT_NAMES,
} from '../../../../workflows/shared/index.js';

export {
  loadSFlowConfig,
  loadUserSFlowConfig,
  loadCascadedSFlowConfig,
  agentOverridesFromConfig,
  mergeOverrides,
  generateConfigTemplate,
  USER_CONFIG_FILE,
} from './config-loader.js';

export {
  createAgent,
  createAllAgents,
  getAgent,
  getAgentNames,
  getAgentMode,
  getPrimaryAgents,
  getSubagentAgents,
  agentExists,
  getDefaultModel,
  getAllDefaultModels,
  clearConfigCache,
} from './agent-builder.js';

export type {
  AgentConfigEntry,
  SFlowConfig,
} from './config-loader.js';

export type {
  AgentMode,
  AgentFactory,
  BuiltinAgentName,
  AgentOverrideConfig,
  AgentOverrides,
} from './types.js';

export type {
  ModelProvenance,
  ModelResolutionResult,
} from './agent-builder.js';
