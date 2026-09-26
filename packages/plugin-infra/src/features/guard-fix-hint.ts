/**
 * Guard 门禁「修复指引」统一构造函数。
 *
 * 背景（D8 / GD-R4）：所有门禁阻断的 blockReason 必须以一行 `Fix:` 结尾，
 * `Fix:` 之后必须是可直接执行的入口（工具调用、Agent 名或命令），
 * 而不是「请修复后重试」这类空泛措辞。格式由本模块单点产出，避免各处手写字符串。
 *
 * 依赖方向：core ← shared ← plugin-infra（本文件属于 plugin-infra/features，纯函数，易测）。
 */

/** 门禁修复入口常量：可直接执行的下一步入口。 */
export const GUARD_FIX_ENTRIES = {
  /** 走正式合同 / 规划路径的入口 */
  contractBuilderRouter: 'workflow_router(agent="contract-builder")',
  /** 补齐 spec 工件的入口 */
  specWriterRouter: 'workflow_router(agent="spec-writer")',
} as const;

export type GuardFixEntry = string;

/**
 * 构造单行 `Fix:` 修复指引。
 *
 * @param reason 下一步要做什么（人类可读动作描述，例如 `走 exploring → specifying → bridging → approved-for-build`）
 * @param entry  可直接执行的入口（工具调用或 Agent 名），缺省为 contract-builder 路由入口
 * @returns 形如 `Fix: 运行 workflow_router(agent="contract-builder") 走 exploring → … .` 的单行字符串
 */
export function formatGuardFixHint(reason: string, entry: GuardFixEntry = GUARD_FIX_ENTRIES.contractBuilderRouter): string {
  const cleanReason = String(reason ?? '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
    .replace(/[.。;；\s]+$/, '');
  const cleanEntry = String(entry ?? '')
    .replace(/\s*\n\s*/g, ' ')
    .trim()
    .replace(/[.。;；\s]+$/, '');

  const action = cleanReason || '补齐缺失的门禁前置条件';
  const body = cleanEntry ? `运行 ${cleanEntry} ${action}` : action;
  return `Fix: ${body}.`;
}

/**
 * 把 `Fix:` 行追加到既有 blockReason 末尾。
 * 供后续批次（收据完整性 / 工件门禁，GD-R4）统一调用。
 */
export function appendGuardFixHint(blockReason: string, reason: string, entry?: GuardFixEntry): string {
  const base = String(blockReason ?? '').trim().replace(/[.。;；\s]+$/, '');
  return `${base}\n${formatGuardFixHint(reason, entry)}`;
}
