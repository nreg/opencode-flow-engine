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

  // --- flow-evolve (架构增量同步) ---
  {
    pattern: /同步.*架构|架构.*演进|evolve|架构.*同步|同步.*CONTEXT|同步.*沉淀|整理.*沉淀|架构.*沉淀/i,
    agent: 'flow-evolve',
    action: 'evolve-architecture',
    description: '架构增量同步：从归档 change 中同步架构沉淀到 CONTEXT.md',
    tokens: ['同步架构', '架构演进', 'evolve', '同步 CONTEXT', '整理沉淀'],
  },

  // --- flow-architect (架构文档) ---
  {
    pattern: /建立.*架构|写.*架构文档|架构.*文档|ARCHITECTURE|建立.*ARCHITECTURE|重构.*架构|架构.*重构|architecture.*doc|write.*architecture/i,
    agent: 'flow-architect',
    action: 'create-architecture',
    description: '建立或重构项目架构文档（ARCHITECTURE.md）',
    tokens: ['建立架构', '架构文档', 'ARCHITECTURE', '重构架构', 'architecture doc'],
  },

  // --- flow-health (健康巡检) ---
  {
    pattern: /健康.*巡检|健康.*检查|health.*check|代码.*健康|项目.*健康|巡检.*代码|代码.*体检|codebase.*health|health.*inspection/i,
    agent: 'flow-health',
    action: 'health-check',
    description: '健康巡检：冗余检测 + AI 自评 6+6 维 + 反哺工件',
    tokens: ['健康巡检', '健康检查', 'health check', '代码健康', '项目健康', '代码体检', 'codebase health'],
  },

  // --- flow-restyle (一键换调性) ---
  {
    pattern: /换调性|改风格|换风格|restyle|重做视觉|换皮|redesign|重新设计.*视觉/i,
    agent: 'flow-restyle',
    action: 'restyle',
    description: '一键换调性：保留功能不变，只换视觉风格（仅前端项目）',
    tokens: ['换调性', '改风格', 'restyle', '换皮', 'redesign'],
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