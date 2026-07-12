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
export { createUiImplementerAgent } from './ui-implementer.js';
export { createIFlowAgent } from './iflow.js';
export { createIFlowDiscussPlannerAgent } from './iflow-discuss-planner.js';
export { createIFlowPlanExecutorAgent } from './iflow-plan-executor.js';
export { createIFlowVerifierAgent } from './iflow-verifier.js';
export { createIFlowResearcherAgent } from './iflow-researcher.js';
export { createIFlowShipperAgent } from './iflow-shipper.js';

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
