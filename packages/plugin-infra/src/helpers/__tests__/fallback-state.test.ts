/**
 * Tests for shared FallbackState state machine (P3-3 / P3-4)
 */
import { describe, expect, it } from 'bun:test';
import type { BackgroundTaskEntry } from '../../types.js';
import { PROBE_PENDING } from '../../types.js';
import {
  canRecoverFromPollError,
  createFallbackState,
  getNextCandidate,
  isExhausted,
  recordAttempt,
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
});
