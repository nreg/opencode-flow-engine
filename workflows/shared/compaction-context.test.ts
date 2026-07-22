/**
 * Tests for Compaction Context
 *
 * Covers:
 * - Basic compaction context generation
 * - With task progress
 * - With decision points
 * - With both progress and decision points
 * - Edge cases (empty state, missing fields)
 */
import { describe, it, expect } from 'bun:test';
import { createCompactionContext } from './compaction-context.js';
import type { CompactionState, TaskProgress } from './compaction-context.js';

describe('createCompactionContext', () => {
  it('should generate context with state only', () => {
    const state: CompactionState = {
      state: 'executing',
      updatedAt: '2026-07-23T10:00:00.000Z',
    };

    const result = createCompactionContext('sFlow', state);

    expect(result).toContain('[sFlow] Session compacted');
    expect(result).toContain('Current State: executing');
    expect(result).toContain('Last Updated: 2026-07-23T10:00:00.000Z');
    expect(result).toContain('Preserve the current workflow state');
  });

  it('should include task progress when provided', () => {
    const state: CompactionState = {
      state: 'executing',
    };

    const progress: TaskProgress = {
      completedTasks: 3,
      totalTasks: 8,
      currentBatch: 'W2',
      currentTask: 'T05 - Implement auth middleware',
    };

    const result = createCompactionContext('sFlow', state, progress);

    expect(result).toContain('3/8 tasks completed');
    expect(result).toContain('Current Batch: W2');
    expect(result).toContain('Current Task: T05 - Implement auth middleware');
  });

  it('should include decision points when provided', () => {
    const state: CompactionState = {
      state: 'approved-for-build',
      dp0: '需求澄清完成',
      dp1: '规范已批准',
      dp2: 'UI 设计已确认',
      dp3: '合同已批准',
    };

    const result = createCompactionContext('sFlow', state);

    expect(result).toContain('Decision Points:');
    expect(result).toContain('DP0: 需求澄清完成');
    expect(result).toContain('DP1: 规范已批准');
    expect(result).toContain('DP2: UI 设计已确认');
    expect(result).toContain('DP3: 合同已批准');
    expect(result).not.toContain('DP4');
    expect(result).not.toContain('DP5');
  });

  it('should include both progress and decision points', () => {
    const state: CompactionState = {
      state: 'executing',
      dp3: 'Contract approved',
      dp4: 'Wave 1 done',
    };

    const progress: TaskProgress = {
      completedTasks: 5,
      totalTasks: 12,
      currentBatch: 'W3',
    };

    const result = createCompactionContext('iFlow', state, progress);

    expect(result).toContain('[iFlow] Session compacted');
    expect(result).toContain('Current State: executing');
    expect(result).toContain('5/12 tasks completed');
    expect(result).toContain('Current Batch: W3');
    expect(result).toContain('DP3: Contract approved');
    expect(result).toContain('DP4: Wave 1 done');
  });

  it('should handle missing optional fields gracefully', () => {
    const state: CompactionState = {
      state: 'exploring',
    };

    const result = createCompactionContext('sFlow', state);

    expect(result).toContain('[sFlow] Session compacted');
    expect(result).toContain('Current State: exploring');
    expect(result).toContain('Last Updated: unknown');
    expect(result).not.toContain('Decision Points:');
  });

  it('should handle partial progress (no batch or task info)', () => {
    const state: CompactionState = {
      state: 'closing',
    };

    const progress: TaskProgress = {
      completedTasks: 10,
      totalTasks: 10,
    };

    const result = createCompactionContext('sFlow', state, progress);

    expect(result).toContain('10/10 tasks completed');
    expect(result).not.toContain('Current Batch:');
    expect(result).not.toContain('Current Task:');
  });

  it('should handle empty string state', () => {
    const state: CompactionState = {
      state: '',
    };

    const result = createCompactionContext('sFlow', state);

    expect(result).toContain('Current State: ');
  });

  it('should handle all decision points 0-5', () => {
    const state: CompactionState = {
      state: 'closing',
      dp0: 'S0',
      dp1: 'S1',
      dp2: 'S2',
      dp3: 'S3',
      dp4: 'S4',
      dp5: 'S5',
    };

    const result = createCompactionContext('sFlow', state);

    expect(result).toContain('DP0: S0');
    expect(result).toContain('DP1: S1');
    expect(result).toContain('DP2: S2');
    expect(result).toContain('DP3: S3');
    expect(result).toContain('DP4: S4');
    expect(result).toContain('DP5: S5');
  });

  it('should include final instruction line', () => {
    const state: CompactionState = { state: 'executing' };

    const result = createCompactionContext('sFlow', state);

    expect(result).toContain('Preserve the current workflow state, decision points, and task progress');
    expect(result).toContain('continue from the next concrete unfinished step');
    expect(result).toContain('audit real artifacts and command outputs');
  });

  it('should use workflow name in the header', () => {
    const state: CompactionState = { state: 'discussing' };

    const result1 = createCompactionContext('sFlow', state);
    expect(result1).toContain('[sFlow]');

    const result2 = createCompactionContext('iFlow', state);
    expect(result2).toContain('[iFlow]');

    const result3 = createCompactionContext('CustomFlow', state);
    expect(result3).toContain('[CustomFlow]');
  });

  it('should produce valid non-empty output', () => {
    const state: CompactionState = { state: 'executing' };

    const result = createCompactionContext('sFlow', state);

    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(50);
  });
});