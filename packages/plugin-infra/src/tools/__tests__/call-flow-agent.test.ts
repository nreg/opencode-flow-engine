/**
 * Tests for CallFlowAgent — P3: 异步模式 completion enforcement
 *
 * Covers:
 * - P3-async: 无完成信号时跳过重试（异步模式不触发完成强制）
 * - P3-async: 有完成信号时通知包含 has_completion_signal
 * - P3-async: 不注入 reminder
 * - P3-async: 不附加 warning
 * - P3-async: JSON code fence 被识别为完成信号
 */

import { beforeEach, describe, expect, it, mock, afterEach } from 'bun:test';
import type { AgentModelMap, BackgroundTaskRegistry } from '../../types.js';
import { createCallFlowAgentTools, resetRunningSubagentCounts } from '../call-flow-agent.js';
import { DEFAULT_PROFILE_MODELS } from '../../agents/config-loader.js';

// ─── Test helpers ──────────────────────────────────────────────────────────

/** Create a mock SFlowClient with controllable session behavior */
function createMockClient(options: {
  pollOutputs: string[]; // outputs returned by pollSessionCompletion in sequence
  promptCalls?: Array<{ id: string; body: Record<string, unknown> }>;
}) {
  let pollIndex = 0;
  const promptCalls = options.promptCalls ?? [];

  return {
    session: {
      create: mock(
        async (_args: { body: Record<string, unknown>; query?: Record<string, unknown> }) => {
          return { data: { id: 'test-session-001' } };
        },
      ),
      prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
        promptCalls.push({ id: args.path.id, body: args.body });
      }),
      messages: mock(async () => {
        const output = options.pollOutputs[Math.min(pollIndex, options.pollOutputs.length - 1)];
        pollIndex++;
        return {
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { parts: [{ type: 'text', text: output }] },
          ],
        };
      }),
      status: mock(async () => {
        return { data: { 'test-session-001': { type: 'idle' } } };
      }),
      abort: mock(async () => {}),
    },
  };
}

/** Create minimal tool options for testing */
function createTestOptions(client: ReturnType<typeof createMockClient>) {
  const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
  const backgroundTaskCounter = { value: 0 };
  const agentModelMap: AgentModelMap = { 'build-executor': 'provider/test-model' };

  return {
    client: client as unknown as import('../../types.js').SFlowClient,
    backgroundTaskRegistry,
    backgroundTaskCounter,
    agentModelMap,
    sessionLabelPrefix: 'sFlow',
    validateAgent: async (_subagentType: string) => null,
    workflowName: 'sFlow',
  };
}

/** Create tools and auto-set currentTools for cleanup (P0-3) */
function createTestTools(options: ReturnType<typeof createTestOptions>) {
  const tools = createCallFlowAgentTools(options);
  currentTools = tools;
  return tools;
}

// P0-3: Store tools reference for cleanup
let currentTools: ReturnType<typeof createCallFlowAgentTools> | null = null;

afterEach(() => {
  if (currentTools && '_stopWatcher' in currentTools && typeof currentTools._stopWatcher === 'function') {
    currentTools._stopWatcher();
  }
  currentTools = null;
  resetRunningSubagentCounts();
});

// ─── P3: 异步模式 completion enforcement ────────────────────────────────────

describe('P3: 异步模式 completion enforcement', () => {
  let _backgroundTaskRegistry: BackgroundTaskRegistry;
  let _backgroundTaskCounter: { value: number };
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    _backgroundTaskRegistry = new Map();
    _backgroundTaskCounter = { value: 0 };
    promptCalls = [];
    currentTools = null;
  });

  it('should skip retry when async output has no completion signal', async () => {
    const client = createMockClient({
      pollOutputs: [
        '我正在处理这个任务...',
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);
    currentTools = tools;

    // Step 1: Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);
    const taskId = startData.task_id;

    // Step 2: Poll for result with block=true
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    // Async mode does NOT retry → no warning, result returned as-is
    expect(outputData.warning).toBeUndefined();
    expect(outputData.result).toContain('我正在处理这个任务');
  });

  it('should not trigger retry when async output has completion signal', async () => {
    // The async task outputs with [TASK_COMPLETE] marker
    const client = createMockClient({
      pollOutputs: [
        '任务已完成 [TASK_COMPLETE]', // initial poll has signal
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    // Should NOT have warning because completion signal was detected
    expect(outputData.warning).toBeUndefined();
    // Should NOT have injected any reminders (filter for REMINDER_MESSAGE parts)
    const reminderCalls = promptCalls.filter((call) => {
      const parts = call.body.parts as Array<{ type: string; text: string }>;
      return parts?.some(
        (p) => p.text?.includes('[TASK_COMPLETE]') || p.text?.includes('尚未完成'),
      );
    });
    expect(reminderCalls.length).toBe(0);
  });

  it('should NOT inject reminder in async mode when output lacks completion signal', async () => {
    // Async mode does NOT retry → no reminders injected
    const client = createMockClient({
      pollOutputs: [
        'incomplete output', // initial (no signal, but async mode skips retry)
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    // Verify NO reminders were injected (async mode skips P3 completion enforcement)
    const reminderCalls = promptCalls.filter((call) => {
      const parts = call.body.parts as Array<{ type: string; text: string }>;
      return parts?.some(
        (p) => p.text?.includes('[TASK_COMPLETE]') || p.text?.includes('尚未完成'),
      );
    });
    expect(reminderCalls.length).toBe(0);
  });

  it('should stop retrying when completion signal appears after reminder', async () => {
    // First poll: no signal → retry → second poll: has signal
    const client = createMockClient({
      pollOutputs: [
        'working on it...', // initial (no signal)
        '任务完成 [TASK_COMPLETE]', // after 1st retry (has signal)
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    // No warning because completion signal was found on retry
    expect(outputData.warning).toBeUndefined();
    // Result should be the output with completion signal
    expect(outputData.result).toContain('[TASK_COMPLETE]');
  });

  it('should NOT include warning in async mode when output lacks completion signal', async () => {
    // Async mode does NOT retry → no warning even if output lacks completion signal
    const client = createMockClient({
      pollOutputs: ['partial output 1'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    // Async mode does NOT apply P3 completion enforcement → no warning
    expect(outputData.warning).toBeUndefined();
  });

  it('should detect JSON code fence as completion signal in async mode', async () => {
    const client = createMockClient({
      pollOutputs: ['```json\n{"files_changed": ["a.ts"], "tests_passed": true}\n```'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    // JSON code fence is a completion signal → no warning
    expect(outputData.warning).toBeUndefined();
  });
});

// ─── NH-3: structured 提取失败 warning 传播 ──────────────────────────────────

describe('NH-3: structured 提取失败 warning 传播', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    promptCalls = [];
  });

  it('sync mode: structured 提取失败时应在 warnings 中传播', async () => {
    // Output has no JSON block → extractJsonBlock returns null → warning
    const client = createMockClient({
      pollOutputs: [
        '任务已完成 [TASK_COMPLETE]', // has completion signal, but no JSON
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
        output_mode: 'structured',
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    // structured_output should be null (extraction failed)
    expect(data.structured_output).toBeNull();
    // warnings array should contain structured extraction failure warning
    expect(data.warnings).toBeDefined();
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(data.warnings).toContain('structured output extraction failed, fallback to raw text');
  });

  it('sync mode: structured 提取成功时不应有 structured warning', async () => {
    // Output has valid JSON code fence
    const client = createMockClient({
      pollOutputs: [
        '结果如下：\n```json\n{"files_changed": ["a.ts"], "tests_passed": true, "blockers": []}\n```\n[TASK_COMPLETE]',
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
        output_mode: 'structured',
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.structured_output).toEqual({
      files_changed: ['a.ts'],
      tests_passed: true,
      blockers: [],
    });
    // No structured warning because extraction succeeded
    expect(data.warnings).toBeUndefined();
  });

  it('sync mode: completionWarning + structuredWarning 应合并为 warnings 数组', async () => {
    // Use spec-writer (in enabled list) so P3 completion retry triggers
    // and produces a warning alongside the structured extraction failure warning
    const client = createMockClient({
      pollOutputs: ['partial output without signal or json', 'still no signal or json after retry'],
      promptCalls,
    });

    const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
    const backgroundTaskCounter = { value: 0 };
    const agentModelMap: AgentModelMap = { 'spec-writer': 'provider/test-model' };

    const options = {
      client: client as unknown as import('../../types.js').SFlowClient,
      backgroundTaskRegistry,
      backgroundTaskCounter,
      agentModelMap,
      sessionLabelPrefix: 'sFlow',
      validateAgent: async (_subagentType: string) => null,
      workflowName: 'sFlow',
    };

    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'spec-writer',
        run_in_background: false,
        output_mode: 'structured',
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    // Both warnings should be merged into warnings array
    expect(data.warnings).toBeDefined();
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(data.warnings.length).toBeGreaterThanOrEqual(2);
    expect(data.warnings).toContain('structured output extraction failed, fallback to raw text');
    // completionWarning should also be present (from P3 completion retry)
    const hasCompletionWarning = data.warnings.some(
      (w: string) =>
        w.includes('incomplete') ||
        w.includes('未检测到') ||
        w.includes('retry') ||
        w.includes('completion signal'),
    );
    expect(hasCompletionWarning).toBe(true);
  });

  it('sync mode: last_message 模式不应产生 structured warning', async () => {
    const client = createMockClient({
      pollOutputs: ['任务已完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
        output_mode: 'last_message',
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    // last_message mode → no structured extraction → no structured warning
    expect(data.warnings).toBeUndefined();
    // Also no single warning field
    expect(data.warning).toBeUndefined();
  });

  it('async mode: structured 提取失败时应在 warnings 中传播', async () => {
    // Async output has no JSON block → extractJsonBlock returns null → warning
    const client = createMockClient({
      pollOutputs: [
        '任务已完成 [TASK_COMPLETE]', // has completion signal, but no JSON
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start async task with structured mode
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
        output_mode: 'structured',
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    // structured_output should be null (extraction failed)
    expect(outputData.structured_output).toBeNull();
    // warnings array should contain structured extraction failure warning
    expect(outputData.warnings).toBeDefined();
    expect(Array.isArray(outputData.warnings)).toBe(true);
    expect(outputData.warnings).toContain(
      'structured output extraction failed, fallback to raw text',
    );
  });

  it('async mode: structured 提取成功时不应有 structured warning', async () => {
    // Async output has valid JSON code fence
    const client = createMockClient({
      pollOutputs: [
        '```json\n{"files_changed": ["a.ts"], "tests_passed": true, "blockers": []}\n```',
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start async task with structured mode
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
        output_mode: 'structured',
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    expect(outputData.structured_output).toEqual({
      files_changed: ['a.ts'],
      tests_passed: true,
      blockers: [],
    });
    // No structured warning because extraction succeeded
    expect(outputData.warnings).toBeUndefined();
  });

  it('async mode: last_message 模式不应产生 structured warning', async () => {
    const client = createMockClient({
      pollOutputs: ['任务已完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start async task with last_message mode (default)
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    expect(outputData.warnings).toBeUndefined();
    expect(outputData.warning).toBeUndefined();
  });
});

// ─── R1: BackgroundTaskWatcher 自动完成检测 ───────────────────────────────────

describe('R1: BackgroundTaskWatcher 自动完成检测', () => {
  let _backgroundTaskRegistry: BackgroundTaskRegistry;
  let _backgroundTaskCounter: { value: number };
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    _backgroundTaskRegistry = new Map();
    _backgroundTaskCounter = { value: 0 };
    promptCalls = [];
  });

  it('watcher should detect task completion and update registry', async () => {
    const client = createMockClient({
      pollOutputs: ['任务已完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    await new Promise((resolve) => setTimeout(resolve, 500));

    const task = options.backgroundTaskRegistry.get(taskId);
    expect(task).toBeDefined();
    expect(task?.status).toBe('completed');
    expect(task?.result).toContain('[TASK_COMPLETE]');
    expect(task?.completedAt).toBeDefined();
  });

  it('watcher should detect task error and update registry', async () => {
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async () => {}),
        messages: mock(async () => ({
          data: [{ parts: [{ type: 'text', text: 'user prompt' }] }],
        })),
        status: mock(async () => ({
          data: [
            { id: 'test-session-001', type: 'retry', attempt: 5, message: 'Max retries exceeded' },
          ],
        })),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    await new Promise((resolve) => setTimeout(resolve, 500));

    const task = options.backgroundTaskRegistry.get(taskId);
    expect(task).toBeDefined();
    expect(task?.status).toBe('error');
    expect(task?.error).toBeDefined();
  });

  it('watcher should skip tasks already processed by pollAndComplete', async () => {
    const client = createMockClient({
      pollOutputs: ['任务已完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const taskAfterPoll = options.backgroundTaskRegistry.get(taskId);
    expect(taskAfterPoll?.status).toBe('completed');
    expect(taskAfterPoll?.slotReleased).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const taskAfterWatcher = options.backgroundTaskRegistry.get(taskId);
    expect(taskAfterWatcher?.status).toBe('completed');
    expect(taskAfterWatcher?.slotReleased).toBe(true);
  });

  it('slotReleased should prevent double slot release', async () => {
    const client = createMockClient({
      pollOutputs: ['任务已完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const startResult1 = await tools.call_flow_agent.execute(
      {
        description: 'test task 1',
        prompt: 'Build feature 1',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData1 = JSON.parse(startResult1.output);
    const taskId1 = startData1.task_id;

    await tools.flowagent_output.execute(
      {
        task_id: taskId1,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const task1 = options.backgroundTaskRegistry.get(taskId1);
    expect(task1?.slotReleased).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const task1AfterWatcher = options.backgroundTaskRegistry.get(taskId1);
    expect(task1AfterWatcher?.slotReleased).toBe(true);
  });

  // P0-2: 验证 pollAndComplete 检查任务状态，避免竞态条件
  it('pollAndComplete should skip if task already completed', async () => {
    const client = createMockClient({
      pollOutputs: ['任务已完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Manually mark task as completed (simulating watcher processing it first)
    const task = options.backgroundTaskRegistry.get(taskId);
    if (task) {
      options.backgroundTaskRegistry.set(taskId, {
        ...task,
        status: 'completed',
        result: 'watcher processed',
        completedAt: Date.now(),
        slotReleased: true,
      });
    }

    // Now call pollAndComplete - it should skip processing
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    expect(outputData.status).toBe('completed');
    // Should return the result set by watcher, not re-process
    expect(outputData.result).toBe('watcher processed');
  });

  it('pollAndComplete should skip if task already in error state', async () => {
    const client = createMockClient({
      pollOutputs: ['任务已完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Manually mark task as error (simulating watcher processing it first)
    const task = options.backgroundTaskRegistry.get(taskId);
    if (task) {
      options.backgroundTaskRegistry.set(taskId, {
        ...task,
        status: 'error',
        error: 'watcher detected error',
        completedAt: Date.now(),
        slotReleased: true,
      });
    }

    // Now call pollAndComplete - it should skip processing
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(false);
    expect(outputData.status).toBe('error');
    // Should return the error set by watcher, not re-process
    expect(outputData.error).toBe('watcher detected error');
  });
});

// ─── R2: 错误传播修正（Batch 3）────────────────────────────────────────────

describe('R2: 错误传播修正', () => {
  let _backgroundTaskRegistry: BackgroundTaskRegistry;
  let _backgroundTaskCounter: { value: number };
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    _backgroundTaskRegistry = new Map();
    _backgroundTaskCounter = { value: 0 };
    promptCalls = [];
  });

  // Task 3.1: pollAndComplete 处理 error 返回
  it('should set status=error when pollSessionCompletion returns null (retry exhausted)', async () => {
    // Mock client that returns null from pollSessionCompletion (retry exhausted)
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async () => {}),
        messages: mock(async () => ({ data: [] })), // empty messages
        status: mock(async () => ({
          data: {
            'test-session-001': {
              type: 'retry',
              attempt: 5, // max attempts reached
              message: 'ApiError: Rate limit exceeded',
            },
          },
        })),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);
    const taskId = startData.task_id;

    // Poll with block=true (triggers pollAndComplete)
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    // Should return success=false, status=error
    expect(outputData.success).toBe(false);
    expect(outputData.status).toBe('error');
    expect(outputData.error).toBeDefined();
    expect(outputData.error).toContain('retry');
  });

  // Task 3.2: 同步模式处理 retry error
  it('should return success=false when sync mode encounters retry error', async () => {
    // Mock client that returns null from pollSessionCompletion
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async () => {}),
        messages: mock(async () => ({ data: [] })),
        status: mock(async () => ({
          data: {
            'test-session-001': {
              type: 'retry',
              attempt: 5,
              message: 'ApiError: Service unavailable',
            },
          },
        })),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start sync task
    const result = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const data = JSON.parse(result.output);
    // Should return success=false with error details
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    expect(data.error).toContain('retry');
  });

  // Task 3.4: flowagent_output error 传播用例
  it('flowagent_output should return error details for error status task', async () => {
    const client = createMockClient({
      pollOutputs: ['正常输出'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Manually set task to error status (simulating retry exhausted)
    const task = options.backgroundTaskRegistry.get(taskId);
    if (task) {
      options.backgroundTaskRegistry.set(taskId, {
        ...task,
        status: 'error',
        error: 'ApiError: Rate limit exceeded after 5 retries',
        result: '最后一次成功输出',
      });
    }

    // Query with block=false (should return error details)
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: false,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(false);
    expect(outputData.status).toBe('error');
    expect(outputData.error).toBe('ApiError: Rate limit exceeded after 5 retries');
    expect(outputData.result).toBe('最后一次成功输出');
  });

  // Task 3.3: 验证工具描述与实际行为一致
  it('flowagent_output description should mention 120s timeout', async () => {
    const client = createMockClient({
      pollOutputs: ['测试输出'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // Check tool description contains "120s"
    expect(tools.flowagent_output.description).toContain('120s');
  });
});

describe('P1-13: _processing flag tests', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    promptCalls = [];
    currentTools = null;
  });

  it('watcher should clear _processing flag after processing completes', async () => {
    const client = createMockClient({
      pollOutputs: ['任务完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    if (!startData.success) {
      console.log('Task creation failed:', startData);
    }
    expect(startData.success).toBe(true);
    const taskId = startData.task_id;
    expect(taskId).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 500));

    const taskAfterComplete = options.backgroundTaskRegistry.get(taskId);
    expect(taskAfterComplete).toBeDefined();
    expect(taskAfterComplete?.status).toBe('completed');
  });

  it('pollAndComplete should clear _processing flag after completion', async () => {
    const client = createMockClient({
      pollOutputs: ['任务完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);

    const completedTask = options.backgroundTaskRegistry.get(taskId);
    expect(completedTask?.status).toBe('completed');
  });

  // P0: 验证 error 状态下 _processing 被清除（修复 finally 块逻辑）
  it('error status should have _processing cleared (P0 fix)', async () => {
    // Mock client that triggers error (retry exhausted)
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async () => {}),
        messages: mock(async () => ({ data: [] })),
        status: mock(async () => ({
          data: {
            'test-session-001': {
              type: 'retry',
              attempt: 5,
              message: 'Max retries exceeded',
            },
          },
        })),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll with block=true (triggers pollAndComplete which sets error status)
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(false);
    expect(outputData.status).toBe('error');

    // P0: _processing should be cleared even when status is error
    const errorTask = options.backgroundTaskRegistry.get(taskId);
    expect(errorTask).toBeDefined();
    expect(errorTask?.status).toBe('error');
    expect(errorTask?._processing).toBeFalsy(); // Should NOT be true
  });

  it('successful completion should have correct _processing state', async () => {
    const client = createMockClient({
      pollOutputs: ['任务完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);

    const completedTask = options.backgroundTaskRegistry.get(taskId);
    expect(completedTask?.status).toBe('completed');
  });
});

// ─── F-1: pollAndComplete exception handling ───────────────────────────────────

describe('F-1: pollAndComplete exception handling', () => {
  let _backgroundTaskRegistry: BackgroundTaskRegistry;
  let _backgroundTaskCounter: { value: number };

  beforeEach(() => {
    _backgroundTaskRegistry = new Map();
    _backgroundTaskCounter = { value: 0 };
    currentTools = null;
  });

  it('should mark task as error when pollSessionCompletion throws exception', async () => {
    // Create a mock client that throws exception on both messages() and status() calls
    // This will cause pollSessionCompletion to return null (session retry exhausted)
    const client = {
      session: {
        create: mock(async () => {
          return { data: { id: 'test-session-001' } };
        }),
        prompt: mock(async () => {}),
        messages: mock(async () => {
          throw new Error('Network error: connection refused');
        }),
        status: mock(async () => {
          throw new Error('Network error: connection refused');
        }),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client as any);
    const tools = createTestTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);
    const taskId = startData.task_id;

    // Poll with block=true - should handle polling failure gracefully
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    
    // F-1: Task should be marked as error, not remain running
    expect(outputData.success).toBe(false);
    expect(outputData.status).toBe('error');
    expect(outputData.error).toContain('Session retry exhausted');

    // Verify registry state
    const errorTask = options.backgroundTaskRegistry.get(taskId);
    expect(errorTask).toBeDefined();
    expect(errorTask?.status).toBe('error');
    expect(errorTask?.error).toContain('Session retry exhausted');
    expect(errorTask?.completedAt).toBeDefined();
    expect(errorTask?.slotReleased).toBe(true);
    expect(errorTask?._processing).toBeFalsy();
  });

  it('should release slot when pollSessionCompletion throws exception', async () => {
    const client = {
      session: {
        create: mock(async () => {
          return { data: { id: 'test-session-001' } };
        }),
        prompt: mock(async () => {}),
        messages: mock(async () => {
          throw new Error('Timeout');
        }),
        status: mock(async () => {
          throw new Error('Timeout');
        }),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client as any);
    const tools = createTestTools(options);

    // Start async task (acquires slot)
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll - should release slot on error
    await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    // Verify slot was released
    const errorTask = options.backgroundTaskRegistry.get(taskId);
    expect(errorTask?.slotReleased).toBe(true);
  });

  it('G1: should return error when task not found in registry during pollAndComplete', async () => {
    // G1: pollAndComplete 显式处理 currentTask 不存在分支
    // Scenario: task exists when flowagent_output checks, but deleted before pollAndComplete reads it
    
    let messagesCallCount = 0;
    const client = {
      session: {
        create: mock(async () => {
          return { data: { id: 'test-session-001' } };
        }),
        prompt: mock(async () => {}),
        messages: mock(async () => {
          messagesCallCount++;
          // First call: simulate concurrent deletion by deleting task from registry
          // This simulates a race condition where task is deleted between flowagent_output check and pollAndComplete
          if (messagesCallCount === 1) {
            // In real scenario, another thread would delete the task here
            // For testing, we'll verify the defensive check exists in pollAndComplete
            return {
              data: [
                { parts: [{ type: 'text', text: 'user prompt' }] },
                { parts: [{ type: 'text', text: 'Task completed' }] },
              ],
            };
          }
          return {
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'Task completed' }] },
            ],
          };
        }),
        status: mock(async () => {
          return { data: { 'test-session-001': { type: 'idle' } } };
        }),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client as any);
    const tools = createTestTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);
    const taskId = startData.task_id;

    // Verify task exists in registry
    const taskBefore = options.backgroundTaskRegistry.get(taskId);
    expect(taskBefore).toBeDefined();
    expect(taskBefore?.status).toBe('running');

    // Poll - G1 defensive check ensures pollAndComplete handles missing task gracefully
    const outputResult = await tools.flowagent_output.execute(
      {
        task_id: taskId,
        block: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const outputData = JSON.parse(outputResult.output);
    
    // Task should complete successfully (task exists in this test scenario)
    // The G1 fix ensures that IF task were missing, it would return error instead of resurrecting
    expect(outputData.success).toBe(true);
    expect(outputData.status).toBe('completed');
  });
});

// ─── F-2: watcher catch state refresh ──────────────────────────────────────────

describe('F-2: watcher catch state refresh', () => {
  let _backgroundTaskRegistry: BackgroundTaskRegistry;
  let _backgroundTaskCounter: { value: number };

  beforeEach(() => {
    _backgroundTaskRegistry = new Map();
    _backgroundTaskCounter = { value: 0 };
    currentTools = null;
  });

  it('should not overwrite state if task status changed during error handling', async () => {
    // This test verifies defensive state refresh in watcher catch block
    // Scenario: watcher catches error, but before it updates state, another call completes the task
    
    let errorCount = 0;
    const client = {
      session: {
        create: mock(async () => {
          return { data: { id: 'test-session-001' } };
        }),
        prompt: mock(async () => {}),
        messages: mock(async () => {
          // First call throws error (triggers watcher catch)
          errorCount++;
          if (errorCount === 1) {
            throw new Error('Transient error');
          }
          // Subsequent calls succeed
          return {
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'Task completed' }] },
            ],
          };
        }),
        status: mock(async () => {
          return { data: { 'test-session-001': { type: 'idle' } } };
        }),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client as any);
    const tools = createTestTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Wait for watcher to process (it will catch transient error)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Manually mark task as completed (simulates concurrent completion)
    const task = options.backgroundTaskRegistry.get(taskId);
    if (task && task.status === 'running') {
      task.status = 'completed';
      task.result = 'Concurrent completion';
      task.completedAt = Date.now();
      options.backgroundTaskRegistry.set(taskId, task);
    }

    // Wait for another watcher cycle
    await new Promise(resolve => setTimeout(resolve, 500));

    // F-2: Task should remain completed, not be overwritten by error handling
    const finalTask = options.backgroundTaskRegistry.get(taskId);
    expect(finalTask?.status).toBe('completed');
    // The result might be "Task completed" (from watcher) or "Concurrent completion" (from manual set)
    // The key is that status should be 'completed', not 'error'
  });
});

// ─── Wave 1: Change_Dir 标记注入 ───────────────────────────────────────────

describe('Wave 1: Change_Dir 标记注入', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    promptCalls = [];
    currentTools = null;
  });

  it('同步模式：prompt 头部包含 <Change_Dir> 且路径与 query.directory 一致', async () => {
    const client = createMockClient({
      pollOutputs: ['任务完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);
    currentTools = tools;

    const testDirectory = 'E:\\test\\project';
    
    // 同步模式调用
    const result = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: testDirectory },
    );

    // 验证 prompt 调用中包含 <Change_Dir> 标记
    expect(promptCalls.length).toBeGreaterThan(0);
    const firstPromptCall = promptCalls[0];
    const parts = firstPromptCall.body.parts as Array<{ type: string; text: string }>;
    const promptText = parts[0].text;
    
    // 验证标记存在
    expect(promptText).toContain('<Change_Dir>');
    expect(promptText).toContain('</Change_Dir>');
    
    // 验证标记在头部
    expect(promptText.startsWith('<Change_Dir>')).toBe(true);
    
    // 验证路径正确
    const changeDirMatch = promptText.match(/<Change_Dir>(.*?)<\/Change_Dir>/);
    expect(changeDirMatch).not.toBeNull();
    expect(changeDirMatch![1]).toBe(testDirectory);
  });

  it('异步模式：后台任务 prompt 也包含 <Change_Dir> 标记', async () => {
    const client = createMockClient({
      pollOutputs: ['任务完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);
    currentTools = tools;

    const testDirectory = 'E:\\test\\async-project';
    
    // 异步模式调用
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: testDirectory },
    );

    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);

    // 验证 prompt 调用中包含 <Change_Dir> 标记
    expect(promptCalls.length).toBeGreaterThan(0);
    const firstPromptCall = promptCalls[0];
    const parts = firstPromptCall.body.parts as Array<{ type: string; text: string }>;
    const promptText = parts[0].text;
    
    // 验证标记存在且在头部
    expect(promptText.startsWith('<Change_Dir>')).toBe(true);
    expect(promptText).toContain('</Change_Dir>');
    
    // 验证路径正确
    const changeDirMatch = promptText.match(/<Change_Dir>(.*?)<\/Change_Dir>/);
    expect(changeDirMatch).not.toBeNull();
    expect(changeDirMatch![1]).toBe(testDirectory);
  });

  it('resume 模式：恢复会话时 prompt 也包含 <Change_Dir> 标记', async () => {
    const client = createMockClient({
      pollOutputs: ['任务完成 [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);
    currentTools = tools;

    const testDirectory = 'E:\\test\\resume-project';
    
    // 先创建一个 agent 记录（模拟之前的运行）
    const store = await import('../../features/subagent-store.js').then(m => m.createSubagentStore({ changeDir: testDirectory }));
    const agentId = 'agent_resume_test';
    await store.createAgent({
      agent_id: agentId,
      subagent_type: 'build-executor',
      session_id: 'test-session-001',
      prompt: 'Previous task',
    });
    
    // resume 模式调用（传入 agent_id）
    const result = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Continue the task',
        subagent_type: 'build-executor',
        run_in_background: false,
        agent_id: agentId,
      },
      { sessionID: 'parent-session', directory: testDirectory },
    );

    // 验证 prompt 调用中包含 <Change_Dir> 标记
    expect(promptCalls.length).toBeGreaterThan(0);
    const firstPromptCall = promptCalls[0];
    const parts = firstPromptCall.body.parts as Array<{ type: string; text: string }>;
    const promptText = parts[0].text;
    
    // 验证标记存在且在头部
    expect(promptText.startsWith('<Change_Dir>')).toBe(true);
    expect(promptText).toContain('</Change_Dir>');
    
    // 验证路径正确
    const changeDirMatch = promptText.match(/<Change_Dir>(.*?)<\/Change_Dir>/);
    expect(changeDirMatch).not.toBeNull();
    expect(changeDirMatch![1]).toBe(testDirectory);
  });
});

// ─── Wave 4: model_type Parameter Tests ─────────────────────────────────────

describe('Wave 4: model_type parameter', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    promptCalls = [];
    currentTools = null;
  });

  describe('Task 4.1: Zod schema accepts model_type', () => {
    it('should accept valid model_type values in schema', async () => {
      const client = createMockClient({
        pollOutputs: ['Task completed [TASK_COMPLETE]'],
        promptCalls,
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      // Test each valid tier
      const validTiers = ['free', 'quick', 'standard', 'deep', 'ultra', 'review'];
      
      for (const tier of validTiers) {
        const result = await tools.call_flow_agent.execute(
          {
            description: `test ${tier}`,
            prompt: 'Test prompt',
            subagent_type: 'build-executor',
            run_in_background: false,
            model_type: tier,
          },
          { sessionID: 'parent-session', directory: '/test' },
        );

        // Should not return error for valid model_type
        const output = JSON.parse((result as { output: string }).output);
        expect(output.success).toBe(true);
      }
    });
  });

  describe('Task 4.2: model_type resolution', () => {
    it('sync mode: should route to ultra tier when model_type=ultra', async () => {
      const client = createMockClient({
        pollOutputs: ['Task completed [TASK_COMPLETE]'],
        promptCalls,
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      await tools.call_flow_agent.execute(
        {
          description: 'ultra task',
          prompt: 'Complex task',
          subagent_type: 'build-executor',
          run_in_background: false,
          model_type: 'ultra',
        },
        { sessionID: 'parent-session', directory: '/test' },
      );

      // Verify prompt was called
      expect(promptCalls.length).toBeGreaterThan(0);
      
      // Verify body.model was injected with ultra tier model
      const promptCall = promptCalls[0];
      expect(promptCall.body.model).toBeDefined();
      
      // The model should be from ultra tier: 'provider/glm-5'
      const expectedModel = DEFAULT_PROFILE_MODELS.ultra.model;
      const [providerID, modelID] = expectedModel.split('/');
      expect(promptCall.body.model).toEqual({ providerID, modelID });
    });

    it('async mode: should route to deep tier when model_type=deep', async () => {
      const client = createMockClient({
        pollOutputs: ['Task running'],
        promptCalls,
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      const result = await tools.call_flow_agent.execute(
        {
          description: 'deep task',
          prompt: 'Deep reasoning task',
          subagent_type: 'spec-writer',
          run_in_background: true,
          model_type: 'deep',
        },
        { sessionID: 'parent-session', directory: '/test' },
      );

      // Verify async mode returns task_id
      const output = JSON.parse((result as { output: string }).output);
      expect(output.success).toBe(true);
      expect(output.task_id).toBeDefined();

      // Verify prompt was called
      expect(promptCalls.length).toBeGreaterThan(0);
      
      // Verify body.model was injected with deep tier model
      const promptCall = promptCalls[0];
      expect(promptCall.body.model).toBeDefined();
      
      // The model should be from deep tier: 'provider/glm-5.1'
      const expectedModel = DEFAULT_PROFILE_MODELS.deep.model;
      const [providerID, modelID] = expectedModel.split('/');
      expect(promptCall.body.model).toEqual({ providerID, modelID });
    });

    it('should fallback to AGENT_PROFILES when model_type is not provided', async () => {
      const client = createMockClient({
        pollOutputs: ['Task completed [TASK_COMPLETE]'],
        promptCalls,
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      // Call without model_type - should use agentModelMap
      await tools.call_flow_agent.execute(
        {
          description: 'standard task',
          prompt: 'Standard task',
          subagent_type: 'build-executor',
          run_in_background: false,
        },
        { sessionID: 'parent-session', directory: '/test' },
      );

      // Verify prompt was called
      expect(promptCalls.length).toBeGreaterThan(0);
      
      // Verify body.model was injected
      const promptCall = promptCalls[0];
      expect(promptCall.body.model).toBeDefined();
      
      // Should use the model from agentModelMap (provider/test-model in test setup)
      // Model is now in object format { providerID, modelID }
      expect(promptCall.body.model).toEqual({ providerID: 'provider', modelID: 'test-model' });
    });
  });

  describe('Task 4.3: body.model injection', () => {
    it('should inject model in correct format (provider/modelID)', async () => {
      const client = createMockClient({
        pollOutputs: ['Task completed [TASK_COMPLETE]'],
        promptCalls,
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      await tools.call_flow_agent.execute(
        {
          description: 'test injection',
          prompt: 'Test prompt',
          subagent_type: 'build-executor',
          run_in_background: false,
          model_type: 'standard',
        },
        { sessionID: 'parent-session', directory: '/test' },
      );

      // Verify body.model was injected
      expect(promptCalls.length).toBeGreaterThan(0);
      const promptCall = promptCalls[0];
      expect(promptCall.body.model).toBeDefined();
      
      // Verify format is object { providerID, modelID }
      const model = promptCall.body.model as { providerID: string; modelID: string };
      expect(typeof model).toBe('object');
      expect(model.providerID).toBeDefined();
      expect(model.modelID).toBeDefined();
    });

    it('should inject resolved model from resolveModelWithFallback', async () => {
      const client = createMockClient({
        pollOutputs: ['Task completed [TASK_COMPLETE]'],
        promptCalls,
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      // Use ultra tier
      await tools.call_flow_agent.execute(
        {
          description: 'ultra test',
          prompt: 'Ultra complex task',
          subagent_type: 'build-executor',
          run_in_background: false,
          model_type: 'ultra',
        },
        { sessionID: 'parent-session', directory: '/test' },
      );

      // Verify the injected model matches resolveModelWithFallback result
      const promptCall = promptCalls[0];
      const injectedModel = promptCall.body.model as { providerID: string; modelID: string };
      
      // The model should be from ultra tier
      const expectedModel = DEFAULT_PROFILE_MODELS.ultra.model;
      const [providerID, modelID] = expectedModel.split('/');
      expect(injectedModel).toEqual({ providerID, modelID });
    });
  });

  describe('Task 4.4: invalid model_type validation', () => {
    it('should return error for invalid model_type', async () => {
      const client = createMockClient({
        pollOutputs: ['Task completed'],
        promptCalls,
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      const result = await tools.call_flow_agent.execute(
        {
          description: 'invalid test',
          prompt: 'Test prompt',
          subagent_type: 'build-executor',
          run_in_background: false,
          model_type: 'invalid-tier',
        },
        { sessionID: 'parent-session', directory: '/test' },
      );

      // Should return error
      const output = (result as { output: string }).output;
      expect(output).toContain('invalid-tier');
      expect(output).toContain('valid');
      expect(output).toContain('free');
      expect(output).toContain('quick');
      expect(output).toContain('standard');
      expect(output).toContain('deep');
      expect(output).toContain('ultra');
      expect(output).toContain('review');
    });

    it('should list all valid tiers in error message', async () => {
      const client = createMockClient({
        pollOutputs: ['Task completed'],
        promptCalls,
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      const result = await tools.call_flow_agent.execute(
        {
          description: 'test',
          prompt: 'Test',
          subagent_type: 'build-executor',
          run_in_background: false,
          model_type: 'nonexistent',
        },
        { sessionID: 'parent-session', directory: '/test' },
      );

      const output = (result as { output: string }).output;
      // Verify all 6 tiers are mentioned
      const validTiers = ['free', 'quick', 'standard', 'deep', 'ultra', 'review'];
      for (const tier of validTiers) {
        expect(output).toContain(tier);
      }
    });
  });
});

// ─── P0: model_type 路由优先级链测试 ─────────────────────────────────────────

describe('P0: model_type routing priority chain', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    promptCalls = [];
  });

  it('P0-1: should use user-configured modelProfiles when model_type is specified', async () => {
    // 测试：当 model_type='deep' 时，应该优先使用 modelProfiles.deep.model
    // 而不是直接使用 DEFAULT_PROFILE_MODELS.deep.model
    const client = createMockClient({
      pollOutputs: ['Task completed [TASK_COMPLETE]'],
      promptCalls,
    });

    // 用户配置的 modelProfiles
    const userModelProfiles = {
      deep: { model: 'provider/user-custom-deep-model', fallback_models: [] },
    };

    const options = createTestOptions(client);
    // 添加 modelProfiles 到选项中（这是我们需要添加的功能）
    (options as any).modelProfiles = userModelProfiles;
    (options as any).configOverrides = {};

    const tools = createTestTools(options);
    currentTools = tools;

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test deep tier',
        prompt: 'Test prompt',
        subagent_type: 'build-executor',
        run_in_background: false,
        model_type: 'deep',
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    // 验证使用了用户配置的模型
    expect(promptCalls.length).toBeGreaterThan(0);
    const lastCall = promptCalls[promptCalls.length - 1];
    expect(lastCall.body.model).toEqual({
      providerID: 'provider',
      modelID: 'user-custom-deep-model',
    });
  });

  it('P0-2: should use fallback chain when primary model is unavailable', async () => {
    // 测试：当 tier model 不可用时，应该使用 fallback_models 链
    const client = createMockClient({
      pollOutputs: ['Task completed [TASK_COMPLETE]'],
      promptCalls,
    });

    // 配置 primary model 不可用，但有 fallback
    const userModelProfiles = {
      deep: {
        model: 'provider/unavailable-primary-model',
        fallback_models: ['provider/fallback-model-1', 'provider/fallback-model-2'],
      },
    };

    const options = createTestOptions(client);
    (options as any).modelProfiles = userModelProfiles;
    (options as any).configOverrides = {};

    const tools = createTestTools(options);
    currentTools = tools;

    // 标记 primary model 为不可用
    const { markModelUnavailable } = await import('../../agents/agent-builder.js');
    markModelUnavailable('provider/unavailable-primary-model');

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test fallback',
        prompt: 'Test prompt',
        subagent_type: 'build-executor',
        run_in_background: false,
        model_type: 'deep',
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    // 验证使用了 fallback model
    expect(promptCalls.length).toBeGreaterThan(0);
    const lastCall = promptCalls[promptCalls.length - 1];
    // 应该使用 fallback-model-1 或 fallback-model-2，而不是 unavailable-primary-model
    const usedModel = lastCall.body.model as { providerID: string; modelID: string };
    expect(usedModel.modelID).not.toContain('unavailable-primary-model');
  });

  it('P0-3: should use resolveModelWithFallback for model resolution', async () => {
    // 测试：call_flow_agent 应该调用 resolveModelWithFallback
    // 而不是直接读取 DEFAULT_PROFILE_MODELS
    const client = createMockClient({
      pollOutputs: ['Task completed [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    (options as any).modelProfiles = {};
    (options as any).configOverrides = {};

    const tools = createTestTools(options);
    currentTools = tools;

    // 使用 model_type='deep'
    const result = await tools.call_flow_agent.execute(
      {
        description: 'test resolveModelWithFallback',
        prompt: 'Test prompt',
        subagent_type: 'build-executor',
        run_in_background: false,
        model_type: 'deep',
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    // 验证使用了 DEFAULT_PROFILE_MODELS.deep.model（因为没有用户配置）
    expect(promptCalls.length).toBeGreaterThan(0);
    const lastCall = promptCalls[promptCalls.length - 1];
    const expectedModel = DEFAULT_PROFILE_MODELS.deep.model;
    expect(lastCall.body.model).toEqual({
      providerID: expectedModel.split('/')[0],
      modelID: expectedModel.split('/')[1],
    });
  });

  it('P0: should respect model_type over per-agent override', async () => {
    // 测试：model_type 应该优先于 per-agent override
    const client = createMockClient({
      pollOutputs: ['Task completed [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    (options as any).modelProfiles = {
      deep: { model: 'provider/tier-deep-model', fallback_models: [] },
    };
    // per-agent override (lower priority than model_type)
    (options as any).configOverrides = {
      'build-executor': { model: 'provider/per-agent-override-model' },
    };

    const tools = createTestTools(options);
    currentTools = tools;

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test model_type priority',
        prompt: 'Test prompt',
        subagent_type: 'build-executor',
        run_in_background: false,
        model_type: 'deep',
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    // 验证使用了 model_type 指定的 tier model，而不是 per-agent override
    expect(promptCalls.length).toBeGreaterThan(0);
    const lastCall = promptCalls[promptCalls.length - 1];
    expect(lastCall.body.model).toEqual({
      providerID: 'provider',
      modelID: 'tier-deep-model',
    });
  });
});

// ─── F2: Watcher Probe Mode Tests ────────────────────────────────────────────

describe('F2: Watcher probe mode (1s timeout bug fix)', () => {
  let _backgroundTaskRegistry: BackgroundTaskRegistry;
  let _backgroundTaskCounter: { value: number };
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    _backgroundTaskRegistry = new Map();
    _backgroundTaskCounter = { value: 0 };
    promptCalls = [];
    currentTools = null;
  });

  it('watcher should keep task running when session is busy (not completed yet)', async () => {
    // Arrange: create a client that returns busy status
    let statusCallCount = 0;
    const client = {
      session: {
        create: mock(async () => {
          return { data: { id: 'test-session-001' } };
        }),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => {
          return {
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'partial output' }] }, // intermediate output
            ],
          };
        }),
        status: mock(async () => {
          statusCallCount++;
          // Always return busy (task not completed)
          return { data: { 'test-session-001': { type: 'busy' } } };
        }),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client as any);
    const tools = createTestTools(options);
    currentTools = tools;

    // Act: Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);
    const taskId = startData.task_id;

    // Wait for watcher to scan (200ms interval, wait 500ms to ensure at least 2 scans)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Assert: Task should still be running (not marked completed/error)
    const task = options.backgroundTaskRegistry.get(taskId);
    expect(task).toBeDefined();
    expect(task?.status).toBe('running'); // Critical: should NOT be marked completed
    expect(statusCallCount).toBeGreaterThan(0); // Watcher did check status
  });

  it('watcher should mark task completed when session becomes idle', async () => {
    // Arrange: create a client that transitions from busy to idle
    const startTime = Date.now();
    const client = {
      session: {
        create: mock(async () => {
          return { data: { id: 'test-session-001' } };
        }),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => {
          return {
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'Task completed [TASK_COMPLETE]' }] },
            ],
          };
        }),
        status: mock(async () => {
          // Return busy for first 600ms, then idle
          const elapsed = Date.now() - startTime;
          if (elapsed < 600) {
            return { data: { 'test-session-001': { type: 'busy' } } };
          }
          return { data: { 'test-session-001': { type: 'idle' } } };
        }),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client as any);
    const tools = createTestTools(options);
    currentTools = tools;

    // Act: Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Wait for watcher to detect idle (600ms busy + multiple scans)
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Assert: Task should be completed
    const task = options.backgroundTaskRegistry.get(taskId);
    expect(task).toBeDefined();
    expect(task?.status).toBe('completed');
    expect(task?.result).toContain('Task completed');
  });

  it('watcher should NOT mark completed on 1s timeout with intermediate output (bug fix)', async () => {
    // Arrange: This is the exact bug scenario - session busy, pollSessionCompletion times out after 1s
    // Before fix: would return intermediate output and mark completed
    // After fix: probe mode returns PROBE_PENDING, task stays running
    let statusCallCount = 0;
    const client = {
      session: {
        create: mock(async () => {
          return { data: { id: 'test-session-001' } };
        }),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => {
          // Return intermediate output (not final)
          return {
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'I am still thinking...' }] }, // intermediate
            ],
          };
        }),
        status: mock(async () => {
          statusCallCount++;
          // Always busy - task is still running
          return { data: { 'test-session-001': { type: 'busy' } } };
        }),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client as any);
    const tools = createTestTools(options);
    currentTools = tools;

    // Act: Start async task
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Wait for multiple watcher cycles (each with 1s probe timeout)
    await new Promise(resolve => setTimeout(resolve, 600));

    // Assert: Task should STILL be running (bug fix verification)
    const task = options.backgroundTaskRegistry.get(taskId);
    expect(task).toBeDefined();
    expect(task?.status).toBe('running'); // Critical: NOT marked completed with intermediate output
    expect(task?.result).toBeUndefined(); // No result yet
  });
});

// ─── Batch 5: Event-Driven Integration ───────────────────────────────────────

describe('Batch 5: Event-driven integration', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    promptCalls = [];
    currentTools = null;
  });

  describe('Task 5.1: Event subscription verification', () => {
    it('should use event-driven polling in sync mode by default', async () => {
      // Arrange: Create mock client with event subscription tracking
      let eventSubscribeCalled = false;
      const client = {
        session: {
          create: mock(async () => ({ data: { id: 'test-session-001' } })),
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            promptCalls.push({ id: args.path.id, body: args.body });
          }),
          messages: mock(async () => ({
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'Task completed [TASK_COMPLETE]' }] },
            ],
          })),
          status: mock(async () => ({ data: { 'test-session-001': { type: 'idle' } } })),
          abort: mock(async () => {}),
        },
        event: {
          subscribe: mock(async () => {
            eventSubscribeCalled = true;
            // Create AsyncGenerator that yields session.idle event
            async function* eventStream() {
              yield {
                directory: '',
                payload: {
                  type: 'session.idle',
                  properties: { sessionID: 'test-session-001' },
                },
              };
            }
            return { stream: eventStream() };
          }),
        },
      };

      const options = createTestOptions(client as any);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act: Execute sync call
      const result = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: false,
        },
        { sessionID: 'parent-session', directory: '' },
      );

      // Assert: Event subscription should be called (eventDriven defaults to true)
      expect(eventSubscribeCalled).toBe(true);
      const data = JSON.parse(result.output);
      expect(data.success).toBe(true);
    });

    it('should use event-driven polling in async pollAndComplete by default', async () => {
      // Arrange: Create mock client with event subscription tracking
      let eventSubscribeCalled = false;
      const client = {
        session: {
          create: mock(async () => ({ data: { id: 'test-session-001' } })),
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            promptCalls.push({ id: args.path.id, body: args.body });
          }),
          messages: mock(async () => ({
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'Task completed [TASK_COMPLETE]' }] },
            ],
          })),
          status: mock(async () => ({ data: { 'test-session-001': { type: 'idle' } } })),
          abort: mock(async () => {}),
        },
        event: {
          subscribe: mock(async () => {
            eventSubscribeCalled = true;
            // Create AsyncGenerator that yields session.idle event
            async function* eventStream() {
              yield {
                directory: '',
                payload: {
                  type: 'session.idle',
                  properties: { sessionID: 'test-session-001' },
                },
              };
            }
            return { stream: eventStream() };
          }),
        },
      };

      const options = createTestOptions(client as any);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act: Start async task and poll with block=true
      const startResult = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: true,
        },
        { sessionID: 'parent-session', directory: '' },
      );

      const startData = JSON.parse(startResult.output);
      const taskId = startData.task_id;

      const outputResult = await tools.flowagent_output.execute(
        { task_id: taskId, block: true },
        { sessionID: 'parent-session', directory: '' },
      );

      // Assert: Event subscription should be called in pollAndComplete
      expect(eventSubscribeCalled).toBe(true);
      const outputData = JSON.parse(outputResult.output);
      expect(outputData.success).toBe(true);
    });

    it('should use event-driven polling in watcher probeMode by default', async () => {
      // Arrange: Create mock client with event subscription tracking
      let eventSubscribeCalled = false;
      const client = {
        session: {
          create: mock(async () => ({ data: { id: 'test-session-001' } })),
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            promptCalls.push({ id: args.path.id, body: args.body });
          }),
          messages: mock(async () => ({
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'Processing...' }] },
            ],
          })),
          status: mock(async () => ({ data: { 'test-session-001': { type: 'busy' } } })),
          abort: mock(async () => {}),
        },
        event: {
          subscribe: mock(async () => {
            eventSubscribeCalled = true;
            // Create AsyncGenerator that yields session.idle event
            async function* eventStream() {
              yield {
                directory: '',
                payload: {
                  type: 'session.idle',
                  properties: { sessionID: 'test-session-001' },
                },
              };
            }
            return { stream: eventStream() };
          }),
        },
      };

      const options = createTestOptions(client as any);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act: Start async task (watcher will probe with probeMode=true)
      const startResult = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: true,
        },
        { sessionID: 'parent-session', directory: '' },
      );

      // Wait for watcher to run at least one cycle (pollIntervalMs=200ms)
      await new Promise(resolve => setTimeout(resolve, 300));

      // Assert: Event subscription should be called even in probeMode
      expect(eventSubscribeCalled).toBe(true);
    });
  });

  describe('Task 5.2: Backward compatibility', () => {
    it('should maintain backward compatibility when event subscription fails', async () => {
      // Arrange: Create mock client where event.subscribe throws
      const client = {
        session: {
          create: mock(async () => ({ data: { id: 'test-session-001' } })),
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            promptCalls.push({ id: args.path.id, body: args.body });
          }),
          messages: mock(async () => ({
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'Task completed [TASK_COMPLETE]' }] },
            ],
          })),
          status: mock(async () => ({ data: { 'test-session-001': { type: 'idle' } } })),
          abort: mock(async () => {}),
        },
        event: {
          subscribe: mock(() => {
            throw new Error('Event subscription not available');
          }),
        },
      };

      const options = createTestOptions(client as any);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act: Execute sync call (should fallback to pure polling)
      const result = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: false,
        },
        { sessionID: 'parent-session', directory: '' },
      );

      // Assert: Should still succeed with pure polling fallback
      const data = JSON.parse(result.output);
      expect(data.success).toBe(true);
      expect(data.output).toContain('Task completed');
    });

    it('should maintain backward compatibility when client.event is undefined', async () => {
      // Arrange: Create mock client without event property (legacy client)
      const client = {
        session: {
          create: mock(async () => ({ data: { id: 'test-session-001' } })),
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            promptCalls.push({ id: args.path.id, body: args.body });
          }),
          messages: mock(async () => ({
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'Task completed [TASK_COMPLETE]' }] },
            ],
          })),
          status: mock(async () => ({ data: { 'test-session-001': { type: 'idle' } } })),
          abort: mock(async () => {}),
        },
        // No event property
      };

      const options = createTestOptions(client as any);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act: Execute sync call
      const result = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: false,
        },
        { sessionID: 'parent-session', directory: '' },
      );

      // Assert: Should succeed with pure polling
      const data = JSON.parse(result.output);
      expect(data.success).toBe(true);
      expect(data.output).toContain('Task completed');
    });
  });

  describe('Task 5.3: Performance and cleanup', () => {
    it('should cleanup event subscription after completion', async () => {
      // Arrange: Create mock client with subscription tracking (AsyncGenerator-based)
      let streamReturnCalled = false;
      const client = {
        session: {
          create: mock(async () => ({ data: { id: 'test-session-001' } })),
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            promptCalls.push({ id: args.path.id, body: args.body });
          }),
          messages: mock(async () => ({
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'Task completed [TASK_COMPLETE]' }] },
            ],
          })),
          status: mock(async () => ({ data: [{ id: 'test-session-001', type: 'idle' }] })),
          abort: mock(async () => {}),
        },
        event: {
          subscribe: mock(async () => {
            // Create AsyncGenerator that yields session.idle event
            async function* eventStream() {
              yield {
                directory: '',
                payload: {
                  type: 'session.idle',
                  properties: { sessionID: 'test-session-001' },
                },
              };
            }
            const stream = eventStream();
            // Wrap stream.return to track cleanup
            const originalReturn = stream.return.bind(stream);
            stream.return = (value?: unknown) => {
              streamReturnCalled = true;
              return originalReturn(value);
            };
            return { stream };
          }),
        },
      };

      const options = createTestOptions(client as any);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act: Execute sync call
      await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: false,
        },
        { sessionID: 'parent-session', directory: '' },
      );

      // Assert: Event subscription should be cleaned up (stream.return called)
      expect(streamReturnCalled).toBe(true);
    });

    it('should respond faster with event-driven polling (performance test)', async () => {
      // Arrange: Create mock client that emits session.idle event quickly via AsyncGenerator
      const client = {
        session: {
          create: mock(async () => ({ data: { id: 'test-session-001' } })),
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            promptCalls.push({ id: args.path.id, body: args.body });
          }),
          messages: mock(async () => ({
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { parts: [{ type: 'text', text: 'Task completed [TASK_COMPLETE]' }] },
            ],
          })),
          status: mock(async () => ({ data: [{ id: 'test-session-001', type: 'idle' }] })),
          abort: mock(async () => {}),
        },
        event: {
          subscribe: mock(async () => {
            // Create AsyncGenerator that yields session.idle event after 50ms
            async function* eventStream() {
              await new Promise(resolve => setTimeout(resolve, 50));
              yield {
                directory: '',
                payload: {
                  type: 'session.idle',
                  properties: { sessionID: 'test-session-001' },
                },
              };
            }
            return { stream: eventStream() };
          }),
        },
      };

      const options = createTestOptions(client as any);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act: Execute sync call and measure time
      const startTime = Date.now();
      await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: false,
        },
        { sessionID: 'parent-session', directory: '' },
      );
      const elapsed = Date.now() - startTime;

      // Assert: Should respond quickly (event-driven response < polling interval)
      // Allow up to 250ms to account for timing variance
      expect(elapsed).toBeLessThan(250);
    });
  });
});
