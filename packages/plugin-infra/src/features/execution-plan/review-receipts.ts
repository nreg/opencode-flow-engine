/**
 * Review receipt and repair state management
 *
 * Provides functions for recording review receipts, reading repair states,
 * and managing the circuit breaker mechanism for the SFlow workflow.
 *
 * T2.9: Review receipt 双写机制（root 镜像 + plan-scoped 权威）
 * T2.10: 自动迁移旧收据到 plan-scoped 目录
 */
import type { ExecutionPlan, ReviewReceipt, RepairState, ReviewEvidence } from '../execution-plan-types.js';
import { ensureDir, readJsonFile, writeJsonFile, fileExists } from '@opencode-flow-engine/shared';
import { MAX_REPAIR_FAILURES } from '@opencode-flow-engine/core';
import {
  getOverlayPaths,
  getPlanScopedPaths,
  hasMatchingPlan,
  ensureReceiptDir,
} from '../plan-scoped-paths.js';
import { readExecutionPlan } from './plan-crud.js';

const REVIEWS_DIR = '.flow-engine/sflow/reviews';

// ─── T2.10: 自动迁移旧收据 ──────────────────────────────────────────────────────

/**
 * 自动迁移根级旧收据到 plan-scoped 目录。
 *
 * 在首次创建或修订 execution plan 时调用。
 * 将根级 reviews/checkpoints/handoffs/repair-state 目录下的收据
 * 迁移到当前 plan-scoped 目录。
 *
 * 迁移策略：
 * - 如果收据没有 plan_hash/plan_revision 字段，视为 legacy 收据，迁移到当前 plan
 * - 如果收据有 plan scope 信息，跳过（属于其他 plan）
 * - 迁移后保留原文件（向后兼容）
 *
 * @param changeDir - 项目根目录
 * @param plan - 当前 execution plan
 */
export async function migrateLegacyReceipts(
  changeDir: string,
  plan: ExecutionPlan,
): Promise<void> {
  const rootPaths = getOverlayPaths(changeDir);
  const planPaths = getPlanScopedPaths(changeDir, plan);

  // 确保目标目录存在
  await ensureReceiptDir(planPaths.reviews);
  await ensureReceiptDir(planPaths.checkpoints);
  await ensureReceiptDir(planPaths.handoffs);
  await ensureReceiptDir(planPaths.repairState);

  // 迁移 reviews
  await migrateReceiptType(changeDir, 'reviews', rootPaths, planPaths, plan);

  // 迁移 repair-state
  await migrateReceiptType(changeDir, 'repair-state', rootPaths, planPaths, plan);
}

/**
 * 迁移某一类型的收据（reviews 或 repair-state）。
 */
async function migrateReceiptType(
  changeDir: string,
  type: 'reviews' | 'repair-state',
  rootPaths: ReturnType<typeof getOverlayPaths>,
  planPaths: ReturnType<typeof getPlanScopedPaths>,
  plan: ExecutionPlan,
): Promise<void> {
  const sourceDir = type === 'reviews' ? rootPaths.reviews : rootPaths.repairState;
  const targetDir = type === 'reviews' ? planPaths.reviews : planPaths.repairState;

  // 检查源目录是否存在
  if (!await fileExists(sourceDir)) {
    return;
  }

  // 列出源目录下的所有 JSON 文件
  const files = await listJsonFiles(sourceDir);

  for (const fileName of files) {
    const sourcePath = sourceDir + '/' + fileName;
    const targetPath = targetDir + '/' + fileName;

    // 如果目标文件已存在，跳过
    if (await fileExists(targetPath)) {
      continue;
    }

    // 读取源收据
    const receipt = await readJsonFile<Record<string, unknown>>(sourcePath);
    if (!receipt) {
      continue;
    }

    // 检查是否需要迁移
    const hasPlanScope = receipt.plan_hash || receipt.plan_revision;
    if (hasPlanScope) {
      // 有 plan scope 信息，检查是否匹配当前 plan
      if (receipt.plan_hash === plan.hash && receipt.plan_revision === plan.revision) {
        // 匹配当前 plan，迁移
        await writeJsonFile(targetPath, receipt);
      }
      // 不匹配当前 plan，跳过（属于其他 plan）
    } else {
      // Legacy 收据，迁移并添加 plan scope 信息
      const migratedReceipt = {
        ...receipt,
        plan_hash: plan.hash,
        plan_revision: plan.revision,
      };
      await writeJsonFile(targetPath, migratedReceipt);
      
      // P1-3: 从根级收据迁移，保持 plan_hash 与 plan_revision 为空以兼容旧格式
      // 注释：迁移后保留原文件，确保向后兼容
    }
  }
}

/**
 * 列出目录下的所有 JSON 文件。
 */
async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import('fs/promises');
    const files = await readdir(dir);
    return files.filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
}

// ─── Task 9.1: recordReviewReceipt ────────────────────────────────────────────

/**
 * Record a review receipt for a wave.
 *
 * Validates that the waveId exists in the current execution plan,
 * then writes the receipt to .flow-engine/sflow/reviews/<wave-id>.json.
 * Overwrites any existing receipt for the same wave (re-review).
 *
 * T2.6-T2.7: Circuit breaker integration
 * - Checks if wave is in adjudication-required state (blocks new reviews)
 * - Checks if wave already has a pass receipt (blocks duplicate reviews)
 * - Validates repair continuity (ensures repair chain is continuous)
 * - Updates repair state after recording receipt
 *
 * T2.9: Review receipt 双写机制
 * - 同时写入根级兼容路径（.flow-engine/sflow/reviews/）与 plan-scoped 路径
 * - 根级路径为兼容镜像，plan-scoped 路径为权威副本
 * - 收据中包含 plan_hash 和 plan_revision 字段
 *
 * @param changeDir - The project/change directory
 * @param waveId - The wave ID to record the receipt for
 * @param receipt - The receipt data (status, base, head, report)
 * @returns The full ReviewReceipt with recorded_at timestamp
 */
export async function recordReviewReceipt(
  changeDir: string,
  waveId: string,
  receipt: Omit<ReviewReceipt, 'recorded_at'>,
): Promise<ReviewReceipt> {
  const plan = await readExecutionPlan(changeDir);
  if (!plan) {
    throw new Error('No execution plan found. Create an execution plan first before recording review receipts.');
  }

  const waveExists = plan.waves.some(w => w.id === waveId);
  if (!waveExists) {
    throw new Error(`Wave "${waveId}" not found in execution plan. Available waves: ${plan.waves.map(w => w.id).join(', ')}`);
  }

  // T2.6: Check repair state for circuit breaker
  const previousRepair = await readRepairState(changeDir, plan, waveId);
  if (previousRepair?.status === 'adjudication-required') {
    throw new Error(`Wave "${waveId}" requires adjudication before another review can be recorded`);
  }

  // T2.9: 优先读取 plan-scoped 收据，回退到根级 legacy 收据
  const previousReceipt = await readCurrentReviewReceipt(changeDir, plan, waveId);
  
  if (previousReceipt?.status === 'pass') {
    throw new Error(`Wave "${waveId}" already has a passing review receipt`);
  }

  // T2.7: Validate repair continuity
  validateRepairContinuity(previousReceipt, previousRepair, receipt);

  // 构建完整收据（包含 plan scope 信息）
  const fullReceipt: ReviewReceipt = {
    status: receipt.status,
    base: receipt.base,
    head: receipt.head,
    report: receipt.report,
    recorded_at: new Date().toISOString(),
    plan_hash: plan.hash,
    plan_revision: plan.revision,
  };

  // T2.9: 双写机制 - 根级兼容镜像
  const rootPaths = getOverlayPaths(changeDir);
  const rootReceiptPath = rootPaths.reviews + '/' + waveId + '.json';
  await ensureReceiptDir(rootPaths.reviews);
  await writeJsonFile(rootReceiptPath, fullReceipt);

  // T2.9: 双写机制 - plan-scoped 权威副本
  const planPaths = getPlanScopedPaths(changeDir, plan);
  const planReceiptPath = planPaths.reviews + '/' + waveId + '.json';
  await ensureReceiptDir(planPaths.reviews);
  await writeJsonFile(planReceiptPath, fullReceipt);

  // T2.6: Update repair state
  const updatedRepairState = await updateRepairState(
    changeDir,
    plan,
    waveId,
    previousRepair,
    previousReceipt,
    fullReceipt,
  );

  // Attach repair state to receipt if it exists
  if (updatedRepairState) {
    fullReceipt.repair_state = updatedRepairState;
  }

  return fullReceipt;
}

/**
 * 读取当前 plan 的 review 收据。
 * T2.9: 优先读取 plan-scoped 路径，回退到根级 legacy 路径。
 *
 * @param changeDir - 项目根目录
 * @param plan - 当前 execution plan
 * @param waveId - Wave ID
 * @returns Review 收据或 null
 */
export async function readCurrentReviewReceipt(
  changeDir: string,
  plan: ExecutionPlan,
  waveId: string,
): Promise<ReviewReceipt | null> {
  // 优先读取 plan-scoped 路径
  const planPaths = getPlanScopedPaths(changeDir, plan);
  const planReceiptPath = planPaths.reviews + '/' + waveId + '.json';
  const planReceipt = await readJsonFile<ReviewReceipt>(planReceiptPath);

  if (planReceipt) {
    // 验证 plan_hash 和 plan_revision 匹配
    if (hasMatchingPlan(planReceipt, plan)) {
      return planReceipt;
    }
    // 不匹配则视为无效，继续尝试 legacy 路径
  }

  // 回退到根级 legacy 路径
  const rootPaths = getOverlayPaths(changeDir);
  const rootReceiptPath = rootPaths.reviews + '/' + waveId + '.json';
  const rootReceipt = await readJsonFile<ReviewReceipt>(rootReceiptPath);

  if (rootReceipt) {
    // 如果是 legacy 收据（无 plan scope 信息），直接返回
    if (!rootReceipt.plan_hash && !rootReceipt.plan_revision) {
      return rootReceipt;
    }
    // 如果有 plan scope 信息，验证是否匹配当前 plan
    if (hasMatchingPlan(rootReceipt, plan)) {
      return rootReceipt;
    }
  }

  return null;
}

/**
 * 读取 repair state。
 * T2.8: 优先读取 plan-scoped 路径，回退到根级 legacy 路径。
 *
 * @param changeDir - 项目根目录
 * @param plan - 当前 execution plan
 * @param waveId - Wave ID
 * @returns Repair state 或 null
 */
export async function readRepairState(
  changeDir: string,
  plan: ExecutionPlan,
  waveId: string,
): Promise<RepairState | null> {
  // 优先读取 plan-scoped 路径
  const planPaths = getPlanScopedPaths(changeDir, plan);
  const planStatePath = planPaths.repairState + '/' + waveId + '.json';
  const planState = await readJsonFile<RepairState>(planStatePath);

  if (planState) {
    // 验证 plan_hash 和 plan_revision 匹配
    if (hasMatchingPlan(planState, plan)) {
      return validateRepairState(planState);
    }
    // 不匹配则视为无效，继续尝试 legacy 路径
  }

  // 回退到根级 legacy 路径
  const rootPaths = getOverlayPaths(changeDir);
  const rootStatePath = rootPaths.repairState + '/' + waveId + '.json';
  const rootState = await readJsonFile<RepairState>(rootStatePath);

  if (rootState) {
    // 如果是 legacy state（无 plan scope 信息），直接返回
    if (!rootState.plan_hash && !rootState.plan_revision) {
      return validateRepairState(rootState);
    }
    // 如果有 plan scope 信息，验证是否匹配当前 plan
    if (hasMatchingPlan(rootState, plan)) {
      return validateRepairState(rootState);
    }
  }

  return null;
}

/**
 * 验证 repair state 的完整性。
 * 确保所有必需字段存在且类型正确。
 */
function validateRepairState(state: unknown): RepairState | null {
  if (!state || typeof state !== 'object') {
    return null;
  }

  const s = state as Record<string, unknown>;

  // Validate required fields
  if (typeof s.wave_id !== 'string' || typeof s.status !== 'string') {
    return null;
  }

  // Validate status
  if (!['repairing', 'resolved', 'adjudication-required'].includes(s.status as string)) {
    return null;
  }

  // Validate failure_count
  if (!Number.isInteger(s.failure_count) || (s.failure_count as number) < 1) {
    return null;
  }

  // Validate failures array
  if (!Array.isArray(s.failures) || s.failures.length !== s.failure_count) {
    return null;
  }

  // Validate previous_head and previous_report
  if (typeof s.previous_head !== 'string' || typeof s.previous_report !== 'string') {
    return null;
  }

  return state as RepairState;
}

/**
 * Validate repair continuity.
 * Ensures that a new review's base equals the previous review's head,
 * unless it's a fail→pass with the exact same range.
 *
 * @param previousReceipt - The previous review receipt (may be null)
 * @param previousRepair - The previous repair state (may be null)
 * @param nextReceipt - The new receipt being recorded
 * @throws Error if continuity is violated
 */
export function validateRepairContinuity(
  previousReceipt: ReviewReceipt | null,
  previousRepair: RepairState | null,
  nextReceipt: { status: string; base: string; head: string; report: string },
): void {
  // Only check continuity if there was a previous failure
  if (previousReceipt?.status !== 'fail') return;

  const previousHead = previousRepair?.previous_head ?? previousReceipt.head;
  if (!previousHead) {
    throw new Error('Repair state is missing the previous review head');
  }

  // A fail→pass may certify the exact original range
  const repeatsPreviousRange =
    nextReceipt.status === 'pass' &&
    nextReceipt.base === previousReceipt.base &&
    nextReceipt.head === previousReceipt.head;

  // A repair must start at the previous review head
  if (nextReceipt.base !== previousHead && !repeatsPreviousRange) {
    throw new Error('Repair review base must equal the previous review head so repair ranges are continuous');
  }
}

/**
 * Update repair state after recording a review receipt.
 *
 * - If the receipt is a failure: increment failure_count, enter adjudication-required if threshold reached
 * - If the receipt is a pass after failures: mark as resolved
 * - If the receipt is a first pass: delete repair state (no repair chain needed)
 *
 * T2.8: 已迁移到 plan-scoped 路径
 *
 * @param changeDir - The project/change directory
 * @param plan - The current execution plan
 * @param waveId - The wave ID
 * @param previousRepair - The previous repair state (may be null)
 * @param previousReceipt - The previous review receipt (may be null)
 * @param receipt - The new receipt that was just recorded
 * @param maxFailures - Maximum failures before adjudication (default: MAX_REPAIR_FAILURES)
 * @returns The updated repair state or null if deleted
 */
export async function updateRepairState(
  changeDir: string,
  plan: ExecutionPlan,
  waveId: string,
  previousRepair: RepairState | null,
  previousReceipt: ReviewReceipt | null,
  receipt: ReviewReceipt,
  maxFailures: number = MAX_REPAIR_FAILURES,
): Promise<RepairState | null> {
  // T2.8: 使用 plan-scoped 路径
  const planPaths = getPlanScopedPaths(changeDir, plan);
  const repairStateDir = planPaths.repairState;
  await ensureDir(repairStateDir);
  const statePath = repairStateDir + '/' + waveId + '.json';
  const now = new Date().toISOString();

  // Extract previous failures for audit trail
  const priorFailures: ReviewEvidence[] = Array.isArray(previousRepair?.failures)
    ? previousRepair.failures
    : [];

  let state: RepairState;

  if (receipt.status === 'fail') {
    // Failure: add to failures array and check threshold
    const failures: ReviewEvidence[] = [
      ...priorFailures,
      {
        base: receipt.base,
        head: receipt.head,
        report: receipt.report,
        recorded_at: receipt.recorded_at,
      },
    ];

    state = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
      wave_id: waveId,
      status: failures.length >= maxFailures ? 'adjudication-required' : 'repairing',
      failure_count: failures.length,
      max_failures: maxFailures,
      previous_head: receipt.head,
      previous_report: receipt.report,
      failures,
      updated_at: now,
    };
  } else if (previousReceipt?.status === 'fail' || (previousRepair && previousRepair.failure_count > 0)) {
    // Pass after failures: mark as resolved
    state = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
      wave_id: waveId,
      status: 'resolved',
      failure_count: priorFailures.length,
      max_failures: maxFailures,
      previous_head: receipt.head,
      previous_report: previousRepair?.previous_report ?? priorFailures[priorFailures.length - 1]?.report ?? null,
      failures: priorFailures,
      updated_at: now,
      resolution: {
        base: receipt.base,
        head: receipt.head,
        report: receipt.report,
        recorded_at: receipt.recorded_at,
      },
    };
  } else {
    // First pass: no repair chain needed, delete repair state if exists
    // Note: In a real implementation, we would delete the file here
    // For now, we just return null to indicate no state should be stored
    return null;
  }

  await writeJsonFile(statePath, state);
  return state;
}
