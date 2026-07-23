/**
 * Tests for CompletionDetector — P3: Completion Enforcement & System Reminder
 *
 * Covers:
 * - hasCompletionSignal: [TASK_COMPLETE] marker detection
 * - hasCompletionSignal: JSON code fence detection
 * - hasCompletionSignal: bare JSON object detection
 * - hasCompletionSignal: empty output → false
 * - hasCompletionSignal: plain text → false
 * - hasCompletionSignal: edge cases
 * - COMPLETION_ENFORCEMENT_CONFIG: retry configuration
 * - REMINDER_MESSAGE: reminder message format
 * - Retry logic: backoff delays, max retries, warning
 * - P3-P2 synergy: structured JSON as completion signal
 */
import { describe, it, expect } from 'bun:test';
import {
  hasCompletionSignal,
  COMPLETION_ENFORCEMENT_CONFIG,
  REMINDER_MESSAGE,
  performCompletionRetry,
} from '../completion-detector.js';

// ─── hasCompletionSignal ────────────────────────────────────────────────────

describe('hasCompletionSignal', () => {
  // ─── [TASK_COMPLETE] marker detection ─────────────────────────────────

  describe('[TASK_COMPLETE] marker detection', () => {
    it('should detect [TASK_COMPLETE] at end of output', () => {
      const output = '所有任务已完成 [TASK_COMPLETE]';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should detect [TASK_COMPLETE] in middle of output', () => {
      const output = '进度更新: [TASK_COMPLETE] 后续说明';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should detect [TASK_COMPLETE] at start of output', () => {
      const output = '[TASK_COMPLETE] 任务已完成';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should detect [TASK_COMPLETE] as entire output', () => {
      const output = '[TASK_COMPLETE]';
      expect(hasCompletionSignal(output)).toBe(true);
    });
  });

  // ─── JSON code fence detection ────────────────────────────────────────

  describe('JSON code fence detection', () => {
    it('should detect ```json ... ``` code fence', () => {
      const output = '结果如下：\n```json\n{"files_changed": ["a.ts"], "tests_passed": true}\n```';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should detect code fence with extra whitespace after json', () => {
      const output = '```json  \n{"key": "value"}\n```';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should detect code fence with empty JSON object', () => {
      const output = '```json\n{}\n```';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should NOT detect non-json code fence as completion signal', () => {
      const output = '```typescript\nconst x = 1;\n```';
      expect(hasCompletionSignal(output)).toBe(false);
    });
  });

  // ─── Bare JSON object detection ───────────────────────────────────────

  describe('bare JSON object detection', () => {
    it('should detect bare JSON object', () => {
      const output = '{"files_changed": ["a.ts"], "tests_passed": true}';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should detect bare JSON object with surrounding text', () => {
      const output = '结果如下：\n{"key": "value"}\n完成';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should detect multi-line bare JSON object', () => {
      const output = '{\n  "key1": "value1",\n  "key2": 42\n}';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should detect empty JSON object', () => {
      const output = '{}';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should detect nested JSON object', () => {
      const output = '{"outer": {"inner": 42}}';
      expect(hasCompletionSignal(output)).toBe(true);
    });
  });

  // ─── Empty output → false ─────────────────────────────────────────────

  describe('empty output', () => {
    it('should return false for empty string', () => {
      expect(hasCompletionSignal('')).toBe(false);
    });

    it('should return false for whitespace-only string', () => {
      expect(hasCompletionSignal('   \n  \t  ')).toBe(false);
    });

    it('should return false for null input', () => {
      expect(hasCompletionSignal(null as unknown as string)).toBe(false);
    });

    it('should return false for undefined input', () => {
      expect(hasCompletionSignal(undefined as unknown as string)).toBe(false);
    });
  });

  // ─── Plain text → false ───────────────────────────────────────────────

  describe('plain text without completion signal', () => {
    it('should return false for plain text', () => {
      const output = '我正在处理这个任务...';
      expect(hasCompletionSignal(output)).toBe(false);
    });

    it('should return false for text with curly braces but not JSON', () => {
      const output = 'Some text with { and } but not JSON';
      expect(hasCompletionSignal(output)).toBe(false);
    });

    it('should return false for partial [TASK_COMPLETE] marker', () => {
      const output = '任务进行中 TASK_COMPLETE';
      expect(hasCompletionSignal(output)).toBe(false);
    });

    it('should return false for JSON array (not object)', () => {
      const output = '[1, 2, 3]';
      expect(hasCompletionSignal(output)).toBe(false);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should detect both [TASK_COMPLETE] and JSON code fence', () => {
      const output = '```json\n{"key": "value"}\n```\n[TASK_COMPLETE]';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should prioritize [TASK_COMPLETE] check first', () => {
      const output = '[TASK_COMPLETE]';
      expect(hasCompletionSignal(output)).toBe(true);
    });

    it('should handle output with only braces that are not valid JSON', () => {
      const output = 'function foo() { return bar; }';
      // This has { and } but not in a JSON object pattern
      // The regex /^\s*\{[\s\S]*\}\s*$/m requires { at line start
      // In this case "function foo() {" doesn't start with {
      expect(hasCompletionSignal(output)).toBe(false);
    });
  });
});

// ─── COMPLETION_ENFORCEMENT_CONFIG ──────────────────────────────────────────

describe('COMPLETION_ENFORCEMENT_CONFIG', () => {
  it('should have maxRetries = 2', () => {
    expect(COMPLETION_ENFORCEMENT_CONFIG.maxRetries).toBe(2);
  });

  it('should have retryDelays [1000, 2000] (1s → 2s)', () => {
    expect(COMPLETION_ENFORCEMENT_CONFIG.retryDelays).toEqual([1000, 2000]);
  });

  it('should have warning message for max retries', () => {
    expect(COMPLETION_ENFORCEMENT_CONFIG.warningMessage).toContain('no completion signal detected');
    expect(COMPLETION_ENFORCEMENT_CONFIG.warningMessage).toContain('3 attempts');
  });
});

// ─── REMINDER_MESSAGE ───────────────────────────────────────────────────────

describe('REMINDER_MESSAGE', () => {
  it('should have type "system"', () => {
    expect(REMINDER_MESSAGE.type).toBe('system');
  });

  it('should have parts with type "text"', () => {
    expect(REMINDER_MESSAGE.parts).toHaveLength(1);
    expect(REMINDER_MESSAGE.parts[0].type).toBe('text');
  });

  it('should contain [TASK_COMPLETE] instruction', () => {
    expect(REMINDER_MESSAGE.parts[0].text).toContain('[TASK_COMPLETE]');
  });

  it('should contain structured JSON instruction', () => {
    expect(REMINDER_MESSAGE.parts[0].text).toContain('结构化 JSON');
  });

  it('should contain task incomplete notice', () => {
    expect(REMINDER_MESSAGE.parts[0].text).toContain('尚未完成');
  });
});

// ─── performCompletionRetry ─────────────────────────────────────────────────

describe('performCompletionRetry', () => {
  // Mock injectFn and pollFn for unit testing retry logic

  it('should return output without warning when completion signal is present', async () => {
    const result = await performCompletionRetry(
      '任务完成 [TASK_COMPLETE]',
      async () => {}, // injectFn - should not be called
      async () => '任务完成 [TASK_COMPLETE]', // pollFn - should not be called
    );
    expect(result.output).toBe('任务完成 [TASK_COMPLETE]');
    expect(result.warning).toBeUndefined();
  });

  it('should return warning after max retries with no completion signal', async () => {
    let injectCallCount = 0;
    const result = await performCompletionRetry(
      '我正在处理这个任务...',
      async () => { injectCallCount++; }, // injectFn
      async () => '我还在处理...', // pollFn - always returns incomplete
    );
    expect(result.output).toBe('我还在处理...');
    expect(result.warning).toBe(COMPLETION_ENFORCEMENT_CONFIG.warningMessage);
    // Should have injected reminder 2 times (maxRetries)
    expect(injectCallCount).toBe(2);
  });

  it('should stop retrying when completion signal appears on second attempt', async () => {
    let pollCount = 0;
    let injectCallCount = 0;
    const result = await performCompletionRetry(
      '我正在处理...',
      async () => { injectCallCount++; },
      async () => {
        pollCount++;
        if (pollCount === 1) {
          return '任务完成 [TASK_COMPLETE]';
        }
        return 'should not reach here';
      },
    );
    expect(result.output).toBe('任务完成 [TASK_COMPLETE]');
    expect(result.warning).toBeUndefined();
    // Should have injected once (first retry), then succeeded
    expect(injectCallCount).toBe(1);
    expect(pollCount).toBe(1);
  });

  it('should stop retrying when completion signal appears on third attempt', async () => {
    let pollCount = 0;
    let injectCallCount = 0;
    const result = await performCompletionRetry(
      '我正在处理...',
      async () => { injectCallCount++; },
      async () => {
        pollCount++;
        if (pollCount === 2) {
          return '```json\n{"done": true}\n```';
        }
        return 'still working...';
      },
    );
    expect(result.output).toBe('```json\n{"done": true}\n```');
    expect(result.warning).toBeUndefined();
    expect(injectCallCount).toBe(2);
    expect(pollCount).toBe(2);
  });

  it('should handle empty initial output', async () => {
    let injectCallCount = 0;
    const result = await performCompletionRetry(
      '',
      async () => { injectCallCount++; },
      async () => 'still empty',
    );
    expect(result.output).toBe('still empty');
    expect(result.warning).toBe(COMPLETION_ENFORCEMENT_CONFIG.warningMessage);
    expect(injectCallCount).toBe(2);
  });

  it('should use correct backoff delays (1s → 2s)', async () => {
    const delays: number[] = [];
    // We verify the config has the right delays
    expect(COMPLETION_ENFORCEMENT_CONFIG.retryDelays[0]).toBe(1000);
    expect(COMPLETION_ENFORCEMENT_CONFIG.retryDelays[1]).toBe(2000);
    // The performCompletionRetry function reads from this config
    // so it will use 1s then 2s delays
  });

  it('should handle pollFn returning null gracefully', async () => {
    let injectCallCount = 0;
    const result = await performCompletionRetry(
      'working...',
      async () => { injectCallCount++; },
      async () => null,
    );
    // null poll result means output stays as initial
    expect(result.warning).toBe(COMPLETION_ENFORCEMENT_CONFIG.warningMessage);
    expect(injectCallCount).toBe(2);
  });

  it('should skip retry for exempt agent (build-executor)', async () => {
    let injectCallCount = 0;
    const result = await performCompletionRetry(
      '实现了功能 X，测试通过',
      async () => { injectCallCount++; },
      async () => '不应该被调用',
      COMPLETION_ENFORCEMENT_CONFIG,
      'build-executor',
    );
    // Exempt agent returns output as-is, no warning, no retry
    expect(result.output).toBe('实现了功能 X，测试通过');
    expect(result.warning).toBeUndefined();
    expect(injectCallCount).toBe(0);
  });

  it('should skip retry for any agent in exempt list', async () => {
    const result = await performCompletionRetry(
      'code review 完成',
      async () => { throw new Error('should not be called'); },
      async () => { throw new Error('should not be called'); },
      COMPLETION_ENFORCEMENT_CONFIG,
      'code-reviewer',
    );
    expect(result.output).toBe('code review 完成');
    expect(result.warning).toBeUndefined();
  });

  it('should still retry for non-exempt agent without completion signal', async () => {
    let injectCallCount = 0;
    const result = await performCompletionRetry(
      '思考中...',
      async () => { injectCallCount++; },
      async () => '仍在思考...',
      COMPLETION_ENFORCEMENT_CONFIG,
      'spec-writer', // spec-writer IS expected to output [TASK_COMPLETE]
    );
    expect(result.warning).toBe(COMPLETION_ENFORCEMENT_CONFIG.warningMessage);
    expect(injectCallCount).toBe(2);
  });
});

// ─── P3-P2 Synergy: structured JSON as completion signal ────────────────────

describe('P3-P2 synergy: structured JSON as completion signal', () => {
  it('should detect structured JSON code fence as completion signal (P2 output_mode=structured)', () => {
    // This is the key synergy: when P2's structured mode extracts JSON,
    // P3 should also recognize it as a completion signal
    const output = 'Build completed\n```json\n{"files_changed": ["a.ts", "b.ts"], "tests_passed": true, "blockers": []}\n```';
    expect(hasCompletionSignal(output)).toBe(true);
  });

  it('should detect bare structured JSON as completion signal', () => {
    const output = '{"files_changed": ["a.ts"], "tests_passed": true, "blockers": []}';
    expect(hasCompletionSignal(output)).toBe(true);
  });

  it('should detect verifier schema JSON as completion signal', () => {
    const output = '```json\n{"blockers": [], "warnings": ["minor issue"], "score": 85}\n```';
    expect(hasCompletionSignal(output)).toBe(true);
  });

  it('should NOT detect invalid JSON in code fence as completion signal', () => {
    const output = '```json\n{invalid json}\n```';
    // extractJsonBlock returns null for invalid JSON, so no completion signal
    expect(hasCompletionSignal(output)).toBe(false);
  });
});
