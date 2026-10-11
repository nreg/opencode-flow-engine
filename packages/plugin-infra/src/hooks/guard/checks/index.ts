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
  checkProgressAntiRepeatGuard,
} from './knowledge-guards.js';

export {
  checkWorkflowModeTransition,
  checkDebuggingState,
  checkTaskCompletion,
} from './transition-guards.js';

export {
  checkArtifactRootPath,
  extractWriteTargetPath,
  GUARDED_WRITE_TOOLS,
  ARTIFACT_ROOT_SEGMENT,
  ARTIFACT_DIR_SEGMENTS,
} from './artifact-root-guards.js';
export type { ArtifactRootGuardInput, ArtifactRootGuardResult } from './artifact-root-guards.js';
