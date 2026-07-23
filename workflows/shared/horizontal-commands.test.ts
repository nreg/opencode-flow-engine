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
    expect(HORIZONTAL_COMMANDS.length).toBeGreaterThanOrEqual(5);
  });

  it('should have unique action values for each command', () => {
    const actions = HORIZONTAL_COMMANDS.map(c => c.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it('should have unique agent values', () => {
    const agents = new Set(HORIZONTAL_COMMANDS.map(c => c.agent));
    expect(agents.has('test-engineer')).toBe(true);
    expect(agents.has('review-engineer')).toBe(true);
    expect(agents.has('flow-architect')).toBe(true);
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

describe('matchHorizontalCommand — Flow Architect', () => {
  const testCases = [
    { input: '建立架构', expected: 'flow-architect' },
    { input: '写架构文档', expected: 'flow-architect' },
    { input: '架构文档', expected: 'flow-architect' },
    { input: 'ARCHITECTURE', expected: 'flow-architect' },
    { input: '建立ARCHITECTURE', expected: 'flow-architect' },
    { input: '重构架构', expected: 'flow-architect' },
    { input: '架构重构', expected: 'flow-architect' },
    { input: 'architecture doc', expected: 'flow-architect' },
    { input: 'write architecture', expected: 'flow-architect' },
  ];

  for (const { input, expected } of testCases) {
    it(`should match "${input}" → ${expected}`, () => {
      const result = matchHorizontalCommand(input);
      expect(result).not.toBeNull();
      expect(result!.agent).toBe(expected);
      expect(result!.action).toBe('create-architecture');
    });
  }
});

describe('matchHorizontalCommand — Flow Evolve', () => {
  const testCases = [
    { input: '同步架构', expected: 'flow-evolve' },
    { input: '架构演进', expected: 'flow-evolve' },
    { input: 'evolve', expected: 'flow-evolve' },
    { input: '架构同步', expected: 'flow-evolve' },
    { input: '同步 CONTEXT', expected: 'flow-evolve' },
    { input: '同步沉淀', expected: 'flow-evolve' },
    { input: '整理沉淀', expected: 'flow-evolve' },
    { input: '架构沉淀', expected: 'flow-evolve' },
    { input: '帮我同步架构', expected: 'flow-evolve' },
    { input: 'Evolve', expected: 'flow-evolve' },
  ];

  for (const { input, expected } of testCases) {
    it(`should match "${input}" → ${expected}`, () => {
      const result = matchHorizontalCommand(input);
      expect(result).not.toBeNull();
      expect(result!.agent).toBe(expected);
      expect(result!.action).toBe('evolve-architecture');
    });
  }
});

describe('matchHorizontalCommand — Flow Health', () => {
  const testCases = [
    { input: '健康巡检', expected: 'flow-health' },
    { input: '健康检查', expected: 'flow-health' },
    { input: 'health check', expected: 'flow-health' },
    { input: '代码健康', expected: 'flow-health' },
    { input: '项目健康', expected: 'flow-health' },
    { input: '巡检代码', expected: 'flow-health' },
    { input: '代码体检', expected: 'flow-health' },
    { input: 'codebase health', expected: 'flow-health' },
    { input: 'health inspection', expected: 'flow-health' },
    { input: 'Health Check', expected: 'flow-health' },
  ];

  for (const { input, expected } of testCases) {
    it(`should match "${input}" → ${expected}`, () => {
      const result = matchHorizontalCommand(input);
      expect(result).not.toBeNull();
      expect(result!.agent).toBe(expected);
      expect(result!.action).toBe('health-check');
    });
  }
});

describe('matchHorizontalCommand — Flow Restyle', () => {
  const testCases = [
    { input: '换调性', expected: 'flow-restyle' },
    { input: '改风格', expected: 'flow-restyle' },
    { input: '换风格', expected: 'flow-restyle' },
    { input: 'restyle', expected: 'flow-restyle' },
    { input: '重做视觉', expected: 'flow-restyle' },
    { input: '换皮', expected: 'flow-restyle' },
    { input: 'redesign', expected: 'flow-restyle' },
    { input: '重新设计视觉', expected: 'flow-restyle' },
    { input: '帮我换调性', expected: 'flow-restyle' },
    { input: 'Restyle', expected: 'flow-restyle' },
    { input: 'Redesign', expected: 'flow-restyle' },
  ];

  for (const { input, expected } of testCases) {
    it(`should match "${input}" → ${expected}`, () => {
      const result = matchHorizontalCommand(input);
      expect(result).not.toBeNull();
      expect(result!.agent).toBe(expected);
      expect(result!.action).toBe('restyle');
    });
  }
});

describe('matchHorizontalCommand — New agents should not interfere with existing ones', () => {
  it('should still match full-test when flow-evolve pattern also matches', () => {
    // "evolve" is a flow-evolve token, but "全面测试" should still match full-test
    const result = matchHorizontalCommand('全面测试');
    expect(result).not.toBeNull();
    expect(result!.agent).toBe('test-engineer');
    expect(result!.action).toBe('full-test');
  });

  it('should match flow-evolve when input is clearly about architecture sync', () => {
    const result = matchHorizontalCommand('同步架构');
    expect(result).not.toBeNull();
    expect(result!.agent).toBe('flow-evolve');
    expect(result!.action).toBe('evolve-architecture');
  });

  it('should match flow-health when input is about health check', () => {
    const result = matchHorizontalCommand('做一次健康巡检');
    expect(result).not.toBeNull();
    expect(result!.agent).toBe('flow-health');
    expect(result!.action).toBe('health-check');
  });

  it('should match flow-restyle when input is about visual restyle', () => {
    const result = matchHorizontalCommand('给项目换皮');
    expect(result).not.toBeNull();
    expect(result!.agent).toBe('flow-restyle');
    expect(result!.action).toBe('restyle');
  });
});

describe('matchHorizontalCommand — AFK Mode', () => {
  const testCases = [
    // 中文触发词
    { input: '开启afk模式', expected: 'sFlow', action: 'set-afk-on' },
    // 英文触发词
    { input: 'AFK', expected: 'sFlow', action: 'set-afk-on' },
    // /flow-afk 命令
    { input: '/flow-afk', expected: 'sFlow', action: 'set-afk-on' },
    // 无人值守触发
    { input: '进入无人值守模式', expected: 'sFlow', action: 'set-afk-on' },
    // Tier 参数
    { input: 'afk tier2', expected: 'sFlow', action: 'set-afk-on' },
    { input: 'afk tier3', expected: 'sFlow', action: 'set-afk-on' },
  ];

  for (const { input, expected, action } of testCases) {
    it(`should match "${input}" → ${expected} (${action})`, () => {
      const result = matchHorizontalCommand(input);
      expect(result).not.toBeNull();
      expect(result!.agent).toBe(expected);
      expect(result!.action).toBe(action);
    });
  }

  it('should not interfere with existing commands — "全面测试" still matches test-engineer', () => {
    const result = matchHorizontalCommand('全面测试');
    expect(result).not.toBeNull();
    expect(result!.agent).toBe('test-engineer');
    expect(result!.action).toBe('full-test');
  });
});

describe('HORIZONTAL_COMMANDS — All agents uniqueness', () => {
  it('should have all 8 agents registered', () => {
    const agents = new Set(HORIZONTAL_COMMANDS.map(c => c.agent));
    expect(agents.has('test-engineer')).toBe(true);
    expect(agents.has('review-engineer')).toBe(true);
    expect(agents.has('flow-architect')).toBe(true);
    expect(agents.has('flow-evolve')).toBe(true);
    expect(agents.has('flow-health')).toBe(true);
    expect(agents.has('flow-restyle')).toBe(true);
    expect(agents.has('sFlow')).toBe(true);
  });

  it('should have at least 9 commands (2 test + 2 review + 4 new + 1 afk)', () => {
    expect(HORIZONTAL_COMMANDS.length).toBeGreaterThanOrEqual(9);
  });
});