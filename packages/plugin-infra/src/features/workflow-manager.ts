/**
 * Workflow Manager feature - Manage workflow execution
 */

import type { FeatureConfig, FeatureResult } from './types.js';
import { isValidTransition } from '@opencode-flow-engine/core';
import { readJsonFile, writeJsonFile, atomicWriteJsonFile, ensureDir, stateFileMutex, fileExists, directoryExists, readFile, listFiles } from '@opencode-flow-engine/shared';
import { detectStateMismatch } from './state-manager.js';

const SFLOW_DIR = '.flow-engine/sflow';
const STATE_FILE = `${SFLOW_DIR}/state.json`;
const ARCHIVE_DIR = `${SFLOW_DIR}/archive`;

/**
 * P21: detectFrontend 先读 state.json 缓存，若不存在则走 package.json 启发式检测。
 * 前后端混放的项目，AI 根据本次 CHANGE 范围判断，不需要全局启发式检测。
 */
export async function detectFrontend(changeDir: string): Promise<boolean> {
  // 1. Check state.json cache first
  const state = await readJsonFile<{ isFrontend?: boolean }>(`${changeDir}/.flow-engine/sflow/state.json`).catch(() => null);
  if (state?.isFrontend !== undefined) return state.isFrontend;

  // 2. Fallback: heuristic detection from package.json (works even before state.json is initialized)
  const pkgContent = await readFile(`${changeDir}/package.json`).catch(() => null);
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const frontendDeps = ['react', 'vue', 'next', 'nuxt', 'svelte', 'angular', 'solid-js', 'preact', 'ember', 'sveltekit', 'lit', 'stencil'];
      return frontendDeps.some(dep => dep in deps);
    } catch { /* ignore parse errors */ }
  }

  return false;
}

/**
 * Update state.json isFrontend cache for informational use.
 * @deprecated P24: isFrontend cached value is informational only;
 * actual decisions must use real-time detectFrontend() to avoid stale cache.
 */
export async function autoDetectFrontendAndUpdateState(changeDir: string): Promise<void> {
  const statePath = changeDir + '/' + STATE_FILE;
  const existing = await readJsonFile<Record<string, unknown>>(statePath);
  if (!existing) return;
  const isFrontend = await detectFrontend(changeDir);
  if (existing.isFrontend !== isFrontend) {
    existing.isFrontend = isFrontend;
    existing.frontendDetectedAt = new Date().toISOString();
    existing._deprecated_isFrontendCache = true; // P24: flag for future removal
    await writeJsonFile(statePath, existing);
  }
}

export function createWorkflowManager(config: FeatureConfig = { enabled: true }) {
  return {
    name: 'workflow_manager',
    config,

    async initialize(): Promise<FeatureResult> {
      if (!config.enabled) {
        return { success: true, data: { message: 'Workflow manager disabled' } };
      }

      console.log('Workflow manager initialized');
      return { success: true };
    },

    async startWorkflow(changeDir: string): Promise<FeatureResult> {
      try {
        await initializeState(changeDir);

        return {
          success: true,
          data: {
            changeDir,
            state: 'exploring',
            message: 'Workflow started',
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getState(changeDir: string): Promise<FeatureResult> {
      try {
        const state = await readStateFile(changeDir);
        return {
          success: true,
          data: state,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async transitionState(changeDir: string, newState: string): Promise<FeatureResult> {
      try {
        return await stateFileMutex.runExclusive(async () => {
          const currentState = await readStateFile(changeDir);

          if (!isValidTransition(currentState.state, newState)) {
            return {
              success: false,
              error: `Invalid transition from ${currentState.state} to ${newState}`,
            } as FeatureResult;
          }

          // P22: Block transition to closing when tasks are still incomplete
          if (newState === 'closing' || newState === 'abandoned') {
            const tasksContent = await readFile(changeDir + '/tasks.md').catch(() => null);
            if (tasksContent) {
              const taskLines = tasksContent.split('\n').filter((line: string) => line.match(/^-\s*\[.\]\s+/));
              const incompleteTasks = taskLines.filter((line: string) => line.match(/^-\s*\[\s\]/));
              if (incompleteTasks.length > 0) {
                return {
                  success: false,
                  error: `P22: Cannot transition to "${newState}": ${incompleteTasks.length} task(s) are still incomplete. Complete all tasks before closing.`,
                } as FeatureResult;
              }
            }
          }

          const now = new Date().toISOString();
          await writeJsonFile(`${changeDir}/${STATE_FILE}`, {
            ...currentState,
            state: newState,
            updatedAt: now,
          });

          return {
            success: true,
            data: {
              from: currentState.state,
              to: newState,
              timestamp: now,
            },
          };
        });
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async completeWorkflow(changeDir: string): Promise<FeatureResult> {
      try {
        await archiveWorkflow(changeDir);

        return {
          success: true,
          data: {
            changeDir,
            message: 'Workflow completed and archived',
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

        async inferStateFromArtifacts(changeDir: string): Promise<{ state: string; mode: string }> {
      const state = await detectStateMismatch(changeDir, 'exploring');
      const hasProposal = await fileExists(changeDir + '/proposal.md');
      const hasContract = await fileExists(changeDir + '/execution-contract.md');
      const tasksContent = await readFile(changeDir + '/tasks.md').catch(() => null);
        const taskLines = tasksContent ? tasksContent.split('\n').filter((line: string) => line.match(/^-\s*\[.\]\s+/)) : [];
      const changedFileCount = await countChangedFiles(changeDir);
      const mode = inferModeFromArtifacts(hasProposal, hasContract, changedFileCount, taskLines.length);

      // P25: Always run frontend pre-detection even in exploring state,
      // so downstream artifact-preflight can check ui-design.md requirements early.
      await autoDetectFrontendAndUpdateState(changeDir).catch(() => {});

      return { state, mode };
    },

    /**
     * Get frontend status — always uses real-time detection.
     * P27: State.json cached value is informational only; actual decisions
     * must use real-time detectFrontend() to avoid stale cache issues.
     */
    async isFrontend(changeDir: string): Promise<boolean> {
      return detectFrontend(changeDir);
    },
  };
}

function inferModeFromArtifacts(hasProposal: boolean, hasContract: boolean, changedFiles: number, taskCount: number): string {
  if (!hasProposal && !hasContract) {
    return changedFiles <= 2 && taskCount <= 2 ? 'hotfix' : 'full';
  }
  if (hasContract) {
    return 'full';
  }
  if (changedFiles <= 4 && taskCount <= 4) {
    return 'tweak';
  }
  return 'full';
}

async function countChangedFiles(changeDir: string): Promise<number> {
  try {
    const { execSync } = await import("child_process");
    const output = execSync("git diff --name-only HEAD", { cwd: changeDir, encoding: "utf8" }).trim();
    if (!output) return 0;
    return output.split("\n").filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

async function initializeState(changeDir: string): Promise<void> {
  const stateFile = `${changeDir}/${STATE_FILE}`;
  const existing = await readJsonFile(stateFile).catch(() => null);
  if (existing) {
    return;
  }

  const inferred = await createWorkflowManager().inferStateFromArtifacts(changeDir);
  const isFrontend = await detectFrontend(changeDir);
  await ensureDir(`${changeDir}/${SFLOW_DIR}`);
  await writeJsonFile(stateFile, {
    state: inferred.state,
    mode: inferred.mode,
    isFrontend,
    artifacts_hash: '',
    contract_hash: '',
    batches_completed: 0,
    dp_0_confirmed: false,
    contractApproved: false,
    verificationStatus: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function readStateFile(changeDir: string): Promise<{
  state: string;
  mode: string;
  updatedAt: string;
  artifacts_hash: string;
  contract_hash: string;
  batches_completed: number;
  dp_0_confirmed: boolean;
  contractApproved: boolean;
  verificationStatus: string;
  isFrontend?: boolean;
  [key: string]: unknown;
}> {
  const statePath = `${changeDir}/${STATE_FILE}`;
  const state = await readJsonFile<{
    state: string;
    mode: string;
    updatedAt: string;
    artifacts_hash: string;
    contract_hash: string;
    batches_completed: number;
    dp_0_confirmed: boolean;
    contractApproved: boolean;
    verificationStatus: string;
    isFrontend?: boolean;
    [key: string]: unknown;
  }>(
    statePath,
  ).catch(() => null);

  if (state) return state;

  // BUG-B fix (GS-1): When state.json does not exist AND .flow-engine/sflow/ directory exists
  // (indicating an active workflow), throw an error instead of returning silent defaults.
  // If .flow-engine/sflow/ doesn't exist (no workflow started), still return defaults for backward compat.
  const sflowDirExists = await directoryExists(`${changeDir}/${SFLOW_DIR}`);
  if (sflowDirExists) {
    throw new Error(`[SFLOW] state.json not found at ${statePath}, but .flow-engine/sflow/ directory exists. This indicates an active workflow with a missing state file. Use startWorkflow() to initialize or restore from boulder-state.json.`);
  }

  return {
    state: 'exploring',
    mode: 'full',
    updatedAt: new Date().toISOString(),
    artifacts_hash: '',
    contract_hash: '',
    batches_completed: 0,
    dp_0_confirmed: false,
    contractApproved: false,
    verificationStatus: 'pending',
    isFrontend: false,
  };
}

async function archiveWorkflow(changeDir: string): Promise<void> {
  await ensureDir(`${changeDir}/${ARCHIVE_DIR}`);
  const statePath = `${changeDir}/${STATE_FILE}`;
  let stateSnapshot = null;
  try {
    stateSnapshot = await readJsonFile<Record<string, unknown>>(statePath);
  } catch {}
  const archiveData = {
    archivedAt: new Date().toISOString(),
    state: stateSnapshot,
    artifacts_hash: stateSnapshot?.artifacts_hash,
    contract_hash: stateSnapshot?.contract_hash,
    batches_completed: stateSnapshot?.batches_completed,
  };
  await writeJsonFile(`${changeDir}/${ARCHIVE_DIR}/archive.json`, archiveData);
}

