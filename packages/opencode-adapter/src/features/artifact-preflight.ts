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
  // P4: Extended frontend check — also covers specifying state for frontend projects
  const frontendCheckStates = ['specifying', 'ui-design', 'bridging', 'approved-for-build', 'executing', 'debugging'];
  if (frontendCheckStates.includes(targetState)) {
    try {
      const isFrontend = await detectFrontend(changeDir);
      if (isFrontend) {
        const uiOk = await fileExists(changeDir + '/ui-design.md');
        existence['ui-design.md'] = uiOk;
        // P2: Check already passed required artifacts; ui-design.md is optional for bridging+ in ARTIFACT_PREFLIGHT
        // but required for frontend projects via this separate check
        if (!uiOk && targetState !== 'specifying') {
          // For specifying state: ui-design.md doesn't need to exist yet (it's generated during specifying→ui-design transition)
          return {
            passed: false, missing: ['ui-design.md'], existence, preflightState: 'ui-design',
            reason: 'Frontend project needs ui-design.md before "' + targetState + '".',
          };
        }
      }
    } catch (err) {
      // P2 fix: Log warning instead of silently swallowing errors
      // A filesystem error in detectFrontend should not silently pass the gate
      console.warn('[SFLOW] detectFrontend() failed during preflight gate:', err instanceof Error ? err.message : String(err));
      return {
        passed: false, missing: [], existence,
        preflightState: targetState,
        reason: 'Frontend detection failed: ' + (err instanceof Error ? err.message : String(err)) + '. Cannot verify ui-design.md requirement.',
      };
    }
  }
  return { passed: true, missing: [], existence };
}

/**
 * Find the deepest state to fall back to based on missing artifacts.
 * Returns the EARLIEST state that still needs work.
 *
 * P3 fix: When both core specs and ui-design.md are missing,
 * return a more specific route message.
 */
export function findPreflightState(missing: string[]): string {
  if (missing.includes('proposal.md')) return 'exploring';
  // P3 fix: When core artifacts AND ui-design.md are both missing,
  // route to specifying first (core specs are prerequisite)
  if (missing.includes('specs/') || missing.includes('design.md') || missing.includes('tasks.md')) {
    return 'specifying';
  }
  if (missing.includes('ui-design.md')) return 'ui-design';
  if (missing.includes('execution-contract.md')) return 'bridging';
  return 'exploring';
}