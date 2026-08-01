/**
 * T3.1-T3.3: Closing 终端状态强制测试
 * 
 * 测试覆盖：
 * - T3.1: transitionState 入口阻断（closing/abandoned 状态下拒绝状态转换）
 * - T3.2: slash-commands 入口阻断（closing 状态下 /start 等命令直接返回提示）
 * - T3.3: 横向命令豁免（全面test/全面review 等横向命令在 closing 状态下仍可执行）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createWorkflowManager } from '../features/workflow-manager.js';
import { createWorkflowRouterTool } from '../tools/workflow-router.js';
import { fileExists, readJsonFile, writeJsonFile, ensureDir, removeFile } from '@opencode-flow-engine/shared';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

describe('T3.1: transitionState 入口阻断终端状态转换', () => {
  let testDir: string;
  const wf = createWorkflowManager();

  beforeEach(async () => {
    testDir = join(tmpdir(), `terminal-state-test-${randomUUID()}`);
    await ensureDir(testDir);
    await ensureDir(join(testDir, '.flow-engine', 'sflow'));
  });

  afterEach(async () => {
    await removeFile(testDir).catch(() => {});
  });

  it('closing 状态下再次 transition 被阻断（除了到 abandoned）', async () => {
    // Given: state.json 中 state='closing'
    await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
      state: 'closing',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // When: 调用 transitionState('executing')
    const result = await wf.transitionState(testDir, 'executing');

    // Then: 返回错误，state.json 未被修改
    expect(result.success).toBe(false);
    // 接受两种错误消息：Invalid transition 或 工作流已结束
    expect(result.error).toMatch(/Invalid transition|工作流已结束/);

    const state = await readJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'));
    expect(state.state).toBe('closing'); // 未被修改
  });

  it('closing 状态下可以转换到 abandoned', async () => {
    // Given: state.json 中 state='closing'
    await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
      state: 'closing',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // When: 调用 transitionState('abandoned')
    const result = await wf.transitionState(testDir, 'abandoned');

    // Then: 转换成功
    expect(result.success).toBe(true);
    expect(result.data?.to).toBe('abandoned');

    const state = await readJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'));
    expect(state.state).toBe('abandoned');
  });

  it('abandoned 状态下任意转换被阻断', async () => {
    // Given: state.json 中 state='abandoned'
    await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
      state: 'abandoned',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // When: 调用 transitionState('specifying')
    const result = await wf.transitionState(testDir, 'specifying');

    // Then: 返回错误，提示工作流已结束
    expect(result.success).toBe(false);
    // 接受两种错误消息：Invalid transition 或 工作流已结束
    expect(result.error).toMatch(/Invalid transition|工作流已结束/);

    const state = await readJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'));
    expect(state.state).toBe('abandoned'); // 未被修改
  });

  it('非终端状态下 transition 正常工作', async () => {
    // Given: state.json 中 state='executing'
    await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
      state: 'executing',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // When: 调用 transitionState('debugging')
    const result = await wf.transitionState(testDir, 'debugging');

    // Then: 转换成功
    expect(result.success).toBe(true);
    expect(result.data?.to).toBe('debugging');

    const state = await readJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'));
    expect(state.state).toBe('debugging');
  });
});

describe('T3.2: slash-commands 入口阻断终端状态路由', () => {
  let testDir: string;
  const routerTool = createWorkflowRouterTool();

  beforeEach(async () => {
    testDir = join(tmpdir(), `terminal-state-router-test-${randomUUID()}`);
    await ensureDir(testDir);
    await ensureDir(join(testDir, '.flow-engine', 'sflow'));
  });

  afterEach(async () => {
    await removeFile(testDir).catch(() => {});
  });

  it('closing 状态下 slash command 直接返回', async () => {
    // Given: state.json 中 state='closing'，用户输入 '/flow-review'
    await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
      state: 'closing',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // When: 调用 workflow_router tool
    const result = await routerTool.execute(
      { changeDir: testDir, intent: '审查代码' },
      { directory: testDir }
    );

    // Then: output 中包含 terminal: true、state: 'closing'、message: '工作流已结束'
    const output = JSON.parse(result.output);
    expect(output.success).toBe(false);
    expect(output.data?.terminal).toBe(true);
    expect(output.data?.state).toBe('closing');
    expect(output.data?.message).toContain('工作流已结束');
    expect(output.data?.message).toContain('closing');
  });

  it('abandoned 状态下自然语言 intent 被阻断', async () => {
    // Given: state.json 中 state='abandoned'，用户输入"执行任务"
    await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
      state: 'abandoned',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // When: 调用 workflow_router tool
    const result = await routerTool.execute(
      { changeDir: testDir, intent: '执行任务' },
      { directory: testDir }
    );

    // Then: output 中 stateGuardBlocked=true，reasons 包含工作流已结束（abandoned）
    const output = JSON.parse(result.output);
    expect(output.success).toBe(false);
    expect(output.data?.terminal).toBe(true);
    expect(output.data?.state).toBe('abandoned');
    expect(output.data?.message).toContain('工作流已结束');
    expect(output.data?.message).toContain('abandoned');
  });

  it('固定模板在两种终端状态中一致出现', async () => {
    // Given: 当前状态分别为 'closing' 与 'abandoned'
    const states = ['closing', 'abandoned'] as const;

    for (const state of states) {
      await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
        state,
        mode: 'full',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // When: 分别调用被阻断的入口
      const result = await routerTool.execute(
        { changeDir: testDir, intent: '执行任务' },
        { directory: testDir }
      );

      // Then: 错误消息均以"工作流已结束"开头，并包含具体状态名称
      const output = JSON.parse(result.output);
      expect(output.data?.message).toContain('工作流已结束');
      expect(output.data?.message).toContain(state);
      expect(output.data?.message).toContain('当前阶段不允许操作');
    }
  });
});

describe('T3.3: 横向命令豁免逻辑', () => {
  let testDir: string;
  const routerTool = createWorkflowRouterTool();

  beforeEach(async () => {
    testDir = join(tmpdir(), `terminal-state-horizontal-test-${randomUUID()}`);
    await ensureDir(testDir);
    await ensureDir(join(testDir, '.flow-engine', 'sflow'));
  });

  afterEach(async () => {
    await removeFile(testDir).catch(() => {});
  });

  it('全面test 命令在 closing 下仍可执行', async () => {
    // Given: state.json 中 state='closing'
    await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
      state: 'closing',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // When: 用户输入横向命令（全面test）
    const result = await routerTool.execute(
      { changeDir: testDir, intent: '全面test' },
      { directory: testDir }
    );

    // Then: 命令成功执行，不返回终端状态阻断错误
    const output = JSON.parse(result.output);
    expect(output.success).toBe(true);
    expect(output.data?.isHorizontalCommand).toBe(true);
    expect(output.data?.stateGuardBlocked).toBe(false);
    expect(output.data?.skill).toBe('test-engineer');
  });

  it('全面review 命令在 closing 下仍可执行', async () => {
    // Given: state.json 中 state='closing'
    await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
      state: 'closing',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // When: 用户输入横向命令（全面review）
    const result = await routerTool.execute(
      { changeDir: testDir, intent: '全面review' },
      { directory: testDir }
    );

    // Then: 命令成功执行，不返回终端状态阻断错误
    const output = JSON.parse(result.output);
    expect(output.success).toBe(true);
    expect(output.data?.isHorizontalCommand).toBe(true);
    expect(output.data?.stateGuardBlocked).toBe(false);
    expect(output.data?.skill).toBe('review-engineer');
  });

  it('AFK 命令在 closing 下仍可执行', async () => {
    // Given: state.json 中 state='closing'
    await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
      state: 'closing',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // When: 用户输入横向命令（AFK）
    const result = await routerTool.execute(
      { changeDir: testDir, intent: '开启AFK' },
      { directory: testDir }
    );

    // Then: 命令成功执行，不返回终端状态阻断错误
    const output = JSON.parse(result.output);
    expect(output.success).toBe(true);
    expect(output.data?.isHorizontalCommand).toBe(true);
    expect(output.data?.stateGuardBlocked).toBe(false);
  });

  it('非横向命令在 closing 状态下被阻断', async () => {
    // Given: state.json 中 state='closing'
    await writeJsonFile(join(testDir, '.flow-engine', 'sflow', 'state.json'), {
      state: 'closing',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // When: 用户输入非横向命令（执行任务）
    const result = await routerTool.execute(
      { changeDir: testDir, intent: '执行任务' },
      { directory: testDir }
    );

    // Then: 返回终端状态阻断错误
    const output = JSON.parse(result.output);
    expect(output.success).toBe(false);
    expect(output.data?.terminal).toBe(true);
    expect(output.data?.state).toBe('closing');
  });
});
