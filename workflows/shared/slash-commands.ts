/**
 * Slash Command Registration for Shared Agents
 *
 * Registers /flow-test and /flow-review slash commands
 * that dispatch to test-engineer and review-engineer.
 */

import type { Config } from '@opencode-ai/plugin';

/**
 * 命令名称常量
 */
export const FLOW_TEST_COMMAND = 'flow-test';
export const FLOW_REVIEW_COMMAND = 'flow-review';
export const FLOW_INTEL_COMMAND = 'flow-intel';
export const FLOW_ARCHITECT_COMMAND = 'flow-architect';
export const FLOW_EVOLVE_COMMAND = 'flow-evolve';
export const FLOW_HEALTH_COMMAND = 'flow-health';
export const FLOW_RESTYLE_COMMAND = 'flow-restyle';

/**
 * /flow-test 命令模板
 * 教导 agent 如何处理该命令
 */
function flowTestCommandTemplate(): string {
  return `"/flow-test" command was invoked.

<flow_command_arguments>
$ARGUMENTS
</flow_command_arguments>

Use call_flow_agent to handle this command:
- If the arguments are empty or "full", call call_flow_agent with subagent_type="test-engineer" and prompt="对本次 change 进行全面 test。全量 5 轮（R1 功能测试、R2 性能测试、R3 安全测试、R4 兼容性测试、R5 可观测性验证）。"
- If the arguments specify a scope (e.g. "性能", "安全", "R2", "只测性能"), call call_flow_agent with subagent_type="test-engineer" and prompt="对本次 change 进行部分 test。范围：<arguments>。"
- Report the test result summary back to the user.`;
}

/**
 * /flow-review 命令模板
 */
function flowReviewCommandTemplate(): string {
  return `"/flow-review" command was invoked.

<flow_command_arguments>
$ARGUMENTS
</flow_command_arguments>

Use call_flow_agent to handle this command:
- If the arguments are empty or "full", call call_flow_agent with subagent_type="review-engineer" and prompt="对本次 change 进行全面 review。R1 Spec 合规审查 + R2 代码质量审查 + R3 UI 视觉审查。"
- If the arguments specify a scope (e.g. "代码质量", "UI", "R1", "只看代码质量"), call call_flow_agent with subagent_type="review-engineer" and prompt="对本次 change 进行部分 review。范围：<arguments>。"
- Report the review result summary back to the user.`;
}

/**
 * /flow-intel 命令模板
 * 入场扫描命令，扫描代码库生成项目级 CONTEXT.md
 */
function flowIntelCommandTemplate(): string {
  return `"/flow-intel" command was invoked.

<flow_command_arguments>
$ARGUMENTS
</flow_command_arguments>

This is the entry scan command for new projects.
Use call_flow_agent to handle this command:
- If no arguments, run a full intel scan: call call_flow_agent with subagent_type="flow-intel" and prompt="对当前项目进行完整的入场扫描（I-intel-scan）。探测既有文档 → 元信息 6 项 → 生成 CONTEXT.md → 更新 STATE。"
- Report the scan result summary back to the user.`;
}

/**
 * /flow-architect 命令模板
 * 架构文档命令，建立或重构项目级架构文档
 */
function flowArchitectCommandTemplate(): string {
  return `"/flow-architect" command was invoked.

<flow_command_arguments>
$ARGUMENTS
</flow_command_arguments>

This is the architecture documentation command.
Use call_flow_agent to handle this command:
- If no arguments, run a full architecture review: call call_flow_agent with subagent_type="flow-architect" and prompt="对当前项目进行完整的架构梳理（A-architect）。判定模式 → 系统概览 → 模块清单 + 依赖规则 → ADR 列表 → 跨模块契约 → 扩展点 → 写入 + 备份。"
- Report the architecture result summary back to the user.`;
}

/**
 * /flow-evolve 命令模板
 * 架构增量同步命令，从归档 change 中同步架构沉淀到 CONTEXT.md
 */
function flowEvolveCommandTemplate(): string {
  return `"/flow-evolve" command was invoked.

<flow_command_arguments>
$ARGUMENTS
</flow_command_arguments>

This is the architecture evolution command - syncs architecture decisions from archived changes.
Use call_flow_agent to handle this command:
- If no arguments, run a full architecture evolution: call call_flow_agent with subagent_type="flow-evolve" and prompt="对当前项目进行架构增量同步（A-evolve）。确定扫描范围 → 抽取 § 9 → 聚合分类 5 类 → 逐项 review → 生成 patch → 写入 → 报告。"
- Report the evolution result summary back to the user.`;
}

/**
 * /flow-health 命令模板
 * 健康巡检命令，代码库健康检查 + 技术债扫描
 */
function flowHealthCommandTemplate(): string {
  return `"/flow-health" command was invoked.

<flow_command_arguments>
$ARGUMENTS
</flow_command_arguments>

This is the codebase health check command.
Use call_flow_agent to handle this command:
- If no arguments, run a full health check: call call_flow_agent with subagent_type="flow-health" and prompt="对当前项目进行完整的健康巡检（M-health）。选模式 → 冗余巡检 → AI 自评 6+6 维 → 输出健康报告 → 反哺工件。"
- Report the health check result summary back to the user.`;
}

/**
 * /flow-restyle 命令模板
 * 一键换调性命令，保留功能不变只换视觉风格（仅前端项目）
 */
function flowRestyleCommandTemplate(): string {
  return `"/flow-restyle" command was invoked.

<flow_command_arguments>
$ARGUMENTS
</flow_command_arguments>

This is the visual restyle command - only available for frontend projects.
Use call_flow_agent to handle this command:
- If no arguments, run a full restyle: call call_flow_agent with subagent_type="flow-restyle" and prompt="对当前项目进行一键换调性（L-restyle）。识别调性 v1 → 切换确认 → 影响面扫描 → 写 UI-DESIGN v2 → 拆任务 → 风险通告。"
- Report the restyle result summary back to the user.`;
}

/**
 * 注册 slash 命令到 plugin config
 * 借鉴 goal-plugin 的 registerDesktopCommand 模式
 */
export function registerFlowCommands(config: Config): void {
  config.command ??= {};

  // 注册 /flow-test
  if (!config.command[FLOW_TEST_COMMAND]) {
    config.command[FLOW_TEST_COMMAND] = {
      description: '全面测试（5 轮测试金字塔：功能/性能/安全/兼容/可观测）',
      template: flowTestCommandTemplate(),
    };
  }

  // 注册 /flow-review
  if (!config.command[FLOW_REVIEW_COMMAND]) {
    config.command[FLOW_REVIEW_COMMAND] = {
      description: '全面审查（3 轮审查：Spec 合规/代码质量/UI 视觉）',
      template: flowReviewCommandTemplate(),
    };
  }

  // 注册 /flow-intel
  if (!config.command[FLOW_INTEL_COMMAND]) {
    config.command[FLOW_INTEL_COMMAND] = {
      description: '入场扫描：扫描代码库生成项目级 CONTEXT.md',
      template: flowIntelCommandTemplate(),
    };
  }

  // 注册 /flow-architect
  if (!config.command[FLOW_ARCHITECT_COMMAND]) {
    config.command[FLOW_ARCHITECT_COMMAND] = {
      description: '架构文档：建立或重构项目级架构文档（ARCHITECTURE.md）',
      template: flowArchitectCommandTemplate(),
    };
  }

  // 注册 /flow-evolve
  if (!config.command[FLOW_EVOLVE_COMMAND]) {
    config.command[FLOW_EVOLVE_COMMAND] = {
      description: '架构增量同步：从归档 change 中同步架构沉淀到 CONTEXT.md',
      template: flowEvolveCommandTemplate(),
    };
  }

  // 注册 /flow-health
  if (!config.command[FLOW_HEALTH_COMMAND]) {
    config.command[FLOW_HEALTH_COMMAND] = {
      description: '健康巡检：代码库健康检查，产出健康报告 + 技术债扫描',
      template: flowHealthCommandTemplate(),
    };
  }

  // 注册 /flow-restyle
  if (!config.command[FLOW_RESTYLE_COMMAND]) {
    config.command[FLOW_RESTYLE_COMMAND] = {
      description: '一键换调性：保留功能不变，只换视觉风格（仅前端项目）',
      template: flowRestyleCommandTemplate(),
    };
  }
}
