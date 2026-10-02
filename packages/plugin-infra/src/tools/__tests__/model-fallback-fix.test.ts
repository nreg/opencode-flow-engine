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

import { beforeEach, describe, expect, it, mock, afterEach, afterAll, spyOn } from 'bun:test';
import { PROBE_PENDING, type ProbePending } from '../../types.js';
import type { AgentModelMap, BackgroundTaskRegistry } from '../../types.js';
import { createCallFlowAgentTools, resetRunningSubagentCounts, runWithModelFallback, createBackgroundTaskWatcher } from '../call-flow-agent.js';
import { clearUnavailableModels, markModelUnavailable, isModelAvailable, getAlternativeModel, resolveModelWithFallback, appendChainUnavailableNotice, TRANSIENT_COOLDOWN_TTL_MS, MIN_QUOTA_COOLDOWN_TTL_MS } from '../../agents/agent-builder.js';
import { parseQuotaResetTime, classifyModelErrorByCode, hasRealOutput, hasStructuredReportEvidence } from '../../helpers/completion-detector.js';
import { Logger } from '../../utils/logger.js';
import {
  resetModelAvailability,
  refreshAvailableModels,
  getAvailabilityState,
  isModelKnown,
  validateConfiguredModels,
} from '../../agents/model-availability.js';
import type { ProviderListClient, SFlowConfig } from '../../agents/model-availability.js';
import { createCombinedPluginModule } from '../../combined-plugin-factory.js';

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

  it('returns null when all models in the user-config chain are unavailable', () => {
    markModelUnavailable('provider/u1');
    markModelUnavailable('provider/u2');
    const next = getAlternativeModel('provider/current', 'build-executor', ['provider/u1', 'provider/u2']);
    // Only the explicitly-provided user-config chain is consulted
    expect(next).toBeNull();
  });
});

describe('T2.4: getAlternativeModel — user-config only (Wave 2)', () => {
  beforeEach(() => clearUnavailableModels());

  it('returns null when no user fallback chain is provided', () => {
    const next = getAlternativeModel('provider/x', 'build-executor', []);
    expect(next).toBeNull();
  });

  it('returns the provided fallback when available', () => {
    const next = getAlternativeModel('provider/x', 'build-executor', ['openai/gpt-5']);
    expect(next).toBe('openai/gpt-5');
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

  it('P7: unavailable primary tier model tries fallback chain instead', () => {
    const sysDefault = 'provider/legacy-sys-default'; // Wave 2: no built-in default; marked unavailable is harmless
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

  const baseParams = (c: ReturnType<typeof makeClient>, poll: (sid: string, m: string) => Promise<string | null | ProbePending>) => ({
    client: c.client as never,
    sessionID: 's1',
    agentName: 'build-executor',
    basePrompt: 'do the work',
    initialModel: 'provider/first-model',
    maxWaitMs: 100,
    directory: '',
    extraFallbacks: ['provider/alt-model'],
    poll,
  });

  it('quota error text from poll is NOT success: model blacklisted (long cooldown) and fallback model used', async () => {
    const c = makeClient({ outputs: [] });
    // UTC+8 显示时间 = resetInstant + 8h 的 UTC 时钟（语义正确的 UTC+8 表示）
    const resetInstant = Date.now() + 60 * 60 * 1000;
    const quotaText = '402: 您的使用量已超出频率限制，将在 ' +
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
    // Echo equals the base prompt (including workDir tag, as in real dispatch)
    const echoText = '<workDir>/x</workDir>\n\ndo the work';
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
    const quotaText = '402: 您的使用量已超出频率限制，将在 ' +
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

  // R3-fix P1-1: poll 返回 PROBE_PENDING（polling 层判定「窗口超时但会话仍在 busy/retry」）
  // 时，sync 编排器 MUST 不拉黑、不换模、不重发，以 timeout-pending 失败终结。
  it('poll 返回 PROBE_PENDING → timeout-pending 失败，模型未拉黑、无换模、prompt 仅 1 次', async () => {
    const c = makeClient({ outputs: [] });
    let pollCount = 0;
    const poll = async () => {
      pollCount++;
      return PROBE_PENDING;
    };
    const result = await runWithModelFallback({ ...baseParams(c, poll) });
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('timeout-pending');
    expect(result.model).toBe('provider/first-model');
    expect(result.fallbacks.length).toBe(0);
    // 慢而健康的模型不拉黑
    expect(isModelAvailable('provider/first-model')).toBe(true);
    // 未换模重发（首次发送计入 1 次）
    expect(pollCount).toBe(1);
    expect(c.promptCalls.length).toBe(1);
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
      configOverrides: { 'build-executor': { fallback_models: ['provider/alt-model'] } },
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
    // 错误码驱动：行首前缀码 402: → non-transient + parseQuotaResetTime 提取重置时长
    const info = classifyModelErrorByCode(`402: ${quotaText}`);
    expect(info).not.toBeNull();
    expect(info!.kind).toBe('non-transient');
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
      configOverrides: { 'build-executor': { fallback_models: ['provider/alt-model'] } },
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

  it('配额报错（裸 UTC + 行首前缀码 402:）不判 completed：长冷却拉黑 + 换模', async () => {
    // NP-2: 使用相对时间构造裸 UTC 报文（避免硬编码未来日期成为测试时间炸弹）。
    // toISOString 输出 UTC 时间，解析端按 UTC+0 解释（TZ 无关）。
    const resetInstant = Date.now() + 60 * 60 * 1000;
    const client = createMockClient({
      pollOutputs: ['402: 您的使用量已超出频率限制，将在 ' + new Date(resetInstant).toISOString().slice(0, 19).replace('T', ' ') + ' UTC 重置', '[TASK_COMPLETE]\nok'],
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

describe('错误码驱动: 无错误码报错为已知限制（文本模式分类已删除）', () => {
  it('无 code 的长报告 / 弱配额词 / 行首 error 文本 → 不分类（不做文本兜底）', () => {
    const report = '审查报告：本模块管理 quota 表与 rate limit 中间件。\n' +
      ('行 429 是端口配置，限流中间件已实现。' .repeat(40));
    expect(classifyModelErrorByCode(report)).toBeNull();
    expect(classifyModelErrorByCode('This module manages the quota table. quota is a column.')).toBeNull();
    expect(classifyModelErrorByCode('Error: none found. All checks passed.')).toBeNull();
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
      extraFallbacks: ['provider/alt-model', 'provider/alt-model-2'],
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

  it('probe 返回行首前缀码配额报文：不判 completed、拉黑至重置时间、换 fallback 模型重派', async () => {
    // NP-2: 使用相对时间构造配额报文（与 :214-217 早先用例一致，避免硬编码未来日期成为时间炸弹）
    const resetInstant = Date.now() + 60 * 60 * 1000;
    const quotaText = '402: 您的使用量已超出频率限制，将在 ' +
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
      prompt: 'original-task-prompt',
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
    // 发送了原样重发 prompt（P1-2：与 sync 统一，不再发送"接管"声明）
    expect(promptCalls.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(promptCalls[0]?.body ?? {})).toContain('original-task-prompt');
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
    const { client } = createWatcherClient({ probeOutputs: ['Error: provider crashed (code: 500)'] });
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

  /**
   * 构造可驱动 watcher「换模后 re-probe」分支的 client：
   * - 首次 poll：status=retry(attempt>=5) → pollSessionCompletion 返回 null → 触发初始故障转移
   * - 换模后 re-probe：status=idle → pollSessionCompletion 返回 messages 末条 assistant 文本
   * 用于复现 P0 异步 re-poll 绕过产出正向判定的 bug。
   */
  function createWatcherClientForReProbe(opts: {
    probeOutputs: string[];
    statusTypes: Array<'idle' | 'retry'>;
    attempts?: number[];
  }) {
    let msgIdx = 0;
    let statusIdx = 0;
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
          status: mock(async () => {
            const type = opts.statusTypes[Math.min(statusIdx, opts.statusTypes.length - 1)];
            const attempt = opts.attempts?.[Math.min(statusIdx, opts.attempts.length - 1)] ?? 5;
            statusIdx++;
            return { data: { 'watch-session': { type, attempt } } };
          }),
          abort: mock(async () => {}),
        },
      },
    };
  }

  it('P0: 换模后 re-probe 返回无码错误文本 → no-valid-output 失败终结且不再换模', async () => {
    const { client, promptCalls } = createWatcherClientForReProbe({
      probeOutputs: ['Service overloaded, please try again later'],
      statusTypes: ['retry', 'idle'],
      attempts: [5, 0],
    });
    const registry: BackgroundTaskRegistry = new Map();
    registry.set('watch-task-ns', {
      sessionID: 'watch-session',
      subagentType: 'build-executor',
      status: 'running',
      createdAt: Date.now(),
      changeDir: '',
      resolvedModel: 'provider/watch-primary',
      prompt: 'original-task-prompt',
    });
    const watcher = createBackgroundTaskWatcher({
      client: client as never,
      registry,
      pollIntervalMs: 20,
      extraFallbacks: ['provider/watch-fallback'],
    });
    watcher.start();
    await waitFor(() => registry.get('watch-task-ns')?.status === 'error');
    watcher.stop();

    const task = registry.get('watch-task-ns');
    if (!task) throw new Error('task entry missing from registry');
    expect(task.status).toBe('error');
    expect(task.result).toBe('Service overloaded, please try again later');
    expect(task.error).toContain('no completion signal');
    // 仅一次换模（初始 fallback 的 prompt 调用），no-valid-output 不再换模
    expect(promptCalls.length).toBe(1);
    // 换模目标模型未被拉黑
    expect(isModelAvailable('provider/watch-fallback')).toBe(true);
  });

  it('P0: 换模后 re-probe 返回正常产出 → completed（不误杀真实产出）', async () => {
    const { client, promptCalls } = createWatcherClientForReProbe({
      probeOutputs: ['## Wave 1 Batch 1.1 完成报告\n\n### 改动文件清单'],
      statusTypes: ['retry', 'idle'],
      attempts: [5, 0],
    });
    const registry: BackgroundTaskRegistry = new Map();
    registry.set('watch-task-ok', {
      sessionID: 'watch-session',
      subagentType: 'build-executor',
      status: 'running',
      createdAt: Date.now(),
      changeDir: '',
      resolvedModel: 'provider/watch-primary',
      prompt: 'original-task-prompt',
    });
    const watcher = createBackgroundTaskWatcher({
      client: client as never,
      registry,
      pollIntervalMs: 20,
      extraFallbacks: ['provider/watch-fallback'],
    });
    watcher.start();
    await waitFor(() => registry.get('watch-task-ok')?.status === 'completed');
    watcher.stop();

    const task = registry.get('watch-task-ok');
    if (!task) throw new Error('task entry missing from registry');
    expect(task.status).toBe('completed');
    expect(task.result).toBe('## Wave 1 Batch 1.1 完成报告\n\n### 改动文件清单');
    // W4（P2-3）：probe null 时先从 session.messages 恢复已完成产出——本次会话最后一条
    // assistant 文本过 hasRealOutput 正向判定，直接采用，不再浪费一次换模重发。
    expect(promptCalls.length).toBe(0);
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

    it('classifyModelErrorByCode 对不可解析偏移的报文不产生 NaN resetAt', () => {
      // 含分钟偏移的报文应被正确解析为有限值（而非 NaN 进入黑名单链路）
      const info = classifyModelErrorByCode('402: 您的使用量已超出频率限制，将在 2026-09-27 12:21:07 UTC+08:00 重置');
      expect(info).not.toBeNull();
      expect(info!.resetAt).not.toBeNull();
      expect(Number.isFinite(info!.resetAt)).toBe(true);
    });
  });
});

// ═══ 修复轮（REVIEW-20260930-005829）：P0-1 产出正向判定 + P1-1 send 失败语义 ═══

describe('FIX-P0-1: 产出正向判定', () => {
  // ── 判定层（8 条）──
  it('D1: 纯文本过载错误（无完成信号、无结构化证据）判为非真实产出', () => {
    expect(hasRealOutput('Service overloaded, please try again later')).toBe(false);
  });

  it('D2: 纯文本配额错误判为非真实产出', () => {
    expect(hasRealOutput('Your account has run out of credits')).toBe(false);
  });

  it('D3: 完成标记文本判为真实产出', () => {
    expect(hasRealOutput('[TASK_COMPLETE]\nSummary: all done')).toBe(true);
  });

  it('D4: JSON 代码围栏判为真实产出', () => {
    expect(hasRealOutput('```json\n{"status":"ok"}\n```')).toBe(true);
  });

  it('D5: 纯长度不再是依据（250 字符无证据文本判为非真实产出）', () => {
    expect(hasStructuredReportEvidence('A'.repeat(250))).toBe(false);
    expect(hasRealOutput('A'.repeat(250))).toBe(false);
  });

  it('D6: 完成的否定形态不计入正向证据', () => {
    expect(hasRealOutput('任务未能完成，请稍后重试')).toBe(false);
    expect(hasStructuredReportEvidence('任务未能完成，请稍后重试')).toBe(false);
  });

  it('D7: Markdown 标题作为结构化证据判为真实产出', () => {
    expect(hasRealOutput('## Wave 1 Batch 1.1 完成报告\n\n### 改动文件清单')).toBe(true);
  });

  it('D8: 真实失败报告仍属真实产出（任务成败由编排器判断）', () => {
    expect(hasRealOutput('failed: Test suite execution failed\n\nTest Results:\n- 15 tests failed')).toBe(true);
  });

  // ── 端到端（6 条）──
  describe('端到端接线', () => {
    beforeEach(() => clearUnavailableModels());
    afterEach(() => {
      resetRunningSubagentCounts();
      clearUnavailableModels();
    });

    function makeClient(opts: { sendFailures?: Array<number | null> }) {
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
      };
    }

    const baseParams = (
      c: ReturnType<typeof makeClient>,
      poll: (sid: string, m: string) => Promise<string | null>,
    ) => ({
      client: c.client as never,
      sessionID: 's1',
      agentName: 'build-executor',
      basePrompt: 'do the work',
      initialModel: 'provider/first-model',
      maxWaitMs: 100,
      directory: '',
      extraFallbacks: ['provider/alt-model'],
      poll,
    });

    /** async 工具层 harness（pollOutputs[0] 亦为 pollSessionCompletion 的初始消息计数返回值） */
    function createAsyncTools(pollOutputs: string[]) {
      let msgCallCount = 0;
      const promptCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
      const client = {
        session: {
          create: mock(async () => ({ data: { id: 'test-session-001' } })),
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            promptCalls.push({ id: args.path.id, body: args.body });
          }),
          messages: mock(async () => {
            const callIdx = msgCallCount++;
            const idx = callIdx === 0 ? 0 : Math.min(callIdx - 1, pollOutputs.length - 1);
            return {
              data: [
                { parts: [{ type: 'text', text: 'user prompt' }] },
                { info: { role: 'assistant' }, parts: [{ type: 'text', text: pollOutputs[idx] }] },
              ],
            };
          }),
          status: mock(async () => ({ data: { 'test-session-001': { type: 'idle' } } })),
          abort: mock(async () => {}),
        },
      };
      const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
      const tools = createCallFlowAgentTools({
        client: client as unknown as import('../../types.js').SFlowClient,
        backgroundTaskRegistry,
        backgroundTaskCounter: { value: 0 },
        agentModelMap: { 'build-executor': 'provider/test-model' } as AgentModelMap,
        configOverrides: { 'build-executor': { fallback_models: ['provider/alt-model'] } },
        sessionLabelPrefix: 'sFlow',
        validateAgent: async () => null,
        workflowName: 'sFlow',
      });
      return { tools, backgroundTaskRegistry, promptCalls };
    }

    it('E1: sync 无信号产出 → no-valid-output 失败返回，原文保留且不拉黑不换模', async () => {
      const c = makeClient({});
      const overloadText = 'Service overloaded, please try again later';
      const result = await runWithModelFallback({ ...baseParams(c, async () => overloadText) });
      expect(result.success).toBe(false);
      expect(result.failureReason).toBe('no-valid-output');
      expect(result.output).toBe(overloadText);
      expect(result.detail).toBe('output has no completion signal; treated as failure (raw output preserved)');
      expect(isModelAvailable('provider/first-model')).toBe(true);
      expect(c.promptCalls.length).toBe(1);
      expect(result.fallbacks.length).toBe(0);
    });

    it('E2: sync 带完成信号产出 → success', async () => {
      const c = makeClient({});
      const result = await runWithModelFallback({ ...baseParams(c, async () => '[TASK_COMPLETE]\nDone') });
      expect(result.success).toBe(true);
      expect(result.fallbacks.length).toBe(0);
    });

    it('E3: sync 带 (code: 500) 产出 → 仍走既有 model-failure（不落入 no-valid-output）', async () => {
      const c = makeClient({});
      let pollCount = 0;
      const poll = async () => {
        pollCount++;
        return pollCount === 1 ? 'Error: upstream failure (code: 500)' : '[TASK_COMPLETE]\nDone';
      };
      const result = await runWithModelFallback({ ...baseParams(c, poll) });
      expect(result.success).toBe(true);
      expect(result.failureReason).toBeUndefined();
      expect(result.fallbacks.length).toBeGreaterThanOrEqual(1);
      expect(isModelAvailable('provider/first-model')).toBe(false);
    });

    it('E4: watcher 无信号输出 → error 条目 + result 原文 + 未换模未拉黑', async () => {
      const creditsText = 'Your account has run out of credits';
      let probeIdx = 0;
      const promptCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
      const client = {
        session: {
          create: mock(async () => ({ data: { id: 'watch-session' } })),
          prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
            promptCalls.push({ id: args.path.id, body: args.body });
          }),
          messages: mock(async () => {
            const output = [creditsText][Math.min(probeIdx, 0)];
            probeIdx++;
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
      };
      const registry: BackgroundTaskRegistry = new Map();
      registry.set('watch-task-no-signal', {
        sessionID: 'watch-session',
        subagentType: 'build-executor',
        status: 'running',
        createdAt: Date.now(),
        changeDir: '',
        resolvedModel: 'provider/no-signal-primary',
      });
      const watcher = createBackgroundTaskWatcher({
        client: client as never,
        registry,
        pollIntervalMs: 20,
        extraFallbacks: ['provider/watch-fallback'],
      });
      watcher.start();
      await waitFor(() => registry.get('watch-task-no-signal')?.status === 'error');
      watcher.stop();

      const task = registry.get('watch-task-no-signal')!;
      expect(task.status).toBe('error');
      expect(task.result).toBe(creditsText);
      expect(task.error).toContain('no completion signal');
      expect(isModelAvailable('provider/no-signal-primary')).toBe(true);
      expect(promptCalls.length).toBe(0);
    });

    it('E5: pollAndComplete 无信号输出 → error 条目 + result 原文 + 未换模未拉黑', async () => {
      const overloadText = 'Service overloaded, please try again later';
      const { tools, backgroundTaskRegistry, promptCalls } = createAsyncTools([overloadText]);

      const startResult = await tools.call_flow_agent.execute(
        { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: true },
        { sessionID: 'parent', directory: '' },
      );
      const startData = JSON.parse(startResult.output);
      expect(startData.success).toBe(true);

      await tools.flowagent_output.execute(
        { task_id: startData.task_id, block: true },
        { sessionID: 'parent', directory: '' },
      );

      const entry = backgroundTaskRegistry.get(startData.task_id)!;
      expect(entry.status).toBe('error');
      expect(entry.result).toBe(overloadText);
      expect(entry.error).toContain('no completion signal');
      expect(isModelAvailable('provider/test-model')).toBe(true);
      expect(promptCalls.length).toBe(1);
    });

    it('E6: async 正常 Markdown 报告 → completed', async () => {
      const report = '## Wave 1 Batch 1.1 完成报告\n\n### 改动文件清单\n\n- completion-detector.ts';
      const { tools, backgroundTaskRegistry } = createAsyncTools([report]);

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
      expect(backgroundTaskRegistry.get(startData.task_id)?.status).toBe('completed');
      expect(backgroundTaskRegistry.get(startData.task_id)?.result).toContain('Wave 1 Batch 1.1');
    });
  });

  // ── 上层与既有语义（2 条）──
  describe('上层与既有语义', () => {
    beforeEach(() => clearUnavailableModels());
    afterEach(() => {
      resetRunningSubagentCounts();
      clearUnavailableModels();
    });

    it('U1: sync no-valid-output 返回体携带 raw_output 与 no completion signal 文案', async () => {
      const creditsText = 'Your account has run out of credits';
      let msgCallCount = 0;
      const client = {
        session: {
          create: mock(async () => ({ data: { id: 'sync-session' } })),
          prompt: mock(async () => {}),
          messages: mock(async () => {
            const callIdx = msgCallCount++;
            return {
              data: [
                { parts: [{ type: 'text', text: 'user prompt' }] },
                { info: { role: 'assistant' }, parts: [{ type: 'text', text: creditsText }] },
                ...(callIdx === 0 ? [] : []),
              ],
            };
          }),
          status: mock(async () => ({ data: { 'sync-session': { type: 'idle' } } })),
          abort: mock(async () => {}),
        },
      };
      const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
      const tools = createCallFlowAgentTools({
        client: client as unknown as import('../../types.js').SFlowClient,
        backgroundTaskRegistry,
        backgroundTaskCounter: { value: 0 },
        agentModelMap: { 'build-executor': 'provider/test-model' } as AgentModelMap,
        sessionLabelPrefix: 'sFlow',
        validateAgent: async () => null,
        workflowName: 'sFlow',
      });

      const result = await tools.call_flow_agent.execute(
        { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: false },
        { sessionID: 'parent', directory: '' },
      );
      const data = JSON.parse(result.output);
      expect(data.success).toBe(false);
      expect(data.raw_output).toBe(creditsText);
      expect(data.error).toContain('no completion signal');
    });

    it('U2: prompt 回显语义不变 → 仍走 model-failure 分支（不落入 no-valid-output）', async () => {
      const echoText = '<workDir>/x</workDir>\n\ndo the work';
      let sendIdx = 0;
      const promptCalls: Array<{ model?: { providerID: string; modelID: string } }> = [];
      const client = {
        session: {
          prompt: mock(async (args: { path: { id: string }; body: { model?: { providerID: string; modelID: string } } }) => {
            promptCalls.push({ model: args.body.model });
            sendIdx++;
          }),
          messages: mock(async () => ({ data: [] })),
          status: mock(async () => ({ data: {} })),
          create: mock(async () => ({ data: { id: 's1' } })),
          abort: mock(async () => {}),
        },
      };
      let pollCount = 0;
      const result = await runWithModelFallback({
        client: client as never,
        sessionID: 's1',
        agentName: 'build-executor',
        basePrompt: echoText,
        initialModel: 'provider/first-model',
        maxWaitMs: 100,
        directory: '',
        extraFallbacks: ['provider/alt-model'],
        poll: async () => {
          pollCount++;
          return pollCount === 1 ? echoText : '[TASK_COMPLETE]\nreal output';
        },
      });
      expect(result.success).toBe(true);
      expect(result.model).not.toBe('provider/first-model');
      expect(result.failureReason).not.toBe('no-valid-output');
      expect(promptCalls.length).toBe(2);
    });
  });
});

describe('FIX-P1-1: send 失败语义分离', () => {
  beforeEach(() => clearUnavailableModels());
  afterEach(() => clearUnavailableModels());

  function makeClient(opts: { sendFailures?: Array<number | null> }) {
    let sendIdx = 0;
    return {
      client: {
        session: {
          prompt: mock(async () => {
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
    };
  }

  const baseParams = (
    c: ReturnType<typeof makeClient>,
    poll: (sid: string, m: string) => Promise<string | null>,
  ) => ({
    client: c.client as never,
    sessionID: 's1',
    agentName: 'build-executor',
    basePrompt: 'do the work',
    initialModel: 'provider/first-model',
    maxWaitMs: 100,
    directory: '',
    extraFallbacks: ['provider/alt-model'],
    poll,
  });

  it('1: send 402 + 唯一候选已尝试 → exhausted（detail 含 model error (HTTP 402) 与已尝试说明）', async () => {
    const c = makeClient({ sendFailures: [402] });
    const result = await runWithModelFallback({
      ...baseParams(c, async () => '[TASK_COMPLETE]\nDone'),
      initialModel: 'provider/alt-model',
      extraFallbacks: ['provider/alt-model'],
    });
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('exhausted');
    expect(result.detail).toContain('model error (HTTP 402)');
    expect(result.detail).toContain('fallback chain exhausted or model already attempted');
    expect(result.attemptedModels).toContain('provider/alt-model');
  });

  it('2: send 402 + 无候选 → exhausted 且保留 fallbacks / attemptedModels', async () => {
    const c = makeClient({ sendFailures: [402] });
    const result = await runWithModelFallback({
      ...baseParams(c, async () => '[TASK_COMPLETE]\nDone'),
      extraFallbacks: [],
    });
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('exhausted');
    expect(result.fallbacks).toEqual([]);
    expect(result.attemptedModels).toContain('provider/first-model');
  });

  it('3: send 400（SessionBusy）仍为 fatal', async () => {
    const c = makeClient({ sendFailures: [400] });
    const result = await runWithModelFallback({ ...baseParams(c, async () => '[TASK_COMPLETE]\nDone') });
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('fatal');
  });

  it('4: send 429 + 有候选 → 换模成功，首模型 5min 短冷却拉黑', async () => {
    const c = makeClient({ sendFailures: [429] });
    const result = await runWithModelFallback({ ...baseParams(c, async () => '[TASK_COMPLETE]\nDone') });
    expect(result.success).toBe(true);
    expect(result.fallbacks.length).toBe(1);
    expect(isModelAvailable('provider/first-model')).toBe(false);
    const restore = advanceClock(TRANSIENT_COOLDOWN_TTL_MS + 1000);
    try {
      expect(isModelAvailable('provider/first-model')).toBe(true);
    } finally {
      restore();
    }
  });
});

// ─── FIX-P1-3: abort 与模型故障分离 ────────────────────────────────────────────
describe('FIX-P1-3: abort 与模型故障分离', () => {
  beforeEach(() => clearUnavailableModels());
  afterEach(() => {
    resetRunningSubagentCounts();
    clearUnavailableModels();
  });

  /** sync harness：poll 恒返回 null，messages 注入指定 assistant 错误名（undefined = 无错误名） */
  function makeAbortClient(errName: string | undefined) {
    const promptCalls: Array<{ model?: { providerID: string; modelID: string } }> = [];
    return {
      promptCalls,
      client: {
        session: {
          prompt: mock(async (args: { path: { id: string }; body: { model?: { providerID: string; modelID: string } } }) => {
            promptCalls.push({ model: args.body.model });
          }),
          messages: mock(async () => ({
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { info: { role: 'assistant', error: errName ? { name: errName } : undefined }, parts: [] },
            ],
          })),
          status: mock(async () => ({ data: { s1: { type: 'retry', attempt: 5 } } })),
          create: mock(async () => ({ data: { id: 's1' } })),
          abort: mock(async () => {}),
        },
      },
    };
  }

  const syncParams = (c: ReturnType<typeof makeAbortClient>) => ({
    client: c.client as never,
    sessionID: 's1',
    agentName: 'build-executor',
    basePrompt: 'do the work',
    initialModel: 'provider/first-model',
    maxWaitMs: 100,
    directory: '',
    extraFallbacks: ['provider/alt-model'],
    poll: async () => null,
  });

  /** pollAndComplete harness：status 序列可控（retry/attempt=5 → poll 返回 null），messages 注入错误名 */
  function createAbortAsyncTools(errName: string | undefined) {
    const promptCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => ({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { info: { role: 'assistant', error: errName ? { name: errName } : undefined }, parts: [] },
          ],
        })),
        status: mock(async () => ({ data: { 'test-session-001': { type: 'retry', attempt: 5 } } })),
        abort: mock(async () => {}),
      },
    };
    const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
    const tools = createCallFlowAgentTools({
      client: client as unknown as import('../../types.js').SFlowClient,
      backgroundTaskRegistry,
      backgroundTaskCounter: { value: 0 },
      agentModelMap: { 'build-executor': 'provider/test-model' } as AgentModelMap,
      configOverrides: { 'build-executor': { fallback_models: ['provider/alt-model'] } },
      sessionLabelPrefix: 'sFlow',
      validateAgent: async () => null,
      workflowName: 'sFlow',
    });
    return { tools, backgroundTaskRegistry, promptCalls };
  }

  it('1: sync poll null + MessageAbortedError → aborted，不拉黑不换模不重发', async () => {
    const c = makeAbortClient('MessageAbortedError');
    const result = await runWithModelFallback(syncParams(c));
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('aborted');
    expect(isModelAvailable('provider/first-model')).toBe(true);
    expect(c.promptCalls.length).toBe(1);
    expect(result.fallbacks.length).toBe(0);
  });

  it('2: sync ContextOverflowError → 仍为 context-overflow（既有语义不变）', async () => {
    const c = makeAbortClient('ContextOverflowError');
    const result = await runWithModelFallback(syncParams(c));
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('context-overflow');
    expect(isModelAvailable('provider/first-model')).toBe(true);
    expect(c.promptCalls.length).toBe(1);
  });

  it('3: APIError / ProviderAuthError / ContextOverflowError 均不判为 aborted', async () => {
    for (const name of ['APIError', 'ProviderAuthError']) {
      clearUnavailableModels();
      const c = makeAbortClient(name);
      const result = await runWithModelFallback(syncParams(c));
      expect(result.failureReason).not.toBe('aborted');
      // 既有语义：走模型故障路径（拉黑 + 换模尝试）
      expect(isModelAvailable('provider/first-model')).toBe(false);
      expect(c.promptCalls.length).toBe(2);
    }
    clearUnavailableModels();
    const c = makeAbortClient('ContextOverflowError');
    const result = await runWithModelFallback(syncParams(c));
    expect(result.failureReason).toBe('context-overflow');
  });

  it('4: watcher probe null + MessageAbortedError → error 条目且未换模未拉黑', async () => {
    const promptCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'abort-session' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => ({
          data: [
            { parts: [{ type: 'text', text: 'user prompt' }] },
            { info: { role: 'assistant', error: { name: 'MessageAbortedError' } }, parts: [] },
          ],
        })),
        status: mock(async () => ({ data: { 'abort-session': { type: 'retry', attempt: 5 } } })),
        abort: mock(async () => {}),
      },
    };
    const registry: BackgroundTaskRegistry = new Map();
    registry.set('abort-task', {
      sessionID: 'abort-session',
      subagentType: 'build-executor',
      status: 'running',
      createdAt: Date.now(),
      changeDir: '',
      resolvedModel: 'provider/abort-primary',
    });
    const watcher = createBackgroundTaskWatcher({
      client: client as never,
      registry,
      pollIntervalMs: 20,
      extraFallbacks: ['provider/abort-fallback'],
    });
    watcher.start();
    await waitFor(() => registry.get('abort-task')?.status === 'error');
    watcher.stop();

    const task = registry.get('abort-task');
    if (!task) throw new Error('abort-task entry missing from registry');
    expect(task.status).toBe('error');
    expect(task.error).toContain('aborted');
    expect(isModelAvailable('provider/abort-primary')).toBe(true);
    expect(promptCalls.length).toBe(0);
  });

  it('5: pollAndComplete poll null + MessageAbortedError → error 条目，未拉黑未换模', async () => {
    const { tools, backgroundTaskRegistry, promptCalls } = createAbortAsyncTools('MessageAbortedError');

    const startResult = await tools.call_flow_agent.execute(
      { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: true },
      { sessionID: 'parent', directory: '' },
    );
    const startData = JSON.parse(startResult.output);
    expect(startData.success).toBe(true);

    await tools.flowagent_output.execute(
      { task_id: startData.task_id, block: true },
      { sessionID: 'parent', directory: '' },
    );

    const entry = backgroundTaskRegistry.get(startData.task_id);
    if (!entry) throw new Error('task entry missing from registry');
    expect(entry.status).toBe('error');
    expect(entry.error).toContain('aborted');
    expect(isModelAvailable('provider/test-model')).toBe(true);
    expect(promptCalls.length).toBe(1);
  });

  it('6: 非 abort 的 poll null（无错误名）→ 仍走既有故障转移（换模重发）', async () => {
    const { tools, backgroundTaskRegistry, promptCalls } = createAbortAsyncTools(undefined);

    const startResult = await tools.call_flow_agent.execute(
      { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: true },
      { sessionID: 'parent', directory: '' },
    );
    const startData = JSON.parse(startResult.output);

    await tools.flowagent_output.execute(
      { task_id: startData.task_id, block: true },
      { sessionID: 'parent', directory: '' },
    );

    // 既有语义不变：poll null 触发故障转移（首发 + 一次换模）
    expect(promptCalls.length).toBe(2);
    expect(backgroundTaskRegistry.get(startData.task_id)?.resolvedModel).toBe('provider/alt-model');
  });

  it('7: 上层 aborted 文案 → success false、含"取消"，且不是既有 fatal/exhausted 误导组合', async () => {
    const c = makeAbortClient('MessageAbortedError');
    const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
    const tools = createCallFlowAgentTools({
      client: c.client as unknown as import('../../types.js').SFlowClient,
      backgroundTaskRegistry,
      backgroundTaskCounter: { value: 0 },
      agentModelMap: { 'build-executor': 'provider/test-model' } as AgentModelMap,
      configOverrides: { 'build-executor': { fallback_models: ['provider/alt-model'] } },
      sessionLabelPrefix: 'sFlow',
      validateAgent: async () => null,
      workflowName: 'sFlow',
    });

    const result = await tools.call_flow_agent.execute(
      { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: false },
      { sessionID: 'parent', directory: '' },
    );
    const data = JSON.parse(result.output);
    expect(data.success).toBe(false);
    // 文案必须明确"取消"（spec: 任务被用户/系统取消，未拉黑模型、未触发模型故障转移）
    expect(data.error).toContain('取消');
    expect(data.error).toContain('未拉黑模型');
    // 不得复用 fatal / exhausted 的误导表述（把取消说成模型故障或前置校验失败）
    expect(data.error).not.toContain('前置校验失败');
    expect(data.error).not.toContain('model fallback exhausted');
    expect(data.attempted_models).toContain('provider/test-model');
  });
});

// ─── FIX-P2-3: poll 失败结果恢复层（session messages 抢救已完成产出）─────────────
describe('FIX-P2-3: poll 失败结果恢复层', () => {
  beforeEach(() => clearUnavailableModels());
  afterEach(() => {
    resetRunningSubagentCounts();
    clearUnavailableModels();
  });

  /**
   * sync harness：poll 恒返回 null（OpenCode 重试耗尽），通过 messages 注入
   * 「最后一条 assistant 消息」的文本 / 错误名，驱动 W4 恢复层判定。
   */
  function makeRecoveryClient(opts: {
    assistantText?: string | null;
    assistantErrorName?: string;
  }) {
    const promptCalls: Array<{ model?: { providerID: string; modelID: string } }> = [];
    return {
      promptCalls,
      client: {
        session: {
          prompt: mock(async (args: { path: { id: string }; body: { model?: { providerID: string; modelID: string } } }) => {
            promptCalls.push({ model: args.body.model });
          }),
          messages: mock(async () => ({
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              {
                info: {
                  role: 'assistant',
                  error: opts.assistantErrorName ? { name: opts.assistantErrorName } : undefined,
                },
                parts:
                  opts.assistantText != null
                    ? [{ type: 'text', text: opts.assistantText }]
                    : [],
              },
            ],
          })),
          status: mock(async () => ({ data: { s1: { type: 'retry', attempt: 5 } } })),
          create: mock(async () => ({ data: { id: 's1' } })),
          abort: mock(async () => {}),
        },
      },
    };
  }

  const recoveryParams = (c: ReturnType<typeof makeRecoveryClient>) => ({
    client: c.client as never,
    sessionID: 's1',
    agentName: 'build-executor',
    basePrompt: 'do the work',
    initialModel: 'provider/first-model',
    maxWaitMs: 100,
    directory: '',
    extraFallbacks: ['provider/alt-model'],
    poll: async () => null,
  });

  it('1: poll null + session 恢复产出过 hasRealOutput → 直接采用，不换模不拉黑', async () => {
    const c = makeRecoveryClient({ assistantText: '## Wave 1 完成报告\n\n### 改动文件清单' });
    const result = await runWithModelFallback(recoveryParams(c));
    expect(result.success).toBe(true);
    expect(result.output).toBe('## Wave 1 完成报告\n\n### 改动文件清单');
    // 不换模：模型与 fallbacks 保持原样
    expect(result.model).toBe('provider/first-model');
    expect(result.fallbacks.length).toBe(0);
    expect(c.promptCalls.length).toBe(1);
    // 不拉黑
    expect(isModelAvailable('provider/first-model')).toBe(true);
  });

  it('2: poll null + session 无有效产出 → 走既有换模路径', async () => {
    const c = makeRecoveryClient({ assistantText: null });
    const result = await runWithModelFallback(recoveryParams(c));
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('exhausted');
    // 换模：首发 + 一次换模
    expect(c.promptCalls.length).toBe(2);
    // 拉黑失败模型
    expect(isModelAvailable('provider/first-model')).toBe(false);
  });

  it('3: abort 错误名 → 不恢复、走 abort 零降级', async () => {
    const c = makeRecoveryClient({ assistantErrorName: 'MessageAbortedError' });
    const result = await runWithModelFallback(recoveryParams(c));
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('aborted');
    // abort 优先于恢复层：即使 session 有文本也不采用
    expect(result.output).toBeNull();
    // 零降级：不拉黑、不换模、不重发
    expect(isModelAvailable('provider/first-model')).toBe(true);
    expect(c.promptCalls.length).toBe(1);
    expect(result.fallbacks.length).toBe(0);
  });

  it('4: 恢复产出未过 hasRealOutput → 不采纳（假产出），仍走换模', async () => {
    // "Service overloaded, please try again later" 被 hasRealOutput 判为假产出（model-fallback-fix.test.ts:1113）
    const c = makeRecoveryClient({ assistantText: 'Service overloaded, please try again later' });
    const result = await runWithModelFallback(recoveryParams(c));
    // 假产出不采纳：未作为 success output 返回
    expect(result.success).toBe(false);
    expect(result.failureReason).toBe('exhausted');
    expect(result.output).toBeNull();
    // 仍走换模路径
    expect(c.promptCalls.length).toBe(2);
    expect(isModelAvailable('provider/first-model')).toBe(false);
  });
});

// ─── FIX-P1-2: 换模后 re-poll 语义 ────────────────────────────────────────────
describe('FIX-P1-2: 换模后 re-poll 语义', () => {
  beforeEach(() => clearUnavailableModels());
  afterEach(() => {
    resetRunningSubagentCounts();
    clearUnavailableModels();
  });

  /**
   * pollAndComplete harness：
   * - pollOutputs[0] 为首次 poll 文本（触发换模），pollOutputs[1] 为 re-poll 文本
   * - statusTypes 为 status() 的返回序列（'busy' → probeMode 下返回 PROBE_PENDING）
   */
  function createRepollTools(opts: {
    pollOutputs: string[];
    statusTypes: Array<'idle' | 'busy'>;
    fallbackModels?: string[];
  }) {
    let msgCallCount = 0;
    let statusIdx = 0;
    const promptCalls: Array<{ id: string; body: Record<string, unknown> }> = [];
    const client = {
      session: {
        create: mock(async () => ({ data: { id: 'test-session-001' } })),
        prompt: mock(async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          promptCalls.push({ id: args.path.id, body: args.body });
        }),
        messages: mock(async () => {
          const callIdx = msgCallCount++;
          const idx = callIdx === 0 ? 0 : Math.min(callIdx - 1, opts.pollOutputs.length - 1);
          return {
            data: [
              { parts: [{ type: 'text', text: 'user prompt' }] },
              { info: { role: 'assistant' }, parts: [{ type: 'text', text: opts.pollOutputs[idx] }] },
            ],
          };
        }),
        status: mock(async () => {
          const type = opts.statusTypes[Math.min(statusIdx++, opts.statusTypes.length - 1)];
          return { data: { 'test-session-001': { type } } };
        }),
        abort: mock(async () => {}),
      },
    };
    const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
    const tools = createCallFlowAgentTools({
      client: client as unknown as import('../../types.js').SFlowClient,
      backgroundTaskRegistry,
      backgroundTaskCounter: { value: 0 },
      agentModelMap: { 'build-executor': 'provider/test-model' } as AgentModelMap,
      configOverrides: {
        'build-executor': { fallback_models: opts.fallbackModels ?? ['provider/alt-model'] },
      },
      sessionLabelPrefix: 'sFlow',
      validateAgent: async () => null,
      workflowName: 'sFlow',
    });
    return { tools, backgroundTaskRegistry, promptCalls };
  }

  /** 启动 async 任务并 block 拉取一次结果 */
  async function runOnce(t: ReturnType<typeof createRepollTools>) {
    const startResult = await t.tools.call_flow_agent.execute(
      { description: 't', prompt: 'work', subagent_type: 'build-executor', run_in_background: true },
      { sessionID: 'parent', directory: '' },
    );
    const startData = JSON.parse(startResult.output);
    const outResult = await t.tools.flowagent_output.execute(
      { task_id: startData.task_id, block: true },
      { sessionID: 'parent', directory: '' },
    );
    return { taskId: startData.task_id as string, outData: JSON.parse(outResult.output) };
  }

  it('1: 换模后 re-poll 会话 busy → 保持 running，新模型未被拉黑且不二次换模', async () => {
    const t = createRepollTools({
      pollOutputs: ['Error: internal provider failure (code: 500)'],
      statusTypes: ['idle', 'busy'],
    });
    const { taskId } = await runOnce(t);

    const entry = t.backgroundTaskRegistry.get(taskId);
    if (!entry) throw new Error('task entry missing from registry');
    expect(entry.status).toBe('running');
    expect(isModelAvailable('provider/alt-model')).toBe(true);
    // 首发 + 一次换模，无第二次换模
    expect(t.promptCalls.length).toBe(2);
  });

  it('2: 换模后 re-poll 正常产出 → completed', async () => {
    const t = createRepollTools({
      pollOutputs: ['Error: internal provider failure (code: 500)', '[TASK_COMPLETE]\nDone'],
      statusTypes: ['idle', 'idle'],
    });
    const { taskId } = await runOnce(t);

    const entry = t.backgroundTaskRegistry.get(taskId);
    if (!entry) throw new Error('task entry missing from registry');
    expect(entry.status).toBe('completed');
    expect(entry.result).toBe('[TASK_COMPLETE]\nDone');
    expect(t.promptCalls.length).toBe(2);
  });

  it('3: 换模后 re-poll 仍返回错误码文本 → 继续换模（第三次 prompt）', async () => {
    const t = createRepollTools({
      pollOutputs: ['Error: internal provider failure (code: 500)', 'HTTP 500: internal error'],
      statusTypes: ['idle', 'idle'],
      // 链上仍有第二个未尝试模型：re-poll 仍为错误码文本时继续换模
      fallbackModels: ['provider/alt-model', 'provider/alt-model-2'],
    });
    await runOnce(t);

    expect(t.promptCalls.length).toBe(3);
  });

  it('4: running 条目保留换模后的 resolvedModel 与 attemptedModels（live registry 基线）', async () => {
    const t = createRepollTools({
      pollOutputs: ['Error: internal provider failure (code: 500)'],
      statusTypes: ['idle', 'busy'],
    });
    const { taskId } = await runOnce(t);

    const entry = t.backgroundTaskRegistry.get(taskId);
    if (!entry) throw new Error('task entry missing from registry');
    expect(entry.status).toBe('running');
    expect(entry.resolvedModel).toBe('provider/alt-model');
    expect(entry.attemptedModels).toContain('provider/alt-model');
  });

  it('5: 换模后 re-poll 返回无码错误文本 → no-valid-output 失败终结且不再换模（P0 补齐异步 re-poll 正向判定）', async () => {
    const t = createRepollTools({
      pollOutputs: ['Error: internal provider failure (code: 500)', 'Service overloaded, please try again later'],
      statusTypes: ['idle', 'idle'],
    });
    const { taskId } = await runOnce(t);

    const entry = t.backgroundTaskRegistry.get(taskId);
    if (!entry) throw new Error('task entry missing from registry');
    expect(entry.status).toBe('error');
    expect(entry.result).toBe('Service overloaded, please try again later');
    expect(entry.error).toContain('no completion signal');
    // 仅首发 + 一次换模（no-valid-output 不再触发第二次换模）
    expect(t.promptCalls.length).toBe(2);
    // 未拉黑换模目标模型
    expect(isModelAvailable('provider/alt-model')).toBe(true);
  });

  it('6: 换模后 re-poll 返回正常产出 → completed（P0 正向判定不误杀真实产出）', async () => {
    const t = createRepollTools({
      pollOutputs: ['Error: internal provider failure (code: 500)', '## Wave 1 Batch 1.1 完成报告\n\n### 改动文件清单'],
      statusTypes: ['idle', 'idle'],
    });
    const { taskId } = await runOnce(t);

    const entry = t.backgroundTaskRegistry.get(taskId);
    if (!entry) throw new Error('task entry missing from registry');
    expect(entry.status).toBe('completed');
    expect(entry.result).toBe('## Wave 1 Batch 1.1 完成报告\n\n### 改动文件清单');
    expect(t.promptCalls.length).toBe(2);
  });
});

// ─── FIX-P1-4: 启动期配置模型存在性校验（P1-4） ──────────────────────────────

/** 构造一个 duck-typed provider.list client */
function makeListClient(data: unknown): ProviderListClient {
  return { provider: { list: mock(async () => ({ data })) } };
}

describe('FIX-P1-4: 配置模型存在性校验', () => {
  let warnSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    resetModelAvailability();
    warnSpy = spyOn(Logger, 'warn').mockImplementation(async () => {});
  });

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('1: 未刷新时状态为 cold', () => {
    expect(getAvailabilityState()).toBe('cold');
  });

  it('2: refresh 后 ready 且 isModelKnown 正确', async () => {
    const client = makeListClient({ all: [{ id: 'p', models: { real: {} } }], connected: ['p'] });
    const snap = await refreshAvailableModels(client);
    expect(snap.state).toBe('ready');
    expect(isModelKnown('p/real')).toBe(true);
    expect(isModelKnown('p/nonexistent')).toBe(false);
  });

  it('3: provider.list 抛错 → failed 且不抛出', async () => {
    const client: ProviderListClient = {
      provider: { list: mock(async () => { throw new Error('boom'); }) },
    };
    let threw = false;
    try {
      await refreshAvailableModels(client);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(getAvailabilityState()).toBe('failed');
    // 状态说明 warn 一条
    expect(warnSpy).toHaveBeenCalled();
  });

  it('4: all 为空 → cold', async () => {
    const client = makeListClient({ all: [], connected: [] });
    await refreshAvailableModels(client);
    expect(getAvailabilityState()).toBe('cold');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('5: 未知模型 / 未连接 provider 被 warn 并收集', async () => {
    const client = makeListClient({
      all: [
        { id: 'p', models: { real: {} } },
        { id: 'p2', models: { m: {} } },
      ],
      connected: ['p'],
    });
    const config: SFlowConfig = {
      agents: { 'build-executor': { model: 'p/nonexistent', fallback_models: ['p2/m'] } },
      modelProfiles: { deep: { model: 'p/real', fallback_models: ['p2/m'] } },
    };
    const result = await validateConfiguredModels(client, config);
    expect(result.unknown).toContain('p/nonexistent');
    expect(result.unconnected).toContain('p2/m');
    // 按模型串去重：p2/m 在 agent 与 tier 两处出现，仅 warn 一次
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('p/nonexistent'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('p2/m'));
    const unconnectedCalls = warnSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes('p2/m'),
    );
    expect(unconnectedCalls.length).toBe(1);
  });

  it('5b: 全部合法时两数组为空且无 warn', async () => {
    const client = makeListClient({ all: [{ id: 'p', models: { real: {} } }], connected: ['p'] });
    const config: SFlowConfig = {
      agents: { 'build-executor': { model: 'p/real' } },
    };
    const result = await validateConfiguredModels(client, config);
    expect(result.unknown).toEqual([]);
    expect(result.unconnected).toEqual([]);
    // 全部合法：无模型级 warn（refresh 为 ready，也不 warn 状态）
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('6: ready 状态下未知模型被标注 unverifiedModels（解析结果不变）', async () => {
    const client = makeListClient({ all: [{ id: 'p', models: { real: {} } }], connected: ['p'] });
    await refreshAvailableModels(client);
    const result = resolveModelWithFallback('spec-writer', undefined, {}, undefined, {
      modelProfiles: { deep: { model: 'p/typo', fallback_models: [] } },
      activeWorkflow: 'sflow',
    });
    expect(result.model).toBe('p/typo');
    expect(result.unverifiedModels).toContain('p/typo');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('p/typo'));
  });

  it('6b: cold 状态下不标注 unverifiedModels', async () => {
    resetModelAvailability();
    const result = resolveModelWithFallback('spec-writer', undefined, {}, undefined, {
      modelProfiles: { deep: { model: 'p/typo', fallback_models: [] } },
      activeWorkflow: 'sflow',
    });
    expect(result.unverifiedModels).toBeUndefined();
  });

  it('7: 启动期校验失败（provider.list 抛错）不抛出且状态 failed', async () => {
    const client: ProviderListClient = {
      provider: { list: mock(async () => { throw new Error('network down'); }) },
    };
    const config: SFlowConfig = { agents: { 'build-executor': { model: 'p/whatever' } } };
    let threw = false;
    let result: { unknown: string[]; unconnected: string[] } | undefined;
    try {
      result = await validateConfiguredModels(client, config);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(getAvailabilityState()).toBe('failed');
    expect(result?.unknown).toEqual([]);
    expect(result?.unconnected).toEqual([]);
  });

  // ─── P0: provider.list 挂起超时保护（OpenCode 启动卡死根因） ───────────────
  // provider.list() 是 HTTP 调用：宿主未就绪时永不 settle，无超时会阻塞插件
  // server() 返回导致 OpenCode 黑屏卡死；try/catch 无法解救永不 settle 的 promise。

  /** 挂起 client：provider.list() 永不 settle */
  function makeHangingClient(): ProviderListClient {
    return { provider: { list: mock(() => new Promise<never>(() => {})) } };
  }

  /** 可控 fake timer：注册的定时器不自动触发，需手动 fire；可观测是否被清理 */
  function installFakeTimers(): {
    pending: () => Array<{ ms: number; cleared: boolean }>;
    fireFirstPending: () => void;
    restore: () => void;
  } {
    type Entry = { cb: () => void; ms: number; cleared: boolean };
    const entries: Entry[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((cb: () => void, ms: number) => {
      const entry: Entry = { cb, ms, cleared: false };
      entries.push(entry);
      return entry as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((handle: unknown) => {
      const entry = entries.find((e) => e === handle);
      if (entry) entry.cleared = true;
    }) as unknown as typeof clearTimeout;
    return {
      pending: () => entries,
      fireFirstPending: () => {
        const entry = entries.find((e) => !e.cleared);
        if (entry) entry.cb();
      },
      restore: () => {
        globalThis.setTimeout = realSetTimeout;
        globalThis.clearTimeout = realClearTimeout;
      },
    };
  }

  it('8: provider.list 永不 settle → 超时后 failed、不抛出、warn 一次', async () => {
    const timers = installFakeTimers();
    try {
      const client = makeHangingClient();
      const config: SFlowConfig = { agents: { 'build-executor': { model: 'p/whatever' } } };
      const pending = validateConfiguredModels(client, config);
      // 未触发超时前：3s 定时器已注册，promise 仍挂起
      await Promise.resolve();
      expect(timers.pending()).toHaveLength(1);
      expect(timers.pending()[0].ms).toBe(3000);
      // 手动推进到超时点
      timers.fireFirstPending();
      let threw = false;
      try {
        await pending;
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
      expect(getAvailabilityState()).toBe('failed');
      // failed 状态说明只 warn 一次（warnStatusOnce）
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      timers.restore();
    }
  });

  it('9: provider.list 正常返回 → 状态 ready 且行为不变（超时定时器被清理）', async () => {
    const timers = installFakeTimers();
    try {
      const client = makeListClient({ all: [{ id: 'p', models: { real: {} } }], connected: ['p'] });
      const config: SFlowConfig = { agents: { 'build-executor': { model: 'p/real' } } };
      const result = await validateConfiguredModels(client, config);
      expect(getAvailabilityState()).toBe('ready');
      expect(result.unknown).toEqual([]);
      expect(result.unconnected).toEqual([]);
      // promise 先 settle：定时器必须被清理，无泄漏
      expect(timers.pending().filter((e) => !e.cleared)).toHaveLength(0);
    } finally {
      timers.restore();
    }
  });

  it('10: 超时路径同样清理定时器（无泄漏）', async () => {
    const timers = installFakeTimers();
    try {
      const client = makeHangingClient();
      const pending = refreshAvailableModels(client);
      await Promise.resolve();
      timers.fireFirstPending();
      const snap = await pending;
      expect(snap.state).toBe('failed');
      expect(timers.pending().every((e) => e.cleared)).toBe(true);
    } finally {
      timers.restore();
    }
  });
});

// ─── W6/D1: 全链不可用时工具描述追加降级提示（方案 B） ─────────────────────────
// 启动对账完成后，若某 agent 的用户配置链全部命中 unknown/unconnected，在其
// description 末尾追加纯事实提示（不推荐替代模型、不改写绑定、不阻断注册）。
// state=cold/failed（对账不可信）时不加提示。

describe('W6/D1: 全链不可用降级提示', () => {
  let warnSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    resetModelAvailability();
    warnSpy = spyOn(Logger, 'warn').mockImplementation(async () => {});
  });

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('①链全不可用（ready+全 unknown/unconnected）→ description 含降级提示', async () => {
    const client = makeListClient({ all: [{ id: 'p', models: { real: {} } }], connected: ['p'] });
    const config: SFlowConfig = {
      agents: { 'build-executor': { model: 'p/unknown1', fallback_models: ['p/unknown2'] } },
    };
    const validation = await validateConfiguredModels(client, config);
    expect(validation.unknown).toEqual(['p/unknown1', 'p/unknown2']);

    const description = appendChainUnavailableNotice(
      'build-executor agent from sFlow plugin',
      'build-executor',
      config,
      validation,
    );
    // 原描述保留
    expect(description).toContain('build-executor agent from sFlow plugin');
    // 追加对账事实提示
    expect(description).toContain('启动对账');
    expect(description).toContain('p/unknown1');
    expect(description).toContain('p/unknown2');
  });

  it('②部分可用 → 不加提示', async () => {
    const client = makeListClient({ all: [{ id: 'p', models: { real: {} } }], connected: ['p'] });
    const config: SFlowConfig = {
      agents: { 'build-executor': { model: 'p/real', fallback_models: ['p/unknown'] } },
    };
    const validation = await validateConfiguredModels(client, config);
    expect(validation.unknown).toEqual(['p/unknown']);

    const description = appendChainUnavailableNotice(
      'build-executor agent from sFlow plugin',
      'build-executor',
      config,
      validation,
    );
    // 链上 p/real 可用 → 原描述原样返回，不追加任何提示
    expect(description).toBe('build-executor agent from sFlow plugin');
  });

  it('③cold/failed（对账不可信）→ 不加提示', async () => {
    const config: SFlowConfig = { agents: { 'build-executor': { model: 'p/x' } } };

    // failed：provider.list 抛错 → 对账不可信
    const failClient: ProviderListClient = {
      provider: { list: mock(async () => { throw new Error('boom'); }) },
    };
    const validationFailed = await validateConfiguredModels(failClient, config);
    expect(getAvailabilityState()).toBe('failed');
    expect(
      appendChainUnavailableNotice('base desc', 'build-executor', config, validationFailed),
    ).toBe('base desc');

    // cold：未刷新 → 对账不可信（即便传入"全不可用"的校验结果也不应提示）
    resetModelAvailability();
    expect(getAvailabilityState()).toBe('cold');
    expect(
      appendChainUnavailableNotice('base desc', 'build-executor', config, { unknown: ['p/x'], unconnected: [] }),
    ).toBe('base desc');
  });

  it('④提示为纯事实陈述（不包含替代模型建议）', async () => {
    const client = makeListClient({
      all: [
        { id: 'p', models: { real: {} } },
        { id: 'q', models: { m: {} } },
      ],
      connected: ['p', 'q'],
    });
    const config: SFlowConfig = {
      agents: { 'build-executor': { model: 'q/typo', fallback_models: ['q/typo2'] } },
    };
    const validation = await validateConfiguredModels(client, config);
    expect(validation.unknown).toEqual(['q/typo', 'q/typo2']);

    // 基础描述为空时，提示独立成文（覆盖另一分支）
    const description = appendChainUnavailableNotice(undefined, 'build-executor', config, validation);
    expect(description).not.toBeUndefined();
    const notice = description as string;
    // 纯事实陈述：不含推荐 / 替代 / 建议类措辞
    expect(notice).not.toMatch(/建议|推荐|替代|改用|可使用|请使用/);
    // 只陈述不可用模型事实，不引入可用模型作为替代暗示
    expect(notice).not.toContain('p/real');
    expect(notice).toContain('q/typo');
    expect(notice).toContain('q/typo2');
  });
});

// ─── R3-fix P2: combined 工厂补接启动期模型可用性校验 ──────────────────────────
// 1357a31 只接了 sflow / iflow 两个工厂；combined（同时安装两个工作流）漏接
// validateConfiguredModels → 配置模型拼错 / provider 未连接完全无 warn。
// 可观测效果：server() 执行后 availability 快照离开 'cold'（refresh 被调用）。

describe('R3-fix P2: combined 工厂启动期模型校验接线', () => {
  let warnSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    resetModelAvailability();
    warnSpy = spyOn(Logger, 'warn').mockImplementation(async () => {});
  });

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('provider.list 抛错 → failed 状态（不阻断插件启动，返回 hooks）', async () => {
    const input = {
      client: {
        provider: { list: mock(async () => { throw new Error('network down'); }) },
      },
      directory: 'C:/Users/admin/AppData/Local/Temp/opencode/combined-factory-test',
    };

    const hooks = await createCombinedPluginModule().server(input as never);

    expect(hooks).toBeDefined();
    expect(typeof hooks.dispose).toBe('function');
    // 校验被调用：状态从 cold 推进到 failed（且不抛出）
    expect(getAvailabilityState()).toBe('failed');
    expect(warnSpy).toHaveBeenCalled();

    await hooks.dispose?.();
  });

  it('provider.list 正常返回 → ready 状态', async () => {
    const input = {
      client: {
        provider: {
          list: mock(async () => ({
            data: { all: [{ id: 'p', models: { real: {} } }], connected: ['p'] },
          })),
        },
      },
      directory: 'C:/Users/admin/AppData/Local/Temp/opencode/combined-factory-test',
    };

    const hooks = await createCombinedPluginModule().server(input as never);

    expect(hooks).toBeDefined();
    expect(getAvailabilityState()).toBe('ready');

    await hooks.dispose?.();
  });
});
