/**
 * Tests for CompletionDetector Extension — P3: Completion Enforcement for Execution Agents
 *
 * Wave 4 Task 4.1: Verify execution-type agents trigger REMINDER_MESSAGE when completion signal is missing
 *
 * Covers:
 * - build-executor completion enforcement
 * - code-reviewer completion enforcement
 * - test-engineer completion enforcement
 * - bug-investigator completion enforcement
 * - release-archivist completion enforcement
 * - need-explorer NOT in whitelist (interactive agent)
 * - performCompletionRetry called for whitelisted agents
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
  hasCompletionSignal,
  COMPLETION_ENFORCEMENT_CONFIG,
  REMINDER_MESSAGE,
  performCompletionRetry,
  DEFAULT_COMPLETION_ENABLED_AGENTS,
  STRICT_COMPLETION_AGENTS,
  LOOSE_COMPLETION_AGENTS,
  hasSubstantialOutput,
} from '../completion-detector.js';

// ─── Agent Type Whitelist Tests ───────────────────────────────────────────────

describe('DEFAULT_COMPLETION_ENABLED_AGENTS extension', () => {
  it('should include build-executor in whitelist', () => {
    expect(DEFAULT_COMPLETION_ENABLED_AGENTS).toContain('build-executor');
  });

  it('should include code-reviewer in whitelist', () => {
    expect(DEFAULT_COMPLETION_ENABLED_AGENTS).toContain('code-reviewer');
  });

  it('should include test-engineer in whitelist', () => {
    expect(DEFAULT_COMPLETION_ENABLED_AGENTS).toContain('test-engineer');
  });

  it('should include bug-investigator in whitelist', () => {
    expect(DEFAULT_COMPLETION_ENABLED_AGENTS).toContain('bug-investigator');
  });

  it('should include release-archivist in whitelist', () => {
    expect(DEFAULT_COMPLETION_ENABLED_AGENTS).toContain('release-archivist');
  });

  it('should NOT include need-explorer (interactive agent)', () => {
    expect(DEFAULT_COMPLETION_ENABLED_AGENTS).not.toContain('need-explorer');
  });

  it('should still include spec-writer (original whitelist)', () => {
    expect(DEFAULT_COMPLETION_ENABLED_AGENTS).toContain('spec-writer');
  });

  it('should still include contract-builder (original whitelist)', () => {
    expect(DEFAULT_COMPLETION_ENABLED_AGENTS).toContain('contract-builder');
  });
});

// ─── performCompletionRetry for Execution Agents ───────────────────────────────

describe('performCompletionRetry for execution agents', () => {
  let injectReminderMock: ReturnType<typeof mock>;
  let pollOutputMock: ReturnType<typeof mock>;

  beforeEach(() => {
    injectReminderMock = mock(async () => {
      // Simulate reminder injection
    });
    pollOutputMock = mock(async () => null);
  });

  afterEach(() => {
    injectReminderMock.mockRestore();
    pollOutputMock.mockRestore();
  });

  describe('build-executor', () => {
    it('should trigger REMINDER_MESSAGE when output is empty or very short', async () => {
      const output = 'Working...';
      const config = {
        ...COMPLETION_ENFORCEMENT_CONFIG,
        maxRetries: 1,
        retryDelays: [100],
      };

      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        config,
        'build-executor',
      );

      expect(injectReminderMock).toHaveBeenCalled();
      expect(result.output).toBe(output);
      expect(result.warning).toBeDefined();
    });

    it('should NOT trigger retry when output has [TASK_COMPLETE]', async () => {
      const output = 'All tasks done [TASK_COMPLETE]';
      
      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        COMPLETION_ENFORCEMENT_CONFIG,
        'build-executor',
      );

      // Should NOT call injectReminder
      expect(injectReminderMock).not.toHaveBeenCalled();
      expect(result.output).toBe(output);
      expect(result.warning).toBeUndefined();
    });

    it('should NOT trigger retry when output has structured JSON', async () => {
      const output = '```json\n{"status": "completed", "files_modified": ["a.ts"]}\n```';
      
      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        COMPLETION_ENFORCEMENT_CONFIG,
        'build-executor',
      );

      expect(injectReminderMock).not.toHaveBeenCalled();
      expect(result.output).toBe(output);
      expect(result.warning).toBeUndefined();
    });
  });

  describe('code-reviewer', () => {
    it('should trigger REMINDER_MESSAGE when output is very short', async () => {
      const output = 'Reviewing...';
      const config = {
        ...COMPLETION_ENFORCEMENT_CONFIG,
        maxRetries: 1,
        retryDelays: [100],
      };

      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        config,
        'code-reviewer',
      );

      expect(injectReminderMock).toHaveBeenCalled();
      expect(result.warning).toBeDefined();
    });
  });

  describe('test-engineer', () => {
    it('should trigger REMINDER_MESSAGE when output is very short', async () => {
      const output = 'Testing...';
      const config = {
        ...COMPLETION_ENFORCEMENT_CONFIG,
        maxRetries: 1,
        retryDelays: [100],
      };

      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        config,
        'test-engineer',
      );

      expect(injectReminderMock).toHaveBeenCalled();
      expect(result.warning).toBeDefined();
    });
  });

  describe('bug-investigator', () => {
    it('should trigger REMINDER_MESSAGE when output is very short', async () => {
      const output = 'Investigating...';
      const config = {
        ...COMPLETION_ENFORCEMENT_CONFIG,
        maxRetries: 1,
        retryDelays: [100],
      };

      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        config,
        'bug-investigator',
      );

      expect(injectReminderMock).toHaveBeenCalled();
      expect(result.warning).toBeDefined();
    });
  });

  describe('release-archivist', () => {
    it('should trigger REMINDER_MESSAGE when output is very short', async () => {
      const output = 'Archiving...';
      const config = {
        ...COMPLETION_ENFORCEMENT_CONFIG,
        maxRetries: 1,
        retryDelays: [100],
      };

      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        config,
        'release-archivist',
      );

      expect(injectReminderMock).toHaveBeenCalled();
      expect(result.warning).toBeDefined();
    });
  });

  describe('need-explorer (interactive agent)', () => {
    it('should NOT trigger retry (interactive agent exempt)', async () => {
      const output = 'What is the main goal of this feature?';
      
      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        COMPLETION_ENFORCEMENT_CONFIG,
        'need-explorer',
      );

      // Should NOT call injectReminder (not in whitelist)
      expect(injectReminderMock).not.toHaveBeenCalled();
      expect(result.output).toBe(output);
      expect(result.warning).toBeUndefined();
    });
  });
});

// ─── REMINDER_MESSAGE Format ───────────────────────────────────────────────────

describe('REMINDER_MESSAGE format', () => {
  it('should have correct structure', () => {
    expect(REMINDER_MESSAGE.type).toBe('system');
    expect(REMINDER_MESSAGE.parts).toHaveLength(1);
    expect(REMINDER_MESSAGE.parts[0].type).toBe('text');
    expect(REMINDER_MESSAGE.parts[0].text).toContain('[TASK_COMPLETE]');
  });

  it('should mention structured JSON output', () => {
    expect(REMINDER_MESSAGE.parts[0].text).toContain('结构化 JSON');
  });
});

// ─── STRICT/LOOSE Completion Agent Groups ─────────────────────────────────────

describe('STRICT_COMPLETION_AGENTS and LOOSE_COMPLETION_AGENTS', () => {
  it('STRICT_COMPLETION_AGENTS should include spec-writer', () => {
    expect(STRICT_COMPLETION_AGENTS).toContain('spec-writer');
  });

  it('STRICT_COMPLETION_AGENTS should include contract-builder', () => {
    expect(STRICT_COMPLETION_AGENTS).toContain('contract-builder');
  });

  it('LOOSE_COMPLETION_AGENTS should include build-executor', () => {
    expect(LOOSE_COMPLETION_AGENTS).toContain('build-executor');
  });

  it('LOOSE_COMPLETION_AGENTS should include code-reviewer', () => {
    expect(LOOSE_COMPLETION_AGENTS).toContain('code-reviewer');
  });

  it('LOOSE_COMPLETION_AGENTS should include test-engineer', () => {
    expect(LOOSE_COMPLETION_AGENTS).toContain('test-engineer');
  });

  it('LOOSE_COMPLETION_AGENTS should include bug-investigator', () => {
    expect(LOOSE_COMPLETION_AGENTS).toContain('bug-investigator');
  });

  it('LOOSE_COMPLETION_AGENTS should include release-archivist', () => {
    expect(LOOSE_COMPLETION_AGENTS).toContain('release-archivist');
  });

  it('LOOSE_COMPLETION_AGENTS should include spec-merger (P1-1)', () => {
    expect(LOOSE_COMPLETION_AGENTS).toContain('spec-merger');
  });

  it('LOOSE_COMPLETION_AGENTS should include ui-implementer (P1-1)', () => {
    expect(LOOSE_COMPLETION_AGENTS).toContain('ui-implementer');
  });

  it('STRICT and LOOSE groups should be disjoint', () => {
    const intersection = STRICT_COMPLETION_AGENTS.filter(agent => 
      LOOSE_COMPLETION_AGENTS.includes(agent)
    );
    expect(intersection).toHaveLength(0);
  });
});

// ─── hasSubstantialOutput (Loose Completion Detection) ───────────────────────

describe('hasSubstantialOutput', () => {
  it('should return false for empty output', () => {
    expect(hasSubstantialOutput('')).toBe(false);
  });

  it('should return false for whitespace-only output', () => {
    expect(hasSubstantialOutput('   \n  \t  ')).toBe(false);
  });

  it('should return false for very short output (< 100 chars)', () => {
    expect(hasSubstantialOutput('Task done')).toBe(false);
  });

  it('should return true for output with report keywords (Summary)', () => {
    const output = 'Summary: All tasks completed successfully. Test Results: all pass.';
    expect(hasSubstantialOutput(output)).toBe(true);
  });

  it('should return true for output with report keywords (完成)', () => {
    const output = '任务已全部完成。共修改 5 个文件，测试全部通过。';
    expect(hasSubstantialOutput(output)).toBe(true);
  });

  it('should return true for output with report keywords (Test Results)', () => {
    const output = 'Test Results: 42 tests passed, 0 failed. Coverage: 95%.';
    expect(hasSubstantialOutput(output)).toBe(true);
  });

  it('should return true for output with report keywords (Batch Status)', () => {
    const output = 'Batch Status: Completed 3/3 tasks. No errors encountered.';
    expect(hasSubstantialOutput(output)).toBe(true);
  });

  it('should return true for output with report keywords (Files)', () => {
    const output = 'Files modified: src/a.ts, src/b.ts, src/c.ts. All changes applied.';
    expect(hasSubstantialOutput(output)).toBe(true);
  });

  it('should return true for substantial output without keywords (length >= 200)', () => {
    const output = 'A'.repeat(250);
    expect(hasSubstantialOutput(output)).toBe(true);
  });

  it('should return false for short output without keywords', () => {
    const output = 'Working on the task...';
    expect(hasSubstantialOutput(output)).toBe(false);
  });

  it('should return false for long error message with "error:" at line start (>= 200 chars)', () => {
    const output = `error: Build failed with multiple issues

Detailed error report:
- TypeScript compilation failed
- Missing dependencies detected
- Type errors in src/utils/helper.ts

Please fix these issues before proceeding.`;
    expect(output.length).toBeGreaterThanOrEqual(200);
    expect(hasSubstantialOutput(output)).toBe(false);
  });

  it('should return false for long error message with "failed:" at line start', () => {
    const output = `failed: Test suite execution failed

Test Results:
- 15 tests failed
- 0 tests passed
- Execution time: 5.2s

All tests have failed. Please review the test output for details.
Check the logs for more information about the failures.`;
    expect(output.length).toBeGreaterThanOrEqual(200);
    expect(hasSubstantialOutput(output)).toBe(false);
  });

  it('should return false for long error message with "❌" emoji', () => {
    const output = `❌ Critical error detected

The build process encountered a critical error and cannot proceed.
Multiple files have syntax errors that need to be fixed.

Error details:
- Syntax error in src/index.ts
- Missing closing brace in config.ts`;
    expect(output.length).toBeGreaterThanOrEqual(200);
    expect(hasSubstantialOutput(output)).toBe(false);
  });

  it('should return false for long error message with "FAIL" marker', () => {
    const output = `FAIL: Integration test suite failed

Test suite: User Authentication
- Login flow: FAIL
- Token refresh: FAIL
- Session management: FAIL

All integration tests have failed. Please check the test logs.`;
    expect(output.length).toBeGreaterThanOrEqual(200);
    expect(hasSubstantialOutput(output)).toBe(false);
  });

  it('should return false for long error message with "Error:" at line start', () => {
    const output = `Error: Cannot resolve module dependency

The module 'some-module' cannot be found in the project.
Please ensure all dependencies are installed correctly.

Run 'npm install' to install missing dependencies.`;
    expect(output.length).toBeGreaterThanOrEqual(200);
    expect(hasSubstantialOutput(output)).toBe(false);
  });

  it('should still return true for successful report with "Test Results: all pass"', () => {
    const output = `Summary: All tasks completed successfully

Batch Status: Completed 3/3 tasks

Test Results: all pass

Files modified: src/a.ts, src/b.ts`;
    expect(hasSubstantialOutput(output)).toBe(true);
  });

  it('should still return true for successful report with "Summary:" keyword', () => {
    const output = `Summary: Build completed successfully

All tests passed. No errors encountered.
Files modified: 5 files changed.`;
    expect(hasSubstantialOutput(output)).toBe(true);
  });

  it('should NOT false positive on "error" word in successful context', () => {
    const output = `Summary: No error found in the codebase

Test Results: all pass
All validation checks passed successfully.`;
    expect(hasSubstantialOutput(output)).toBe(true);
  });
});

// ─── Loose Completion Detection for Execution Agents ──────────────────────────

describe('performCompletionRetry with loose detection', () => {
  let injectReminderMock: ReturnType<typeof mock>;
  let pollOutputMock: ReturnType<typeof mock>;

  beforeEach(() => {
    injectReminderMock = mock(async () => {});
    pollOutputMock = mock(async () => null);
  });

  afterEach(() => {
    injectReminderMock.mockRestore();
    pollOutputMock.mockRestore();
  });

  describe('build-executor (loose agent)', () => {
    it('should NOT trigger retry when output contains complete report structure', async () => {
      const output = `
Summary: All tasks completed successfully.

Batch Status: Completed 3/3 tasks.

Test Results: 42 tests passed, 0 failed.

Files modified: src/a.ts, src/b.ts.
      `.trim();

      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        COMPLETION_ENFORCEMENT_CONFIG,
        'build-executor',
      );

      // Should NOT call injectReminder (loose detection passed)
      expect(injectReminderMock).not.toHaveBeenCalled();
      expect(result.output).toBe(output);
      expect(result.warning).toBeUndefined();
    });

    it('should NOT trigger retry when output has substantial content (>= 200 chars)', async () => {
      const output = 'A'.repeat(250);

      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        COMPLETION_ENFORCEMENT_CONFIG,
        'build-executor',
      );

      expect(injectReminderMock).not.toHaveBeenCalled();
      expect(result.warning).toBeUndefined();
    });

    it('should trigger retry when output is empty or very short', async () => {
      const output = 'Working...';
      const config = {
        ...COMPLETION_ENFORCEMENT_CONFIG,
        maxRetries: 1,
        retryDelays: [100],
      };

      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        config,
        'build-executor',
      );

      expect(injectReminderMock).toHaveBeenCalled();
      expect(result.warning).toBeDefined();
    });
  });

  describe('spec-merger (loose agent, P1-1)', () => {
    it('should NOT trigger retry when output contains complete report', async () => {
      const output = `
Summary: Specs merged successfully.

Files modified: spec-a.md, spec-b.md.

All conflicts resolved.
      `.trim();

      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        COMPLETION_ENFORCEMENT_CONFIG,
        'spec-merger',
      );

      expect(injectReminderMock).not.toHaveBeenCalled();
      expect(result.warning).toBeUndefined();
    });
  });

  describe('ui-implementer (loose agent, P1-1)', () => {
    it('should NOT trigger retry when output contains complete report', async () => {
      const output = `
Summary: UI components implemented.

Files modified: src/Button.tsx, src/Input.tsx.

Test Results: All visual tests passed.
      `.trim();

      const result = await performCompletionRetry(
        output,
        injectReminderMock,
        pollOutputMock,
        COMPLETION_ENFORCEMENT_CONFIG,
        'ui-implementer',
      );

      expect(injectReminderMock).not.toHaveBeenCalled();
      expect(result.warning).toBeUndefined();
    });
  });
});

// ─── Retry Success Scenario (P1-2) ─────────────────────────────────────────────

describe('performCompletionRetry retry success', () => {
  let injectReminderMock: ReturnType<typeof mock>;
  let pollOutputMock: ReturnType<typeof mock>;

  beforeEach(() => {
    injectReminderMock = mock(async () => {});
  });

  afterEach(() => {
    injectReminderMock.mockRestore();
  });

  it('should stop retry and return output when pollOutput returns completion signal', async () => {
    // First poll returns null, second poll returns completion signal
    let pollCount = 0;
    pollOutputMock = mock(async () => {
      pollCount++;
      if (pollCount === 1) {
        return null;
      }
      return 'Task completed [TASK_COMPLETE]';
    });

    const output = 'Initial output without signal';
    const config = {
      ...COMPLETION_ENFORCEMENT_CONFIG,
      maxRetries: 2,
      retryDelays: [100, 100],
    };

    const result = await performCompletionRetry(
      output,
      injectReminderMock,
      pollOutputMock,
      config,
      'spec-writer', // strict agent
    );

    // Should have called injectReminder twice (once per retry iteration)
    expect(injectReminderMock).toHaveBeenCalledTimes(2);
    // Should have polled twice
    expect(pollOutputMock).toHaveBeenCalledTimes(2);
    // Should return the output with completion signal
    expect(result.output).toContain('[TASK_COMPLETE]');
    expect(result.warning).toBeUndefined();
  });

  it('should stop retry when loose agent output becomes substantial', async () => {
    let pollCount = 0;
    pollOutputMock = mock(async () => {
      pollCount++;
      if (pollCount === 1) {
        return null;
      }
      return 'Summary: Task done. Files: a.ts, b.ts. All tests pass.';
    });

    const output = 'Working...';
    const config = {
      ...COMPLETION_ENFORCEMENT_CONFIG,
      maxRetries: 2,
      retryDelays: [100, 100],
    };

    const result = await performCompletionRetry(
      output,
      injectReminderMock,
      pollOutputMock,
      config,
      'build-executor', // loose agent
    );

    expect(injectReminderMock).toHaveBeenCalledTimes(2);
    expect(pollOutputMock).toHaveBeenCalledTimes(2);
    expect(result.output).toContain('Summary');
    expect(result.warning).toBeUndefined();
  });
});
