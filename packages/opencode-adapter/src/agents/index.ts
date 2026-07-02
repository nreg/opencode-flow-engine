/**
 * Agent index exports for sFlow
 */

export { createSFlowAgent } from './spec-flow.js';
export { createNeedExplorerAgent } from './need-explorer.js';
export { createSpecWriterAgent } from './spec-writer.js';
export { createContractBuilderAgent } from './contract-builder.js';
export { createBuildExecutorAgent } from './build-executor.js';
export { createBugInvestigatorAgent } from './bug-investigator.js';
export { createCodeReviewerAgent } from './code-reviewer.js';
export { createReleaseArchivistAgent } from './release-archivist.js';
export { createSpecMergerAgent } from './spec-merger.js';

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
  AgentCategory,
  AgentCost,
  DelegationTrigger,
  AgentPromptMetadata,
  BuiltinAgentName,
  AgentOverrideConfig,
  AgentOverrides,
} from './types.js';
