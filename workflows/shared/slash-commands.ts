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
}
