/**
 * Artifact Preflight - Shared check function for artifact-first discipline.
 */
import { ARTIFACT_PREFLIGHT, isDirectoryArtifact } from '@opencode-sflow/core';

export interface PreflightCheckParams {
  changeDir: string;
  targetState: string;
  fileExists: (path: string) => Promise<boolean>;
  directoryExists: (path: string) => Promise<boolean>;
  readJson?: <T>(path: string) => Promise<T | null>;
}

export interface PreflightCheckResult {
  passed: boolean;
  missing: string[];
  preflightState?: string;
  reason?: string;
}

export async function checkArtifactPreflight(
  params: PreflightCheckParams,
): Promise<PreflightCheckResult> {
  const { changeDir, targetState, fileExists, directoryExists, readJson } = params;
  const gate = ARTIFACT_PREFLIGHT[targetState];
  if (!gate || gate.required.length === 0) {
    return { passed: true, missing: [] };
  }
  const missing: string[] = [];
  for (const artifact of gate.required) {
    const p = changeDir + '/' + artifact;
    const exists = isDirectoryArtifact(artifact)
      ? await directoryExists(p) : await fileExists(p);
    if (!exists) missing.push(artifact);
  }
  if (missing.length > 0) {
    const route = findPreflightState(missing);
    return {
      passed: false, missing, preflightState: route,
      reason: 'Cannot enter "' + targetState + '". Missing: ' + missing.join(', ') + '. Route to "' + route + '".',
    };
  }
  // Frontend check
  if (['bridging', 'approved-for-build', 'executing'].includes(targetState) && readJson) {
    try {
      const sd = await readJson<{ isFrontend?: boolean }>(changeDir + '/.sflow/state.json');
      if (sd?.isFrontend) {
        const uiOk = await fileExists(changeDir + '/ui-design.md');
        if (!uiOk) {
          return {
            passed: false, missing: ['ui-design.md'], preflightState: 'ui-design',
            reason: 'Frontend project needs ui-design.md before "' + targetState + '".',
          };
        }
      }
    } catch { /* skip */ }
  }
  return { passed: true, missing: [] };
}

/**
 * Find the deepest state to fall back to based on missing artifacts.
 * Checks from most fundamental (proposal) → least fundamental (contract)
 * so we return the EARLIEST state that still needs work.
 */
export function findPreflightState(missing: string[]): string {
  if (missing.includes('proposal.md')) return 'exploring';
  if (missing.includes('specs/') || missing.includes('design.md') || missing.includes('tasks.md')) return 'specifying';
  if (missing.includes('ui-design.md')) return 'ui-design';
  if (missing.includes('execution-contract.md')) return 'bridging';
  return 'exploring';
}