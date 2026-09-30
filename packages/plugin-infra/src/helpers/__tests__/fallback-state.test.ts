/**
 * Tests for shared FallbackState state machine (P3-3 / P3-4)
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import type { ProviderListClient } from '../../agents/model-availability.js';
import { refreshAvailableModels, resetModelAvailability } from '../../agents/model-availability.js';
import type { BackgroundTaskEntry } from '../../types.js';
import { PROBE_PENDING } from '../../types.js';
import {
  canRecoverFromPollError,
  createFallbackState,
  extractLastAssistantText,
  getNextCandidate,
  isExhausted,
  recordAttempt,
  resetAvailabilitySkipWarnFlag,
  resolveProbeVerdict,
} from '../fallback-state.js';

// ─── Task 1.1: createFallbackState / recordAttempt / isExhausted ───────────────

describe('FIX-P3-3: FallbackState 核心状态机', () => {
  it('createFallbackState 从首模型与配置链创建初始状态，attemptedModels 已含首模型', () => {
    const state = createFallbackState('p1/m1', ['p2/m2', 'p3/m3']);
    expect(state.providerID).toBe('p1');
    expect(state.modelID).toBe('m1');
    expect(state.fallbackChain).toEqual(['p2/m2', 'p3/m3']);
    expect(state.attemptCount).toBe(1);
    expect(state.attemptedModels).toEqual(['p1/m1']);
    expect(state.pending).toBe(false);
  });

  it('createFallbackState 处理非法格式模型字符串（不抛错）', () => {
    const state = createFallbackState('bad-model', ['p2/m2']);
    expect(state.providerID).toBe('bad-model');
    expect(state.modelID).toBe('bad-model');
    expect(state.attemptedModels).toEqual(['bad-model']);
  });

  it('recordAttempt 递增 attemptCount 并把模型加入 attemptedModels', () => {
    const state = createFallbackState('p1/m1', ['p2/m2', 'p3/m3']);
    recordAttempt(state, 'p2/m2');
    expect(state.attemptCount).toBe(2);
    expect(state.attemptedModels).toEqual(['p1/m1', 'p2/m2']);
    expect(state.providerID).toBe('p2');
    expect(state.modelID).toBe('m2');
  });

  it('isExhausted 在 attemptCount > maxRetries 时返回 true', () => {
    const state = createFallbackState('p1/m1', ['p2/m2', 'p3/m3']);
    expect(isExhausted(state, 2)).toBe(false);
    recordAttempt(state, 'p2/m2');
    expect(isExhausted(state, 2)).toBe(false);
    recordAttempt(state, 'p3/m3');
    expect(isExhausted(state, 2)).toBe(true);
  });

  it('isExhausted 在 fallbackChain 全部尝试过（含首模型）时返回 true', () => {
    const state = createFallbackState('p1/m1', ['p2/m2']);
    recordAttempt(state, 'p2/m2');
    // attemptCount = 2, maxRetries = 2 => 2 > 2? false
    // fallbackChain.every in attemptedModels = true
    expect(isExhausted(state, 2)).toBe(true);
  });

  it('isExhausted 在 attemptCount <= maxRetries 且链未耗尽时返回 false', () => {
    const state = createFallbackState('p1/m1', ['p2/m2', 'p3/m3']);
    expect(isExhausted(state, 2)).toBe(false);
  });
});

// ─── Task 1.2: getNextCandidate ────────────────────────────────────────────────

describe('FIX-P3-3: getNextCandidate', () => {
  // W3: getNextCandidate 内部已接入 model-availability 状态机（cold/failed 跳过
  // 黑名单）。此组用例验证注入的 isModelAvailable 语义，前置推进到 ready，
  // 避免单文件运行时的全局 cold 默认导致黑名单被跳过。
  beforeEach(async () => {
    resetModelAvailability();
    resetAvailabilitySkipWarnFlag();
    const client: ProviderListClient = {
      provider: {
        list: async () => ({
          data: {
            all: [{ id: 'p1', models: { m1: {}, m2: {}, m3: {}, m4: {} } }],
            connected: ['p1'],
          },
        }),
      },
    };
    await refreshAvailableModels(client);
  });

  it('沿 fallbackChain 返回第一个未尝试且可用的模型', () => {
    const state = createFallbackState('p1/m1', ['p2/m2', 'p3/m3']);
    const isAvailable = (m: string) => m !== 'p2/m2'; // p2/m2 unavailable
    expect(getNextCandidate(state, isAvailable)).toBe('p3/m3');
  });

  it('跳过已在 attemptedModels 中的模型', () => {
    const state = createFallbackState('p1/m1', ['p2/m2', 'p3/m3']);
    recordAttempt(state, 'p2/m2');
    const isAvailable = () => true;
    expect(getNextCandidate(state, isAvailable)).toBe('p3/m3');
  });

  it('链耗尽时返回 null', () => {
    const state = createFallbackState('p1/m1', ['p2/m2']);
    recordAttempt(state, 'p2/m2');
    const isAvailable = () => true;
    expect(getNextCandidate(state, isAvailable)).toBeNull();
  });
});

// ─── Task 1.3: canRecoverFromPollError ─────────────────────────────────────────

describe('FIX-P3-4: canRecoverFromPollError', () => {
  it('MessageAbortedError 返回 false', () => {
    expect(canRecoverFromPollError('MessageAbortedError')).toBe(false);
  });

  it('AbortError 返回 false', () => {
    expect(canRecoverFromPollError('AbortError')).toBe(false);
  });

  it('DOMException AbortError (the operation was aborted) 返回 false', () => {
    expect(canRecoverFromPollError('the operation was aborted')).toBe(false);
  });

  it('ApiError 返回 true', () => {
    expect(canRecoverFromPollError('ApiError')).toBe(true);
  });

  it('空字符串返回 true', () => {
    expect(canRecoverFromPollError('')).toBe(true);
  });
});

// ─── Task 1.4: resolveProbeVerdict ─────────────────────────────────────────────

describe('FIX-P3-4: resolveProbeVerdict', () => {
  const baseEntry = (attemptedModels: string[] = []): BackgroundTaskEntry => ({
    sessionID: 's1',
    subagentType: 'test',
    status: 'running',
    createdAt: Date.now(),
    attemptedModels,
  });

  it('probeResult 为字符串时返回 idle', () => {
    const verdict = resolveProbeVerdict('output', null, baseEntry(), () => null);
    expect(verdict).toBe('idle');
  });

  it('probeResult 为 PROBE_PENDING 时返回 pending', () => {
    const verdict = resolveProbeVerdict(PROBE_PENDING, null, baseEntry(), () => null);
    expect(verdict).toBe('pending');
  });

  it('probeResult 为 null 且错误名为 MessageAbortedError 时返回 abort', () => {
    const verdict = resolveProbeVerdict(null, null, baseEntry(), () => 'MessageAbortedError');
    expect(verdict).toBe('abort');
  });

  it('probeResult 为 null 且尝试已耗尽时返回 error', () => {
    const verdict = resolveProbeVerdict(null, null, baseEntry(['a', 'b', 'c']), () => 'ApiError');
    expect(verdict).toBe('error');
  });

  it('probeResult 为 null 且非 abort、未耗尽时返回 noSignal（W1 recoverable 留枚举位）', () => {
    const verdict = resolveProbeVerdict(null, null, baseEntry(['a']), () => 'ApiError');
    expect(verdict).toBe('noSignal');
  });

  it('resolveProbeVerdict 为纯函数，不调用 readErrorName 当 probeResult 为字符串时', () => {
    let called = false;
    resolveProbeVerdict('output', null, baseEntry(), () => {
      called = true;
      return null;
    });
    expect(called).toBe(false);
  });

  it('probeResult 为 null 且 readRecoverable 返回 true → recoverable（W4 落地枚举分支）', () => {
    const verdict = resolveProbeVerdict(null, null, baseEntry(['a']), () => 'ApiError', () => true);
    expect(verdict).toBe('recoverable');
  });

  it('probeResult 为 null 且 readRecoverable 缺省/返回 false → 维持 noSignal', () => {
    const defaultVerdict = resolveProbeVerdict(null, null, baseEntry(['a']), () => 'ApiError');
    expect(defaultVerdict).toBe('noSignal');
    const falseVerdict = resolveProbeVerdict(
      null,
      null,
      baseEntry(['a']),
      () => 'ApiError',
      () => false,
    );
    expect(falseVerdict).toBe('noSignal');
  });

  it('probeResult 为 null 且 abort 错误名 → abort 优先于 recoverable（readRecoverable 被短路）', () => {
    const verdict = resolveProbeVerdict(null, null, baseEntry(['a']), () => 'MessageAbortedError', () => true);
    expect(verdict).toBe('abort');
  });
});

// ─── W4: extractLastAssistantText ────────────────────────────────────────────

describe('FIX-P2-3: extractLastAssistantText', () => {
  it('取最后一条 assistant 消息的 text part 拼接文本', () => {
    const data = [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'user prompt' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'first draft' }] },
      {
        info: { role: 'assistant' },
        parts: [{ type: 'text', text: '## 完成报告\n\n### 改动清单' }],
      },
    ];
    expect(extractLastAssistantText(data)).toBe('## 完成报告\n\n### 改动清单');
  });

  it('最新 assistant 消息带 error → 返回 null（拒绝用陈旧内容掩盖失败）', () => {
    const data = [
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'old complete report' }] },
      { info: { role: 'assistant', error: { name: 'ApiError' } }, parts: [{ type: 'text', text: 'partial' }] },
    ];
    expect(extractLastAssistantText(data)).toBeNull();
  });

  it('最新 assistant 消息无可读 text → 返回 null', () => {
    const data = [
      { info: { role: 'assistant' }, parts: [{ type: 'text', text: 'old report' }] },
      { info: { role: 'assistant' }, parts: [{ type: 'reasoning', text: 'chain of thought' }] },
    ];
    expect(extractLastAssistantText(data)).toBeNull();
  });

  it('无 assistant 消息 / 非数组数据 → 返回 null', () => {
    expect(extractLastAssistantText(null)).toBeNull();
    expect(extractLastAssistantText([{ info: { role: 'user' }, parts: [] }])).toBeNull();
  });
});
