/**
 * Guard hook — combined entry point.
 * Delegates to sub-modules for specific guard checks.
 */
export { createGuardHook } from '../guard.js';
export { isArtifactPath, isSourceCodePath, simpleContractHash } from './helpers.js';
export {
  parseFileBoundaryPatterns, matchesBoundary, getActiveTaskId,
  boundaryCache, getBoundaryCacheKey, READ_FILES_WHITELIST,
} from './boundary.js';
export {
  checkIFlowFileWriteGuard, checkIFlowLessonsGuard,
  checkIFlowProgressAntiRepeatGuard, checkIFlowArtifactAndPhaseConsistency,
  checkIFlowOmoUsageGuard, markIFlowOmoUsed, resetIFlowOmoTracking,
} from './iflow-shared-guards.js';
