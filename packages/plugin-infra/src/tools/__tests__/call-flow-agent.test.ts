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

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createCallFlowAgentTools } from '../call-flow-agent.js';
import type { BackgroundTaskRegistry, AgentModelMap } from '../../types.js';

// ─── Test helpers ──────────────────────────────────────────────────────────

/** Create a mock SFlowClient with controllable session behavior */
function createMockClient(options: {
  pollOutputs: string[];  // outputs returned by pollSessionCompletion in sequence
  promptCalls?: Array<{ id: string; body: Record<string, unknown> }>;
}) {
  let pollIndex = 0;
  const promptCalls = options.promptCalls ?? [];

  return {
    session: {
      create: mock(async (args: { body: Record<string, unknown>; query?: Record<string, unknown> }) => {
        return { data: { id: 'test-session-001' } };
      }),
      prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
        promptCalls.push({ id: args.path.id, body: args.body });
        // Simulate the subagent producing new output after reminder injection
        // by advancing the pollIndex
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
  const agentModelMap: AgentModelMap = { 'build-executor': 'test-model' };

  return {
    client: client as unknown as import('../../types.js').SFlowClient,
    backgroundTaskRegistry,
    backgroundTaskCounter,
    agentModelMap,
    sessionLabelPrefix: 'sFlow',
    validateAgent: async (subagentType: string) => null,
    workflowName: 'sFlow',
  };
}

// ─── P3: 异步模式 completion enforcement ────────────────────────────────────

describe('P3: 异步模式 completion enforcement', () => {
  let backgroundTaskRegistry: BackgroundTaskRegistry;
  let backgroundTaskCounter: { value: number };
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  beforeEach(() => {
    backgroundTaskRegistry = new Map();
    backgroundTaskCounter = { value: 0 };
    promptCalls = [];
  });

  it('should skip retry when async output has no completion signal', async () => {
    // The async task outputs plain text without completion signal
    // Async mode skips P3 completion enforcement → returns result as-is, no warning
    const client = createMockClient({
      pollOutputs: [
        '我正在处理这个任务...',  // initial poll output (no signal)
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createCallFlowAgentTools(options);

    // Step 1: Start async task
    const startResult = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: true,
    }, { sessionID: 'parent-session', directory: '' });

    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);
    const taskId = startData.task_id;

    // Step 2: Poll for result with block=true
    const outputResult = await tools.flowagent_output.execute({
      task_id: taskId,
      block: true,
    }, { sessionID: 'parent-session', directory: '' });

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
        '任务已完成 [TASK_COMPLETE]',  // initial poll has signal
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createCallFlowAgentTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: true,
    }, { sessionID: 'parent-session', directory: '' });

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute({
      task_id: taskId,
      block: true,
    }, { sessionID: 'parent-session', directory: '' });

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    // Should NOT have warning because completion signal was detected
    expect(outputData.warning).toBeUndefined();
    // Should NOT have injected any reminders (filter for REMINDER_MESSAGE parts)
    const reminderCalls = promptCalls.filter(call => {
      const parts = call.body.parts as Array<{ type: string; text: string }>;
      return parts?.some(p => p.text?.includes('[TASK_COMPLETE]') || p.text?.includes('尚未完成'));
    });
    expect(reminderCalls.length).toBe(0);
  });

  it('should NOT inject reminder in async mode when output lacks completion signal', async () => {
    // Async mode does NOT retry → no reminders injected
    const client = createMockClient({
      pollOutputs: [
        'incomplete output',       // initial (no signal, but async mode skips retry)
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createCallFlowAgentTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: true,
    }, { sessionID: 'parent-session', directory: '' });

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    await tools.flowagent_output.execute({
      task_id: taskId,
      block: true,
    }, { sessionID: 'parent-session', directory: '' });

    // Verify NO reminders were injected (async mode skips P3 completion enforcement)
    const reminderCalls = promptCalls.filter(call => {
      const parts = call.body.parts as Array<{ type: string; text: string }>;
      return parts?.some(p => p.text?.includes('[TASK_COMPLETE]') || p.text?.includes('尚未完成'));
    });
    expect(reminderCalls.length).toBe(0);
  });

  it('should stop retrying when completion signal appears after reminder', async () => {
    // First poll: no signal → retry → second poll: has signal
    const client = createMockClient({
      pollOutputs: [
        'working on it...',              // initial (no signal)
        '任务完成 [TASK_COMPLETE]',       // after 1st retry (has signal)
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createCallFlowAgentTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: true,
    }, { sessionID: 'parent-session', directory: '' });

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute({
      task_id: taskId,
      block: true,
    }, { sessionID: 'parent-session', directory: '' });

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
      pollOutputs: [
        'partial output 1',
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createCallFlowAgentTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: true,
    }, { sessionID: 'parent-session', directory: '' });

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute({
      task_id: taskId,
      block: true,
    }, { sessionID: 'parent-session', directory: '' });

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    // Async mode does NOT apply P3 completion enforcement → no warning
    expect(outputData.warning).toBeUndefined();
  });

  it('should detect JSON code fence as completion signal in async mode', async () => {
    const client = createMockClient({
      pollOutputs: [
        '```json\n{"files_changed": ["a.ts"], "tests_passed": true}\n```',
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createCallFlowAgentTools(options);

    // Start async task
    const startResult = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: true,
    }, { sessionID: 'parent-session', directory: '' });

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute({
      task_id: taskId,
      block: true,
    }, { sessionID: 'parent-session', directory: '' });

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
        '任务已完成 [TASK_COMPLETE]',  // has completion signal, but no JSON
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createCallFlowAgentTools(options);

    const result = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: false,
      output_mode: 'structured',
    }, { sessionID: 'parent-session', directory: '' });

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
    const tools = createCallFlowAgentTools(options);

    const result = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: false,
      output_mode: 'structured',
    }, { sessionID: 'parent-session', directory: '' });

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.structured_output).toEqual({ files_changed: ['a.ts'], tests_passed: true, blockers: [] });
    // No structured warning because extraction succeeded
    expect(data.warnings).toBeUndefined();
  });

  it('sync mode: completionWarning + structuredWarning 应合并为 warnings 数组', async () => {
    // Use a non-exempt agent type so completion retry triggers and produces a warning
    // 'verifier' is NOT in DEFAULT_COMPLETION_EXEMPT_AGENTS
    const client = createMockClient({
      pollOutputs: [
        'partial output without signal or json',
        'still no signal or json after retry',
      ],
      promptCalls,
    });

    const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
    const backgroundTaskCounter = { value: 0 };
    // Use 'verifier' which is NOT in the exempt list
    const agentModelMap: AgentModelMap = { 'verifier': 'test-model' };

    const options = {
      client: client as unknown as import('../../types.js').SFlowClient,
      backgroundTaskRegistry,
      backgroundTaskCounter,
      agentModelMap,
      sessionLabelPrefix: 'sFlow',
      validateAgent: async (subagentType: string) => null,
      workflowName: 'sFlow',
    };

    const tools = createCallFlowAgentTools(options);

    const result = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'verifier',
      run_in_background: false,
      output_mode: 'structured',
    }, { sessionID: 'parent-session', directory: '' });

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    // Both warnings should be merged into warnings array
    expect(data.warnings).toBeDefined();
    expect(Array.isArray(data.warnings)).toBe(true);
    expect(data.warnings.length).toBeGreaterThanOrEqual(2);
    expect(data.warnings).toContain('structured output extraction failed, fallback to raw text');
    // completionWarning should also be present (from P3 completion retry)
    const hasCompletionWarning = data.warnings.some((w: string) =>
      w.includes('incomplete') || w.includes('未检测到') || w.includes('retry') || w.includes('completion signal'),
    );
    expect(hasCompletionWarning).toBe(true);
  });

  it('sync mode: last_message 模式不应产生 structured warning', async () => {
    const client = createMockClient({
      pollOutputs: [
        '任务已完成 [TASK_COMPLETE]',
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createCallFlowAgentTools(options);

    const result = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: false,
      output_mode: 'last_message',
    }, { sessionID: 'parent-session', directory: '' });

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
        '任务已完成 [TASK_COMPLETE]',  // has completion signal, but no JSON
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createCallFlowAgentTools(options);

    // Start async task with structured mode
    const startResult = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: true,
      output_mode: 'structured',
    }, { sessionID: 'parent-session', directory: '' });

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute({
      task_id: taskId,
      block: true,
    }, { sessionID: 'parent-session', directory: '' });

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    // structured_output should be null (extraction failed)
    expect(outputData.structured_output).toBeNull();
    // warnings array should contain structured extraction failure warning
    expect(outputData.warnings).toBeDefined();
    expect(Array.isArray(outputData.warnings)).toBe(true);
    expect(outputData.warnings).toContain('structured output extraction failed, fallback to raw text');
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
    const tools = createCallFlowAgentTools(options);

    // Start async task with structured mode
    const startResult = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: true,
      output_mode: 'structured',
    }, { sessionID: 'parent-session', directory: '' });

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute({
      task_id: taskId,
      block: true,
    }, { sessionID: 'parent-session', directory: '' });

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    expect(outputData.structured_output).toEqual({ files_changed: ['a.ts'], tests_passed: true, blockers: [] });
    // No structured warning because extraction succeeded
    expect(outputData.warnings).toBeUndefined();
  });

  it('async mode: last_message 模式不应产生 structured warning', async () => {
    const client = createMockClient({
      pollOutputs: [
        '任务已完成 [TASK_COMPLETE]',
      ],
      promptCalls,
    });

    const options = createTestOptions(client);
    const tools = createCallFlowAgentTools(options);

    // Start async task with last_message mode (default)
    const startResult = await tools.call_flow_agent.execute({
      description: 'test task',
      prompt: 'Build the feature',
      subagent_type: 'build-executor',
      run_in_background: true,
    }, { sessionID: 'parent-session', directory: '' });

    const startData = JSON.parse(startResult.output);
    const taskId = startData.task_id;

    // Poll for result
    const outputResult = await tools.flowagent_output.execute({
      task_id: taskId,
      block: true,
    }, { sessionID: 'parent-session', directory: '' });

    const outputData = JSON.parse(outputResult.output);
    expect(outputData.success).toBe(true);
    expect(outputData.warnings).toBeUndefined();
    expect(outputData.warning).toBeUndefined();
  });
});
