/**
 * Task 3: sFlow / iFlow 编排代理提示词 <projectDir> 标签块测试。
 *
 * 两个编排代理的 instructions 必须包含 projectDir 标签块，
 * 提示编排器在多项目工作目录下委派时注明任务所属项目目录。
 */
import { describe, expect, it } from 'bun:test';
import { createIFlowAgent } from '../../../../workflows/iflow/agents/iflow.js';
import { createSFlowAgent } from '../../../../workflows/sflow/agents/spec-flow.js';

const EXPECTED_BLOCK_TEXT =
  '委派子代理后会自动注入工作目录。如果工作目录存在多个项目，则委派时需要注明工作任务所处的项目目录。';

describe('编排代理 <projectDir> 标签块（Task 3）', () => {
  it('sFlow 编排代理 instructions 包含 <projectDir> 标签块', () => {
    const agent = createSFlowAgent('test-model');
    const instructions = String(agent.instructions);
    expect(instructions).toContain('<projectDir>');
    expect(instructions).toContain('</projectDir>');
    expect(instructions).toContain(EXPECTED_BLOCK_TEXT);
  });

  it('iFlow 编排代理 instructions 包含 <projectDir> 标签块', () => {
    const agent = createIFlowAgent('test-model');
    const instructions = String(agent.instructions);
    expect(instructions).toContain('<projectDir>');
    expect(instructions).toContain('</projectDir>');
    expect(instructions).toContain(EXPECTED_BLOCK_TEXT);
  });
});
