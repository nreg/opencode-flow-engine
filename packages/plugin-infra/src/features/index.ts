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

export type {
  CheckpointFile,
  HandoffFile,
  HandoffStatus,
  HandoffDecision,
} from './state-manager.js';

export {
  saveCheckpoint,
  readCheckpoint,
  detectStaleCheckpoints,
  clearCheckpoint,
  CHECKPOINT_DIR,
  createHandoff,
  finishHandoff,
  resolveHandoff,
  readHandoff,
  listHandoffs,
  HANDOFF_DIR,
  HANDOFF_TYPES,
} from './state-manager.js';

export {
  createTaskTracker,
} from './task-tracker.js';

export type {
  TrackerBeforeRecord,
  TrackerAfterRecord,
  TrackerRecord,
  TrackerData,
  TaskTrackerInstance,
} from './task-tracker.js';

export {
  createNotificationManager,
} from './notification-manager.js';

export type {
  NotificationType,
  WriteNotificationParams,
  NotificationEntry,
  ConsumedNotification,
  NotificationManager,
} from './notification-manager.js';

export {
  createSubagentStore,
} from './subagent-store.js';

export type {
  AgentStatus,
  AgentMeta,
  AgentEvent,
  AgentData,
  CreateAgentParams,
  IndexEntry,
  ResumeResult,
  SubagentStore,
} from './subagent-store.js';

export {
  DEFAULT_LINE_LIMIT,
  REFERENCE_LINE_THRESHOLD,
  ARTIFACT_FILE_PATTERNS,
  truncateContent,
  isArtifactFile,
  classifyFile,
  isWithinLimit,
  applyTokenBudgetToContent,
} from './token-budget-limiter.js';

export type { FileTier } from './token-budget-limiter.js';

// ─── Schema Migration Detector ────────────────────────────────────────────────

export type {
  SchemaChange,
  FrameworkDetectionResult,
  FrameworkDetector,
} from './schema-migration-detector.js';

export {
  SCHEMA_FILE_PATTERNS,
  FRAMEWORK_DETECTORS,
  detectSchemaChanges,
  generateMigrationFile,
  checkMigrationFileExists,
} from './schema-migration-detector.js';

// ─── Abstraction Grep Tracker ─────────────────────────────────────────────────

export type {
  AbstractionCategoryDef,
  AbstractionCategory,
} from './abstraction-grep-tracker.js';

export {
  ABSTRACTION_PATTERNS,
  ABSTRACTION_CATEGORIES,
  detectNewAbstraction,
  recordGrepResult,
  hasGrepRecord,
} from './abstraction-grep-tracker.js';
