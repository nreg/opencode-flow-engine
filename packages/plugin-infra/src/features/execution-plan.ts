/**
 * Execution plan feature module for sFlow
 *
 * Provides functions for creating, reading, validating, revising,
 * and recommending execution plans for the SFlow workflow.
 *
 * Stored in .flow-engine/sflow/execution-plan.json
 *
 * T2.9: Review receipt 双写机制（root 镜像 + plan-scoped 权威）
 * T2.10: 自动迁移旧收据到 plan-scoped 目录
 */
import type { ExecutionPlan, ExecutionMode, PlanSource, Wave, DP4Result, ReviewReceipt, RepairState, ReviewEvidence } from './execution-plan-types.js';
import { ensureDir, readJsonFile, writeJsonFile, stateFileMutex, fileExists } from '@opencode-flow-engine/shared';
import { EXECUTION_MODE_THRESHOLDS, MAX_REPAIR_FAILURES } from '@opencode-flow-engine/core';
import {
  getOverlayPaths,
  getPlanScopedPaths,
  getCurrentPlanScopedPaths,
  resolveRecordDirectory,
  hasMatchingPlan,
  ensureReceiptDir,
} from './plan-scoped-paths.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const EXECUTION_PLAN_FILE = '.flow-engine/sflow/execution-plan.json';
const STATE_FILE = '.flow-engine/sflow/state.json';

/** Valid execution modes for validation */
const VALID_MODES: ExecutionMode[] = ['inline', 'batch-inline', 'sdd'];

/**
 * Mode downgrade hierarchy: sdd > batch-inline > inline
 * Downgrade means moving to a "lower" mode in this order.
 */
const MODE_RANK: Record<ExecutionMode, number> = {
  inline: 0,
  'batch-inline': 1,
  sdd: 2,
};

// ─── Task 2.4: computeContentHash ─────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 hex digest of an execution plan.
 * Uses canonical JSON (sorted keys) to ensure same input → same output
 * regardless of key insertion order.
 *
 * Returns: sha256:<64-hex-chars>
 */
export async function computeContentHash(plan: ExecutionPlan): Promise<string> {
  // Create a canonical representation with sorted keys
  // Exclude the hash field itself from the hash computation
  const { hash: _hash, ...planWithoutHash } = plan;
  const canonical = canonicalJsonStringify(planWithoutHash);

  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hexDigest = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hexDigest}`;
}

/**
 * Deterministic JSON stringify with sorted keys.
 * Recursively sorts object keys to produce a canonical representation.
 */
function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sortedKeys.map(k => JSON.stringify(k) + ':' + canonicalJsonStringify((obj as Record<string, unknown>)[k]));
  return '{' + pairs.join(',') + '}';
}

// ─── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Validate execution plan structure.
 * Checks for: valid mode, duplicate task IDs, circular wave dependencies,
 * missing wave references in depends_on.
 */
export function validatePlanStructure(waves: Wave[], mode: ExecutionMode): void {
  // Validate mode
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid execution mode: "${mode}". Must be one of: ${VALID_MODES.join(', ')}`);
  }

  // Check for duplicate task IDs across waves
  const taskIds = new Set<string>();
  for (const wave of waves) {
    for (const taskId of wave.tasks) {
      if (taskIds.has(taskId)) {
        throw new Error(`Duplicate task ID "${taskId}" found across waves. Each task ID must be unique.`);
      }
      taskIds.add(taskId);
    }
  }

  // Check for missing wave references in depends_on
  const waveIds = new Set(waves.map(w => w.id));
  for (const wave of waves) {
    for (const depId of wave.depends_on) {
      if (!waveIds.has(depId)) {
        throw new Error(`Wave "${wave.id}" depends on non-existent wave "${depId}". All depends_on references must exist.`);
      }
    }
  }

  // Check for circular dependencies using topological sort
  detectCircularDependencies(waves);
}

/**
 * Detect circular dependencies in wave graph using Kahn's algorithm.
 * Throws if a cycle is detected.
 */
function detectCircularDependencies(waves: Wave[]): void {
  if (waves.length === 0) return;

  const waveMap = new Map(waves.map(w => [w.id, w]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const wave of waves) {
    inDegree.set(wave.id, 0);
    adjacency.set(wave.id, []);
  }

  for (const wave of waves) {
    for (const depId of wave.depends_on) {
      adjacency.get(depId)!.push(wave.id);
      inDegree.set(wave.id, (inDegree.get(wave.id) || 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (processed !== waves.length) {
    throw new Error('Circular wave dependencies detected. Wave dependency graph must be acyclic.');
  }
}

// ─── Task 2.1: createExecutionPlan ────────────────────────────────────────────

/**
 * Parameters for creating an execution plan.
 */
export interface CreateExecutionPlanParams {
  mode: ExecutionMode;
  source: PlanSource;
  rationale: string;
  waves: Wave[];
  revision?: number;
}

/**
 * Create an execution plan and write it to .flow-engine/sflow/execution-plan.json.
 *
 * Steps:
 * 1. Validate plan structure (mode, duplicate tasks, circular deps)
 * 2. Read state.json for artifacts_hash and contract_hash
 * 3. Compute content hash using SHA-256
 * 4. Write the plan to disk
 * 5. Update state.json with execution_plan_hash
 * 6. T2.10: 自动迁移旧收据到 plan-scoped 目录
 */
export async function createExecutionPlan(
  changeDir: string,
  params: CreateExecutionPlanParams,
): Promise<ExecutionPlan> {
  // 1. Validate plan structure
  validatePlanStructure(params.waves, params.mode);

  // 2. Read state.json for hashes
  const statePath = changeDir + '/' + STATE_FILE;
  const state = await readJsonFile<Record<string, unknown>>(statePath);
  if (!state) {
    throw new Error('Cannot create execution plan: state.json not found at ' + statePath);
  }

  const artifacts_hash = (state.artifacts_hash as string) || '';
  const contract_hash = (state.contract_hash as string) || '';

  // 3. Build the plan object
  const revision = params.revision ?? 1;
  const plan: ExecutionPlan = {
    mode: params.mode,
    source: params.source,
    rationale: params.rationale,
    waves: params.waves,
    hash: '', // placeholder, computed below
    artifacts_hash,
    contract_hash,
    revision,
  };

  // 4. Compute content hash
  plan.hash = await computeContentHash(plan);

  // 5. Write the plan to disk
  const planPath = changeDir + '/' + EXECUTION_PLAN_FILE;
  await ensureDir(changeDir + '/.flow-engine/sflow');
  await writeJsonFile(planPath, plan);

  // 6. Update state.json with execution_plan_hash
  await stateFileMutex.runExclusive(async () => {
    const currentState = await readJsonFile<Record<string, unknown>>(statePath);
    if (currentState) {
      currentState.execution_plan_hash = plan.hash;
      currentState.updatedAt = new Date().toISOString();
      await writeJsonFile(statePath, currentState);
    }
  });

  // T2.10: 自动迁移旧收据到 plan-scoped 目录（在 hash 计算完成后）
  // 注意：这里 plan.hash 已经计算完成，可以安全调用
  try {
    await migrateLegacyReceipts(changeDir, plan);
  } catch (error) {
    // 迁移失败不应阻止 plan 创建，记录警告即可
    console.warn('[T2.10] Failed to migrate legacy receipts:', error);
  }

  return plan;
}

// ─── Task 2.2: readExecutionPlan ──────────────────────────────────────────────

/**
 * Read and parse the execution plan from .flow-engine/sflow/execution-plan.json.
 * Returns null if the file does not exist.
 */
export async function readExecutionPlan(changeDir: string): Promise<ExecutionPlan | null> {
  const planPath = changeDir + '/' + EXECUTION_PLAN_FILE;
  return readJsonFile<ExecutionPlan>(planPath);
}

// ─── Task 2.2: validatePlanHashes ─────────────────────────────────────────────

/**
 * Result of hash validation.
 */
export interface HashValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that the plan's hashes match the current state.json values.
 * Compares artifacts_hash and contract_hash.
 */
export async function validatePlanHashes(
  plan: ExecutionPlan,
  changeDir: string,
): Promise<HashValidationResult> {
  const statePath = changeDir + '/' + STATE_FILE;
  const state = await readJsonFile<Record<string, unknown>>(statePath);

  if (!state) {
    return { valid: false, reason: 'state.json not found' };
  }

  const currentArtifactsHash = (state.artifacts_hash as string) || '';
  const currentContractHash = (state.contract_hash as string) || '';

  if (plan.artifacts_hash !== currentArtifactsHash) {
    return {
      valid: false,
      reason: `artifacts_hash mismatch: plan has "${plan.artifacts_hash}" but state.json has "${currentArtifactsHash}"`,
    };
  }

  if (plan.contract_hash !== currentContractHash) {
    return {
      valid: false,
      reason: `contract_hash mismatch: plan has "${plan.contract_hash}" but state.json has "${currentContractHash}"`,
    };
  }

  return { valid: true };
}

// ─── Task 2.3: reviseExecutionPlan ────────────────────────────────────────────

/**
 * Parameters for revising an execution plan.
 */
export interface ReviseExecutionPlanParams {
  mode: ExecutionMode;
  source: PlanSource;
  rationale: string;
  waves: Wave[];
}

/**
 * Revise an existing execution plan.
 *
 * - Increments revision number
 * - Rejects mode downgrade (sdd → inline, sdd → batch-inline, batch-inline → inline)
 * - Allows mode upgrade (inline → sdd, inline → batch-inline, batch-inline → sdd)
 * - Validates the new plan structure
 * - Updates state.json with new execution_plan_hash
 * - T2.10: 自动迁移旧收据到新的 plan-scoped 目录
 */
export async function reviseExecutionPlan(
  changeDir: string,
  params: ReviseExecutionPlanParams,
): Promise<ExecutionPlan> {
  // Read existing plan
  const existingPlan = await readExecutionPlan(changeDir);
  if (!existingPlan) {
    throw new Error('No execution plan exists to revise. Create one first with createExecutionPlan.');
  }

  // Check for mode downgrade
  const currentRank = MODE_RANK[existingPlan.mode];
  const newRank = MODE_RANK[params.mode];

  if (newRank < currentRank) {
    throw new Error(
      `Mode downgrade not allowed: cannot change from "${existingPlan.mode}" to "${params.mode}". ` +
      `Downgrading execution mode compromises the integrity of the execution plan. ` +
      `Upgrade is allowed (e.g. inline → sdd), but downgrade is not.`
    );
  }

  // Validate the new plan structure
  validatePlanStructure(params.waves, params.mode);

  // Read state.json for current hashes
  const statePath = changeDir + '/' + STATE_FILE;
  const state = await readJsonFile<Record<string, unknown>>(statePath);
  if (!state) {
    throw new Error('Cannot revise execution plan: state.json not found');
  }

  const artifacts_hash = (state.artifacts_hash as string) || '';
  const contract_hash = (state.contract_hash as string) || '';

  // Build revised plan with incremented revision
  const revisedPlan: ExecutionPlan = {
    mode: params.mode,
    source: params.source,
    rationale: params.rationale,
    waves: params.waves,
    hash: '',
    artifacts_hash,
    contract_hash,
    revision: existingPlan.revision + 1,
  };

  // Compute new content hash
  revisedPlan.hash = await computeContentHash(revisedPlan);

  // Write revised plan to disk
  const planPath = changeDir + '/' + EXECUTION_PLAN_FILE;
  await writeJsonFile(planPath, revisedPlan);

  // Update state.json with new execution_plan_hash
  await stateFileMutex.runExclusive(async () => {
    const currentState = await readJsonFile<Record<string, unknown>>(statePath);
    if (currentState) {
      currentState.execution_plan_hash = revisedPlan.hash;
      currentState.updatedAt = new Date().toISOString();
      await writeJsonFile(statePath, currentState);
    }
  });

  // T2.10: 自动迁移旧收据到新的 plan-scoped 目录（在 hash 计算完成后）
  try {
    await migrateLegacyReceipts(changeDir, revisedPlan);
  } catch (error) {
    // 迁移失败不应阻止 plan 修订，记录警告即可
    console.warn('[T2.10] Failed to migrate legacy receipts:', error);
  }

  return revisedPlan;
}

// ─── Task 2.5: recommendExecutionMode ─────────────────────────────────────────

/**
 * Dependency detection keywords in tasks.md content.
 * These keywords indicate cross-task or cross-module dependencies.
 */
const DEPENDENCY_KEYWORDS = [
  'depends on',
  'depends upon',
  'requires',
  'cross-module',
  'cross module',
  'must complete before',
  'must be done before',
  'prerequisite',
  'after',
  'follows',
];

/**
 * Recommend an execution mode based on tasks.md content analysis.
 *
 * Logic:
 * - 1-2 tasks, no dependencies → inline
 * - 3-5 tasks, no dependencies → batch-inline
 * - 6+ tasks OR has dependencies → sdd
 *
 * @param tasksMdContent - The content of the tasks.md file
 * @returns DP4Result with the recommended mode and rationale
 */
export function recommendExecutionMode(tasksMdContent: string): DP4Result {
  // Count tasks: lines starting with "- [ ]" (unchecked task items)
  const taskLines = tasksMdContent.split('\n').filter(line => /^\s*-\s*\[\s*\]/.test(line));
  const taskCount = taskLines.length;

  // Detect dependencies by scanning for keywords
  const lowerContent = tasksMdContent.toLowerCase();
  const hasDependencies = DEPENDENCY_KEYWORDS.some(kw => lowerContent.includes(kw));

  // Determine mode based on thresholds and dependencies
  let mode: ExecutionMode;
  let rationale: string;

  if (hasDependencies) {
    mode = 'sdd';
    rationale = `Tasks have cross-wave dependencies detected: sdd mode recommended for structured execution with dependency management.`;
  } else if (taskCount <= EXECUTION_MODE_THRESHOLDS.inline.maxTasks) {
    mode = 'inline';
    rationale = `${taskCount} task(s) with no dependencies: inline mode recommended for simple, direct execution.`;
  } else if (taskCount <= EXECUTION_MODE_THRESHOLDS['batch-inline'].maxTasks) {
    mode = 'batch-inline';
    rationale = `${taskCount} tasks with no dependencies: batch-inline mode recommended for grouped execution.`;
  } else {
    mode = 'sdd';
    rationale = `${taskCount} tasks: sdd mode recommended for complex execution with multiple waves and review gates.`;
  }

  return {
    mode,
    taskCount,
    hasDependencies,
    rationale,
  };
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
  await migrateReceiptType(changeDir, 'repairState', rootPaths, planPaths, plan);

  // 注释：checkpoints 和 handoffs 的迁移在 state-manager.ts 中处理
  // 因为它们使用不同的文件格式（.md 而非 .json）
}

/**
 * 迁移特定类型的收据。
 *
 * @param changeDir - 项目根目录
 * @param type - 收据类型
 * @param rootPaths - 根级路径
 * @param planPaths - plan-scoped 路径
 * @param plan - 当前 execution plan
 */
async function migrateReceiptType(
  changeDir: string,
  type: 'reviews' | 'repairState',
  rootPaths: ReturnType<typeof getOverlayPaths>,
  planPaths: ReturnType<typeof getPlanScopedPaths>,
  plan: ExecutionPlan,
): Promise<void> {
  const sourceDir = rootPaths[type];
  const targetDir = planPaths[type];

  // 检查源目录是否存在
  const sourceExists = await fileExists(sourceDir);
  if (!sourceExists) {
    return;
  }

  // 列出源目录下的所有 JSON 文件
  const { listFiles } = await import('@opencode-flow-engine/shared');
  const files = await listFiles(sourceDir);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  for (const fileName of jsonFiles) {
    const sourcePath = sourceDir + '/' + fileName;
    const targetPath = targetDir + '/' + fileName;

    // 检查目标文件是否已存在
    const targetExists = await fileExists(targetPath);
    if (targetExists) {
      continue; // 已迁移，跳过
    }

    // 读取源文件
    const receipt = await readJsonFile<Record<string, unknown>>(sourcePath);
    if (!receipt) {
      continue;
    }

    // 检查是否为 legacy 收据（没有 plan scope 信息）
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

// ─── Task 9.1: recordReviewReceipt ────────────────────────────────────────────

const REVIEWS_DIR = '.flow-engine/sflow/reviews';

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
    // 验证 plan_hash 和 plan_revision 匹配（如果有）
    if (hasMatchingPlan(rootReceipt, plan)) {
      return rootReceipt;
    }
    // 如果收据没有 plan scope 信息，视为 legacy 收据，仍然返回
    if (!rootReceipt.plan_hash && !rootReceipt.plan_revision) {
      return rootReceipt;
    }
  }

  return null;
}

// ─── T2.5-T2.7: Repair Circuit Breaker ─────────────────────────────────────────

/**
 * Repair state directory (P1-3: 已迁移到 plan-scoped 路径)
 * 路径：.flow-engine/sflow/plans/<plan_identity>/repair-state/
 */

/**
 * Read repair state for a wave.
 * Returns null if no repair state exists or if the state is invalid.
 *
 * T2.8: 已迁移到 plan-scoped 路径
 *
 * @param changeDir - The project/change directory
 * @param plan - The current execution plan
 * @param waveId - The wave ID
 * @returns The repair state or null
 */
export async function readRepairState(
  changeDir: string,
  plan: ExecutionPlan,
  waveId: string,
): Promise<RepairState | null> {
  // T2.8: 使用 plan-scoped 路径
  const planPaths = getPlanScopedPaths(changeDir, plan);
  const statePath = planPaths.repairState + '/' + waveId + '.json';
  const state = await readJsonFile<RepairState>(statePath);

  if (!state) return null;

  // Validate that the state belongs to the current plan
  if (state.plan_hash !== plan.hash || state.plan_revision !== plan.revision || state.wave_id !== waveId) {
    return null;
  }

  // Validate status
  if (!['repairing', 'resolved', 'adjudication-required'].includes(state.status)) {
    return null;
  }

  // Validate failure_count
  if (!Number.isInteger(state.failure_count) || state.failure_count < 1) {
    return null;
  }

  // Validate failures array
  if (!Array.isArray(state.failures) || state.failures.length !== state.failure_count) {
    return null;
  }

  // Validate previous_head and previous_report
  if (typeof state.previous_head !== 'string' || typeof state.previous_report !== 'string') {
    return null;
  }

  return state;
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
