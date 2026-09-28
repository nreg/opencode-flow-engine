/**
 * Tests for model fallback chain fixes (REVIEW-20260926-202318)
 *
 * Covers:
 * - P0-1: poll 返回「错误文本 / 用户 prompt 回显」不算成功 → 转入 model-failure 分支
 * - P0-2: 频率限制/配额类错误识别（429 / 频率限制 / quota / rate limit）+ 重置时间解析 + 长冷却黑名单
 * - P0-3: 无 model_type 默认路径查黑名单（unavailable 模型走 fallback 链）
 * - P0-4: 错误识别接入换模（markModelUnavailable + getAlternativeModel）
 * - P1-1: getAlternativeModel 同时读用户配置的 fallback 链
 * - P1-2: async pollAndComplete 成功路径不触发 fallback（output !== null 守卫）
 * - P1-3: resolveModelWithFallback P1/P2/P7 分支接入黑名单检查
 */

import { beforeEach, describe, expect, it, mock, afterEach, afterAll } from 'bun:test';
import type { AgentModelMap, BackgroundTaskRegistry } from '../../types.js';
import { createCallFlowAgentTools, resetRunningSubagentCounts, runWithModelFallback, createBackgroundTaskWatcher } from '../call-flow-agent.js';
import { clearUnavailableModels, markModelUnavailable, isModelAvailable, getAlternativeModel, resolveModelWithFallback, TRANSIENT_COOLDOWN_TTL_MS, MIN_QUOTA_COOLDOWN_TTL_MS } from '../../agents/agent-builder.js';
import { classifyQuotaError, parseQuotaResetTime, matchesModelErrorPatterns, matchesQuotaErrorPattern } from '../../helpers/completion-detector.js';

/** 临时把 Date.now 前进 offsetMs，返回恢复函数 */
function advanceClock(offsetMs: number): () => void {
  const realNow = Date.now;
  Date.now = () => realNow() + offsetMs;
  return () => {
    Date.now = realNow;
  };
}

/** R3-P2-1: 轮询等待条件成立（去除固定 sleep 的时序耦合，消除 flaky） */
async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ─── P0-2: quota error classification ────────────────────────────────────────

describe('P0-2: 配额/频率限制错误分类', () => {
  it('parses Chinese quota reset message with UTC+8 timestamp', () => {
    const text = '您的使用量已超出频率限制，将在 2026-09-27 12:21:07 UTC+8 重置';
    const resetAt = parseQuotaResetTime(text);
    expect(resetAt).not.toBeNull();
    // 2026-09-27 12:21:07 UTC+8 === 2026-09-27 04:21:07 UTC
    const expected = Date.UTC(2026, 8, 27, 4, 21, 7);
    expect(resetAt).toBe(expected);
  });

  it('classifies quota messages (429 / rate limit / quota / 频率限制)', () => {
    expect(classifyQuotaError('您的使用量已超出频率限制，将在 2026-09-27 12:21:07 UTC+8 重置')).not.toBeNull();
    expect(classifyQuotaError('HTTP 429: too many requests')).not.toBeNull();
    expect(classifyQuotaError('rate limit exceeded')).not.toBeNull();
    expect(classifyQuotaError('quota exceeded for this model')).not.toBeNull();
    expect(classifyQuotaError('Error: 频率限制，请稍后再试')).not.toBeNull();
    // Non-quota errors / normal output → null
    expect(classifyQuotaError('Error: model not found')).toBeNull();
    expect(classifyQuotaError('normal output text')).toBeNull();
    expect(classifyQuotaError('')).toBeNull();
  });
});

describe('P0-2: 长冷却黑名单（按重置时间 TTL）', () => {
  beforeEach(() => clearUnavailableModels());

  it('marks model unavailable with long TTL until reset time', () => {
    const resetAt = Date.now() + 60 * 60 * 1000; // 1 hour in future
    markModelUnavailable('provider/quota-model', { resetAt });
    expect(isModelAvailable('provider/quota-model')).toBe(false);
  });

  it('model becomes available again after reset time has passed', () => {
    markModelUnavailable('provider/expired-model', { resetAt: Date.now() - 1000 });
    expect(isModelAvailable('provider/expired-model')).toBe(true);
  });

  it('default mark (no resetAt) uses transient cooldown TTL', () => {
    markModelUnavailable('provider/transient-model');
    expect(isModelAvailable('provider/transient-model')).toBe(false);
  });
});

// ─── P1-1: getAlternativeModel reads user-configured fallback chain ─────────

describe('P1-1: getAlternativeModel 读用户配置 fallback 链', () => {
  beforeEach(() => clearUnavailableModels());

  it('returns first available model from extraFallbacks (user config)', () => {
    markModelUnavailable('provider/default-fallback');
    const next = getAlternativeModel('provider/current', 'build-executor', ['provider/default-fallback', 'provider/user-config-fallback']);
    expect(next).toBe('provider/user-config-fallback');
  });

  it('skips unavailable models in user-config chain', () => {
    markModelUnavailable('provider/u1');
    markModelUnavailable('provider/u2');
    const next = getAlternativeModel('provider/current', 'build-executor', ['provider/u1', 'provider/u2']);
    // Falls back to DEFAULT_FALLBACKS entries that are still available
    expect(next).not.toBeNull();
    expect(next).not.toBe('provider/current');
  });
});

// ─── P1-3: resolveModelWithFallback P1/P2/P7 blacklist checks ───────────────

describe('P1-3: resolveModelWithFallback P1/P2/P7 黑名单检查', () => {
  beforeEach(() => clearUnavailableModels());

  it('P2: model parameter that is unavailable falls through to fallback chain', () => {
    markModelUnavailable('provider/param-model');
    const result = resolveModelWithFallback('spec-writer', 'provider/param-model', {}, undefined, {
      modelProfiles: { deep: { model: 'provider/tier-model', fallback_models: [] } },
      activeWorkflow: 'sflow',
    });
    expect(result.model).not.toBe('provider/param-model');
    expect(result.model).toBe('provider/tier-model');
    expect(result.provenance).toBe('profile');
  });

  it('P1: programmatic override that is unavailable falls through', () => {
    markModelUnavailable('provider/prog-model');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      { 'spec-writer': { model: 'provider/prog-model' } },
      { modelProfiles: { deep: { model: 'provider/tier-model2', fallback_models: [] } }, activeWorkflow: 'sflow' },
    );
    expect(result.model).toBe('provider/tier-model2');
  });

  it('P2: available model parameter is returned as before', () => {
    const result = resolveModelWithFallback('spec-writer', 'provider/available-model', {}, undefined, { activeWorkflow: 'sflow' });
    expect(result.model).toBe('provider/available-model');
    expect(result.provenance).toBe('override');
  });

  it('P7: unavailable system default tries fallback chain instead', () => {
    const sysDefault = 'provider/deepseek-v4-flash'; // DEFAULT_MODELS['spec-writer']
    markModelUnavailable(sysDefault);
    markModelUnavailable('provider/tier-model3');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'provider/tier-model3', fallback_models: ['provider/chain-fallback'] } },
        activeWorkflow: 'none', // gating off so Priority 5/6 skipped → reaches P7
      },
    );
    expect(result.model).toBe('provider/chain-fallback');
  });
});

// ─── P0-1 / P0-2 / P0-4: runWithModelFallback success validation ────────────

describe('P0-1/P0-2/P0-4: runWithModelFallback 成功判定与换模', () => {
  beforeEach(() => clearUnavailableModels());

  function makeClient(opts: {
    outputs: Array<string | null>;
    sendFailures?: Array<number | null>;
  }) {
    let pollIdx = 0;
    let sendIdx = 0;
    const promptCalls: Array<{ model?: { providerID: string; modelID: string } }> = [];
    return {
      promptCalls,
      client: {
        session: {
          prompt: mock(async (args: { path: { id: string }; body: { model?: { providerID: string; modelID: string } } }) => {
            promptCalls.push({ model: args.body.model });
            if (sendIdx < (opts.sendFailures?.length ?? 0)) {
              const f = opts.sendFailures![sendIdx];
              sendIdx++;
              if (f !== null) {
                const err = new Error(`HTTP ${f}: request failed`);
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

  it('quota error text from poll is NOT success: model blacklisted (long cooldown) and fallback model used', async () => {
    const c = makeClient({ outputs: [] });
    // UTC+8 显示时间 = resetInstant + 8h 的 UTC 时钟（语义正确的 UTC+8 表示）
    const resetInstant = Date.now() + 60 * 60 * 1000;
    const quotaText = '您的使用量已超出频率限制，将在 ' +
      new Date(resetInstant + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') +
      ' UTC+8 重置';
    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      return pollCount === 1 ? quotaText : '[TASK_COMPLETE]\nDone';
    };
    const result = await runWithModelFallback({ ...baseParams(c, poll) });
    expect(result.success).toBe(true);
    expect(result.model).not.toBe('provider/first-model');
    expect(result.fallbacks.length).toBe(1);
    expect(result.fallbacks[0]!.from).toBe('provider/first-model');
    expect(isModelAvailable('provider/first-model')).toBe(false);
    expect(pollCount).toBe(2);
  });

  it('error text (Error: ...) from poll is NOT success: treated as model-failure and switches model', async () => {
    const c = makeClient({ outputs: [] });
    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      return pollCount === 1 ? 'Error: internal provider failure (code: 500)' : '[TASK_COMPLETE]\nOK';
    };
    const result = await runWithModelFallback({ ...baseParams(c, poll) });
    expect(result.success).toBe(true);
    expect(result.model).not.toBe('provider/first-model');
    expect(isModelAvailable('provider/first-model')).toBe(false);
  });

  it('user prompt echo from poll is NOT success', async () => {
    const c = makeClient({ outputs: [] });
    // Echo equals the base prompt (including Change_Dir tag, as in real dispatch)
    const echoText = '<Change_Dir>/x</Change_Dir>\n\ndo the work';
    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      return pollCount === 1 ? echoText : '[TASK_COMPLETE]\nreal output';
    };
    const params = { ...baseParams(c, poll), basePrompt: echoText };
    const result = await runWithModelFallback(params);
    expect(result.success).toBe(true);
    expect(result.model).not.toBe('provider/first-model');
  });

  it('substantial output IS success (no fallback)', async () => {
    const c = makeClient({ outputs: [] });
    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      return '[TASK_COMPLETE]\nSummary: all done\nTest Results: 10 pass';
    };
    const result = await runWithModelFallback({ ...baseParams(c, poll) });
    expect(result.success).toBe(true);
    expect(result.model).toBe('provider/first-model');
    expect(result.fallbacks.length).toBe(0);
    expect(pollCount).toBe(1);
    expect(isModelAvailable('provider/first-model')).toBe(true);
  });

  it('HTTP 429 on send triggers long-cooldown blacklist and model switch (not fatal abort)', async () => {
    const c = makeClient({ outputs: [], sendFailures: [429] });
    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      return '[TASK_COMPLETE]\nDone';
    };
    const result = await runWithModelFallback({ ...baseParams(c, poll) });
    expect(result.success).toBe(true);
    expect(result.model).not.toBe('provider/first-model');
    expect(isModelAvailable('provider/first-model')).toBe(false);
  });

  it('sync E2E：配额错误拉黑后 5min+1s 仍 blocked（长冷却不被 :351 覆盖）', async () => {
    const c = makeClient({ outputs: [] });
    // UTC+8 显示时间 = resetInstant + 8h 的 UTC 时钟（语义正确的 UTC+8 表示）
    const resetInstant = Date.now() + 60 * 60 * 1000;
    const quotaText = '您的使用量已超出频率限制，将在 ' +
      new Date(resetInstant + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') +
      ' UTC+8 重置';
    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      return pollCount === 1 ? quotaText : '[TASK_COMPLETE]\nDone';
    };
    const result = await runWithModelFallback({ ...baseParams(c, poll) });
    expect(result.success).toBe(true);
    expect(isModelAvailable('provider/first-model')).toBe(false);
    // 5min+1s 后仍 blocked（长冷却不被 :351 覆盖）
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/first-model')).toBe(false);
    } finally {
      restore();
    }
  });
});

// ─── P1-2: async pollAndComplete success guard ──────────────────────────────

describe('P1-2: async pollAndComplete 成功路径不触发 fallback', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  function createMockClient(opts: { pollOutputs: string[] }) {
    let pollIndex = 0;
    promptCalls = [];
    return {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => {
          const output = opts.pollOutputs[Math.min(pollIndex, opts.pollOutputs.length - 1)];
          pollIndex++;
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

  afterEach(() => {
    resetRunningSubagentCounts();
    clearUnavailableModels();
  });

  it('successful async output does NOT blacklist model nor send fallback prompt', async () => {
    clearUnavailableModels();
    const client = createMockClient({ pollOutputs: ['[TASK_COMPLETE]\nSummary: done\nTest Results: all pass'] });
    const { tools } = createTools(client);

    const startResult = await tools.call_flow_agent.execute(
      { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: true },
      { sessionID: 'parent', directory: '' },
    );
    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);

    const outResult = await tools.flowagent_output.execute(
      { task_id: startData.task_id, block: true },
      { sessionID: 'parent', directory: '' },
    );
    const outData = JSON.parse(outResult.output);
    expect(outData.success).toBe(true);

    // P1-2: no fallback prompt sent (only the initial one)
    expect(promptCalls.length).toBe(1);
    // model NOT blacklisted
    expect(isModelAvailable('provider/test-model')).toBe(true);
  });
});

// ─── P0-3: default path (no model_type) checks blacklist ────────────────────

describe('P0-3: 无 model_type 默认路径查黑名单', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  function createMockClient(opts: { pollOutputs: string[] }) {
    let pollIndex = 0;
    promptCalls = [];
    return {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => {
          const output = opts.pollOutputs[Math.min(pollIndex, opts.pollOutputs.length - 1)];
          pollIndex++;
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

  afterEach(() => {
    resetRunningSubagentCounts();
    clearUnavailableModels();
  });

  it('blacklisted agentModelMap model falls back to an available model', async () => {
    clearUnavailableModels();
    // Blacklist the static map model
    markModelUnavailable('provider/test-model');
    const client = createMockClient({ pollOutputs: ['[TASK_COMPLETE]\nSummary: ok\nTest Results: pass'] });
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

    const result = await tools.call_flow_agent.execute(
      { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: false },
      { sessionID: 'parent', directory: '' },
    );
    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    // The prompt was sent to a fallback model, not the blacklisted one
    const usedModel = promptCalls[0]?.body?.model as { modelID: string } | undefined;
    expect(usedModel?.modelID).not.toBe('test-model');
  });
});

// ═══ 第 2 轮修复（REVIEW-20260926-205542）═══

// ═══ 第 3 轮修复（REVIEW-20260926-212053）═══

describe('R3-P1: parseQuotaResetTime 裸 UTC 支持', () => {
  // bun test 运行时强制 TZ=UTC，会掩盖「裸 UTC 落本地时区解释」的 bug——
  // 显式切到 Asia/Shanghai（UTC+8）使本地解释与 UTC+0 可区分，测试后恢复。
  beforeEach(() => {
    process.env.TZ = 'Asia/Shanghai';
  });
  afterAll(() => {
    process.env.TZ = 'UTC';
  });

  it('裸 UTC（无偏移）按 UTC+0 解释，不落本地时区', () => {
    const text = '您的使用量已超出频率限制，将在 2026-09-27 12:21:07 UTC 重置';
    const resetAt = parseQuotaResetTime(text);
    expect(resetAt).not.toBeNull();
    // 裸 UTC === UTC+0，不得按本地时区解释
    expect(resetAt).toBe(Date.UTC(2026, 8, 27, 12, 21, 7));
  });

  it('裸 UTC 配额报文 → 长冷却写入且 expireAt 正确', () => {
    clearUnavailableModels();
    // 相对时间构造报文，消除壁钟依赖：报文时间在未来约 1 小时，
    // 即使 advanceClock 前进后（±1s 偏移）仍保持正确的前后关系
    const resetInstant = Date.now() + 60 * 60 * 1000;
    const quotaText = '您的使用量已超出频率限制，将在 ' +
      new Date(resetInstant).toISOString().slice(0, 19).replace('T', ' ') +
      ' UTC 重置';
    const info = classifyQuotaError(quotaText);
    expect(info).not.toBeNull();
    const resetAt = info!.resetAt;
    // 裸 UTC 报文按 UTC+0 解析，应还原出原始时刻（容许秒级截断误差）
    expect(Math.abs(resetAt - resetInstant)).toBeLessThan(1000);
    markModelUnavailable('provider/bare-utc-model', { resetAt });
    expect(isModelAvailable('provider/bare-utc-model')).toBe(false);
    // expireAt 精确到重置时间：重置前 blocked
    const before = advanceClock(resetAt - Date.now() - 1000);
    try {
      expect(isModelAvailable('provider/bare-utc-model')).toBe(false);
    } finally {
      before();
    }
    // 重置之后 available（不被 min TTL 拖长误判）
    const after = advanceClock(resetAt - Date.now() + 1000);
    try {
      expect(isModelAvailable('provider/bare-utc-model')).toBe(true);
    } finally {
      after();
    }
  });
});

describe('R3-P2-2: 过期 resetAt delete 保守化（不绕过单调合并）', () => {
  beforeEach(() => clearUnavailableModels());

  it('在效长冷却不被陈旧/过去时刻的 resetAt 抹掉', () => {
    // 真实场景：先写入长冷却（正确解析），随后陈旧报文/误判解析出过去时刻
    markModelUnavailable('provider/monotonic-model', { resetAt: Date.now() + 60 * 60 * 1000 });
    // 过去时刻的 resetAt 不得抹掉在效长冷却（不命中 delete 分支）
    markModelUnavailable('provider/monotonic-model', { resetAt: Date.now() - 1000 });
    expect(isModelAvailable('provider/monotonic-model')).toBe(false);
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/monotonic-model')).toBe(false);
    } finally {
      restore();
    }
    const restore2 = advanceClock(61 * 60 * 1000);
    try {
      expect(isModelAvailable('provider/monotonic-model')).toBe(true);
    } finally {
      restore2();
    }
  });

  it('无在效条目时过期 resetAt 仍删除（不阻塞可用模型，既有行为保留）', () => {
    markModelUnavailable('provider/expired-only', { resetAt: Date.now() - 1000 });
    expect(isModelAvailable('provider/expired-only')).toBe(true);
  });
});

describe('R3-P2-3: pollAndComplete 第三路径错误/配额识别', () => {
  let promptCalls: Array<{ id: string; body: Record<string, unknown> }>;

  function createMockClient(opts: { pollOutputs: string[] }) {
    // 注意：pollSessionCompletion 入口会先调用一次 messages 统计 initialMsgCount（不消费 poll 序列），
    // 因此 messages 调用 #1 视为计数调用（返回 pollOutputs[0] 但不推进序列），#2 起为真实 poll。
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

  it('错误文本不判 completed：换 fallback 模型重 prompt 后完成', async () => {
    const client = createMockClient({
      pollOutputs: ['Error: internal provider failure (code: 500)', '[TASK_COMPLETE]\nrecovered'],
    });
    const { tools, backgroundTaskRegistry } = createTools(client);

    const startResult = await tools.call_flow_agent.execute(
      { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: true },
      { sessionID: 'parent', directory: '' },
    );
    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);

    const outResult = await tools.flowagent_output.execute(
      { task_id: startData.task_id, block: true },
      { sessionID: 'parent', directory: '' },
    );
    const outData = JSON.parse(outResult.output);
    // 换模后完成（不把错误文本当成功产出）
    expect(outData.success).toBe(true);
    expect(outData.result).toContain('recovered');
    // prompt 调用 2 次（初始 + 换模型重 prompt）
    expect(promptCalls.length).toBe(2);
    // 原模型被拉黑
    expect(isModelAvailable('provider/test-model')).toBe(false);
    // registry 中 resolvedModel 已变为 fallback 模型
    const task = backgroundTaskRegistry.get(startData.task_id);
    expect(task?.resolvedModel).toBeDefined();
    expect(task?.resolvedModel).not.toBe('provider/test-model');
  });

  it('配额报错（裸 UTC）不判 completed：长冷却拉黑 + 换模', async () => {
    // NP-2: 使用相对时间构造裸 UTC 报文（避免硬编码未来日期成为测试时间炸弹）。
    // toISOString 输出 UTC 时间，解析端按 UTC+0 解释（TZ 无关）。
    const resetInstant = Date.now() + 60 * 60 * 1000;
    const client = createMockClient({
      pollOutputs: ['您的使用量已超出频率限制，将在 ' + new Date(resetInstant).toISOString().slice(0, 19).replace('T', ' ') + ' UTC 重置', '[TASK_COMPLETE]\nok'],
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
    expect(outData.result).toContain('ok');
    expect(promptCalls.length).toBe(2);
    // 长冷却：5min+1s 后仍 blocked（非 5min transient）
    expect(isModelAvailable('provider/test-model')).toBe(false);
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/test-model')).toBe(false);
    } finally {
      restore();
    }
  });
});

describe('NEW-P0-A: 长冷却 TTL 不被无条件 markModelUnavailable 覆盖', () => {
  beforeEach(() => clearUnavailableModels());

  it('quota 拉黑后再调用默认 mark，5min+1s 后仍 blocked（取 max 语义）', () => {
    const resetAt = Date.now() + 60 * 60 * 1000; // 重置时间在 1 小时后
    markModelUnavailable('provider/ttl-model', { resetAt });
    // 模拟 :351 的无条件默认 markModelUnavailable（5min TTL）
    markModelUnavailable('provider/ttl-model');
    // 前进 5min+1s（超过 transient TTL）：模型必须仍被拉黑，直到重置时间
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/ttl-model')).toBe(false);
    } finally {
      restore();
    }
    // 前进到重置时间之后：释放
    const restore2 = advanceClock(61 * 60 * 1000);
    try {
      expect(isModelAvailable('provider/ttl-model')).toBe(true);
    } finally {
      restore2();
    }
  });

  it('无重置时间的配额错误给默认长 TTL（30min），5min+1s 后仍 blocked', () => {
    markModelUnavailable('provider/quota-no-reset', { resetAt: null, ttlMs: 30 * 60_000 });
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/quota-no-reset')).toBe(false);
    } finally {
      restore();
    }
    const restore2 = advanceClock(31 * 60 * 1000);
    try {
      expect(isModelAvailable('provider/quota-no-reset')).toBe(true);
    } finally {
      restore2();
    }
  });
});

describe('NEW-P1-C: 错误/配额模式收紧（正常产出不误判）', () => {
  it('含 quota/限流/429 的长报告文本不判配额错误', () => {
    const report = '审查报告：本模块管理 quota 表与 rate limit 中间件。\n' +
      ('行 429 是端口配置，限流中间件已实现。' .repeat(40));
    expect(report.length).toBeGreaterThan(500);
    expect(matchesQuotaErrorPattern(report)).toBe(false);
    expect(classifyQuotaError(report)).toBeNull();
  });

  it('短文本中的弱配额词（无错误语境）不判配额错误', () => {
    expect(classifyQuotaError('This module manages the quota table. quota is a column.')).toBeNull();
    expect(classifyQuotaError('第 429 行是端口配置，rate limit 中间件已实现')).toBeNull();
  });

  it('"Error: none found. All checks passed." 不判模型错误', () => {
    expect(matchesModelErrorPatterns('Error: none found. All checks passed.')).toBe(false);
  });

  it('长报告（含 Error: 与堆栈）不判模型错误（任务层错误 ≠ 模型层错误）', () => {
    const failingTestOutput = 'Running tests...\n' +
      ('some assertion detail line\n'.repeat(40)) +
      'Error: expect(received).toBe(expected)\n    at Object.<anonymous> (test.ts:12:5)';
    expect(failingTestOutput.length).toBeGreaterThan(500);
    expect(matchesModelErrorPatterns(failingTestOutput)).toBe(false);
  });

  it('明确的短错误文本仍判模型错误（既有行为保留）', () => {
    expect(matchesModelErrorPatterns('Error: internal provider failure (code: 500)')).toBe(true);
    expect(matchesModelErrorPatterns('Failed: model unavailable')).toBe(true);
  });
});

describe('NEW-P1-D: attempt>0 回显比对对正确对象（实际发送文本）', () => {
  function makeClientLocal(sendFailures?: Array<number | null>) {
    let sendIdx = 0;
    return {
      client: {
        session: {
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            if (sendIdx < (sendFailures?.length ?? 0)) {
              const f = sendFailures![sendIdx];
              sendIdx++;
              if (f !== null) {
                const err = new Error(`HTTP ${f}: request failed`);
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
    };
  }

  it('换模后第 2 轮 poll 回显所发 prompt（重试原样重发，不含接管声明）不算成功', async () => {
    const c = makeClientLocal([429]);
    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      if (pollCount === 1) {
        // 回显第 2 轮实际发送文本 —— 与 basePrompt 原样一致，不含任何接管声明
        return 'do the work';
      }
      return '[TASK_COMPLETE]\nreal output';
    };
    const result = await runWithModelFallback({
      client: c.client as never,
      sessionID: 's1',
      agentName: 'build-executor',
      basePrompt: 'do the work',
      initialModel: 'provider/first-model',
      maxWaitMs: 100,
      directory: '',
      poll,
    });
    expect(result.success).toBe(true);
    expect(result.fallbacks.length).toBeGreaterThanOrEqual(1);
    // 第二个尝试的模型（换模后）不应被判成功后直接返回回显
    expect(result.model).not.toBe('provider/first-model');
    expect(result.output).toContain('TASK_COMPLETE');
  });
});

describe('NEW-P0-B: async watcher 路径配额错误识别与换模', () => {
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

  it('probe 返回配额错误文本：不判 completed、拉黑至重置时间、换 fallback 模型重派', async () => {
    // NP-2: 使用相对时间构造配额报文（与 :214-217 早先用例一致，避免硬编码未来日期成为时间炸弹）
    const resetInstant = Date.now() + 60 * 60 * 1000;
    const quotaText = '您的使用量已超出频率限制，将在 ' +
      new Date(resetInstant + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') +
      ' UTC+8 重置';
    const { client, promptCalls } = createWatcherClient({ probeOutputs: [quotaText] });
    const registry: BackgroundTaskRegistry = new Map();
    registry.set('watch-task-1', {
      sessionID: 'watch-session',
      subagentType: 'build-executor',
      status: 'running',
      createdAt: Date.now(),
      changeDir: '',
      resolvedModel: 'provider/quota-primary',
    });
    const watcher = createBackgroundTaskWatcher({
      client: client as never,
      registry,
      pollIntervalMs: 20,
      extraFallbacks: ['provider/watch-fallback'],
    });
    watcher.start();
    // R3-P2-1: 轮询等待 watcher 完成故障转移（去除固定 400ms 时序耦合）
    await waitFor(() => registry.get('watch-task-1')?.resolvedModel === 'provider/watch-fallback');
    watcher.stop();

    const task = registry.get('watch-task-1')!;
    // 不判 completed
    expect(task.status).not.toBe('completed');
    // 换模：resolvedModel 变为 fallback 链中的模型
    expect(task.resolvedModel).toBe('provider/watch-fallback');
    // 发送了接管 prompt（故障转移重派调用）
    expect(promptCalls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(promptCalls[0]?.body ?? {})).toContain('接管');
    // 原模型被拉黑且 TTL 为长冷却（5min+1s 后仍 blocked）
    expect(isModelAvailable('provider/quota-primary')).toBe(false);
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/quota-primary')).toBe(false);
    } finally {
      restore();
    }
  });

  it('watcher 传入 extraFallbacks（用户 fallback 链被使用）', async () => {
    const { client } = createWatcherClient({ probeOutputs: ['Error: provider crashed'] });
    const registry: BackgroundTaskRegistry = new Map();
    registry.set('watch-task-2', {
      sessionID: 'watch-session',
      subagentType: 'build-executor',
      status: 'running',
      createdAt: Date.now(),
      changeDir: '',
      resolvedModel: 'provider/broken-model',
    });
    const watcher = createBackgroundTaskWatcher({
      client: client as never,
      registry,
      pollIntervalMs: 20,
      extraFallbacks: ['provider/user-chain-fallback'],
    });
    watcher.start();
    // R3-P2-1: 轮询等待 watcher 完成故障转移（去除固定 400ms 时序耦合）
    await waitFor(() => registry.get('watch-task-2')?.resolvedModel === 'provider/user-chain-fallback');
    watcher.stop();

    const task = registry.get('watch-task-2')!;
    expect(task.status).not.toBe('completed');
    expect(task.resolvedModel).toBe('provider/user-chain-fallback');
  });
});

// ═══ 第 4 轮修复（REVIEW-20260926-220449）═══

describe('NP-1: 时区偏移解析回归与 NaN 防御', () => {
  describe('parseQuotaResetTime 偏移格式解析正确性', () => {
    it('UTC+08:00（含冒号分钟偏移）解析为正确 UTC 时刻，不得为 NaN', () => {
      // 2026-09-27 12:21:07 UTC+08:00 === 2026-09-27 04:21:07 UTC
      const resetAt = parseQuotaResetTime('您的使用量已超出频率限制，将在 2026-09-27 12:21:07 UTC+08:00 重置');
      expect(resetAt).not.toBeNull();
      expect(resetAt).toBe(Date.UTC(2026, 8, 27, 4, 21, 7));
    });

    it('GMT+08:00（含冒号分钟偏移）解析为正确 UTC 时刻，不得为 NaN', () => {
      const resetAt = parseQuotaResetTime('rate limit exceeded, resets at 2026-09-27 12:21:07 GMT+08:00');
      expect(resetAt).not.toBeNull();
      expect(resetAt).toBe(Date.UTC(2026, 8, 27, 4, 21, 7));
    });

    it('UTC+0800（无冒号分钟偏移）解析为正确偏移 8 小时，不得静默错值 800', () => {
      const resetAt = parseQuotaResetTime('您的使用量已超出频率限制，将在 2026-09-27 12:21:07 UTC+0800 重置');
      expect(resetAt).not.toBeNull();
      expect(resetAt).toBe(Date.UTC(2026, 8, 27, 4, 21, 7));
    });

    it('UTC+8:30（半小时偏移）按 小时 + 分钟/60 正确解析', () => {
      // 2026-09-27 12:21:07 UTC+8:30 === 2026-09-27 03:51:07 UTC
      const resetAt = parseQuotaResetTime('您的使用量已超出频率限制，将在 2026-09-27 12:21:07 UTC+8:30 重置');
      expect(resetAt).not.toBeNull();
      expect(resetAt).toBe(Date.UTC(2026, 8, 27, 3, 51, 7));
    });

    it('ISO +08:00 偏移解析为正确 UTC 时刻（回归保护）', () => {
      const resetAt = parseQuotaResetTime('resets at 2026-09-27T04:21:07+08:00');
      expect(resetAt).not.toBeNull();
      expect(resetAt).toBe(Date.UTC(2026, 8, 26, 20, 21, 7));
    });

    it('负偏移 UTC-05:00 解析为正确 UTC 时刻', () => {
      // 2026-09-27 12:21:07 UTC-5 === 2026-09-27 17:21:07 UTC
      const resetAt = parseQuotaResetTime('resets at 2026-09-27 12:21:07 UTC-05:00');
      expect(resetAt).not.toBeNull();
      expect(resetAt).toBe(Date.UTC(2026, 8, 27, 17, 21, 7));
    });
  });

  describe('markModelUnavailable NaN 防御（不永久拉黑）', () => {
    beforeEach(() => clearUnavailableModels());

    it('传入 NaN resetAt 不会永久拉黑模型（30min 后可恢复）', () => {
      markModelUnavailable('provider/nan-reset-model', { resetAt: Number.NaN });
      // 立即被拉黑（退化为默认 TTL）
      expect(isModelAvailable('provider/nan-reset-model')).toBe(false);
      // 推进超过最大兜底 TTL（30min）后必须可恢复——NaN 不得进入 expireAt
      const restore = advanceClock(MIN_QUOTA_COOLDOWN_TTL_MS + 1000);
      try {
        expect(isModelAvailable('provider/nan-reset-model')).toBe(true);
      } finally {
        restore();
      }
    });

    it('NaN resetAt 不会抹掉在效长冷却（单调合并语义保持）', () => {
      markModelUnavailable('provider/nan-merge-model', { resetAt: Date.now() + 60 * 60 * 1000 });
      // NaN resetAt 不得破坏已有长冷却（也不能触发 delete 分支）
      markModelUnavailable('provider/nan-merge-model', { resetAt: Number.NaN });
      expect(isModelAvailable('provider/nan-merge-model')).toBe(false);
      const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
      try {
        // 原 1h 长冷却仍在效（NaN mark 未覆盖为 5min）
        expect(isModelAvailable('provider/nan-merge-model')).toBe(false);
      } finally {
        restore();
      }
    });

    it('classifyQuotaError 对不可解析偏移的报文不产生 NaN resetAt', () => {
      // 含分钟偏移的报文应被正确解析为有限值（而非 NaN 进入黑名单链路）
      const info = classifyQuotaError('您的使用量已超出频率限制，将在 2026-09-27 12:21:07 UTC+08:00 重置');
      expect(info).not.toBeNull();
      expect(info!.resetAt).not.toBeNull();
      expect(Number.isFinite(info!.resetAt)).toBe(true);
    });
  });
});
