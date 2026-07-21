/**
 * Guard helper functions — extracted from guard.ts for maintainability.
 */

export const SOURCE_CODE_PATTERNS = /\.(ts|js|tsx|jsx|mjs|cjs|mts|cts|py|java|kt|rs|go|rb|php|c|cpp|h|hpp|cs|swift|vue|svelte|css|scss|less)$/i;
export const ARTIFACT_NAMES = new Set(['proposal.md', 'design.md', 'tasks.md', 'execution-contract.md']);

export function isArtifactPath(filePath: string, changeDir: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const changeDirNorm = changeDir.replace(/\\/g, '/');
  if (normalized.includes('.flow-engine/sflow/') || normalized.endsWith('.flow-engine/sflow')) return true;
  const relative = normalized.startsWith(changeDirNorm)
    ? normalized.slice(changeDirNorm.length + 1)
    : normalized;
  const baseName = relative.split('/').pop() || '';
  if (ARTIFACT_NAMES.has(baseName)) return true;
  if (relative.startsWith('specs/') || relative === 'specs') return true;
  return false;
}

export function isSourceCodePath(filePath: string): boolean {
  return SOURCE_CODE_PATTERNS.test(filePath);
}

/**
 * Compute a simple hash of contract content for cache invalidation.
 */
export function simpleContractHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const chr = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
}
