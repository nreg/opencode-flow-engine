/**
 * Shared utilities index for sFlow
 */

export type {
  PluginConfig,
  WorkflowConfig,
  AgentModelEntry,
} from './types.js';

export { deepMerge } from './deep-merge.js';
export { fileExists, readFile, writeFile, atomicWriteFile, listFiles, directoryExists, readJsonFile, writeJsonFile, atomicWriteJsonFile, ensureDir, Mutex, stateFileMutex } from './file-utils.js';
export { isContractStale, getContractStalenessReport } from './contract-staleness.js';
export type { StalenessReport } from './contract-staleness.js';
export { isBun, sleep, readTextFile, checkFileExists, writeTextFile, spawnProcess } from './runtime.js';

export { CacheManager, caches, startCacheCleanup, stopCacheCleanup } from './cache.js';

export { segmentChinese, extractKeywords, calculateOverlapRatio, calculateDynamicThreshold } from './chinese-segmenter.js';
