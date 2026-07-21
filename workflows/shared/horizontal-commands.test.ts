/**
 * Tests for Shared Horizontal Command Definitions
 *
 * Covers:
 * - Full test/review command matching
 * - Partial test/review command matching
 * - Edge cases (empty input, partial matches, case sensitivity)
 * - Cross-workflow compatibility (both routers import from this source)
 */
import { describe, it, expect } from 'bun:test';
import { HORIZONTAL_COMMANDS, matchHorizontalCommand } from './horizontal-commands.js';

describe('HORIZONTAL_COMMANDS', () => {
  it('should define at least 4 commands (full + partial for test and review)', () => {
    expect(HORIZONTAL_COMMANDS.length).toBeGreaterThanOrEqual(4);
  });

  it('should have unique action values for each command', () => {
    const actions = HORIZONTAL_COMMANDS.map(c => c.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('should have unique agent values', () => {
    const agents = new Set(HORIZONTAL_COMMANDS.map(c => c.agent));
    expect(agents.has('test-engineer')).toBe(true);
    expect(agents.has('review-engineer')).toBe(true);
  });
});

describe('matchHorizontalCommand — Full Test', () => {
  const testCases = [
    // Chinese full test patterns
    { input: '全面test', expected: 'test-engineer' },
    { input: '全面测试', expected: 'test-engineer' },
    { input: '做一次完整的测试', expected: 'test-engineer' },
    { input: '全线测试', expected: 'test-engineer' },
    { input: '彻底测试', expected: 'test-engineer' },
    { input: '测试所有', expected: 'test-engineer' },
    { input: '5轮测试', expected: 'test-engineer' },
    // English full test patterns
    { input: 'full test', expected: 'test-engineer' },
    { input: 'run all tests', expected: 'test-engineer' },
    { input: 'comprehensive test', expected: 'test-engineer' },
    { input: 'comprehensive testing', expected: 'test-engineer' },
    // Mixed
    { input: '进行全面test', expected: 'test-engineer' },
    { input: '进行全面测试', expected: 'test-engineer' },
  ];

  for (const { input, expected } of testCases) {
    it(`should match "${input}" → ${expected}`, () => {
      const result = matchHorizontalCommand(input);
      expect(result).not.toBeNull();
      expect(result!.agent).toBe(expected);
      expect(result!.action).toBe('full-test');
    });
  }
});

describe('matchHorizontalCommand — Partial Test', () => {
  const testCases = [
    { input: '只测性能', expected: 'test-engineer' },
    { input: '只测安全', expected: 'test-engineer' },
    { input: '只测兼容', expected: 'test-engineer' },
    { input: '只测功能', expected: 'test-engineer' },
    { input: '只测可观测', expected: 'test-engineer' },
    { input: '只跑R1', expected: 'test-engineer' },
    { input: '只跑R2', expected: 'test-engineer' },
    { input: '只跑R3', expected: 'test-engineer' },
    { input: '只跑R4', expected: 'test-engineer' },
    { input: '只跑R5', expected: 'test-engineer' },
    { input: '只跑测试', expected: 'test-engineer' },
    { input: 'partial test', expected: 'test-engineer' },
  ];

  for (const { input, expected } of testCases) {
    it(`should match "${input}" → ${expected} (partial)`, () => {
      const result = matchHorizontalCommand(input);
      expect(result).not.toBeNull();
      expect(result!.agent).toBe(expected);
      expect(result!.action).toBe('partial-test');
    });
  }
});

describe('matchHorizontalCommand — Full Review', () => {
  const testCases = [
    { input: '全面review', expected: 'review-engineer' },
    { input: '全面审查', expected: 'review-engineer' },
    { input: '做一次完整的审查', expected: 'review-engineer' },
    { input: '完整审查', expected: 'review-engineer' },
    { input: '彻底审查', expected: 'review-engineer' },
    { input: '审查所有', expected: 'review-engineer' },
    { input: '代码审计', expected: 'review-engineer' },
    { input: 'code audit', expected: 'review-engineer' },
    { input: 'comprehensive review', expected: 'review-engineer' },
    { input: '3轮审查', expected: 'review-engineer' },
    // English patterns
    { input: 'full review', expected: 'review-engineer' },
    { input: '全面代码审查', expected: 'review-engineer' },
  ];

  for (const { input, expected } of testCases) {
    it(`should match "${input}" → ${expected}`, () => {
      const result = matchHorizontalCommand(input);
      expect(result).not.toBeNull();
      expect(result!.agent).toBe(expected);
      expect(result!.action).toBe('full-review');
    });
  }
});

describe('matchHorizontalCommand — Partial Review', () => {
  const testCases = [
    { input: '只看代码质量', expected: 'review-engineer' },
    { input: '只看代码', expected: 'review-engineer' },
    { input: '只看UI', expected: 'review-engineer' },
    { input: '只看视觉', expected: 'review-engineer' },
    { input: '只看合规', expected: 'review-engineer' },
    { input: '只看R1', expected: 'review-engineer' },
    { input: '只看R2', expected: 'review-engineer' },
    { input: '只看R3', expected: 'review-engineer' },
    { input: '只看R4', expected: 'review-engineer' },
    { input: 'partial review', expected: 'review-engineer' },
  ];

  for (const { input, expected } of testCases) {
    it(`should match "${input}" → ${expected} (partial)`, () => {
      const result = matchHorizontalCommand(input);
      expect(result).not.toBeNull();
      expect(result!.agent).toBe(expected);
      expect(result!.action).toBe('partial-review');
    });
  }
});

describe('matchHorizontalCommand — Edge Cases', () => {
  it('should return null for empty input', () => {
    expect(matchHorizontalCommand('')).toBeNull();
  });

  it('should return null for null input', () => {
    expect(matchHorizontalCommand(null as unknown as string)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(matchHorizontalCommand(undefined as unknown as string)).toBeNull();
  });

  it('should return null for unrelated input', () => {
    expect(matchHorizontalCommand('帮我写一个登录页面')).toBeNull();
    expect(matchHorizontalCommand('如何使用这个工具')).toBeNull();
    expect(matchHorizontalCommand('hello world')).toBeNull();
  });

  it('should be case-insensitive for English patterns', () => {
    const result1 = matchHorizontalCommand('COMPREHENSIVE TEST');
    expect(result1).not.toBeNull();
    expect(result1!.agent).toBe('test-engineer');

    const result2 = matchHorizontalCommand('Full Review');
    expect(result2).not.toBeNull();
    expect(result2!.agent).toBe('review-engineer');
  });

  it('should prefer full-test over partial-test when both match', () => {
    // "全面测试" should match full-test, not partial-test
    const result = matchHorizontalCommand('全面测试');
    expect(result).not.toBeNull();
    expect(result!.action).toBe('full-test');
  });

  it('should prefer full-review over partial-review when both match', () => {
    const result = matchHorizontalCommand('全面审查');
    expect(result).not.toBeNull();
    expect(result!.action).toBe('full-review');
  });

  it('should match chinese text with surrounding context', () => {
    // User might say "帮我进行全面测试" or "做一个全面审查"
    const testResult = matchHorizontalCommand('帮我做一个全面测试');
    expect(testResult).not.toBeNull();
    expect(testResult!.agent).toBe('test-engineer');

    const reviewResult = matchHorizontalCommand('请进行一次全面审查');
    expect(reviewResult).not.toBeNull();
    expect(reviewResult!.agent).toBe('review-engineer');
  });
});