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

import { beforeEach, describe, expect, it, mock, afterEach } from 'bun:test';
import type { AgentModelMap, BackgroundTaskRegistry } from '../../types.js';
import { createCallFlowAgentTools, resetRunningSubagentCounts, runWithModelFallback } from '../call-flow-agent.js';
import { clearUnavailableModels, markModelUnavailable, isModelAvailable, getAlternativeModel, resolveModelWithFallback } from '../../agents/agent-builder.js';
import { classifyQuotaError, parseQuotaResetTime } from '../../helpers/completion-detector.js';

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
    const quotaText = '您的使用量已超出频率限制，将在 ' +
      new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') +
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
