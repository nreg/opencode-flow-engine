/**
 * State manager feature - pure re-export module.
 * All logic has been extracted to dedicated sub-modules.
 */

// Re-export types and functions from sub-modules
export type { LessonEntry, LessonHit } from './lessons.js';
export { parseLessonsMd, formatLessonEntry, findProjectRoot, searchLessonsInFile } from './lessons.js';

export type { ExcludedApproach, ProgressData } from './progress.js';
export { writeProgressFile, readProgressFile, detectProgressAntiRepeat, clearProgressFile, PROGRESS_ANTI_REPEAT_THRESHOLD } from './progress.js';

export type { CheckpointFile } from './checkpoints.js';
export { CHECKPOINT_DIR, saveCheckpoint, readCheckpoint, detectStaleCheckpoints, clearCheckpoint } from './checkpoints.js';

export type { HandoffFile, HandoffStatus, HandoffDecision } from './handoffs.js';
export { HANDOFF_DIR, HANDOFF_TYPES, createHandoff, readHandoff, finishHandoff, resolveHandoff, listHandoffs } from './handoffs.js';

// Re-export state detection functions
export type { WorkflowStateDetection } from './state-detection.js';
export { 
  BOULDER_STATE_FILE,
  getStateFilePath,
  simpleHash,
  detectArtifactExistence,
  detectWorkflowState,
  detectStateMismatch
} from './state-detection.js';

// Re-export state writer functions
export { writeStateFile } from './state-writer.js';

// Re-export state manager factory
export { createStateManager } from './state-manager-factory.js';
