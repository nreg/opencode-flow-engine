/**
 * IFlow workflow - Agent factory exports
 * GSD-style cyclic workflow: discussing → researching → planning → executing → verifying → shipping
 */

export { createIFlowAgent } from './agents/iflow.js';
export { createIFlowDiscussPlannerAgent } from './agents/iflow-discuss-planner.js';
export { createIFlowPlanExecutorAgent } from './agents/iflow-plan-executor.js';
export { createIFlowVerifierAgent } from './agents/iflow-verifier.js';
export { createIFlowResearcherAgent } from './agents/iflow-researcher.js';
export { createIFlowShipperAgent } from './agents/iflow-shipper.js';

/** IFlow agent names for registration */
export const IFLOW_AGENT_NAMES = [
  'iFlow',
  'iflow-discuss-planner',
  'iflow-plan-executor',
  'iflow-verifier',
  'iflow-researcher',
  'iflow-shipper',
  'ui-implementer',
] as const;

/** IFlow workflow directory name */
export const IFLOW_DIR = '.flow-engine/iflow';
