/**
 * Execution plan feature module - Public API
 *
 * Re-exports all public functions and types from execution-plan submodules.
 * This allows existing imports from '../features/execution-plan.js' to continue working.
 */

// Export all from plan-crud.ts
export {
  // Constants
  EXECUTION_PLAN_FILE,
  STATE_FILE,
  VALID_MODES,
  MODE_RANK,
  // Functions
  computeContentHash,
  validatePlanStructure,
  createExecutionPlan,
  readExecutionPlan,
  validatePlanHashes,
  reviseExecutionPlan,
  recommendExecutionMode,
  // Types
  type CreateExecutionPlanParams,
  type HashValidationResult,
  type ReviseExecutionPlanParams,
} from './plan-crud.js';

// Export all from review-receipts.ts
export {
  // Functions
  migrateLegacyReceipts,
  recordReviewReceipt,
  readCurrentReviewReceipt,
  readRepairState,
  validateRepairContinuity,
  updateRepairState,
  // P0-1: 审查区间完整性（Wave 3 终评区间复用）
  assertNonEmptyDiff,
  // P0-2: Issue-identity circuit breaker
  issueFailureCount,
  validateIssueId,
  adjudicateWave,
  readActiveAdjudicationAsync,
  // P0-3: Plan revision recovery
  resolveRecommendationPlanRevision,
  // P1-1: Review targets
  reviewTargets,
  // P1-5: Review base
  normalizeCommitSha,
  recordReviewBase,
  validateFinalReviewRange,
  isGitEnvironment,
} from './review-receipts.js';

// Export all from task-parser.ts（D7: 复选框行单一解析入口）
export {
  parseTasks,
  incompleteTasks,
  type ParsedTask,
} from './task-parser.js';
