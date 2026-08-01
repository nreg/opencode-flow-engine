import { ensureDir, readJsonFile, writeJsonFile, directoryExists, stateFileMutex, listFiles } from "@opencode-flow-engine/shared";
import {
  getPlanScopedPaths,
  hasMatchingPlan,
  ensureReceiptDir,
} from '../plan-scoped-paths.js';
import { readExecutionPlan } from '../execution-plan.js';

// ─── Handoff Types ──────────────────────────────────────────────────────

export type HandoffStatus = 'created' | 'finished' | 'resolved';
export type HandoffDecision = 'accept' | 'reject' | 'defer';

export interface HandoffFile {
  id: string;
  type: string;
  objective: string;
  expectedOutput: string;
  acceptance: string;
  boundary: string;
  status: HandoffStatus;
  decision?: HandoffDecision;
  decisionReason?: string;
  output?: string;
  createdAt: string;
  finishedAt?: string;
  resolvedAt?: string;
  /** Plan hash (T2.8: plan-scoped SDD 记录) */
  plan_hash?: string;
  /** Plan revision (T2.8: plan-scoped SDD 记录) */
  plan_revision?: number;
}

export const HANDOFF_DIR = '.flow-engine/sflow/handoffs';

/** Allowed handoff types — validates against unexpected type values */
export const HANDOFF_TYPES = new Set(['prototype', 'research', 'experiment', 'task-handoff', 'code-review', 'architecture']);

// ─── Handoff Operations ──────────────────────────────────────────────────

/**
 * 创建 handoff。
 * T2.8: 支持双写 - 根级兼容镜像 + plan-scoped 权威副本
 */
export async function createHandoff(
  changeDir: string,
  params: Omit<HandoffFile, 'id' | 'status' | 'createdAt'>,
): Promise<HandoffFile> {
  if (!HANDOFF_TYPES.has(params.type)) {
    throw new Error('Unsupported handoff type "' + params.type + '". Allowed types: ' + Array.from(HANDOFF_TYPES).join(', '));
  }
  const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const now = new Date().toISOString();

  // 获取当前 execution plan
  const plan = await readExecutionPlan(changeDir);

  const handoff: HandoffFile = {
    id,
    type: params.type,
    objective: params.objective,
    expectedOutput: params.expectedOutput,
    acceptance: params.acceptance,
    boundary: params.boundary,
    status: 'created',
    decision: params.decision,
    decisionReason: params.decisionReason,
    output: params.output,
    createdAt: now,
    finishedAt: params.finishedAt,
    resolvedAt: params.resolvedAt,
    plan_hash: plan?.hash,
    plan_revision: plan?.revision,
  };

  await stateFileMutex.runExclusive(async () => {
    // 根级兼容镜像
    const rootHandoffsDir = changeDir + '/' + HANDOFF_DIR;
    const rootFilePath = rootHandoffsDir + '/' + id + '.json';
    await ensureDir(rootHandoffsDir);
    await writeJsonFile(rootFilePath, handoff);

    // Plan-scoped 权威副本（如果存在 plan）
    if (plan) {
      const planPaths = getPlanScopedPaths(changeDir, plan);
      const planFilePath = planPaths.handoffs + '/' + id + '.json';
      await ensureReceiptDir(planPaths.handoffs);
      await writeJsonFile(planFilePath, handoff);
    }
  });

  return handoff;
}

/**
 * 读取 handoff。
 * T2.8: 优先读取 plan-scoped 路径，回退到根级 legacy 路径
 */
export async function readHandoff(changeDir: string, id: string): Promise<HandoffFile | null> {
  // 获取当前 execution plan
  const plan = await readExecutionPlan(changeDir);

  // 优先读取 plan-scoped 路径
  if (plan) {
    const planPaths = getPlanScopedPaths(changeDir, plan);
    const planFilePath = planPaths.handoffs + '/' + id + '.json';
    const planHandoff = await readJsonFile<HandoffFile>(planFilePath);
    if (planHandoff && hasMatchingPlan(planHandoff, plan)) {
      return planHandoff;
    }
  }

  // 回退到根级 legacy 路径
  const rootFilePath = changeDir + '/' + HANDOFF_DIR + '/' + id + '.json';
  return readJsonFile<HandoffFile>(rootFilePath);
}

/**
 * 完成 handoff。
 * T2.8: 同时更新根级和 plan-scoped 路径
 */
export async function finishHandoff(changeDir: string, id: string, output: string): Promise<HandoffFile> {
  return stateFileMutex.runExclusive(async () => {
    const existing = await readHandoff(changeDir, id);
    if (!existing) {
      throw new Error('Handoff not found: ' + id);
    }
    if (existing.status === 'finished') {
      throw new Error('Handoff already finished: ' + id);
    }
    existing.status = 'finished';
    existing.output = output;
    existing.finishedAt = new Date().toISOString();

    // 更新根级路径
    const rootFilePath = changeDir + '/' + HANDOFF_DIR + '/' + id + '.json';
    await writeJsonFile(rootFilePath, existing);

    // 更新 plan-scoped 路径（如果存在 plan）
    if (existing.plan_hash && existing.plan_revision) {
      // 重建 plan 对象以获取路径
      const plan = await readExecutionPlan(changeDir);
      if (plan && plan.hash === existing.plan_hash && plan.revision === existing.plan_revision) {
        const planPaths = getPlanScopedPaths(changeDir, plan);
        const planFilePath = planPaths.handoffs + '/' + id + '.json';
        await writeJsonFile(planFilePath, existing);
      }
    }

    return existing;
  });
}

/**
 * 解决 handoff。
 * T2.8: 同时更新根级和 plan-scoped 路径
 */
export async function resolveHandoff(
  changeDir: string,
  id: string,
  decision: HandoffDecision,
  reason?: string,
): Promise<HandoffFile> {
  return stateFileMutex.runExclusive(async () => {
    const existing = await readHandoff(changeDir, id);
    if (!existing) {
      throw new Error('Handoff not found: ' + id);
    }
    if (existing.status !== 'finished') {
      throw new Error('Handoff must be in "finished" status to resolve, current status: ' + existing.status);
    }
    existing.status = 'resolved';
    existing.decision = decision;
    if (reason !== undefined) {
      existing.decisionReason = reason;
    }
    existing.resolvedAt = new Date().toISOString();

    // 更新根级路径
    const rootFilePath = changeDir + '/' + HANDOFF_DIR + '/' + id + '.json';
    await writeJsonFile(rootFilePath, existing);

    // 更新 plan-scoped 路径（如果存在 plan）
    if (existing.plan_hash && existing.plan_revision) {
      const plan = await readExecutionPlan(changeDir);
      if (plan && plan.hash === existing.plan_hash && plan.revision === existing.plan_revision) {
        const planPaths = getPlanScopedPaths(changeDir, plan);
        const planFilePath = planPaths.handoffs + '/' + id + '.json';
        await writeJsonFile(planFilePath, existing);
      }
    }

    return existing;
  });
}

export async function listHandoffs(changeDir: string): Promise<HandoffFile[]> {
  const handoffsDir = changeDir + '/' + HANDOFF_DIR;
  const dirExists = await directoryExists(handoffsDir);
  if (!dirExists) return [];

  const files = await listFiles(handoffsDir, '.json');
  const handoffs: HandoffFile[] = [];

  for (const file of files) {
    const filePath = handoffsDir + '/' + file;
    const handoff = await readJsonFile<HandoffFile>(filePath);
    if (handoff) {
      handoffs.push(handoff);
    }
  }

  return handoffs;
}
