/**
 * Guard checks — re-export all check functions.
 */

export {
  checkArtifactAndPhaseConsistency,
  checkPresetUpgrade,
  checkContractStalenessGuard,
} from './artifact-guards.js';

export {
  checkWaveDependencies,
  checkReceiptIntegrity,
  checkClosingGate,
  checkSpecsMerged,
} from './wave-guards.js';

export {
  checkFileWriteGuard,
  checkReadFilesBoundary,
  checkGitCommitBoundary,
  checkFileBoundary,
} from './file-guards.js';

export {
  checkSchemaMigrationGuard,
  checkAbstractionGrepGuard,
} from './schema-guards.js';
export type { SchemaMigrationGuardOptions } from './schema-guards.js';

export {
  checkLessonsGuard,
  checkOmoUsageGuard,
  checkProgressAntiRepeatGuard,
  markOmoUsed,
  resetOmoTracking,
} from './knowledge-guards.js';

export {
  checkWorkflowModeTransition,
  checkDebuggingState,
  checkTaskCompletion,
} from './transition-guards.js';
