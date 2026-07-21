/**
 * Shared Horizontal Command Definitions
 *
 * These commands are independent of any workflow state (iFlow or SFlow).
 * They are detected at Phase 0 (before state routing) and bypass state guards.
 * Both workflow_router and iflow_router import from this single source of truth.
 *
 * SYNC: 主智能体 Phase 0 Intent Gate 表格必须与此文件同步。见：
 *   - workflows/iflow/agents/iflow.ts (Horizontal Commands 表格)
 *   - workflows/sflow/agents/spec-flow.ts (Phase 0 Intent Gate 表格)
 *
 * Inspired by flow-kit's lateral command system (L-/M-/I-/A- series).
 */

export interface HorizontalCommandEntry {
  pattern: RegExp;
  agent: string;
  action: string;
  description: string;
  tokens: string[];
}

/**
 * Horizontal commands that are available at any workflow state.
 * Matching at Phase 0 bypasses STATE_ALLOWED_AGENTS / IFLOW_STATE_AGENTS guards.
 */
export const HORIZONTAL_COMMANDS: HorizontalCommandEntry[] = [
  // --- test-engineer (全面测试) ---
  {
    pattern: /全面.*test|全面.*测试|full.*test|完整.*测试|全线.*测|彻底.*测|测试所有|run.*all.*test|comprehensive.*test|5轮.*测试/i,
    agent: 'test-engineer',
    action: 'full-test',
    description: '全面测试（5 轮测试金字塔）',
    tokens: ['全面test', '全面测试', 'full test', '完整测试', '全线测试', '彻底测试', '测试所有', 'comprehensive test', '5轮测试'],
  },
  {
    pattern: /只测性能|只测安全|只测兼容|只测功能|只测可观测|只跑R1|只跑R2|只跑R3|只跑R4|只跑R5|只跑.*test|只跑.*测试|partial.*test/i,
    agent: 'test-engineer',
    action: 'partial-test',
    description: '部分测试（指定轮次）',
    tokens: ['只测', '只跑R', '部分测试', 'partial test'],
  },

  // --- review-engineer (全面审查) ---
  {
    pattern: /全面.*review|全面.*审查|full.*review|完整.*审查|彻底.*审查|全线.*审|审查所有|代码审计|code.*audit|comprehensive.*review|3轮.*审查/i,
    agent: 'review-engineer',
    action: 'full-review',
    description: '全面审查（3 轮审查）',
    tokens: ['全面review', '全面审查', 'full review', '完整审查', '彻底审查', '代码审计', 'code audit', 'comprehensive review', '3轮审查'],
  },
  {
    pattern: /只看代码质量|只看代码|只看UI|只看视觉|只看合规|只看R1|只看R2|只看R3|只看R4|只看.*质量|只看.*合规|partial.*review/i,
    agent: 'review-engineer',
    action: 'partial-review',
    description: '部分审查（指定轮次）',
    tokens: ['只看', '只看R', '部分审查', 'partial review'],
  },
];

/**
 * Check if user intent matches a horizontal command.
 * Returns the matched entry or null.
 */
export function matchHorizontalCommand(intent: string): HorizontalCommandEntry | null {
  if (!intent) return null;
  for (const cmd of HORIZONTAL_COMMANDS) {
    if (cmd.pattern.test(intent)) {
      return cmd;
    }
  }
  return null;
}