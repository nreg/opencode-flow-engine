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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentModelMap, BackgroundTaskRegistry } from '../../types.js';
import { createCallFlowAgentTools, resetRunningSubagentCounts, createBackgroundTaskWatcher } from '../call-flow-agent.js';
import { resetGlobalEventBus, getGlobalEventBus } from '../../features/event-bus.js';
import { clearUnavailableModels, markModelUnavailable, getAlternativeModel, isModelAvailable } from '../../agents/agent-builder.js';
import { Logger } from '../../utils/logger.js';

// ─── Test helpers ──────────────────────────────────────────────────────────

/**
 * Create a mock SFlowClient with controllable session behavior.
 *
 * Wave 3 (Task 6) 扩展：支持故障注入能力
 * - promptFailures: 按 prompt 调用顺序消费，number → HTTP 错误（cause.status），Error → 原样抛出，null/缺省 → 成功
 * - pollFailure: 'retry-error' 时 status mock 返回 retry 终态（attempt=5），使 pollSessionCompletion 返回 null
 * - pollFailureAfter: 前 N 次 poll 返回 null，之后恢复正常（idle）—— 用于"首次失败、重试成功"场景
 * - assistantErrorName: 让 messages mock 返回的 assistant 消息带 info.error.name（用于 ContextOverflow 分支测试）
 */
function createMockClient(options: {
  pollOutputs: string[]; // outputs returned by pollSessionCompletion in sequence
  promptCalls?: Array<{ id: string; body: Record<string, unknown> }>;
  promptFailures?: Array<number | Error | null>; // Wave 3: prompt 故障注入
  pollFailure?: 'retry-error' | null; // Wave 3: poll 返回 null（retry 耗尽）
  pollFailureAfter?: number; // Wave 3: 前 N 次 poll 失败，之后恢复（0 = 不失败，缺省 = 全部失败）
  assistantErrorName?: string; // Wave 3: assistant info.error.name 注入
}) {
  let pollIndex = 0;
  let pollAttemptIndex = 0; // Wave 3: 跟踪 pollSessionCompletion 调用次数（通过 status 调用计数）
  const promptCalls = options.promptCalls ?? [];
  const promptFailures = options.promptFailures ?? [];
  let promptCallIndex = 0;

  return {
    session: {
      create: mock(
        async (_args: { body: Record<string, unknown>; query?: Record<string, unknown> }) => {
          return { data: { id: 'test-session-001' } };
        },
      ),
      prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
        promptCalls.push({ id: args.path.id, body: args.body });
        // Wave 3: 按 promptFailures 队列注入故障
        if (promptCallIndex < promptFailures.length) {
          const failure = promptFailures[promptCallIndex];
          promptCallIndex++;
          if (failure !== null && failure !== undefined) {
            if (typeof failure === 'number') {
              // 模拟 HTTP 错误：throw Error with cause.status（hey-api error-interceptor 形态）
              const err = new Error(`HTTP ${failure}: request failed`);
              (err as any).cause = { status: failure, body: {} };
              throw err;
            } else if (failure instanceof Error) {
              throw failure;
            }
          }
          // null → 成功，继续
        } else {
          promptCallIndex++;
        }
        // 成功：sendPromptOnce 使用 { throwOnError: true }，成功时不抛异常
      }),
      messages: mock(async () => {
        const output = options.pollOutputs[Math.min(pollIndex, options.pollOutputs.length - 1)];
        pollIndex++;
        // Wave 3: 构造消息列表，保留原有 parts 结构，追加 info 字段
        const assistantMsg: Record<string, unknown> = {
          parts: [{ type: 'text', text: output }],
        };
        if (options.assistantErrorName) {
          assistantMsg.info = { role: 'assistant', error: { name: options.assistantErrorName } };
        }
        return {
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            assistantMsg,
          ],
        };
      }),
      status: mock(async () => {
        // Wave 3: pollFailure 注入 —— 返回 retry 终态使 pollSessionCompletion 返回 null
        // pollFailureAfter 语义：前 N 次 poll 失败，之后恢复 idle
        //   pollFailureAfter 缺省（Infinity）= 全部失败
        //   pollFailureAfter = 1 = 第 1 次 poll 失败，第 2 次起恢复
        //   pollFailureAfter = 0 = 不失败（与不设 pollFailure 等价）
        if (options.pollFailure === 'retry-error') {
          pollAttemptIndex++;
          const failCount = options.pollFailureAfter ?? Infinity;
          if (pollAttemptIndex <= failCount) {
            return { data: { 'test-session-001': { type: 'retry', attempt: 5, next: 0 } } };
          }
        }
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

/** R3-P2-1: 轮询等待条件成立（去除固定 sleep 的时序耦合，消除 flaky） */
async function waitFor(
  pred: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

// P0-3: Store tools reference for cleanup
let currentTools: ReturnType<typeof createCallFlowAgentTools> | null = null;

afterEach(() => {
  if (currentTools && '_stopWatcher' in currentTools && typeof currentTools._stopWatcher === 'function') {
    currentTools._stopWatcher();
  }
  currentTools = null;
  resetRunningSubagentCounts();
  resetGlobalEventBus(); // Batch 4: Reset event bus between tests
  clearUnavailableModels(); // Wave 2: 统一兜底，清理模块级 UNAVAILABLE_MODELS（故障转移测试会写入拉黑），防止跨测试泄漏
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
    // P0-1 语义变更（specs/output-verdict.md 产出正向判定，DP-2 批准）：
    // 异步产出无完成信号（无 [TASK_COMPLETE]、无 JSON、无报告关键词/Markdown 标题）
    // 不再被判为成功，而是按 no-valid-output 失败终结（原文保留在 result 中）
    expect(outputData.success).toBe(false);
    expect(outputData.status).toBe('error');
    expect(outputData.error).toContain('no completion signal');
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
    // P0-1 语义变更（specs/output-verdict.md 产出正向判定，DP-2 批准）：'partial output 1'
    // 无完成信号与结构化证据 → 不判 completed，按 no-valid-output 失败终结，原文保留
    expect(outputData.success).toBe(false);
    expect(outputData.status).toBe('error');
    expect(outputData.error).toContain('no completion signal');
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
    // and produces a warning alongside the structured extraction failure warning.
    // P0-1 夹具对齐：产出需带报告证据（Summary）才能作为"真实产出"走 P3 重试与 warnings 合并；
    // 仍不含 [TASK_COMPLETE] 与 JSON，故本用例"无完成信号"的被测前提保持不变。
    const client = createMockClient({
      pollOutputs: ['Summary: partial output without signal or json', 'Summary: still no signal or json after retry'],
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

  it('sync mode: 无完成信号且无结构化证据的产出 → no-valid-output 失败返回（P0-1 新语义）', async () => {
    // P0-1 语义变更（specs/output-verdict.md 产出正向判定，DP-2 批准）：
    // 无 [TASK_COMPLETE]、无 JSON、无报告关键词/Markdown 标题的产出不再判成功，
    // 同步路径返回失败并保留原文（raw_output），不拉黑模型、不触发故障转移。
    const client = createMockClient({
      pollOutputs: ['partial output without signal or json'],
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
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(false);
    expect(data.raw_output).toBe('partial output without signal or json');
    expect(data.error).toContain('no completion signal');
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

    // P0-1 语义变更（specs/output-verdict.md 产出正向判定，DP-2 批准）：夹具产出 'Task completed'
    // 无完成信号（无 [TASK_COMPLETE]、无 JSON）且无报告关键词/Markdown 标题 → 按失败终结，
    // 原文保留在 result 中；G1 的"任务缺失时返回 error 而非复活"防御语义不受影响。
    expect(outputData.success).toBe(false);
    expect(outputData.status).toBe('error');
    expect(outputData.error).toContain('no completion signal');
    expect(outputData.result).toContain('Task completed');
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
    // P0-1 语义变更（specs/output-verdict.md 产出正向判定，DP-2 批准）：夹具产出 'Task completed'
    // 无完成信号与结构化证据 → watcher 按 no-valid-output 失败终结（早于本用例模拟的并发完成），
    // 且终结后不被后续周期再次改写（F-2 防御语义保留）。
    const finalTask = options.backgroundTaskRegistry.get(taskId);
    expect(finalTask?.status).toBe('error');
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
      (options as any).modelProfiles = {
        lite: { model: 'provider/lite-resolved-model', fallback_models: [] },
        quick: { model: 'provider/quick-resolved-model', fallback_models: [] },
        standard: { model: 'provider/standard-resolved-model', fallback_models: [] },
        deep: { model: 'provider/deep-resolved-model', fallback_models: [] },
        ultra: { model: 'provider/ultra-resolved-model', fallback_models: [] },
        review: { model: 'provider/review-resolved-model', fallback_models: [] },
      };
      (options as any).configOverrides = {};
      const tools = createTestTools(options);
      currentTools = tools;

      // Test each valid tier
      const validTiers = ['lite', 'quick', 'standard', 'deep', 'ultra', 'review'];
      
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
      (options as any).modelProfiles = { ultra: { model: 'provider/ultra-resolved-model', fallback_models: [] } };
      (options as any).configOverrides = {};
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

      // Verify body.model was injected with the user-configured ultra tier model (Wave 2: no built-in default)
      const promptCall = promptCalls[0];
      expect(promptCall.body.model).toEqual({ providerID: 'provider', modelID: 'ultra-resolved-model' });
    });

    it('async mode: should route to deep tier when model_type=deep', async () => {
      const client = createMockClient({
        pollOutputs: ['Task running'],
        promptCalls,
      });

      const options = createTestOptions(client);
      (options as any).modelProfiles = { deep: { model: 'provider/deep-resolved-model', fallback_models: [] } };
      (options as any).configOverrides = {};
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
      
      // Verify body.model was injected with the user-configured deep tier model (Wave 2: no built-in default)
      const promptCall = promptCalls[0];
      expect(promptCall.body.model).toEqual({ providerID: 'provider', modelID: 'deep-resolved-model' });
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
      (options as any).modelProfiles = { standard: { model: 'provider/standard-resolved-model', fallback_models: [] } };
      (options as any).configOverrides = {};
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
      (options as any).modelProfiles = { ultra: { model: 'provider/ultra-resolved-model', fallback_models: [] } };
      (options as any).configOverrides = {};
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

      // Verify the injected model matches the user-configured ultra tier model (Wave 2)
      const promptCall = promptCalls[0];
      const injectedModel = promptCall.body.model as { providerID: string; modelID: string };
      expect(injectedModel).toEqual({ providerID: 'provider', modelID: 'ultra-resolved-model' });
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
      expect(output).toContain('lite');
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
      const validTiers = ['lite', 'quick', 'standard', 'deep', 'ultra', 'review'];
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
    clearUnavailableModels(); // D-9：每个测试前清理黑名单，防止跨测试泄漏
  });

  afterEach(() => {
    clearUnavailableModels(); // D-9：每个测试后清理黑名单
  });

  it('P0-1: should use user-configured modelProfiles when model_type is specified', async () => {
    // 测试：当 model_type='deep' 时，应该优先使用用户配置的 modelProfiles.deep.model
    // 未配置该档位时不应回落到任何内置常量
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
    // 测试：call_flow_agent 应该调用 resolveModelWithFallback，统一走用户配置解析
    // 而不是直接读取任何内置的档位常量
    const client = createMockClient({
      pollOutputs: ['Task completed [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    (options as any).modelProfiles = { deep: { model: 'provider/deep-configured-model', fallback_models: [] } };
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

    // Wave 2: model_type='deep' 经 resolveModelWithFallback 读取用户配置（modelProfiles），
    // 不再注入旧内置默认 provider/deep-model；body.model 来自用户配置。
    expect(promptCalls.length).toBeGreaterThan(0);
    const lastCall = promptCalls[promptCalls.length - 1];
    expect(lastCall.body.model).toEqual({ providerID: 'provider', modelID: 'deep-configured-model' });
    // 确保不再回退到已删除的内置默认
    expect((lastCall.body.model as { modelID: string }).modelID).not.toBe('deep-model');
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

  it('P2-4: should log degradation diagnosis and keep explicit error when tier is unconfigured', async () => {
    // 测试：model_type 指定了 tier（ultra）但用户未配置该 tier 时，
    // 解析链尾降级为 unconfigured —— 必须补降级诊断日志，同时保留显式报错，
    // 且绝不注入假模型（不得发起任何 prompt）。
    const client = createMockClient({
      pollOutputs: ['Task completed [TASK_COMPLETE]'],
      promptCalls,
    });

    const options = createTestOptions(client);
    // 不提供该 tier 的用户配置
    (options as any).modelProfiles = {};
    (options as any).configOverrides = {};

    const tools = createTestTools(options);
    currentTools = tools;

    // 拦截 Logger.log 断言降级日志（Logger 目前无 debug 级别，LOG 为最低级别）
    const originalLog = Logger.log;
    const logSpy = mock(() => Promise.resolve());
    (Logger as unknown as { log: unknown }).log = logSpy;

    try {
      const result = await tools.call_flow_agent.execute(
        {
          description: 'test unconfigured tier',
          prompt: 'Test prompt',
          subagent_type: 'build-executor',
          run_in_background: false,
          model_type: 'ultra',
        },
        { sessionID: 'parent-session', directory: '/test' },
      );

      // 保留既有语义：显式报错，而不是静默回退或注入假模型
      const output = (result as { output: string }).output;
      expect(output).toContain('No model configured');
      expect(output).toContain('ultra');
      // 未注入任何模型 ⇒ 不应发起 prompt
      expect(promptCalls.length).toBe(0);

      // 降级诊断日志：说明未配置该 tier，agent 将使用 OpenCode 默认模型
      const messages = logSpy.mock.calls.map((call) => String(call[0]));
      expect(
        messages.some((msg) => msg.includes('ultra') && msg.includes('OpenCode')),
      ).toBe(true);
    } finally {
      (Logger as unknown as { log: unknown }).log = originalLog;
    }
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
      // Arrange: Create mock client (no event.subscribe needed - uses global event bus)
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
      };

      // Batch 4: Track event bus register calls
      let registerCalled = false;
      const eventBus = getGlobalEventBus();
      const originalRegister = eventBus.register.bind(eventBus);
      eventBus.register = (sessionID: string, listener: unknown) => {
        registerCalled = true;
        originalRegister(sessionID, listener);
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

      // Assert: Event bus register should be called (eventDriven defaults to true)
      expect(registerCalled).toBe(true);
      const data = JSON.parse(result.output);
      expect(data.success).toBe(true);
    });

    it('should use event-driven polling in async pollAndComplete by default', async () => {
      // Arrange: Create mock client (no event.subscribe needed - uses global event bus)
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
      };

      // Batch 4: Track event bus register calls
      let registerCalled = false;
      const eventBus = getGlobalEventBus();
      const originalRegister = eventBus.register.bind(eventBus);
      eventBus.register = (sessionID: string, listener: unknown) => {
        registerCalled = true;
        originalRegister(sessionID, listener);
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

      // Assert: Event bus register should be called in pollAndComplete
      expect(registerCalled).toBe(true);
      const outputData = JSON.parse(outputResult.output);
      expect(outputData.success).toBe(true);
    });

    it('should use event-driven polling in watcher probeMode by default', async () => {
      // Arrange: Create mock client (no event.subscribe needed - uses global event bus)
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
      };

      // Batch 4: Track event bus register calls
      let registerCalled = false;
      const eventBus = getGlobalEventBus();
      const originalRegister = eventBus.register.bind(eventBus);
      eventBus.register = (sessionID: string, listener: unknown) => {
        registerCalled = true;
        originalRegister(sessionID, listener);
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

      // Assert: Event bus register should be called even in probeMode
      expect(registerCalled).toBe(true);
    });
  });

  describe('Task 5.2: Backward compatibility', () => {
    // Batch 4: Event bus mode does not use client.event.subscribe
    // Backward compatibility is ensured by event bus + polling fallback
    it('should maintain backward compatibility with event bus + polling fallback', async () => {
      // Arrange: Create mock client (no event.subscribe needed - uses global event bus)
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

      // Assert: Should succeed with event bus + polling fallback
      const data = JSON.parse(result.output);
      expect(data.success).toBe(true);
      expect(data.output).toContain('Task completed');
    });
  });

  describe('Task 5.3: Performance and cleanup', () => {
    it('should cleanup event subscription after completion', async () => {
      // Arrange: Create mock client (no event.subscribe needed - uses global event bus)
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
      };

      // Batch 4: Track event bus unregister calls
      let unregisterCalled = false;
      const eventBus = getGlobalEventBus();
      const originalUnregister = eventBus.unregister.bind(eventBus);
      eventBus.unregister = (sessionID: string) => {
        unregisterCalled = true;
        originalUnregister(sessionID);
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

      // Assert: Event bus unregister should be called (cleanup)
      expect(unregisterCalled).toBe(true);
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

// ─── Batch 3: directory parameter passing (TO-4/TO-5/TO-6/TO-7) ───────────────

/** Create a mock SFlowClient with subscribe tracking for directory tests */
function createMockClientWithEventBusTracking(options: {
  pollOutputs: string[];
}) {
  let pollIndex = 0;
  const registerCalls: Array<{ sessionID: string }> = [];

  // Batch 4: Track event bus register calls
  const eventBus = getGlobalEventBus();
  const originalRegister = eventBus.register.bind(eventBus);
  eventBus.register = (sessionID: string, listener: unknown) => {
    registerCalls.push({ sessionID });
    originalRegister(sessionID, listener);
  };

  return {
    client: {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async () => {}),
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
        status: mock(async () => ({ data: [{ id: 'test-session-001', type: 'idle' }] })),
        abort: mock(async () => {}),
      },
    },
    registerCalls,
  };
}

describe('Batch 3: directory parameter passing (TO-4/TO-5/TO-6/TO-7)', () => {
  const testDirectory = '/test/project/path';

  describe('TO-4: 同步模式调用传入 directory', () => {
    it('should pass directory to pollSessionCompletion in sync mode (line 641)', async () => {
      // Arrange
      const { client, registerCalls } = createMockClientWithEventBusTracking({
        pollOutputs: ['Task completed [TASK_COMPLETE]'],
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act: Execute sync call with directory
      await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: false,
        },
        { sessionID: 'parent-session', directory: testDirectory },
      );

      // Assert: Event bus register was called (directory is passed to pollSessionCompletion options)
      expect(registerCalls.length).toBeGreaterThan(0);
    });
  });

  describe('TO-5: 异步模式 pollAndComplete 传入 directory', () => {
    it('should pass directory to pollSessionCompletion in pollAndComplete (line 848)', async () => {
      // Arrange
      const { client, registerCalls } = createMockClientWithEventBusTracking({
        pollOutputs: ['Task completed [TASK_COMPLETE]'],
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act 1: Start async task
      const asyncResult = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: true,
        },
        { sessionID: 'parent-session', directory: testDirectory },
      );

      const asyncData = JSON.parse(asyncResult.output);
      expect(asyncData.task_id).toBeDefined();

      // Act 2: Poll for result (triggers pollAndComplete)
      await tools.flowagent_output.execute(
        { task_id: asyncData.task_id, block: true },
        { sessionID: 'parent-session', directory: testDirectory },
      );

      // Assert: Event bus register was called
      expect(registerCalls.length).toBeGreaterThan(0);
    });
  });

  describe('TO-6: watcher 探测模式传入 directory', () => {
    it('should pass directory to pollSessionCompletion in watcher probe mode (line 135)', async () => {
      // Arrange
      const { client, registerCalls } = createMockClientWithEventBusTracking({
        pollOutputs: ['Task completed [TASK_COMPLETE]'],
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act 1: Start async task
      const asyncResult = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: true,
        },
        { sessionID: 'parent-session', directory: testDirectory },
      );

      const asyncData = JSON.parse(asyncResult.output);

      // Act 2: Wait for watcher to process (it runs every 200ms)
      // The watcher will call pollSessionCompletion with probeMode=true
      await new Promise(resolve => setTimeout(resolve, 500));

      // Assert: Event bus register was called (by watcher)
      // Note: watcher uses task.changeDir from BackgroundTaskEntry
      expect(registerCalls.length).toBeGreaterThan(0);
    });
  });

  describe('TO-7: 同步重试 pollOutput 传入 directory', () => {
    it('should pass directory to pollSessionCompletion in retry pollOutput (line 699)', async () => {
      // Arrange: Create output that triggers retry (no completion signal)
      const { client, registerCalls } = createMockClientWithEventBusTracking({
        pollOutputs: [
          'Working on it...', // No completion signal → triggers retry
          'Task completed [TASK_COMPLETE]', // Second attempt has signal
        ],
      });

      const options = createTestOptions(client);
      const tools = createTestTools(options);
      currentTools = tools;

      // Act: Execute sync call (will trigger retry logic)
      await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: false,
        },
        { sessionID: 'parent-session', directory: testDirectory },
      );

      // Assert: Event bus register was called (may be multiple times due to retry)
      expect(registerCalls.length).toBeGreaterThan(0);
    });
  });
});

// ─── Bugfix: nullish 可选参数兼容（null / 空字符串 / "null"） ────────────────
//
// 背景：LLM 主编排器有时会把可选参数显式填成 null 或字符串 "null"：
//   - zod `.optional()` 只接受 undefined，显式传 null 会被 schema 校验直接拒绝
//   - 字符串 "null" 会通过 `if (agent_id)` 真值判断，触发无效 resume
//     （"Agent null not found in subagent-store"）
// 修复：schema 改为 `.nullish()`，execute 层把 null/空串/"null" 归一化为 undefined，
//       使其行为与"省略参数"完全一致。

describe('Bugfix: nullish 可选参数兼容', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    promptCalls = [];
    currentTools = null;
  });

  it('schema: agent_id / session_id 同时接受 null 与 undefined', () => {
    const client = createMockClient({ pollOutputs: ['ok [TASK_COMPLETE]'], promptCalls });
    const tools = createTestTools(createTestOptions(client));
    currentTools = tools;

    // null 被接受（修复前 .optional() 会拒绝）
    expect(tools.call_flow_agent.args.agent_id.safeParse(null).success).toBe(true);
    expect(tools.call_flow_agent.args.session_id.safeParse(null).success).toBe(true);
    // undefined（省略）仍被接受
    expect(tools.call_flow_agent.args.agent_id.safeParse(undefined).success).toBe(true);
    expect(tools.call_flow_agent.args.session_id.safeParse(undefined).success).toBe(true);
    // 正常字符串仍被接受
    expect(tools.call_flow_agent.args.agent_id.safeParse('agent_1').success).toBe(true);
    expect(tools.call_flow_agent.args.session_id.safeParse('session_1').success).toBe(true);
  });

  it('schema: block 同时接受 null 与 undefined', () => {
    const client = createMockClient({ pollOutputs: ['ok [TASK_COMPLETE]'], promptCalls });
    const tools = createTestTools(createTestOptions(client));
    currentTools = tools;

    expect(tools.flowagent_output.args.block.safeParse(null).success).toBe(true);
    expect(tools.flowagent_output.args.block.safeParse(undefined).success).toBe(true);
    expect(tools.flowagent_output.args.block.safeParse(true).success).toBe(true);
    expect(tools.flowagent_output.args.block.safeParse(false).success).toBe(true);
  });

  it('execute: agent_id=null 且 session_id=null 应走新建 session 流程', async () => {
    const client = createMockClient({
      pollOutputs: ['任务完成 [TASK_COMPLETE]'],
      promptCalls,
    });
    const tools = createTestTools(createTestOptions(client));
    currentTools = tools;

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test task',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
        agent_id: null,
        session_id: null,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    // 新建 session（而非复用 null / "null"）
    expect(data.sessionID).toBe('test-session-001');
    expect(promptCalls.length).toBeGreaterThan(0);
    expect(promptCalls[0].id).toBe('test-session-001');
  });

  it('execute: agent_id 为无效字符串（"" / "null" / 空白）应走新建 session 流程', async () => {
    for (const invalidAgentId of ['', 'null', '   ']) {
      promptCalls = [];
      const client = createMockClient({
        pollOutputs: ['任务完成 [TASK_COMPLETE]'],
        promptCalls,
      });
      const tools = createTestTools(createTestOptions(client));
      currentTools = tools;

      const result = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: false,
          agent_id: invalidAgentId,
        },
        { sessionID: 'parent-session', directory: '' },
      );

      const data = JSON.parse(result.output);
      // 修复前 agent_id="null" 会走 resume 分支并报 "Agent null not found in subagent-store"
      expect(data.success).toBe(true);
      expect(data.error).toBeUndefined();
      expect(data.sessionID).toBe('test-session-001');
    }
  });

  it('execute: session_id 为无效字符串（"" / "null"）应新建 session 而非复用', async () => {
    for (const invalidSessionId of ['', 'null']) {
      promptCalls = [];
      const client = createMockClient({
        pollOutputs: ['任务完成 [TASK_COMPLETE]'],
        promptCalls,
      });
      const tools = createTestTools(createTestOptions(client));
      currentTools = tools;

      const result = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: false,
          session_id: invalidSessionId,
        },
        { sessionID: 'parent-session', directory: '' },
      );

      const data = JSON.parse(result.output);
      expect(data.success).toBe(true);
      // 修复前 session_id="null" 会把字面量 "null" 当作 sessionID 复用
      expect(data.sessionID).toBe('test-session-001');
      expect(promptCalls[0].id).toBe('test-session-001');
    }
  });

  it('flowagent_output: block=null 应按默认 false 立即返回（不等待完成）', async () => {
    const client = createMockClient({
      pollOutputs: ['任务完成 [TASK_COMPLETE]'],
      promptCalls,
    });
    const options = createTestOptions(client);
    const tools = createTestTools(options);
    currentTools = tools;

    // 直接注入一个 running 状态任务，避免 watcher 定时器干扰
    const taskId = 'st_block_null_test';
    options.backgroundTaskRegistry.set(taskId, {
      sessionID: 'test-session-001',
      subagentType: 'build-executor',
      status: 'running',
      createdAt: Date.now(),
    });

    const result = await tools.flowagent_output.execute(
      { task_id: taskId, block: null },
      { sessionID: 'parent-session', directory: '' },
    );

    const data = JSON.parse(result.output);
    expect(data.task_id).toBe(taskId);
    // 若错误地按 block=true 处理，pollAndComplete 会把任务推进为 completed
    expect(data.status).toBe('running');
    expect(data.result).toBeUndefined();
  });
});

// ─── Wave 3: 模型级故障转移 (model fallback) 测试 ──────────────────────────────

describe('模型级故障转移 (model fallback)', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    promptCalls = [];
    currentTools = null;
    clearUnavailableModels(); // D-9：每个测试前清理黑名单
  });

  afterEach(() => {
    clearUnavailableModels(); // D-9：每个测试后清理黑名单
  });

  it('F-1: 换模型重试成功（首次 poll 失败 → 拉黑 → 换模型 → 重 prompt → 成功）', async () => {
    // pollFailureAfter=1：第 1 次 poll 失败，第 2 次起恢复 idle
    const client = createMockClient({
      pollOutputs: ['Task completed [TASK_COMPLETE]'],
      promptCalls,
      pollFailure: 'retry-error',
      pollFailureAfter: 1,
    });

    const options = createTestOptions(client);
    // Fallback chain comes ONLY from user config
    (options as any).modelProfiles = {};
    (options as any).configOverrides = {
      'build-executor': { fallback_models: ['provider/alt-1', 'provider/alt-2'] },
    };
    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test fallback',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    const data = JSON.parse(result.output);

    // 断言 1：prompt 调用 2 次（首次 + 换模型重试）
    expect(promptCalls.length).toBe(2);

    // 断言 2：第 2 次 prompt 使用用户配置的 fallback 模型（第一个 fallback = provider/alt-1）
    const secondModel = promptCalls[1].body.model as { providerID: string; modelID: string };
    expect(secondModel.modelID).toBe('alt-1');

    // 断言 3：第 2 次 prompt 原样重发 basePrompt（D-5：不含接管声明，上下文由 session 承载）
    const secondParts = promptCalls[1].body.parts as Array<{ type: string; text: string }>;
    expect(secondParts[0].text).toContain('Build the feature');
    expect(secondParts[0].text).not.toContain('接管');

    // 断言 4：最终成功
    expect(data.success).toBe(true);
    expect(data.model).toContain('alt-1');
  });

  it('F-2: 拉黑生效（故障模型不再被选中）', async () => {
    // 复用 F-1 场景，额外验证 markModelUnavailable 的效果
    const client = createMockClient({
      pollOutputs: ['Task completed [TASK_COMPLETE]'],
      promptCalls,
      pollFailure: 'retry-error',
      pollFailureAfter: 1,
    });

    const options = createTestOptions(client);
    // Fallback chain comes ONLY from user config
    (options as any).modelProfiles = {};
    (options as any).configOverrides = {
      'build-executor': { fallback_models: ['provider/alt-1', 'provider/alt-2'] },
    };
    const tools = createTestTools(options);

    await tools.call_flow_agent.execute(
      {
        description: 'test blacklist',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    // 断言：首次模型 provider/test-model 已被拉黑
    // getAlternativeModel 跳过 currentModel 且跳过黑名单模型（Wave 2：显式传入用户 fallback 链）
    // 验证方式：把所有 fallback 也拉黑后，getAlternativeModel 应返回 null
    const fb = ['provider/alt-1', 'provider/alt-2'];
    // 先验证 alt-1 仍可用（F-1 只拉黑了 test-model）
    const alt1 = getAlternativeModel('provider/test-model', 'build-executor', fb);
    expect(alt1).toBe('provider/alt-1'); // 第一个可用 fallback

    // 再拉黑 alt-1，验证 alt-2 被选中
    markModelUnavailable('provider/alt-1');
    const alt2 = getAlternativeModel('provider/test-model', 'build-executor', fb);
    expect(alt2).toBe('provider/alt-2');

    // 再拉黑 alt-2，验证无可用模型
    markModelUnavailable('provider/alt-2');
    const alt3 = getAlternativeModel('provider/test-model', 'build-executor', fb);
    expect(alt3).toBeNull();

    // 测试结束清理（afterEach 也会清理，但显式清理更安全）
    clearUnavailableModels();
  });

  it('F-3: 换模型次数上限（MAX_MODEL_RETRIES=2，最多 3 次 prompt）', async () => {
    // pollFailure 无 pollFailureAfter = 每次 poll 都失败
    const client = createMockClient({
      pollOutputs: ['irrelevant'],
      promptCalls,
      pollFailure: 'retry-error',
    });

    const options = createTestOptions(client);
    // Fallback chain comes ONLY from user config
    (options as any).modelProfiles = {};
    (options as any).configOverrides = {
      'build-executor': { fallback_models: ['provider/alt-1', 'provider/alt-2'] },
    };
    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test max retries',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    const data = JSON.parse(result.output);

    // 断言 1：prompt 调用 3 次（首次 + 2 次换模型 = MAX_MODEL_RETRIES=2 的语义）
    expect(promptCalls.length).toBe(3);

    // 断言 2：最终失败
    expect(data.success).toBe(false);

    // 断言 3：error 含 exhausted（故障转移耗尽）
    expect(data.error).toContain('exhausted');

    // 断言 4：attempted_models 数组长度为 3（验证 MAX_MODEL_RETRIES=2 语义：首模型 + 2 次换模型）
    expect(data.attempted_models).toBeDefined();
    expect(data.attempted_models.length).toBe(3);

    // 断言 5：3 次 prompt 使用的模型依次为 test-model → alt-1 → alt-2（用户配置 fallback 链）
    const models = promptCalls.map(c => (c.body.model as { providerID: string; modelID: string }).modelID);
    expect(models[0]).toBe('test-model');
    expect(models[1]).toBe('alt-1');
    expect(models[2]).toBe('alt-2');
  });

  it('F-4: 无可用替代模型（getAlternativeModel 返回 null，立即终止）', async () => {
    // 预先拉黑 build-executor 的全部用户配置 fallback（无内置兜底链）
    markModelUnavailable('provider/alt-1');
    markModelUnavailable('provider/alt-2');

    const client = createMockClient({
      pollOutputs: ['irrelevant'],
      promptCalls,
      pollFailure: 'retry-error',
    });

    const options = createTestOptions(client);
    // Fallback chain comes ONLY from user config
    (options as any).modelProfiles = {};
    (options as any).configOverrides = {
      'build-executor': { fallback_models: ['provider/alt-1', 'provider/alt-2'] },
    };
    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test no alternative',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    const data = JSON.parse(result.output);

    // 断言 1：仅 1 次 prompt（首次失败后无替代模型，立即终止）
    expect(promptCalls.length).toBe(1);

    // 断言 2：最终失败
    expect(data.success).toBe(false);

    // 断言 3：error 含 "no alternative model" 或 "exhausted"
    expect(data.error).toMatch(/no alternative model|exhausted/i);
  });

  it('F-5: ContextOverflow 豁免（不拉黑、不换模型）', async () => {
    const client = createMockClient({
      pollOutputs: ['irrelevant'],
      promptCalls,
      pollFailure: 'retry-error',
      assistantErrorName: 'ContextOverflowError',
    });

    const options = createTestOptions(client);
    // Fallback chain comes ONLY from user config
    (options as any).modelProfiles = {};
    (options as any).configOverrides = {
      'build-executor': { fallback_models: ['provider/alt-1', 'provider/alt-2'] },
    };
    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test context overflow',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    const data = JSON.parse(result.output);

    // 断言 1：仅 1 次 prompt（ContextOverflow 不换模型）
    expect(promptCalls.length).toBe(1);

    // 断言 2：最终失败
    expect(data.success).toBe(false);

    // 断言 3：error 含 ContextOverflow 且明确未换模型
    expect(data.error).toContain('ContextOverflow');

    // 断言 4：模型未被拉黑（getAlternativeModel 仍能返回用户 fallback 链第一个）
    const alt = getAlternativeModel('provider/test-model', 'build-executor', ['provider/alt-1', 'provider/alt-2']);
    expect(alt).toBe('provider/alt-1'); // 若未被拉黑，第一个 fallback 仍可用
  });

  it('F-6a: 前置校验失败 HTTP 400 不换模型', async () => {
    const client = createMockClient({
      pollOutputs: ['irrelevant'],
      promptCalls,
      promptFailures: [400],
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test http 400',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    const output = result.output;

    // 断言 1：仅 1 次 prompt（前置校验失败不重试）
    expect(promptCalls.length).toBe(1);

    // 断言 2：返回错误
    expect(output).toContain('HTTP 400');

    // 断言 3：明确"未触发模型故障转移"
    expect(output).toContain('未触发模型故障转移');
  });

  it('F-6b: 前置校验失败 HTTP 404 → 模型级错误，换模拉黑（错误码驱动分类）', async () => {
    const client = createMockClient({
      pollOutputs: ['irrelevant'],
      promptCalls,
      promptFailures: [404],
    });

    const options = createTestOptions(client);
    (options as any).configOverrides = { 'build-executor': { fallback_models: ['provider/alt-model'] } };
    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'test http 404',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    // 404（model not found）是模型级错误：立即换模 + 拉黑（不再 fatal 终止）。
    // promptCalls ≥ 2（初始 404 失败 + 换模重试；mock 输出 'irrelevant' 无完成信号，
    // 可能额外触发 completion-enforcement 重试注入）
    expect(promptCalls.length).toBeGreaterThanOrEqual(2);
    expect(isModelAvailable('provider/test-model')).toBe(false);
    expect(result.output).not.toContain('未触发模型故障转移');
  });

  it('F-7: async pollAndComplete 路径换模型重 prompt（保持 running、不释放槽位）', async () => {
    // pollFailureAfter=1：第 1 次 poll 失败 → tryAsyncModelFallback → 换模型重 prompt → 第 2 次 poll 成功
    const client = createMockClient({
      pollOutputs: ['Task completed [TASK_COMPLETE]'],
      promptCalls,
      pollFailure: 'retry-error',
      pollFailureAfter: 1,
    });

    const options = createTestOptions(client);
    // Fallback chain comes ONLY from user config
    (options as any).modelProfiles = {};
    (options as any).configOverrides = {
      'build-executor': { fallback_models: ['provider/alt-1', 'provider/alt-2'] },
    };
    const tools = createTestTools(options);

    // 启动 async 任务
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'test async fallback',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '/test' },
    );

    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);
    const taskId = startData.task_id;

    // 用 flowagent_output + block=true 触发 pollAndComplete
    const outputResult = await tools.flowagent_output.execute(
      { task_id: taskId, block: true },
      { sessionID: 'parent-session', directory: '/test' },
    );

    const outputData = JSON.parse(outputResult.output);

    // 断言 1：最终成功（故障转移后完成）
    expect(outputData.success).toBe(true);

    // 断言 2：prompt 调用 2 次（初始 + 换模型重 prompt）
    expect(promptCalls.length).toBe(2);

    // 断言 3：第 2 次 prompt 使用用户配置的 fallback 模型
    const secondModel = promptCalls[1].body.model as { providerID: string; modelID: string };
    expect(secondModel.modelID).toBe('alt-1');

    // 断言 4：registry 中 resolvedModel 已变为 fallback 模型
    const task = options.backgroundTaskRegistry.get(taskId);
    expect(task).toBeDefined();
    expect(task?.resolvedModel).toContain('alt-1');
  });
});

// ─── R3-fix：第 3 轮审查修复（P1-1 / P1-2 / P1-3）──────────────────────────

describe('R3-fix P1-1: sync 超时回显不拉黑换模', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    promptCalls = [];
  });

  it('sync 窗口超时但会话仍 busy → 不判模型故障：未拉黑、未换模、prompt 仅 1 次', async () => {
    // 会话一直 busy、消息列表只有编排器发出的 prompt（超时回显）
    let sentText = '';
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
          const parts = args.body.parts as Array<{ type: string; text?: string }>;
          sentText = parts[0]?.text ?? '';
        }),
        messages: mock(async () => ({ data: [{ parts: [{ type: 'text', text: sentText }] }] })),
        status: mock(async () => ({ data: { 'test-session-001': { type: 'busy' } } })),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // 快进时钟：让 sync poll 的 30s 窗口在首次循环条件检查即超时
    const realNow = Date.now;
    let fake = realNow();
    Date.now = () => (fake += 60_000);
    try {
      const result = await tools.call_flow_agent.execute(
        {
          description: 'slow task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: false,
        },
        { sessionID: 'parent-session', directory: '' },
      );
      const data = JSON.parse(result.output);
      expect(data.success).toBe(false);
      expect(data.error).toContain('仍在运行');
    } finally {
      Date.now = realNow;
    }

    // 慢而健康的模型不被拉黑
    expect(isModelAvailable('provider/test-model')).toBe(true);
    // 未换模重发
    expect(promptCalls.length).toBe(1);
  });
});

// ─── P2-1′：sync 换模记录必须进 registry（护栏读 attemptedModels）──────────────

describe('P2-1′: sync 换模后 registry 条目写入 attemptedModels', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;
  let registry: BackgroundTaskRegistry;

  /** 首发送失败（402 非瞬态）→ 触发 sync 换模；后续 poll 返回成功产出 */
  function createSyncFallbackClient() {
    return {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
          // 首次发送即配额错误（非瞬态，可分类）；换模重发成功
          const model = args.body.model as { providerID: string; modelID: string };
          if (model.modelID === 'test-model') {
            throw Object.assign(new Error('quota exceeded'), {
              status: 402,
              data: { status: 402 },
            });
          }
        }),
        messages: mock(async () => ({
          data: [{ parts: [{ type: 'text', text: 'Build done [TASK_COMPLETE]' }] }],
        })),
        status: mock(async () => ({ data: { 'test-session-001': { type: 'idle' } } })),
        abort: mock(async () => {}),
      },
    } as const;
  }

  beforeEach(() => {
    promptCalls = [];
    registry = new Map();
  });

  it('sync 换模成功后条目带完整 attemptedModels（护栏可识别已换模）', async () => {
    const client = createSyncFallbackClient();
    const options = createTestOptions(client);
    options.backgroundTaskRegistry = registry;
    (options as Record<string, unknown>).modelProfiles = {};
    (options as Record<string, unknown>).configOverrides = {
      'build-executor': { fallback_models: ['provider/alt-1'] },
    };
    const tools = createTestTools(options);

    const result = await tools.call_flow_agent.execute(
      {
        description: 'sync fallback',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    expect(JSON.parse(result.output).success).toBe(true);

    // 关键断言：换模发生的依据是 entry.attemptedModels.length > 1（护栏判据）
    const entries = [...registry.values()];
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.resolvedModel).toBe('provider/alt-1');
    expect(entry.attemptedModels).toEqual(['provider/test-model', 'provider/alt-1']);
  });

  it('护栏判据成立：sync 换模后迟到旧模型事件不拉黑健康模型', async () => {
    const client = createSyncFallbackClient();
    const options = createTestOptions(client);
    options.backgroundTaskRegistry = registry;
    (options as Record<string, unknown>).modelProfiles = {};
    (options as Record<string, unknown>).configOverrides = {
      'build-executor': { fallback_models: ['provider/alt-1'] },
    };
    const tools = createTestTools(options);

    await tools.call_flow_agent.execute(
      {
        description: 'sync fallback',
        prompt: 'Build the feature',
        subagent_type: 'build-executor',
        run_in_background: false,
      },
      { sessionID: 'parent-session', directory: '' },
    );

    // 以工厂同款护栏反查该条目：已换模 → 返回 undefined（不拉黑，交由轮询路径）
    const { sessionErrorModelForBlacklist } = await import('../../features/session-error-fence.js');
    const entry = [...registry.values()][0];
    expect(sessionErrorModelForBlacklist(entry)).toBeUndefined();
  });
});

describe('R3-fix P1-2: pollAndComplete 初次 poll 回显不判 completed', () => {
  it('prompt 含 Markdown 标题 + 初次 poll 返回回显 → 不判 completed、不换模', async () => {
    const promptCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
    let sentText = '';
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
          const parts = args.body.parts as Array<{ type: string; text?: string }>;
          sentText = parts[0]?.text ?? '';
        }),
        // 会话 idle 但消息列表只有 prompt（无 assistant 消息）→ poll 返回回显
        messages: mock(async () => ({ data: [{ parts: [{ type: 'text', text: sentText }] }] })),
        status: mock(async () => ({ data: { 'test-session-001': { type: 'idle' } } })),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client);
    const tools = createTestTools(options);
    // 隔离 watcher：本用例只验证 pollAndComplete 自身判定
    (tools as { _stopWatcher?: () => void })._stopWatcher?.();

    // 启动 background 任务（prompt 含 Markdown 标题——回显若被 hasRealOutput 判过即误判）
    const startResult = await tools.call_flow_agent.execute(
      {
        description: 'markdown prompt task',
        prompt: '## 执行计划\n\n请构建功能并输出报告',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );
    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // 触发 pollAndComplete（block=true）
    const outputResult = await tools.flowagent_output.execute(
      { task_id: taskId, block: true },
      { sessionID: 'parent-session', directory: '' },
    );
    const outputData = JSON.parse(outputResult.output);

    // 回显不得被判为成功产出：保持 running
    expect(outputData.status).toBe('running');
    expect(outputData.result).toBeFalsy();
    // 初次 poll 回显不触发换模（prompt 仅 1 次）
    expect(promptCalls.length).toBe(1);

    const task = options.backgroundTaskRegistry.get(taskId);
    expect(task?.status).toBe('running');
  });
});

describe('R3-fix P1-3: background reserve-then-dispatch', () => {
  it('并发槽位已满时不发送 prompt（不产生孤儿 session）', async () => {
    const promptCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        // 会话持续 busy → 3 个已启动任务保持 running、持续占位
        messages: mock(async () => ({ data: [] })),
        status: mock(async () => ({ data: { 'test-session-001': { type: 'busy' } } })),
        abort: mock(async () => {}),
      },
    };

    const options = createTestOptions(client);
    const tools = createTestTools(options);
    // 停掉 watcher：已占位的 3 个任务由 mock 保持 running，确定性不受 tick 干扰
    (tools as { _stopWatcher?: () => void })._stopWatcher?.();

    const base = {
      description: 't',
      prompt: 'work',
      subagent_type: 'build-executor',
      run_in_background: true,
    };

    // 占满 3 个并发槽位（MAX_CONCURRENT_SUBAGENTS = 3）
    for (let i = 0; i < 3; i++) {
      const r = await tools.call_flow_agent.execute(
        { ...base, description: `task ${i}` },
        { sessionID: 'parent-session', directory: '' },
      );
      expect(JSON.parse(r.output).success).toBe(true);
    }
    expect(promptCalls.length).toBe(3);

    // 第 4 次调用：槽位满 → 必须返回并发错误且【未发送 prompt】
    const r4 = await tools.call_flow_agent.execute(
      { ...base, description: 'task 4' },
      { sessionID: 'parent-session', directory: '' },
    );
    const d4 = JSON.parse(r4.output);
    expect(d4.success).toBe(false);
    expect(String(d4.error)).toContain('Concurrency limit');
    // 关键断言：旧实现先发 prompt 后占位 → 第 4 次 prompt 已发出（孤儿 session）
    expect(promptCalls.length).toBe(3);
  });

  it('占位成功但首发送失败时释放槽位（不泄漏）', async () => {
    const promptCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
    // 首次 prompt 失败（HTTP 400 前置校验失败，D-7 不换模），其后成功
    const client = createMockClient({
      pollOutputs: ['Task done [TASK_COMPLETE]'],
      promptCalls,
      promptFailures: [400],
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);

    // 第 1 次 background 调用：占位成功 → send 失败 → 必须释放槽位
    const r1 = await tools.call_flow_agent.execute(
      {
        description: 'failing send',
        prompt: 'work',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );
    const d1 = JSON.parse(r1.output);
    expect(d1.success).toBe(false);

    // 槽位已释放：第 2 次调用可以正常占位并启动（否则会命中 Concurrency limit）
    const r2 = await tools.call_flow_agent.execute(
      {
        description: 'retry after release',
        prompt: 'work',
        subagent_type: 'build-executor',
        run_in_background: true,
      },
      { sessionID: 'parent-session', directory: '' },
    );
    const d2 = JSON.parse(r2.output);
    expect(d2.success).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 500));
    const task = options.backgroundTaskRegistry.get(d2.task_id);
    expect(task?.status).toBe('completed');
  });
});

// ─── FIX-P3-2: no-valid-output 路径补写降级通知 ─────────────────────────────

describe('FIX-P3-2: no-valid-output 路径补写降级通知', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    promptCalls = [];
    currentTools = null;
  });

  /** 读取 changeDir 下通知目录中的全部通知 JSON */
  async function readNotifications(changeDir: string): Promise<Array<Record<string, unknown>>> {
    const notifDir = join(changeDir, '.flow-engine/sflow/notifications');
    try {
      const { readdir, readFile } = await import('node:fs/promises');
      const files = (await readdir(notifDir)).filter((f) => f.endsWith('.json'));
      const entries: Array<Record<string, unknown>> = [];
      for (const f of files) {
        const raw = await readFile(join(notifDir, f), 'utf-8');
        entries.push(JSON.parse(raw));
      }
      return entries;
    } catch {
      return [];
    }
  }

  it('① 异步模式首个产出无完成信号（noSignal 终结）→ 写入通知且含 no-valid-output 原因', async () => {
    const client = createMockClient({
      pollOutputs: ['The agent is still thinking about the approach and has not produced a final answer yet.'],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createTestTools(options);
    currentTools = tools;

    const tmp = await mkdtemp(join(tmpdir(), 'w5-notif-'));
    try {
      const startResult = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: true,
        },
        { sessionID: 'parent-session', directory: tmp },
      );
      const taskId = JSON.parse(startResult.output).task_id;

      await tools.flowagent_output.execute(
        { task_id: taskId, block: true },
        { sessionID: 'parent-session', directory: tmp },
      );

      const task = options.backgroundTaskRegistry.get(taskId);
      expect(task?.status).toBe('error');

      const notifs = await readNotifications(tmp);
      const match = notifs.find((n) => n.task_id === taskId);
      expect(match).toBeDefined();
      expect(match?.type).toBe('async_error');
      expect(match?.failure_reason).toBe('no-valid-output');
      expect(match?.has_completion_signal).toBe(false);
      expect(String(match?.summary)).toContain('no completion signal');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('② watcher 换模耗尽后 re-probe 仍无有效产出（其它无有效产出终结分支）→ 写入通知', async () => {
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'watch-session-002' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => ({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { info: { role: 'assistant' }, parts: [{ type: 'text', text: '未完成的占位输出' }] },
          ],
        })),
        status: mock(async () => ({ data: { 'watch-session-002': { type: 'idle' } } })),
        abort: mock(async () => {}),
      },
    };

    const tmp = await mkdtemp(join(tmpdir(), 'w5-notif-'));
    try {
      const registry: BackgroundTaskRegistry = new Map();
      registry.set('watch-task-002', {
        sessionID: 'watch-session-002',
        subagentType: 'build-executor',
        status: 'running',
        createdAt: Date.now(),
        changeDir: tmp,
        resolvedModel: 'provider/no-signal-primary',
        attemptedModels: ['provider/no-signal-primary'],
      });
      const watcher = createBackgroundTaskWatcher({
        client: client as never,
        registry,
        pollIntervalMs: 20,
        extraFallbacks: [],
      });
      watcher.start();
      await waitFor(() => registry.get('watch-task-002')?.status === 'error');
      watcher.stop();

      const task = registry.get('watch-task-002');
      expect(task?.status).toBe('error');
      expect(task?.error).toContain('no completion signal');

      const notifs = await readNotifications(tmp);
      const match = notifs.find((n) => n.task_id === 'watch-task-002');
      expect(match).toBeDefined();
      expect(match?.type).toBe('async_error');
      expect(match?.failure_reason).toBe('no-valid-output');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('③ 假产出放弃路径（换模 re-poll 仍无有效产出 → 终结 noSignal）→ 写入通知', async () => {
    // 首轮 poll 返回错误码文本触发换模（一次 fallback），re-poll 返回非完成信号/
    // 非结构化报告的"假产出" → 落入 no-valid-output 终结分支（pollAndComplete
    // re-poll 路径），与 watcher 的 finalizeAsyncNoSignal 一致补写降级通知。
    const client = createMockClient({
      pollOutputs: [
        'Error: internal provider failure (code: 500)',
        'The agent is still thinking about the approach and has not produced a final answer yet.',
      ],
      promptCalls,
    });

    const tmp = await mkdtemp(join(tmpdir(), 'w5-notif-'));
    try {
      const options = createTestOptions(client);
      // 注入用户 fallback 链，使首轮错误码触发一次换模并进入 re-poll
      (options as Record<string, unknown>).configOverrides = {
        'build-executor': { fallback_models: ['provider/alt-model'] },
      };
      const tools = createTestTools(options);
      currentTools = tools;

      const startResult = await tools.call_flow_agent.execute(
        {
          description: 'test task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: true,
        },
        { sessionID: 'parent-session', directory: tmp },
      );
      const taskId = JSON.parse(startResult.output).task_id;

      await tools.flowagent_output.execute(
        { task_id: taskId, block: true },
        { sessionID: 'parent-session', directory: tmp },
      );

      const task = options.backgroundTaskRegistry.get(taskId);
      expect(task?.status).toBe('error');
      expect(task?.error).toContain('no completion signal');

      // 等待通知落盘（finalize 先置 status 再 await 写通知，存在竞态窗口）
      await waitFor(async () => {
        const ns = await readNotifications(tmp);
        return ns.some((n) => n.task_id === taskId);
      });

      const notifs = await readNotifications(tmp);
      const match = notifs.find((n) => n.task_id === taskId);
      expect(match).toBeDefined();
      expect(match?.type).toBe('async_error');
      expect(match?.failure_reason).toBe('no-valid-output');
      expect(match?.has_completion_signal).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('④ completed/error 通知行为不回归（含类型与字段断言）', async () => {
    // completed 分支
    const completedClient = createMockClient({
      pollOutputs: ['任务已完成 [TASK_COMPLETE]'],
      promptCalls,
    });
    const tmpCompleted = await mkdtemp(join(tmpdir(), 'w5-notif-'));
    try {
      const options = createTestOptions(completedClient);
      const tools = createTestTools(options);
      currentTools = tools;
      const startResult = await tools.call_flow_agent.execute(
        {
          description: 'completed task',
          prompt: 'Build the feature',
          subagent_type: 'build-executor',
          run_in_background: true,
        },
        { sessionID: 'parent-session', directory: tmpCompleted },
      );
      const taskId = JSON.parse(startResult.output).task_id;
      await tools.flowagent_output.execute(
        { task_id: taskId, block: true },
        { sessionID: 'parent-session', directory: tmpCompleted },
      );
      expect(options.backgroundTaskRegistry.get(taskId)?.status).toBe('completed');

      const notifs = await readNotifications(tmpCompleted);
      const match = notifs.find((n) => n.task_id === taskId);
      expect(match).toBeDefined();
      expect(match?.type).toBe('async_completed');
      expect(match?.failure_reason).toBeUndefined();
    } finally {
      await rm(tmpCompleted, { recursive: true, force: true });
    }

    // error 分支（retry 耗尽 → async_error）
    const errorClient = {
      session: {
        create: mock(async () => ({ data: { id: 'err-session-004' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => ({ data: [] })),
        status: mock(async () => ({
          data: { 'err-session-004': { type: 'retry', attempt: 5, next: 0 } },
        })),
        abort: mock(async () => {}),
      },
    };
    const tmpError = await mkdtemp(join(tmpdir(), 'w5-notif-'));
    try {
      const registry: BackgroundTaskRegistry = new Map();
      registry.set('watch-task-004', {
        sessionID: 'err-session-004',
        subagentType: 'build-executor',
        status: 'running',
        createdAt: Date.now(),
        changeDir: tmpError,
        resolvedModel: 'provider/error-primary',
        attemptedModels: ['provider/error-primary'],
      });
      const watcher = createBackgroundTaskWatcher({
        client: errorClient as never,
        registry,
        pollIntervalMs: 20,
        extraFallbacks: [],
      });
      watcher.start();
      await waitFor(() => registry.get('watch-task-004')?.status === 'error');
      watcher.stop();

      expect(registry.get('watch-task-004')?.status).toBe('error');

      // 等待通知落盘（finalize 先置 status 再 await 写通知，存在竞态窗口）
      await waitFor(async () => {
        const ns = await readNotifications(tmpError);
        return ns.some((n) => n.task_id === 'watch-task-004');
      });

      const notifs = await readNotifications(tmpError);
      const match = notifs.find((n) => n.task_id === 'watch-task-004');
      expect(match).toBeDefined();
      expect(match?.type).toBe('async_error');
    } finally {
      await rm(tmpError, { recursive: true, force: true });
    }
  });
});
