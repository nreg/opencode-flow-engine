/**
 * Workflow Manager feature - Manage workflow execution
 */

import type { FeatureConfig, FeatureResult } from './types.js';
import { isValidTransition } from '@opencode-sflow/core';
import { readJsonFile, writeJsonFile, atomicWriteJsonFile, ensureDir, stateFileMutex, fileExists, directoryExists, readFile, listFiles } from '@opencode-sflow/shared';
import { detectStateMismatch } from './state-manager.js';

const SFLOW_DIR = '.sflow';
const STATE_FILE = `${SFLOW_DIR}/state.json`;
const ARCHIVE_DIR = `${SFLOW_DIR}/archive`;

/**
 * Detect if the project at changeDir is a frontend project.
 * Checks: package.json dependencies, directory structure, config files.
 */
export async function detectFrontend(changeDir: string): Promise<boolean> {
  // 1. Check package.json for frontend frameworks
  const pkgJson = await readJsonFile<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(changeDir + '/package.json').catch(() => null);
  if (pkgJson) {
    const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
    const frontendIndicators = [
      'react', 'vue', 'next', 'nuxt', 'svelte', 'angular', 'solid-js',
      'sass', 'less', 'tailwindcss', 'postcss', 'styled-components',
      'emotion', 'antd', 'element-ui', 'vite', '@vitejs',
      'daisyui', 'bootstrap', 'remix', 'gatsby', 'astro', 'qwik',
      'shadcn', 'chakra-ui', 'mui/material', '@ngrx', 'react-router',
      'vue-router', 'pinia', 'zustand', 'jotai', 'redux',
    ];
    for (const dep of Object.keys(allDeps)) {
      for (const indicator of frontendIndicators) {
        if (dep.includes(indicator)) return true;
      }
    }
  }

  // 2. Check for frontend directory structure
  const frontendDirs = ['src/pages', 'src/components', 'src/views', 'src/router', 'pages', 'components', 'views', 'app', 'src/app'];
  for (const dir of frontendDirs) {
    if (await directoryExists(changeDir + '/' + dir)) return true;
  }

  // 3. Check for frontend config files
  const configFiles = ['vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.ts', 'nuxt.config.ts', 'vue.config.js', 'angular.json', 'svelte.config.js', 'tailwind.config.js', 'tailwind.config.ts', 'astro.config.mjs', 'astro.config.ts', 'remix.config.js', 'gatsby-config.js', 'gatsby-config.ts', 'qwik.config.ts'];
  for (const cfg of configFiles) {
    if (await fileExists(changeDir + '/' + cfg)) return true;
  }

  return false;
}

/** Automatically detect frontend and update state.json if needed */
export async function autoDetectFrontendAndUpdateState(changeDir: string): Promise<void> {
  const statePath = changeDir + '/' + STATE_FILE;
  const existing = await readJsonFile<Record<string, unknown>>(statePath);
  if (!existing) return;
  const isFrontend = await detectFrontend(changeDir);
  if (existing.isFrontend !== isFrontend) {
    existing.isFrontend = isFrontend;
    existing.frontendDetectedAt = new Date().toISOString();
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
      const taskLines = tasksContent ? tasksContent.split('\\n').filter((line: string) => line.match(/^-\\s*\\[.\\]\\s+/)) : [];
      const changedFileCount = await countChangedFiles(changeDir);
      const mode = inferModeFromArtifacts(hasProposal, hasContract, changedFileCount, taskLines.length);

      // Auto-detect frontend and update state if applicable
      await autoDetectFrontendAndUpdateState(changeDir).catch(() => {});

      return { state, mode };
    },

    /** Get auto-detected frontend status */
    async isFrontend(changeDir: string): Promise<boolean> {
      const state = await readJsonFile<{ isFrontend?: boolean }>(changeDir + '/' + STATE_FILE).catch(() => null);
      if (state?.isFrontend !== undefined) return state.isFrontend;
      const detected = await detectFrontend(changeDir);
      return detected;
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
    `${changeDir}/${STATE_FILE}`,
  ).catch(() => null);
  return state || {
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
