/**
 * 错误码驱动的模型故障分类测试（classifyModelErrorByCode）
 *
 * 契约依据：provider-scaffold SKILL.md 提供商错误码规范 —
 * - 瞬态错误（408/409/429/5xx）：isRetryable=true，重试耗尽 → fallback
 * - 非瞬态错误（配额耗尽/参数/账号级持久错误）：归一化为 402（401/403 保留原码）
 *   → isRetryable=false → 立即 fallback（重试无意义）
 * - 真实事故样例：iFlow 子代理英文配额报文未触发 fallback，错误文本被当正常产出返回
 *
 * 覆盖：分类器单元 + 三路径（sync / async watcher / pollAndComplete）端到端
 */

import { beforeEach, describe, expect, it, mock, afterEach } from 'bun:test';
import type { AgentModelMap, BackgroundTaskRegistry } from '../../types.js';
import { createCallFlowAgentTools, resetRunningSubagentCounts, runWithModelFallback, createBackgroundTaskWatcher } from '../call-flow-agent.js';
import { clearUnavailableModels, isModelAvailable, TRANSIENT_COOLDOWN_TTL_MS } from '../../agents/agent-builder.js';
import { classifyModelErrorByCode, classifyQuotaError } from '../../helpers/completion-detector.js';

/** 真实事故样例：iFlow 子代理英文配额报文（原文） */
const REAL_QUOTA_SAMPLE =
  'You have used up your free quota for the current cycle (used 10083874 tokens). ' +
  'Your quota will automatically reset at 2026-09-30 00:00:00. ' +
  'For a higher quota, please complete real-name verification.';

function advanceClock(offsetMs: number): () => void {
  const realNow = Date.now;
  Date.now = () => realNow() + offsetMs;
  return () => {
    Date.now = realNow;
  };
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ─── 分类器单元 ───────────────────────────────────────────────────────────────

describe('classifyModelErrorByCode: 错误码驱动分类', () => {
  it('真实事故样例：英文配额报文 → non-transient + 解析重置时间', () => {
    const info = classifyModelErrorByCode(REAL_QUOTA_SAMPLE);
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('non-transient');
    // "2026-09-30 00:00:00" 无时区标记 → 按本地时间解释
    expect(info!.resetAt).toBe(new Date(2026, 8, 30, 0, 0, 0).getTime());
  });

  it('嵌入 JSON（type=ModelServiceRateLimit, code=403）→ non-transient', () => {
    const text = '{"message":"model service rejected","type":"ModelServiceRateLimit","code":"403"}';
    const info = classifyModelErrorByCode(text);
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('non-transient');
  });

  it('"code":"402" / "code":402 / HTTP 402 → non-transient', () => {
    for (const text of ['{"message":"payment required","code":"402"}', '{"code":402}', 'HTTP 402: request failed']) {
      const info = classifyModelErrorByCode(text);
      expect(info).not.toBeNull();
      expect(info!.kind).toBe('non-transient');
    }
  });

  it('type-only（无 code）ModelServiceRateLimit → non-transient', () => {
    const info = classifyModelErrorByCode('{"message":"limited","type":"ModelServiceRateLimit"}');
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('non-transient');
  });

  it('status: 429 → transient', () => {
    const info = classifyModelErrorByCode('status: 429 too many requests');
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('transient');
  });

  it('(code: 500) → transient', () => {
    const info = classifyModelErrorByCode('Error: internal provider failure (code: 500)');
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('transient');
  });

  it('send status 参数兜底：message 无码时按 status 分类', () => {
    expect(classifyModelErrorByCode('request failed', 402)?.kind).toBe('non-transient');
    expect(classifyModelErrorByCode('request failed', 403)?.kind).toBe('non-transient');
    expect(classifyModelErrorByCode('request failed', 429)?.kind).toBe('transient');
    expect(classifyModelErrorByCode('request failed', 503)?.kind).toBe('transient');
    // 400：请求级错误（SessionBusy 等），不分类（保持 fatal）
    expect(classifyModelErrorByCode('request failed', 400)).toBeNull();
  });

  it('非错误文本 → null（none）', () => {
    expect(classifyModelErrorByCode('[TASK_COMPLETE]\nSummary: all done')).toBeNull();
    expect(classifyModelErrorByCode('')).toBeNull();
  });

  it('404 视为模型级错误 → non-transient（换模拉黑更合理）', () => {
    const info = classifyModelErrorByCode('HTTP 404: model not found');
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('non-transient');
  });

  it('文本模式兜底：分类器 none 时 classifyQuotaError 补英文 used up/reset 语境', () => {
    const text = 'You have used up your quota for this cycle. It will reset at a later time.';
    expect(classifyModelErrorByCode(text)?.kind ?? classifyQuotaError(text)).toBeTruthy();
    expect(classifyQuotaError(text)).not.toBeNull();
  });
});

// ─── Send 阶段：runWithModelFallback ─────────────────────────────────────────

describe('错误码驱动: send 阶段接线（runWithModelFallback）', () => {
  beforeEach(() => clearUnavailableModels());
  afterEach(() => clearUnavailableModels());

  function makeClient(opts: { outputs: Array<string | null>; sendFailures?: Array<number | null>; sendMessages?: Array<string | undefined> }) {
    let pollIdx = 0;
    let sendIdx = 0;
    return {
      client: {
        session: {
          prompt: mock(async () => {
            if (sendIdx < (opts.sendFailures?.length ?? 0)) {
              const f = opts.sendFailures![sendIdx];
              const msg = opts.sendMessages?.[sendIdx];
              sendIdx++;
              if (f !== null) {
                const err = new Error(msg ?? `HTTP ${f}: request failed`);
                (err as unknown as { cause: unknown }).cause = { status: f, body: {} };
                throw err;
              }
            } else {
              sendIdx++;
            }
          }),
          messages: mock(async () => ({ data: [] })),
          status: mock(async () => ({ data: {} })),
          create: mock(async () => ({ data: { id: 's1' } })),
          abort: mock(async () => {}),
        },
      },
      getOutput: () => {
        const o = opts.outputs[Math.min(pollIdx, opts.outputs.length - 1)];
        pollIdx++;
        return o;
      },
    };
  }

  const baseParams = (c: ReturnType<typeof makeClient>, poll: (sid: string, m: string) => Promise<string | null>) => ({
    client: c.client as never,
    sessionID: 's1',
    agentName: 'build-executor',
    basePrompt: 'do the work',
    initialModel: 'provider/first-model',
    maxWaitMs: 100,
    directory: '',
    poll,
  });

  it('send 402 → 立即换模（不再 fatal）', async () => {
    const c = makeClient({ outputs: [], sendFailures: [402] });
    const result = await runWithModelFallback({ ...baseParams(c, async () => '[TASK_COMPLETE]\nDone') });
    expect(result.success).toBe(true);
    expect(result.model).not.toBe('provider/first-model');
    expect(result.fallbacks.length).toBe(1);
    expect(isModelAvailable('provider/first-model')).toBe(false);
  });

  it('send 402 + 配额报文 → 长冷却拉黑（重置时间 TTL）', async () => {
    const c = makeClient({ outputs: [], sendFailures: [402], sendMessages: [REAL_QUOTA_SAMPLE] });
    const result = await runWithModelFallback({ ...baseParams(c, async () => '[TASK_COMPLETE]\nDone') });
    expect(result.success).toBe(true);
    expect(isModelAvailable('provider/first-model')).toBe(false);
    // 长冷却：5min+1s 后仍 blocked
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/first-model')).toBe(false);
    } finally {
      restore();
    }
  });

  it('send 400（SessionBusy）仍 fatal', async () => {
    const c = makeClient({ outputs: [], sendFailures: [400] });
    const result = await runWithModelFallback({ ...baseParams(c, async () => '[TASK_COMPLETE]\nDone') });
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('fatal');
  });

  it('send 404 → 换模拉黑（模型级错误，不再 fatal）', async () => {
    const c = makeClient({ outputs: [], sendFailures: [404] });
    const result = await runWithModelFallback({ ...baseParams(c, async () => '[TASK_COMPLETE]\nDone') });
    expect(result.success).toBe(true);
    expect(result.model).not.toBe('provider/first-model');
    expect(isModelAvailable('provider/first-model')).toBe(false);
  });

  it('send 429/503 → 换模 + 5min 短拉黑', async () => {
    const c = makeClient({ outputs: [], sendFailures: [429] });
    const result = await runWithModelFallback({ ...baseParams(c, async () => '[TASK_COMPLETE]\nDone') });
    expect(result.success).toBe(true);
    expect(isModelAvailable('provider/first-model')).toBe(false);
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/first-model')).toBe(true);
    } finally {
      restore();
    }
  });

  it('sync E2E：poll 返回真实事故样例 → 不判 success、长冷却拉黑、换模', async () => {
    const c = makeClient({ outputs: [] });
    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      return pollCount === 1 ? REAL_QUOTA_SAMPLE : '[TASK_COMPLETE]\nDone';
    };
    const result = await runWithModelFallback({ ...baseParams(c, poll) });
    expect(result.success).toBe(true);
    expect(result.model).not.toBe('provider/first-model');
    expect(result.fallbacks.length).toBe(1);
    expect(isModelAvailable('provider/first-model')).toBe(false);
    expect(pollCount).toBe(2);
    // 长冷却：5min+1s 后仍 blocked
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/first-model')).toBe(false);
    } finally {
      restore();
    }
  });
});

// ─── Poll 阶段：async watcher 路径 ───────────────────────────────────────────

describe('错误码驱动: async watcher 路径接线', () => {
  beforeEach(() => clearUnavailableModels());
  afterEach(() => {
    resetRunningSubagentCounts();
    clearUnavailableModels();
  });

  function createWatcherClient(opts: { probeOutputs: string[] }) {
    let msgIdx = 0;
    const promptCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
    return {
      promptCalls,
      client: {
        session: {
          create: mock(async () => ({ data: { id: 'watch-session' } })),
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            promptCalls.push({ id: args.path.id, body: args.body });
          }),
          messages: mock(async () => {
            const output = opts.probeOutputs[Math.min(msgIdx, opts.probeOutputs.length - 1)];
            msgIdx++;
            return {
              data: [
                { parts: [{ type: 'text', text: 'user prompt' }] },
                { info: { role: 'assistant' }, parts: [{ type: 'text', text: output }] },
              ],
            };
          }),
          status: mock(async () => ({ data: { 'watch-session': { type: 'idle' } } })),
          abort: mock(async () => {}),
        },
      },
    };
  }

  it('probe 返回真实事故样例：不判 completed、长冷却拉黑、换 fallback 模型重派', async () => {
    const { client, promptCalls } = createWatcherClient({ probeOutputs: [REAL_QUOTA_SAMPLE] });
    const registry: BackgroundTaskRegistry = new Map();
    registry.set('code-watch-task', {
      sessionID: 'watch-session',
      subagentType: 'build-executor',
      status: 'running',
      createdAt: Date.now(),
      changeDir: '',
      resolvedModel: 'provider/code-primary',
    });
    const watcher = createBackgroundTaskWatcher({
      client: client as never,
      registry,
      pollIntervalMs: 20,
      extraFallbacks: ['provider/code-fallback'],
    });
    watcher.start();
    await waitFor(() => registry.get('code-watch-task')?.resolvedModel === 'provider/code-fallback');
    watcher.stop();

    const task = registry.get('code-watch-task')!;
    expect(task.status).not.toBe('completed');
    expect(task.resolvedModel).toBe('provider/code-fallback');
    expect(promptCalls.length).toBeGreaterThanOrEqual(1);
    expect(isModelAvailable('provider/code-primary')).toBe(false);
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/code-primary')).toBe(false);
    } finally {
      restore();
    }
  });

  it('probe 返回嵌入 code:402 JSON：识别换模', async () => {
    const { client } = createWatcherClient({ probeOutputs: ['{"message":"payment required","code":"402"}'] });
    const registry: BackgroundTaskRegistry = new Map();
    registry.set('code-watch-task-2', {
      sessionID: 'watch-session',
      subagentType: 'build-executor',
      status: 'running',
      createdAt: Date.now(),
      changeDir: '',
      resolvedModel: 'provider/code402-primary',
    });
    const watcher = createBackgroundTaskWatcher({
      client: client as never,
      registry,
      pollIntervalMs: 20,
      extraFallbacks: ['provider/code402-fallback'],
    });
    watcher.start();
    await waitFor(() => registry.get('code-watch-task-2')?.resolvedModel === 'provider/code402-fallback');
    watcher.stop();

    expect(registry.get('code-watch-task-2')?.status).not.toBe('completed');
    expect(registry.get('code-watch-task-2')?.resolvedModel).toBe('provider/code402-fallback');
    expect(isModelAvailable('provider/code402-primary')).toBe(false);
  });
});

// ─── Poll 阶段：pollAndComplete 第三路径 ─────────────────────────────────────

describe('错误码驱动: pollAndComplete 第三路径接线', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  function createMockClient(opts: { pollOutputs: string[] }) {
    let msgCallCount = 0;
    promptCalls = [];
    return {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => {
          const callIdx = msgCallCount++;
          const idx = callIdx === 0 ? 0 : Math.min(callIdx - 1, opts.pollOutputs.length - 1);
          const output = opts.pollOutputs[idx];
          return {
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { info: { role: 'assistant' }, parts: [{ type: 'text', text: output }] },
            ],
          };
        }),
        status: mock(async () => ({ data: { 'test-session-001': { type: 'idle' } } })),
        abort: mock(async () => {}),
      },
    };
  }

  function createTools(client: ReturnType<typeof createMockClient>) {
    const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
    const options = {
      client: client as unknown as import('../../types.js').SFlowClient,
      backgroundTaskRegistry,
      backgroundTaskCounter: { value: 0 },
      agentModelMap: { 'build-executor': 'provider/test-model' } as AgentModelMap,
      sessionLabelPrefix: 'sFlow',
      validateAgent: async () => null,
      workflowName: 'sFlow',
    };
    const tools = createCallFlowAgentTools(options);
    return { tools, backgroundTaskRegistry };
  }

  beforeEach(() => clearUnavailableModels());
  afterEach(() => {
    resetRunningSubagentCounts();
    clearUnavailableModels();
  });

  it('真实事故样例不判 completed：长冷却拉黑 + 换 fallback 模型重 prompt 后完成', async () => {
    const client = createMockClient({
      pollOutputs: [REAL_QUOTA_SAMPLE, '[TASK_COMPLETE]\nrecovered'],
    });
    const { tools, backgroundTaskRegistry } = createTools(client);

    const startResult = await tools.call_flow_agent.execute(
      { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: true },
      { sessionID: 'parent', directory: '' },
    );
    const startData = JSON.parse(startResult.output);

    const outResult = await tools.flowagent_output.execute(
      { task_id: startData.task_id, block: true },
      { sessionID: 'parent', directory: '' },
    );
    const outData = JSON.parse(outResult.output);
    expect(outData.success).toBe(true);
    expect(outData.result).toContain('recovered');
    expect(promptCalls.length).toBe(2);
    expect(isModelAvailable('provider/test-model')).toBe(false);
    // 长冷却：5min+1s 后仍 blocked（非 5min transient）
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/test-model')).toBe(false);
    } finally {
      restore();
    }
    const task = backgroundTaskRegistry.get(startData.task_id);
    expect(task?.resolvedModel).not.toBe('provider/test-model');
  });

  it('嵌入 code:403 JSON 不判 completed：换 fallback 模型重 prompt 后完成', async () => {
    const client = createMockClient({
      pollOutputs: ['{"message":"model service rejected","type":"ModelServiceRateLimit","code":"403"}', '[TASK_COMPLETE]\nok-after-fallback'],
    });
    const { tools } = createTools(client);

    const startResult = await tools.call_flow_agent.execute(
      { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: true },
      { sessionID: 'parent', directory: '' },
    );
    const startData = JSON.parse(startResult.output);

    const outResult = await tools.flowagent_output.execute(
      { task_id: startData.task_id, block: true },
      { sessionID: 'parent', directory: '' },
    );
    const outData = JSON.parse(outResult.output);
    expect(outData.success).toBe(true);
    expect(outData.result).toContain('ok-after-fallback');
    expect(promptCalls.length).toBe(2);
    expect(isModelAvailable('provider/test-model')).toBe(false);
  });
});
