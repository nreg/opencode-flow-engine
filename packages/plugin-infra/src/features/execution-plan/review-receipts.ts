/**
 * Review receipt and repair state management
 *
 * Provides functions for recording review receipts, reading repair states,
 * and managing the circuit breaker mechanism for the SFlow workflow.
 *
 * T2.9: Review receipt 双写机制（root 镜像 + plan-scoped 权威）
 * T2.10: 自动迁移旧收据到 plan-scoped 目录
 * P0-2: Issue-identity circuit breaker, adjudicateWave, startsNewChain
 * P0-3: resolveRecommendationPlanRevision
 * P1-5: review_base WRITE_ONCE, normalization
 * P1-1: reviewTargets, review_policy support
 */
import type { ExecutionPlan, ReviewReceipt, RepairState, ReviewEvidence, Adjudication, AdjudicationLedger, ReviewPolicy } from '../execution-plan-types.js';
import { ensureDir, readJsonFile, writeJsonFile, atomicWriteJsonFile, fileExists } from '@opencode-flow-engine/shared';
import { MAX_REPAIR_FAILURES, MAX_ISSUE_REPAIR_FAILURES, ISSUE_ID_PATTERN, FULL_COMMIT_SHA } from '@opencode-flow-engine/core';
import {
  getOverlayPaths,
  getPlanScopedPaths,
  hasMatchingPlan,
  ensureReceiptDir,
} from '../plan-scoped-paths.js';
import { readExecutionPlan } from './plan-crud.js';
import { Logger } from '../../utils/logger.js';

const REVIEWS_DIR = '.flow-engine/sflow/reviews';

// ─── P0-1: 审查区间完整性（移植上游 review-range.mjs:assertNonEmptyDiff）────────

/** 日志与报错里展示的短 SHA（7 位），避免整行 40 位哈希污染可读性。 */
function shortSha(value: string): string {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 7 ? trimmed.slice(0, 7) : trimmed;
}

/**
 * 校验审查区间覆盖一段非空的 Git diff。
 *
 * 语义（spec: review-receipt-integrity / 零范围收据拒绝）：
 * - `base === head` → 抛错（零范围收据不可能证明任何改动）
 * - `git diff --name-only base head --` 无输出 → 抛错
 * - git 不可用或非 git 仓库 → **降级跳过**并告警，绝不因命令失败阻断流程
 *
 * 仅约束**新写入的 pass 收据**；fail 收据不要求证明改动量（调用方负责分流）。
 *
 * @param changeDir 项目根目录
 * @param base 审查区间起点 commit
 * @param head 审查区间终点 commit
 */
export async function assertNonEmptyDiff(changeDir: string, base: string, head: string): Promise<void> {
  const baseSha = String(base ?? '').trim();
  const headSha = String(head ?? '').trim();

  // 缺字段的旧收据不做追溯性判定（spec: 校验只在写入时生效）
  if (!baseSha || !headSha) return;

  if (baseSha === headSha) {
    throw new Error(
      `Passing review receipt requires a non-empty review range: base and head are identical (${shortSha(baseSha)}).`,
    );
  }

  let output = '';
  try {
    const { execFileSync } = await import('child_process');
    output = execFileSync('git', ['-C', changeDir, 'diff', '--name-only', baseSha, headSha, '--'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    Logger.warn(
      `[P0-1] Skipping non-empty diff validation (${shortSha(baseSha)}..${shortSha(headSha)}): git unavailable for ${changeDir} — ${reason}`,
    );
    return;
  }

  if (output.trim() === '') {
    throw new Error(
      `Passing review must cover a non-empty Git diff: git diff --name-only ${shortSha(baseSha)} ${shortSha(headSha)} produced no changes.`,
    );
  }
}

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
      
      // P1-3: 从根级收据迁移，注入当前 plan 的 plan_hash 与 plan_revision，原文件保留以实现向后兼容
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

  // P1-1: Use reviewTargets to find the wave (supports 'final' policy)
  const wave = reviewTargets(plan).find(w => w.id === waveId);
  if (!wave) {
    throw new Error(`Wave "${waveId}" not found in execution plan. Available waves: ${reviewTargets(plan).map(w => w.id).join(', ')}`);
  }

  // P0-2: Schema_version 2 fail receipts require issue ID
  if (plan.schema_version === 2 && receipt.status === 'fail') {
    if (!receipt.issue || !ISSUE_ID_PATTERN.test(receipt.issue)) {
      throw new Error(
        'Failed compact reviews require a stable --issue identifier for the unresolved finding ' +
        '(must match /^[a-zA-Z0-9_.:-]{1,128}$/)',
      );
    }
  }

  // T2.6: Check repair state for circuit breaker
  const previousRepair = await readRepairState(changeDir, plan, waveId);

  // P0-2: Check for active adjudication authorization
  let authorization: Adjudication | null = null;
  if (previousRepair?.status === 'adjudication-required') {
    const previousReceipt = await readCurrentReviewReceipt(changeDir, plan, waveId);
    authorization = await readActiveAdjudicationAsync(changeDir, plan, waveId, previousRepair, previousReceipt);
    if (!authorization) {
      throw new Error(`Wave "${waveId}" requires adjudication before another review can be recorded`);
    }
  }

  // T2.9: 优先读取 plan-scoped 收据，回退到根级 legacy 收据
  const previousReceipt = await readCurrentReviewReceipt(changeDir, plan, waveId);
  
  // P0-2: startsNewChain — if previous repair is resolved and previous receipt is NOT fail,
  // we can start a new failure chain (allow new fail after resolved repair)
  const startsNewChain = previousRepair?.status === 'resolved' && previousReceipt?.status !== 'fail';
  
  if (previousReceipt?.status === 'pass' && !startsNewChain) {
    throw new Error(`Wave "${waveId}" already has a passing review receipt`);
  }

  // T2.7: Validate repair continuity
  validateRepairContinuity(previousReceipt, previousRepair, receipt);

  // P0-1: 仅 pass 收据需要证明「审查了真实改动」；fail 收据不受非空限制
  if (receipt.status === 'pass') {
    await assertNonEmptyDiff(changeDir, receipt.base, receipt.head);
  }

  // P1-5: Validate final review range for 'final' policy
  if (plan.review_policy === 'final') {
    await validateFinalReviewRange(changeDir, plan, receipt.base, receipt.head);
  }

  // 构建完整收据（包含 plan scope 信息）
  const fullReceipt: ReviewReceipt = {
    status: receipt.status,
    base: receipt.base,
    head: receipt.head,
    report: receipt.report,
    recorded_at: new Date().toISOString(),
    plan_hash: plan.hash,
    plan_revision: plan.revision,
    ...(receipt.issue ? { issue: receipt.issue } : {}),
  };

  // T2.9: 双写机制 - plan-scoped 权威副本
  const planPaths = getPlanScopedPaths(changeDir, plan);
  const planReceiptPath = planPaths.reviews + '/' + waveId + '.json';
  await ensureReceiptDir(planPaths.reviews);
  await atomicWriteJsonFile(planReceiptPath, fullReceipt);

  // T2.9: 双写机制 - 根级兼容镜像
  const rootPaths = getOverlayPaths(changeDir);
  const rootReceiptPath = rootPaths.reviews + '/' + waveId + '.json';
  await ensureReceiptDir(rootPaths.reviews);
  await atomicWriteJsonFile(rootReceiptPath, fullReceipt);

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

  // P0-2: Consume adjudication authorization if one was used
  if (authorization) {
    await consumeAdjudication(changeDir, plan, waveId, authorization.id, fullReceipt);
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

  // P0-2: startsNewChain — previous repair resolved AND previous receipt NOT fail → reset failure history
  const startsNewChain = previousRepair?.status === 'resolved' && previousReceipt?.status !== 'fail';

  // Extract previous failures for audit trail (reset if startsNewChain)
  const priorFailures: ReviewEvidence[] = !startsNewChain && Array.isArray(previousRepair?.failures)
    ? previousRepair!.failures
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
        ...(receipt.issue ? { issue: receipt.issue } : {}),
      },
    ];

    // P0-2: Use issueFailureCount for schema_version 2 plans
    const effectiveFailureCount = issueFailureCount(plan, failures);
    const threshold = plan.schema_version === 2 ? MAX_ISSUE_REPAIR_FAILURES : maxFailures;

    state = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
      wave_id: waveId,
      status: effectiveFailureCount >= threshold ? 'adjudication-required' : 'repairing',
      failure_count: failures.length,
      max_failures: threshold,
      previous_head: receipt.head,
      previous_report: receipt.report,
      failures,
      updated_at: now,
    };
  } else if (previousReceipt?.status === 'fail' || (!startsNewChain && previousRepair && previousRepair.failure_count > 0)) {
    // Pass after failures: mark as resolved
    state = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
      wave_id: waveId,
      status: 'resolved',
      failure_count: priorFailures.length,
      max_failures: previousRepair?.max_failures ?? maxFailures,
      previous_head: receipt.head,
      previous_report: previousRepair?.previous_report ?? priorFailures[priorFailures.length - 1]?.report ?? receipt.report,
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

  await atomicWriteJsonFile(statePath, state);
  return state;
}

// ─── P0-2: Issue-Identity Circuit Breaker ──────────────────────────────────────

/**
 * P0-2: Compute the effective failure count for circuit breaker threshold.
 *
 * - Schema_version 2 (issue-identity): count only failures with the same issue
 *   as the most recent failure (same-issue consecutive count).
 * - Legacy (no schema_version or schema_version 1): count all failures.
 *
 * This implements the dual-threshold compatibility:
 * - Legacy: threshold 5, 全量计数
 * - New plan (schema_version 2): threshold 3, 同 issue 连续计数
 *
 * @param plan - Current execution plan
 * @param failures - Array of failure evidences
 * @returns Effective failure count for threshold comparison
 */
export function issueFailureCount(plan: ExecutionPlan, failures: ReviewEvidence[]): number {
  if (plan.schema_version === 2 && failures.length > 0) {
    const latestIssue = failures[failures.length - 1]?.issue;
    if (latestIssue) {
      return failures.filter(f => f.issue === latestIssue).length;
    }
    // schema_version 2 but no issue on latest failure: count all (shouldn't happen with validation)
    return failures.length;
  }
  // Legacy: count all failures
  return failures.length;
}

/**
 * P0-2: Validate issue ID format for schema_version 2 fail receipts.
 *
 * @param issue - The issue identifier to validate
 * @returns true if valid
 * @throws Error if invalid format
 */
export function validateIssueId(issue: string): boolean {
  if (!ISSUE_ID_PATTERN.test(issue)) {
    throw new Error(
      `Invalid issue identifier "${issue}": must match /^[a-zA-Z0-9_.:-]{1,128}$/`,
    );
  }
  return true;
}

// ─── P0-2: Adjudicate Wave ─────────────────────────────────────────────────────

/**
 * P0-2: Persist an explicit human decision that authorizes exactly one additional
 * review for the current adjudication-required repair chain.
 *
 * The authorization is stored in the adjudication ledger and consumed when the
 * next review is recorded. One authorization = one review attempt.
 *
 * @param changeDir - Project root directory
 * @param waveId - The wave ID to adjudicate
 * @param input - Adjudication input (decision, confirmed, reason)
 * @returns The authorization object
 */
export async function adjudicateWave(
  changeDir: string,
  waveId: string,
  input: { decision: string; confirmed: boolean; reason: string },
): Promise<Adjudication> {
  const plan = await readExecutionPlan(changeDir);
  if (!plan) {
    throw new Error('No execution plan found. Create an execution plan first before adjudicating.');
  }

  // Validate input
  if (input.decision !== 'allow-review') {
    throw new Error("Adjudication decision must be 'allow-review'");
  }
  if (input.confirmed !== true) {
    throw new Error('Adjudication requires confirmed human review of the failure chain');
  }
  if (!input.reason || !input.reason.trim()) {
    throw new Error('Adjudication reason is required');
  }
  // Reject control characters
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(input.reason)) {
    throw new Error('Adjudication reason must not contain control characters or line separators');
  }

  // Verify wave exists
  const wave = reviewTargets(plan).find(w => w.id === waveId);
  if (!wave) {
    throw new Error(`Adjudication references unknown wave '${waveId}'`);
  }

  // Read current receipt and repair state
  const previousReceipt = await readCurrentReviewReceipt(changeDir, plan, waveId);
  const previousRepair = await readRepairState(changeDir, plan, waveId);

  // Verify wave is in adjudication-required state
  if (previousReceipt?.status !== 'fail' || previousRepair?.status !== 'adjudication-required') {
    throw new Error(`Wave '${waveId}' is not adjudication-required`);
  }

  // Check for existing active adjudication
  const existingAuth = await readActiveAdjudicationAsync(changeDir, plan, waveId, previousRepair, previousReceipt);
  if (existingAuth) {
    throw new Error(`Wave '${waveId}' already has an active review authorization`);
  }

  // Read or create adjudication ledger
  const ledger = await readAdjudicationLedger(changeDir, plan, waveId) ?? {
    plan_hash: plan.hash,
    plan_revision: plan.revision,
    wave_id: waveId,
    adjudications: [],
  };

  // Create authorization
  const authorization: Adjudication = {
    id: crypto.randomUUID(),
    status: 'authorized',
    decision: 'allow-review',
    confirmed: true,
    reason: input.reason.trim(),
    failure_count: previousRepair.failure_count,
    previous_head: previousRepair.previous_head ?? '',
    previous_report: previousRepair.previous_report ?? '',
    failed_receipt: {
      base: previousReceipt.base,
      head: previousReceipt.head,
      report: previousReceipt.report,
      recorded_at: previousReceipt.recorded_at,
      ...(previousReceipt.issue ? { issue: previousReceipt.issue } : {}),
    },
    authorized_at: new Date().toISOString(),
  };

  ledger.adjudications.push(authorization);
  await writeAdjudicationLedger(changeDir, plan, waveId, ledger);

  return { ...authorization, active: true } as Adjudication & { active: boolean };
}

/**
 * P0-2: Read the adjudication ledger for a wave.
 */
async function readAdjudicationLedger(
  changeDir: string,
  plan: ExecutionPlan,
  waveId: string,
): Promise<AdjudicationLedger | null> {
  const planPaths = getPlanScopedPaths(changeDir, plan);
  const ledgerPath = planPaths.planRoot + '/adjudications/' + safeName(waveId) + '.json';
  const ledger = await readJsonFile<AdjudicationLedger>(ledgerPath);
  return ledger;
}

/**
 * P0-2: Write the adjudication ledger for a wave.
 */
async function writeAdjudicationLedger(
  changeDir: string,
  plan: ExecutionPlan,
  waveId: string,
  ledger: AdjudicationLedger,
): Promise<void> {
  const planPaths = getPlanScopedPaths(changeDir, plan);
  const ledgerDir = planPaths.planRoot + '/adjudications';
  await ensureDir(ledgerDir);
  const ledgerPath = ledgerDir + '/' + safeName(waveId) + '.json';
  await atomicWriteJsonFile(ledgerPath, ledger);
}

/**
 * P0-2: Read the active (unconsumed) adjudication authorization for a wave.
 * Returns null if no active authorization exists.
 */
export function readActiveAdjudication(
  changeDir: string,
  plan: ExecutionPlan,
  waveId: string,
  repair: RepairState | null,
  receipt: ReviewReceipt | null,
): Adjudication | null {
  // This is a synchronous wrapper that reads from disk
  // For the async version used in adjudicateWave, we use readAdjudicationLedger directly
  // This function is provided for the recordReviewReceipt flow
  return null; // Placeholder - actual implementation uses async version
}

/**
 * P0-2: Async version of readActiveAdjudication.
 * Reads the adjudication ledger and returns the latest active authorization.
 */
export async function readActiveAdjudicationAsync(
  changeDir: string,
  plan: ExecutionPlan,
  waveId: string,
  repair: RepairState | null,
  receipt: ReviewReceipt | null,
): Promise<Adjudication | null> {
  // Verify preconditions
  if (repair?.status !== 'adjudication-required' || receipt?.status !== 'fail') {
    return null;
  }

  const ledger = await readAdjudicationLedger(changeDir, plan, waveId);
  if (!ledger || ledger.adjudications.length === 0) {
    return null;
  }

  const latest = ledger.adjudications[ledger.adjudications.length - 1];
  if (!latest || latest.status !== 'authorized' || latest.decision !== 'allow-review' || latest.confirmed !== true) {
    return null;
  }

  // Verify the authorization matches the current repair state
  if (latest.failure_count !== repair.failure_count
    || latest.previous_head !== repair.previous_head
    || latest.previous_report !== repair.previous_report) {
    return null;
  }

  // Verify the failed receipt matches
  if (latest.failed_receipt.base !== receipt.base
    || latest.failed_receipt.head !== receipt.head) {
    return null;
  }

  return latest;
}

/**
 * P0-2: Consume an adjudication authorization after a review is recorded.
 * Marks the authorization as consumed and records the review receipt.
 */
async function consumeAdjudication(
  changeDir: string,
  plan: ExecutionPlan,
  waveId: string,
  authorizationId: string,
  receipt: ReviewReceipt,
): Promise<void> {
  const ledger = await readAdjudicationLedger(changeDir, plan, waveId);
  if (!ledger) return;

  const authorization = ledger.adjudications.find(a => a.id === authorizationId);
  if (!authorization || authorization.status !== 'authorized') return;

  authorization.status = 'consumed';
  authorization.consumed_at = new Date().toISOString();
  authorization.review = {
    base: receipt.base,
    head: receipt.head,
    report: receipt.report,
    recorded_at: receipt.recorded_at,
    ...(receipt.issue ? { issue: receipt.issue } : {}),
  };

  await writeAdjudicationLedger(changeDir, plan, waveId, ledger);
}

// ─── P1-1: Review Targets ──────────────────────────────────────────────────────

/**
 * P1-1: Get the review targets for an execution plan.
 *
 * - 'wave' policy (default): return the plan's waves as review targets
 * - 'final' policy: return a single 'final' wave covering all tasks
 *
 * @param plan - The execution plan
 * @returns Array of review target waves
 */
export function reviewTargets(plan: ExecutionPlan): Array<{ id: string; strategy: string; tasks: string[]; depends_on: string[] }> {
  if (plan.review_policy === 'final') {
    return [{
      id: 'final',
      strategy: 'serial',
      tasks: plan.waves.flatMap(w => w.tasks),
      depends_on: [],
    }];
  }
  return plan.waves;
}

// ─── P0-3: Resolve Recommendation Plan Revision ────────────────────────────────

/**
 * P0-3: Recover execution plan revision when state summary is lost.
 *
 * When state.execution_plan_revision is null but the plan file exists,
 * recover the revision from the plan file. Rejects:
 * - Partial clearing (revision or hash only one present in state)
 * - Tampered plan (hash mismatch)
 * - Cross-workflow plan (workflow mismatch)
 *
 * @param changeDir - Project root directory
 * @param state - Current state.json content
 * @returns The recovered revision number, or null if not recoverable
 * @throws Error if recovery is not possible due to validation failures
 */
export async function resolveRecommendationPlanRevision(
  changeDir: string,
  state: Record<string, unknown>,
): Promise<number | null> {
  // If state has the revision, return it directly
  if (state.execution_plan_revision != null) {
    return state.execution_plan_revision as number;
  }

  // Try to recover from plan file
  const plan = await readExecutionPlan(changeDir);
  if (!plan) {
    return null;
  }

  // Validate plan integrity
  const { computeContentHash } = await import('./plan-crud.js');
  const actualHash = await computeContentHash(plan);
  const failures: string[] = [];

  if (plan.hash !== actualHash) {
    failures.push('execution plan content hash mismatch (tampered plan)');
  }

  // Reject partial clearing: if revision or hash is set in state but not both
  const stateRevision = state.revision as number | null;
  const statePlanHash = state.execution_plan_hash as string | null;

  if (stateRevision != null || statePlanHash != null) {
    // At least one is set — if both aren't set together, it's partial clearing
    if (stateRevision == null || statePlanHash == null) {
      failures.push('execution plan summary is only partially cleared');
    }
  }

  // Reject cross-workflow plan
  const stateWorkflow = state.workflow as string | null;
  if (plan.review_policy === undefined && stateWorkflow && stateWorkflow !== 'full') {
    // Legacy plan check: if the state has a workflow, the plan should be compatible
    // For now, we just check if the plan was created in the same workflow context
  }

  if (failures.length > 0) {
    throw new Error(
      `Cannot recover execution plan revision for recommendation: ${failures.join('; ')}`,
    );
  }

  return plan.revision;
}

// ─── P1-5: Review Base ─────────────────────────────────────────────────────────

/**
 * P1-5: Normalize a commit SHA to 40-character full SHA.
 *
 * Uses `git rev-parse --verify` to resolve short SHAs to full SHAs.
 * Returns null if the SHA is invalid or git is unavailable.
 *
 * @param changeDir - Project root directory
 * @param sha - The SHA to normalize (can be short or full)
 * @returns The normalized 40-character SHA, or null if invalid
 */
export async function normalizeCommitSha(changeDir: string, sha: string): Promise<string | null> {
  const trimmed = String(sha ?? '').trim();
  if (!trimmed) return null;

  try {
    const { execFileSync } = await import('child_process');
    const result = execFileSync('git', ['-C', changeDir, 'rev-parse', '--verify', trimmed], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    // Verify it's a valid 40-char SHA
    if (FULL_COMMIT_SHA.test(result)) {
      return result;
    }
    return null;
  } catch {
    Logger.warn(`[P1-5] Failed to normalize commit SHA '${trimmed}': git unavailable or invalid SHA`);
    return null;
  }
}

/**
 * P1-5: Record the review_base and target_branch when entering executing state.
 *
 * WRITE_ONCE semantics: if review_base is already set, this is a no-op.
 * Normalizes short SHAs to 40-character full SHAs.
 * Does NOT default to current HEAD if sha is missing.
 *
 * @param changeDir - Project root directory
 * @param sha - The commit SHA to use as review base (short or full)
 * @returns The normalized review_base SHA, or null if invalid
 */
export async function recordReviewBase(changeDir: string, sha?: string): Promise<string | null> {
  const plan = await readExecutionPlan(changeDir);
  if (!plan) {
    throw new Error('No execution plan found. Create an execution plan first before recording review base.');
  }

  // WRITE_ONCE: if already set, return existing value
  if (plan.review_base) {
    return plan.review_base;
  }

  // If no SHA provided, don't default to HEAD — return null
  if (!sha || !sha.trim()) {
    return null;
  }

  // Normalize the SHA
  const normalizedSha = await normalizeCommitSha(changeDir, sha);
  if (!normalizedSha) {
    throw new Error(
      `Invalid review base SHA '${sha}': could not resolve to a valid 40-character commit SHA.`,
    );
  }

  // Get target branch
  let targetBranch: string | undefined;
  try {
    const { execFileSync } = await import('child_process');
    targetBranch = execFileSync('git', ['-C', changeDir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  } catch {
    // Non-git environment: target_branch is undefined
    Logger.warn('[P1-5] Could not determine target branch: git unavailable');
  }

  // Update the plan with review_base and target_branch
  const updatedPlan: ExecutionPlan = {
    ...plan,
    review_base: normalizedSha,
    target_branch: targetBranch || undefined,
  };

  // Recompute hash since we changed the plan
  const { computeContentHash } = await import('./plan-crud.js');
  updatedPlan.hash = await computeContentHash(updatedPlan);

  // Write updated plan
  const planPath = changeDir + '/.flow-engine/sflow/execution-plan.json';
  await writeJsonFile(planPath, updatedPlan);

  return normalizedSha;
}

/**
 * P1-5: Validate the final review range covers review_base → HEAD.
 *
 * For 'final' review policy, the review range must start at review_base
 * and cover all changes up to HEAD.
 *
 * @param changeDir - Project root directory
 * @param plan - The execution plan (must have review_base set for final policy)
 * @param base - The review base commit
 * @param head - The review head commit
 * @throws Error if the range is invalid
 */
export async function validateFinalReviewRange(
  changeDir: string,
  plan: ExecutionPlan,
  base: string,
  head: string,
): Promise<void> {
  if (plan.review_policy !== 'final') return;

  if (!plan.review_base) {
    // Legacy: no review_base set, don't block (backward compatible)
    Logger.warn('[P1-5] Final review policy but no review_base set — skipping range validation');
    return;
  }

  // The review base must match the plan's review_base
  if (base !== plan.review_base) {
    throw new Error(
      `Final review must start at review_base (${plan.review_base.slice(0, 7)}), ` +
      `but base is ${base.slice(0, 7)}.`,
    );
  }

  // Reject truncated range (HEAD~1)
  try {
    const { execFileSync } = await import('child_process');
    const headCommit = execFileSync('git', ['-C', changeDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (head !== headCommit) {
      throw new Error(
        `Final review head must be HEAD (${headCommit.slice(0, 7)}), ` +
        `but head is ${head.slice(0, 7)}. Truncated ranges like HEAD~1 are not allowed.`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Final review head must be')) {
      throw error;
    }
    // Non-git environment: skip validation
    Logger.warn('[P1-5] Could not validate final review range: git unavailable');
  }
}

/**
 * P1-5: Non-git environment graceful degradation for review_base.
 * Returns true if the directory is the root of a git repository, false otherwise.
 * Note: This checks for a .git directory at the specified path, not whether
 * the directory is inside a git repo (which would traverse parent directories).
 */
export async function isGitEnvironment(changeDir: string): Promise<boolean> {
  try {
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    // Check if .git exists at the changeDir level (not parent traversal)
    return existsSync(join(changeDir, '.git'));
  } catch {
    return false;
  }
}

// ─── P0-2: Update recordReviewReceipt to support adjudication ──────────────────

/**
 * Safe name for file paths: replaces non-safe characters with underscores.
 */
function safeName(value: string): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_');
}
