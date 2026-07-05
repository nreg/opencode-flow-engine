/**
 * Artifact Preflight - Shared check function for artifact-first discipline.
 */
import { ARTIFACT_PREFLIGHT, isDirectoryArtifact } from '@opencode-sflow/core';
import { listFiles } from '@opencode-sflow/shared';
import { detectFrontend } from './workflow-manager.js';

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
  /** Existence map for all checked artifacts — reused by guard Phase 2 to avoid redundant stat calls */
  existence?: Record<string, boolean>;
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
  const existence: Record<string, boolean> = {};
  for (const artifact of gate.required) {
    const p = changeDir + '/' + artifact;
    let exists: boolean;
    if (isDirectoryArtifact(artifact)) {
      exists = await directoryExists(p);
      // For directory artifacts, also verify they contain at least one .md file
      if (exists && artifact.endsWith('/')) {
        const specFiles = await listFiles(p, '.md');
        exists = specFiles.length > 0;
      }
    } else {
      exists = await fileExists(p);
    }
    existence[artifact] = exists;
    if (!exists) missing.push(artifact);
  }
  if (missing.length > 0) {
    const route = findPreflightState(missing);
    return {
      passed: false, missing, existence, preflightState: route,
      reason: 'Cannot enter "' + targetState + '". Missing: ' + missing.join(', ') + '. Route to "' + route + '".',
    };
  }
  // Frontend check — use detectFrontend() for real-time detection instead of stale state.json
  if (['bridging', 'approved-for-build', 'executing'].includes(targetState)) {
    try {
      const isFrontend = await detectFrontend(changeDir);
      if (isFrontend) {
        const uiOk = await fileExists(changeDir + '/ui-design.md');
        existence['ui-design.md'] = uiOk;
        if (!uiOk) {
          return {
            passed: false, missing: ['ui-design.md'], existence, preflightState: 'ui-design',
            reason: 'Frontend project needs ui-design.md before "' + targetState + '".',
          };
        }
      }
    } catch { /* skip */ }
  }
  return { passed: true, missing: [], existence };
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