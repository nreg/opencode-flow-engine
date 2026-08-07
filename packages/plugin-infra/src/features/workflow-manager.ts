/**
 * Workflow Manager feature - Manage workflow execution
 */

import type { FeatureConfig, FeatureResult } from './types.js';
import { isValidTransition } from '@opencode-flow-engine/core';
import { readJsonFile, writeJsonFile, atomicWriteJsonFile, ensureDir, stateFileMutex, fileExists, directoryExists, readFile, listFiles } from '@opencode-flow-engine/shared';
import { detectStateMismatch } from './state-manager.js';
import { readArtifactContent, artifactExists } from './state-manager/artifact-paths.js';

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

          // 先检查状态转换是否有效
          if (!isValidTransition(currentState.state, newState)) {
            return {
              success: false,
              error: `Invalid transition from ${currentState.state} to ${newState}`,
            } as FeatureResult;
          }

          // T3.1: 终端状态阻断 - abandoned 状态下拒绝任何状态转换
          // closing 状态下只允许转换到 abandoned（因为 abandoned 也是终端状态）
          // 注意：这个检查在 isValidTransition 之后，因为 isValidTransition 已经定义了有效转换
          if (currentState.state === 'abandoned') {
            return {
              success: false,
              error: `工作流已结束（${currentState.state}），不允许状态转换`,
            } as FeatureResult;
          }

          if (currentState.state === 'closing' && newState !== 'abandoned') {
            return {
              success: false,
              error: `工作流已结束（${currentState.state}），不允许状态转换`,
            } as FeatureResult;
          }

          // P22: Block transition to closing when tasks are still incomplete
          if (newState === 'closing' || newState === 'abandoned') {
            const tasksContent = await readArtifactContent(changeDir, 'tasks.md');
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

          // P1-1: 自动迁移旧 spec_merged 到 publication receipt
          // 当首次进入 bridging 状态时，如果检测到旧的 spec_merged=true 但没有 publication receipt，
          // 自动生成初始 receipt，确保向后兼容
          if (newState === 'bridging' && currentState.state !== 'bridging') {
            await migrateSpecMergedToReceipt(changeDir, currentState).catch(err => {
              // 迁移失败不影响状态转换，仅记录警告
              console.warn('[P1-1] Migration from spec_merged to publication receipt failed:', err);
            });
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
      const hasProposal = await artifactExists(changeDir, 'proposal.md');
      const hasContract = await artifactExists(changeDir, 'execution-contract.md');
      const tasksContent = await readArtifactContent(changeDir, 'tasks.md');
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

/**
 * P0-2: 推断工作流模式（支持 quick 模式）
 * 
 * 推断规则（优先级从高到低）：
 * 1. 无 proposal 且无 contract → hotfix（<=2 文件/任务）或 full
 * 2. 有 contract → full
 * 3. 低风险代码工作（<=3 文件/任务）→ quick
 * 4. config/doc-only（<=4 文件/任务）→ tweak
 * 5. 默认 → full
 */
function inferModeFromArtifacts(hasProposal: boolean, hasContract: boolean, changedFiles: number, taskCount: number): string {
  // 无 proposal 且无 contract → hotfix 或 full
  if (!hasProposal && !hasContract) {
    return changedFiles <= 2 && taskCount <= 2 ? 'hotfix' : 'full';
  }
  
  // 有 contract → full
  if (hasContract) {
    return 'full';
  }
  
  // P0-2: 低风险代码工作 → quick
  if (changedFiles <= 3 && taskCount <= 3) {
    return 'quick';
  }
  
  // config/doc-only → tweak
  if (changedFiles <= 4 && taskCount <= 4) {
    return 'tweak';
  }
  
  // 默认 → full
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
  artifact_language?: 'zh' | 'en';
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
    artifact_language?: 'zh' | 'en';
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
    artifact_language: undefined,
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

/**
 * P1-1: 自动迁移旧 spec_merged 到 publication receipt
 * 
 * 迁移场景：
 * - 首次进入 bridging 状态时
 * - 检测到 state.json 中 spec_merged=true
 * - 但 .flow-engine/sflow/spec-publication/ 目录不存在或为空
 * 
 * 迁移逻辑：
 * 1. 读取当前 specs/ 目录下的所有 capability
 * 2. 为每个 capability 生成初始 publication receipt
 * 3. 将 receipt 写入 .flow-engine/sflow/spec-publication/<capability>.json
 * 
 * 注意：
 * - 此函数在 transitionState 内部调用，已受 stateFileMutex 保护
 * - 迁移失败不影响状态转换，仅记录警告
 * - 代码注释必须清晰说明迁移来源和兼容策略
 */
async function migrateSpecMergedToReceipt(
  changeDir: string,
  currentState: Record<string, unknown>
): Promise<void> {
  // 检查是否需要迁移：spec_merged=true 但无 publication receipt
  if (currentState.spec_merged !== true) {
    return; // 无需迁移
  }

  // 动态导入 spec-publication 模块（避免循环依赖）
  const {
    hasPublicationReceipts,
    createPublicationReceipt,
    savePublicationReceipt,
    resolvePublicationContext,
  } = await import('./spec-publication.js');

  // 检查是否已存在 receipt
  const hasReceipts = await hasPublicationReceipts(changeDir);
  if (hasReceipts) {
    return; // 已存在 receipt，无需迁移
  }

  // 迁移逻辑：为当前所有 specs 生成初始 receipt
  console.log('[P1-1] Migrating legacy spec_merged=true to publication receipts...');

  const context = resolvePublicationContext(changeDir);
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');

  // 读取 specs 目录下的所有 capability
  const specsDir = join(context.projectRoot, 'specs');
  const specsExists = await directoryExists(specsDir);
  if (!specsExists) {
    console.log('[P1-1] No specs directory found, skipping migration');
    return;
  }

  try {
    const entries = await readdir(specsDir, { withFileTypes: true });
    const capabilities = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(name => !name.startsWith('.')); // 忽略隐藏目录

    if (capabilities.length === 0) {
      console.log('[P1-1] No capabilities found in specs/, skipping migration');
      return;
    }

    // 为每个 capability 生成初始 receipt
    for (const capability of capabilities) {
      // 构造 spec 文件列表（简化：假设每个 capability 有一个 spec.md）
      const specFiles = [join(specsDir, capability, 'spec.md')];
      
      // 生成 receipt（使用当前 baseline 哈希）
      const receipt = await createPublicationReceipt(
        changeDir,
        context.projectRoot,
        specFiles,
        'migrated-from-spec-merged', // 标记为迁移来源
        currentState.change_id as string || 'legacy-change'
      );

      // 添加迁移标记
      receipt.warnings.push(
        'P1-1: This receipt was auto-generated from legacy spec_merged=true flag during first bridging entry.'
      );

      // 保存 receipt
      await savePublicationReceipt(context.projectRoot, receipt);
      console.log(`[P1-1] Migrated receipt for capability: ${capability}`);
    }

    console.log(`[P1-1] Migration complete: ${capabilities.length} receipt(s) generated`);
  } catch (error) {
    console.error('[P1-1] Migration failed:', error);
    throw error; // 重新抛出，让调用方处理
  }
}

