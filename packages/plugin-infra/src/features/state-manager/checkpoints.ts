import { ensureDir, readJsonFile, writeJsonFile, readFile, directoryExists, stateFileMutex, listFiles } from "@opencode-flow-engine/shared";
import {
  getPlanScopedPaths,
  hasMatchingPlan,
  ensureReceiptDir,
} from '../plan-scoped-paths.js';
import { readExecutionPlan } from '../execution-plan.js';
import { simpleHash } from './state-detection.js';
import { readArtifactContent } from './artifact-paths.js';

// ─── Checkpoint Types ──────────────────────────────────────────────────────

export interface CheckpointFile {
  taskId: string;
  commitStart?: string;
  commitEnd?: string;
  evidence?: string;
  reviewStatus?: 'pending' | 'pass' | 'fail';
  contractHash: string;
  timestamp: string;
  nextStep?: string;
  /** 'active' — checkpoint is current; 'stale' — deliberately cleared/marked inactive (not deleted) */
  status?: 'active' | 'stale';
  /** Plan hash (T2.8: plan-scoped SDD 记录) */
  plan_hash?: string;
  /** Plan revision (T2.8: plan-scoped SDD 记录) */
  plan_revision?: number;
}

export const CHECKPOINT_DIR = '.flow-engine/sflow/checkpoints';

// ─── Checkpoint Operations ─────────────────────────────────────────────────

/**
 * 保存 checkpoint。
 * T2.8: 支持双写 - 根级兼容镜像 + plan-scoped 权威副本
 */
export async function saveCheckpoint(changeDir: string, checkpoint: CheckpointFile): Promise<void> {
  // 获取当前 execution plan
  const plan = await readExecutionPlan(changeDir);

  // 添加 plan scope 信息
  const checkpointWithPlan: CheckpointFile = {
    ...checkpoint,
    plan_hash: plan?.hash,
    plan_revision: plan?.revision,
  };

  await stateFileMutex.runExclusive(async () => {
    // 根级兼容镜像
    const rootCheckpointsDir = changeDir + '/' + CHECKPOINT_DIR;
    const rootFilePath = rootCheckpointsDir + '/' + checkpoint.taskId + '.json';
    await ensureDir(rootCheckpointsDir);
    await writeJsonFile(rootFilePath, checkpointWithPlan);

    // Plan-scoped 权威副本（如果存在 plan）
    if (plan) {
      const planPaths = getPlanScopedPaths(changeDir, plan);
      const planFilePath = planPaths.checkpoints + '/' + checkpoint.taskId + '.json';
      await ensureReceiptDir(planPaths.checkpoints);
      await writeJsonFile(planFilePath, checkpointWithPlan);
    }
  });
}

/**
 * 读取 checkpoint。
 * T2.8: 优先读取 plan-scoped 路径，回退到根级 legacy 路径
 */
export async function readCheckpoint(changeDir: string, taskId: string, includeStale?: boolean): Promise<CheckpointFile | null> {
  // 获取当前 execution plan
  const plan = await readExecutionPlan(changeDir);

  // 优先读取 plan-scoped 路径
  if (plan) {
    const planPaths = getPlanScopedPaths(changeDir, plan);
    const planFilePath = planPaths.checkpoints + '/' + taskId + '.json';
    const planCheckpoint = await readJsonFile<CheckpointFile>(planFilePath);
    if (planCheckpoint && hasMatchingPlan(planCheckpoint, plan)) {
      // Skip stale checkpoints unless explicitly requested
      if (!includeStale && planCheckpoint.status === 'stale') return null;
      return planCheckpoint;
    }
  }

  // 回退到根级 legacy 路径
  const rootFilePath = changeDir + '/' + CHECKPOINT_DIR + '/' + taskId + '.json';
  const cp = await readJsonFile<CheckpointFile>(rootFilePath);
  if (!cp) return null;
  // Skip stale checkpoints unless explicitly requested
  if (!includeStale && cp.status === 'stale') return null;
  return cp;
}

export async function detectStaleCheckpoints(changeDir: string): Promise<string[]> {
  const contractContent = await readArtifactContent(changeDir, 'execution-contract.md');
  if (!contractContent) return [];

  const currentHash = await simpleHash(contractContent);
  const checkpointsDir = changeDir + '/' + CHECKPOINT_DIR;
  const dirExists = await directoryExists(checkpointsDir);
  if (!dirExists) return [];

  const files = await listFiles(checkpointsDir, '.json');
  const staleTaskIds: string[] = [];

  for (const file of files) {
    const filePath = checkpointsDir + '/' + file;
    const checkpoint = await readJsonFile<CheckpointFile>(filePath);
    if (checkpoint && checkpoint.contractHash !== currentHash) {
      staleTaskIds.push(checkpoint.taskId);
    }
  }

  return staleTaskIds;
}

export async function clearCheckpoint(changeDir: string, taskId: string): Promise<void> {
  const checkpointsDir = changeDir + '/' + CHECKPOINT_DIR;
  const filePath = checkpointsDir + '/' + taskId + '.json';

  // Read existing checkpoint (if any) and mark as stale instead of deleting
  const existing = await readJsonFile<CheckpointFile>(filePath);
  const timestamp = new Date().toISOString();

  if (existing) {
    existing.status = 'stale';
    existing.timestamp = timestamp;
    await writeJsonFile(filePath, existing);
  } else {
    // No existing checkpoint — create a stub stale record for audit trace
    await ensureDir(checkpointsDir);
    const stub: CheckpointFile = {
      taskId,
      contractHash: '',
      timestamp,
      status: 'stale',
    };
    await writeJsonFile(filePath, stub);
  }

  // P1-2: Also sync plan-scoped path
  const plan = await readExecutionPlan(changeDir);
  if (plan) {
    const planPaths = getPlanScopedPaths(changeDir, plan);
    const planFilePath = planPaths.checkpoints + '/' + taskId + '.json';
    const planExisting = await readJsonFile<CheckpointFile>(planFilePath);

    if (planExisting) {
      planExisting.status = 'stale';
      planExisting.timestamp = timestamp;
      await writeJsonFile(planFilePath, planExisting);
    } else {
      // Create stub stale record in plan-scoped path
      await ensureReceiptDir(planPaths.checkpoints);
      const stub: CheckpointFile = {
        taskId,
        contractHash: '',
        timestamp,
        status: 'stale',
      };
      await writeJsonFile(planFilePath, stub);
    }
  }
}
