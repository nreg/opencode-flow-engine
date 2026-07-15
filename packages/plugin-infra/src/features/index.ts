/**
 * Features index exports for sFlow
 */

export type {
  FeatureName,
  FeatureConfig,
  FeatureResult,
} from './types.js';

export { createWorkflowManager } from './workflow-manager.js';
export { createStateManager } from './state-manager.js';
export {
  BuiltinMcpRegistry,
  createValidatorTools,
} from './builtin-mcp.js';

export type {
  ExecutionMode,
  ReceiptStatus,
  WaveStrategy,
  PlanSource,
  Wave,
  ReviewReceipt,
  DP4Result,
  ExecutionPlan,
} from './execution-plan-types.js';

export {
  createExecutionPlan,
  readExecutionPlan,
  validatePlanHashes,
  reviseExecutionPlan,
  computeContentHash,
  recommendExecutionMode,
  validatePlanStructure,
  recordReviewReceipt,
} from './execution-plan.js';

export type {
  CreateExecutionPlanParams,
  ReviseExecutionPlanParams,
  HashValidationResult,
} from './execution-plan.js';
