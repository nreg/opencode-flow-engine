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
} from './review-receipts.js';
