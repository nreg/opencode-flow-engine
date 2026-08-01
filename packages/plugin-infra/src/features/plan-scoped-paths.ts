/**
 * Plan-scoped SDD 记录模块 (P1-3)
 *
 * 提供按 execution plan identity 隔离的收据路径派生功能。
 * 将 reviews/checkpoints/handoffs/repair-state 按 plan_hash + plan_revision
 * 物理隔离到 .flow-engine/sflow/plans/<identity>/ 下。
 *
 * 关键决策：
 * - plan_hash + plan_revision 构成 identity（每个 revision 独立目录）
 * - 嵌套目录结构：.flow-engine/sflow/plans/<identity>/reviews|checkpoints|handoffs|repair-state/
 * - 双写机制：root reviews/（兼容镜像）+ plan-scoped reviews/（权威副本）
 * - 首次创建/修订 plan 时自动迁移旧收据
 */

import type { ExecutionPlan } from './execution-plan-types.js';
import { fileExists, readJsonFile, ensureDir, directoryExists } from '@opencode-flow-engine/shared';
import { join } from 'node:path';

// ─── Constants ────────────────────────────────────────────────────────────────

const SDD_ROOT = '.flow-engine/sflow';
const PLANS_DIR = 'plans';

// ─── Overlay Paths (Root Level) ────────────────────────────────────────────────

/**
 * 获取根级 SDD 路径（兼容层）。
 * 用于读取 legacy 收据或在 plan-scoped 机制启用前的文件。
 */
export function getOverlayPaths(changeDir: string) {
  const root = join(changeDir, SDD_ROOT);
  return {
    root,
    reviews: join(root, 'reviews'),
    checkpoints: join(root, 'checkpoints'),
    handoffs: join(root, 'handoffs'),
    repairState: join(root, 'repair-state'),
    executionPlan: join(root, 'execution-plan.json'),
  };
}

// ─── Plan Identity ──────────────────────────────────────────────────────────────

/**
 * 计算 plan identity 字符串。
 * 格式：r<revision>-<hash-prefix>
 * 例如：r1-a1b2c3d4e5f6...
 *
 * @param plan - Execution plan 对象
 * @returns Plan identity 字符串
 * @throws 如果 plan.hash 或 plan.revision 无效
 */
export function getPlanIdentity(plan: ExecutionPlan): string {
  // 验证 hash 格式：sha256:<hex>
  if (typeof plan.hash !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(plan.hash)) {
    throw new Error('Execution plan hash must be a sha256 digest (format: sha256:<64-hex-chars>)');
  }

  // 验证 revision：正整数
  if (!Number.isSafeInteger(plan.revision) || plan.revision < 1) {
    throw new Error('Execution plan revision must be a positive integer');
  }

  // 提取 hash 的 hex 部分（去掉 sha256: 前缀）
  const hashHex = plan.hash.slice('sha256:'.length).toLowerCase();

  // 格式：r<revision>-<hash>
  return `r${plan.revision}-${hashHex}`;
}

// ─── Plan-scoped Paths ────────────────────────────────────────────────────────

/**
 * Plan-scoped 路径结构。
 * 包含 plan identity 信息和所有子目录路径。
 */
export interface PlanScopedPaths {
  /** 根级 SDD 路径 */
  root: string;
  /** Plan identity 字符串 */
  planIdentity: string;
  /** Plan 根目录：.flow-engine/sflow/plans/<identity>/ */
  planRoot: string;
  /** Reviews 目录：.flow-engine/sflow/plans/<identity>/reviews/ */
  reviews: string;
  /** Checkpoints 目录：.flow-engine/sflow/plans/<identity>/checkpoints/ */
  checkpoints: string;
  /** Handoffs 目录：.flow-engine/sflow/plans/<identity>/handoffs/ */
  handoffs: string;
  /** Repair state 目录：.flow-engine/sflow/plans/<identity>/repair-state/ */
  repairState: string;
}

/**
 * 获取 plan-scoped 路径。
 * 根据 plan identity 派生所有收据目录路径。
 *
 * @param changeDir - 项目根目录
 * @param plan - Execution plan 对象
 * @returns Plan-scoped 路径结构
 */
export function getPlanScopedPaths(changeDir: string, plan: ExecutionPlan): PlanScopedPaths {
  const rootPaths = getOverlayPaths(changeDir);
  const planIdentity = getPlanIdentity(plan);
  const planRoot = join(rootPaths.root, PLANS_DIR, planIdentity);

  return {
    root: rootPaths.root,
    planIdentity,
    planRoot,
    reviews: join(planRoot, 'reviews'),
    checkpoints: join(planRoot, 'checkpoints'),
    handoffs: join(planRoot, 'handoffs'),
    repairState: join(planRoot, 'repair-state'),
  };
}

// ─── Current Plan-scoped Paths ────────────────────────────────────────────────

/**
 * 当前 plan-scoped 路径结构。
 * 包含 plan 对象和路径信息。
 */
export interface CurrentPlanScopedPaths extends PlanScopedPaths {
  /** 当前 execution plan 对象 */
  plan: ExecutionPlan;
}

/**
 * 获取当前 plan 的 scoped 路径。
 * 读取 execution-plan.json 并派生路径。
 *
 * @param changeDir - 项目根目录
 * @returns 当前 plan-scoped 路径结构，如果 execution plan 不存在则返回 null
 * @throws 如果 execution plan 文件存在但无法解析
 */
export async function getCurrentPlanScopedPaths(changeDir: string): Promise<CurrentPlanScopedPaths | null> {
  const planPath = getOverlayPaths(changeDir).executionPlan;

  // 检查 execution plan 是否存在
  const exists = await fileExists(planPath);
  if (!exists) {
    return null;
  }

  // 读取并解析 execution plan
  let plan: ExecutionPlan;
  try {
    plan = await readJsonFile<ExecutionPlan>(planPath) as ExecutionPlan;
    if (!plan) {
      throw new Error('Execution plan file is empty or invalid');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read execution plan for SDD workspace: ${message}`);
  }

  // 派生 plan-scoped 路径
  const paths = getPlanScopedPaths(changeDir, plan);

  return {
    plan,
    ...paths,
  };
}

// ─── Record Directory Resolution ────────────────────────────────────────────────

/**
 * 收据目录解析结果。
 * 用于确定应该从哪个目录读取收据。
 */
export interface RecordDirectoryResolution {
  /** 收据目录路径 */
  directory: string;
  /** Legacy plan（如果正在从根级目录读取且需要过滤） */
  legacyPlan: ExecutionPlan | null;
}

/**
 * 解析收据目录。
 * 决定应该从 plan-scoped 目录还是根级目录读取收据。
 *
 * 逻辑：
 * 1. 尝试获取当前 plan-scoped 路径
 * 2. 如果 plan-scoped 目录存在，使用它
 * 3. 否则使用根级目录，并返回 legacy plan 用于过滤
 *
 * @param changeDir - 项目根目录
 * @param field - 收据类型字段（'reviews' | 'checkpoints' | 'handoffs' | 'repairState'）
 * @returns 收据目录解析结果
 */
export async function resolveRecordDirectory(
  changeDir: string,
  field: 'reviews' | 'checkpoints' | 'handoffs' | 'repairState',
): Promise<RecordDirectoryResolution> {
  let currentScope: CurrentPlanScopedPaths | null;
  try {
    currentScope = await getCurrentPlanScopedPaths(changeDir);
  } catch {
    // 恢复场景：如果 execution plan 格式错误，返回根级目录
    // 保持 checkpoint/handoff 读取可用，以便诊断信息能够显示
    return {
      directory: getOverlayPaths(changeDir)[field],
      legacyPlan: null,
    };
  }

  // 如果没有 execution plan，使用根级目录
  if (!currentScope) {
    return {
      directory: getOverlayPaths(changeDir)[field],
      legacyPlan: null,
    };
  }

  // 检查 plan-scoped 目录是否存在
  // 一旦 plan-scoped 目录存在，就不再混合使用根级收据
  const planRootExists = await directoryExists(currentScope.planRoot);
  if (planRootExists) {
    return {
      directory: currentScope[field],
      legacyPlan: null,
    };
  }

  // plan-scoped 目录不存在，使用根级目录并标记为 legacy
  return {
    directory: getOverlayPaths(changeDir)[field],
    legacyPlan: currentScope.plan,
  };
}

// ─── Plan Matching ──────────────────────────────────────────────────────────────

/**
 * 检查收据记录是否匹配当前 plan。
 *
 * @param record - 收据记录（包含 plan_hash 和 plan_revision 字段）
 * @param plan - 当前 execution plan
 * @returns 是否匹配
 */
export function hasMatchingPlan(
  record: { plan_hash?: string; plan_revision?: number } | null | undefined,
  plan: ExecutionPlan,
): boolean {
  if (!record) return false;
  return record.plan_hash === plan.hash && record.plan_revision === plan.revision;
}

// ─── Path Utilities ──────────────────────────────────────────────────────────────

/**
 * 确保收据目录存在。
 * 如果目录不存在则创建。
 *
 * @param dirPath - 目录路径
 */
export async function ensureReceiptDir(dirPath: string): Promise<void> {
  await ensureDir(dirPath);
}

/**
 * 安全文件名：替换非安全字符为下划线。
 *
 * @param value - 原始值
 * @returns 安全文件名
 */
export function safeName(value: string): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '_');
}
