/**
 * Artifact Preflight Gate - Check required artifacts before state transitions.
 *
 * Inspired by flow-kit's Artifact Preflight Gate (GO.md § 第二步前).
 *
 * P29: Caching. Uses unified CacheManager with 5s TTL to avoid redundant
 * filesystem operations during frequent state transitions.
 * P4: Extended frontend check — also covers specifying state for frontend projects.
 */

import { ARTIFACT_PREFLIGHT, isDirectoryArtifact } from '@opencode-flow-engine/core';
import { listFiles, caches } from '@opencode-flow-engine/shared';
import { detectFrontend } from './workflow-manager.js';
import { artifactExists, directoryArtifactExists } from './state-manager/artifact-paths.js';
import { Logger } from '../utils/logger.js';

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

  // P1-3: Cache removed — preflight checks are lightweight operations (file existence checks),
  // and the 5s TTL cache provides minimal benefit while risking stale results when artifacts change.

  const gate = ARTIFACT_PREFLIGHT[targetState];
  if (!gate || gate.required.length === 0) {
    return { passed: true, missing: [] };
  }
  const missing: string[] = [];
  const existence: Record<string, boolean> = {};
  for (const artifact of gate.required) {
    let exists: boolean;
    if (isDirectoryArtifact(artifact)) {
      exists = await directoryArtifactExists(changeDir, artifact);
    } else {
      exists = await artifactExists(changeDir, artifact);
    }
    existence[artifact] = exists;
    if (!exists) missing.push(artifact);
  }
  if (missing.length > 0) {
    const route = findPreflightState(missing, true);
    const result: PreflightCheckResult = {
      passed: false, missing, existence, preflightState: route.state,
      reason: `[SFLOW] Preflight gate: missing ${missing.join(', ')}. Route to "${route.state}" first (${route.actionHint}).`,
    };
    return result;
  }
  // P4: Extended frontend check — also covers specifying state for frontend projects
  const frontendCheckStates = ['specifying', 'ui-design', 'bridging', 'approved-for-build', 'executing', 'debugging'];
  if (frontendCheckStates.includes(targetState)) {
    try {
      const isFrontend = await detectFrontend(changeDir);
      if (isFrontend) {
        const uiOk = await artifactExists(changeDir, 'ui-design.md');
        existence['ui-design.md'] = uiOk;
        if (!uiOk && targetState !== 'specifying') {
          const result: PreflightCheckResult = {
            passed: false, missing: ['ui-design.md'], existence, preflightState: 'ui-design',
            reason: 'Frontend project needs ui-design.md before "' + targetState + '".',
          };
          return result;
        }
      }
    } catch (err) {
      Logger.warn('[SFLOW] detectFrontend() failed during preflight gate: ' + (err instanceof Error ? err.message : String(err)));
      const result: PreflightCheckResult = {
        passed: false, missing: [], existence,
        preflightState: targetState,
        reason: 'Frontend detection failed: ' + (err instanceof Error ? err.message : String(err)) + '. Cannot verify ui-design.md requirement.',
      };
      return result;
    }
  }

  const result: PreflightCheckResult = { passed: true, missing: [], existence };
  return result;
}

/**
 * Preflight route with human-readable action hint.
 * P3: Extends the state with an `actionHint` describing what to do next.
 */
export interface PreflightRoute {
  state: string;
  actionHint: string;
}

const PREFLIGHT_ROUTES: Record<string, PreflightRoute> = {
  exploring:  { state: 'exploring',  actionHint: '创建 proposal.md 明确需求和范围' },
  specifying: { state: 'specifying', actionHint: '补齐 specs/, design.md, tasks.md 规划工件' },
  'ui-design':{ state: 'ui-design', actionHint: '生成 ui-design.md 定义 UI 设计 token 和组件结构' },
  bridging:   { state: 'bridging',   actionHint: '生成 execution-contract.md 执行合同' },
};

/**
 * Find the deepest state to fall back to based on missing artifacts.
 * Returns the EARLIEST state that still needs work, with a human-readable action hint.
 *
 * P3 fix: When both core specs and ui-design.md are missing,
 * return a more specific route message with action guidance.
 */
export function findPreflightState(missing: string[], returnRoute?: true): PreflightRoute;
export function findPreflightState(missing: string[], returnRoute?: false): string;
export function findPreflightState(missing: string[], returnRoute = false): string | PreflightRoute {
  const stateName = (() => {
    if (missing.includes('proposal.md')) return 'exploring';
    if (missing.includes('specs/') || missing.includes('design.md') || missing.includes('tasks.md')) return 'specifying';
    if (missing.includes('ui-design.md')) return 'ui-design';
    if (missing.includes('execution-contract.md')) return 'bridging';
    return 'exploring';
  })();

  if (returnRoute) return (PREFLIGHT_ROUTES[stateName] as PreflightRoute) || PREFLIGHT_ROUTES.exploring;
  return stateName;
}
