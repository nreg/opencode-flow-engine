/**
 * sFlow / iFlow 编排代理提示词 <projectDir> 规则块测试。
 *
 * 两个编排代理的 instructions 必须包含 projectDir 规则块，
 * 且明确机制：通过 call_flow_agent 的 projectDir 参数注明项目目录，
 * 单项目工作目录可省略。
 */
import { describe, expect, it } from 'bun:test';
import { createIFlowAgent } from '../../../../workflows/iflow/agents/iflow.js';
import { createSFlowAgent } from '../../../../workflows/sflow/agents/spec-flow.js';

const EXPECTED_BLOCK_TEXT =
  '委派子代理后会自动注入工作目录（<workDir> 标签）。如果工作目录存在多个项目，委派时必须通过 call_flow_agent 的 projectDir 参数注明工作任务所处的项目目录；提供后该值会以 <projectDir> 标签注入子代理提示词。单项目工作目录可省略该参数。';

describe('编排代理 <projectDir> 规则块（参数化注入）', () => {
  it('sFlow 编排代理 instructions 包含 <projectDir> 规则块', () => {
    const agent = createSFlowAgent('test-model');
    const instructions = String(agent.instructions);
    expect(instructions).toContain('<projectDir>');
    expect(instructions).toContain('</projectDir>');
    expect(instructions).toContain(EXPECTED_BLOCK_TEXT);
  });

  it('iFlow 编排代理 instructions 包含 <projectDir> 规则块', () => {
    const agent = createIFlowAgent('test-model');
    const instructions = String(agent.instructions);
    expect(instructions).toContain('<projectDir>');
    expect(instructions).toContain('</projectDir>');
    expect(instructions).toContain(EXPECTED_BLOCK_TEXT);
  });
});
