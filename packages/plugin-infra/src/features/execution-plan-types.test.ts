/**
 * Tests for execution-plan-types.ts — Wave W1 Task 1.1
 *
 * Validates that all required interfaces and type aliases are exported
 * and have the correct fields. Uses runtime structural checks since
 * TypeScript interfaces are compile-time only.
 */
import { describe, it, expect } from 'bun:test';
import type {
  ExecutionMode,
  ReceiptStatus,
  WaveStrategy,
  PlanSource,
  Wave,
  ReviewReceipt,
  DP4Result,
  ExecutionPlan,
} from './execution-plan-types.js';

// ─── Type Alias Tests ────────────────────────────────────────────────────────

describe('ExecutionMode type alias', () => {
  it('should accept valid execution modes', () => {
    const inline: ExecutionMode = 'inline';
    const batchInline: ExecutionMode = 'batch-inline';
    const sdd: ExecutionMode = 'sdd';

    expect(inline).toBe('inline');
    expect(batchInline).toBe('batch-inline');
    expect(sdd).toBe('sdd');
  });
});

describe('ReceiptStatus type alias', () => {
  it('should accept valid receipt statuses', () => {
    const pass: ReceiptStatus = 'pass';
    const fail: ReceiptStatus = 'fail';

    expect(pass).toBe('pass');
    expect(fail).toBe('fail');
  });
});

describe('WaveStrategy type alias', () => {
  it('should accept valid wave strategies', () => {
    const parallel: WaveStrategy = 'parallel';
    const serial: WaveStrategy = 'serial';

    expect(parallel).toBe('parallel');
    expect(serial).toBe('serial');
  });
});

describe('PlanSource type alias', () => {
  it('should accept valid plan sources', () => {
    const userOverride: PlanSource = 'user-override';
    const defaultSource: PlanSource = 'default';

    expect(userOverride).toBe('user-override');
    expect(defaultSource).toBe('default');
  });
});

// ─── Interface Structural Tests ──────────────────────────────────────────────

describe('Wave interface', () => {
  it('should have all required fields', () => {
    const wave: Wave = {
      id: 'W1',
      strategy: 'parallel',
      tasks: ['1.1', '1.2'],
      depends_on: [],
    };

    expect(wave).toHaveProperty('id');
    expect(wave).toHaveProperty('strategy');
    expect(wave).toHaveProperty('tasks');
    expect(wave).toHaveProperty('depends_on');
    expect(wave.id).toBe('W1');
    expect(wave.strategy).toBe('parallel');
    expect(wave.tasks).toEqual(['1.1', '1.2']);
    expect(wave.depends_on).toEqual([]);
  });

  it('should support serial strategy with dependencies', () => {
    const wave: Wave = {
      id: 'W2',
      strategy: 'serial',
      tasks: ['2.1', '2.2'],
      depends_on: ['W1'],
    };

    expect(wave.strategy).toBe('serial');
    expect(wave.depends_on).toEqual(['W1']);
  });
});

describe('ReviewReceipt interface', () => {
  it('should have all required fields', () => {
    const receipt: ReviewReceipt = {
      status: 'pass',
      base: 'abc1234',
      head: 'def5678',
      report: 'All checks passed',
      recorded_at: '2026-07-15T10:00:00Z',
    };

    expect(receipt).toHaveProperty('status');
    expect(receipt).toHaveProperty('base');
    expect(receipt).toHaveProperty('head');
    expect(receipt).toHaveProperty('report');
    expect(receipt).toHaveProperty('recorded_at');
    expect(receipt.status).toBe('pass');
    expect(receipt.base).toBe('abc1234');
    expect(receipt.head).toBe('def5678');
    expect(receipt.report).toBe('All checks passed');
    expect(receipt.recorded_at).toBe('2026-07-15T10:00:00Z');
  });

  it('should support fail status', () => {
    const receipt: ReviewReceipt = {
      status: 'fail',
      base: 'abc1234',
      head: 'def5678',
      report: 'Test failures detected',
      recorded_at: '2026-07-15T10:00:00Z',
    };

    expect(receipt.status).toBe('fail');
  });
});

describe('DP4Result interface', () => {
  it('should have all required fields for inline mode', () => {
    const result: DP4Result = {
      mode: 'inline',
      taskCount: 2,
      hasDependencies: false,
      rationale: '2 tasks with no dependencies: inline mode recommended',
    };

    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('taskCount');
    expect(result).toHaveProperty('hasDependencies');
    expect(result).toHaveProperty('rationale');
    expect(result.mode).toBe('inline');
    expect(result.taskCount).toBe(2);
    expect(result.hasDependencies).toBe(false);
    expect(result.rationale).toContain('inline');
  });

  it('should support sdd mode with dependencies', () => {
    const result: DP4Result = {
      mode: 'sdd',
      taskCount: 8,
      hasDependencies: true,
      rationale: 'Tasks have cross-wave dependencies: sdd mode recommended',
    };

    expect(result.mode).toBe('sdd');
    expect(result.taskCount).toBe(8);
    expect(result.hasDependencies).toBe(true);
  });

  it('should support batch-inline mode', () => {
    const result: DP4Result = {
      mode: 'batch-inline',
      taskCount: 4,
      hasDependencies: false,
      rationale: '4 tasks with no dependencies: batch-inline mode recommended',
    };

    expect(result.mode).toBe('batch-inline');
    expect(result.taskCount).toBe(4);
  });
});

describe('ExecutionPlan interface', () => {
  it('should have all required fields', () => {
    const plan: ExecutionPlan = {
      mode: 'inline',
      source: 'default',
      rationale: 'Auto-recommended based on task count',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
      ],
      hash: 'sha256abc123',
      artifacts_hash: 'artifacts_sha256',
      contract_hash: 'contract_sha256',
      revision: 1,
    };

    expect(plan).toHaveProperty('mode');
    expect(plan).toHaveProperty('source');
    expect(plan).toHaveProperty('rationale');
    expect(plan).toHaveProperty('waves');
    expect(plan).toHaveProperty('hash');
    expect(plan).toHaveProperty('artifacts_hash');
    expect(plan).toHaveProperty('contract_hash');
    expect(plan).toHaveProperty('revision');
    expect(plan.mode).toBe('inline');
    expect(plan.source).toBe('default');
    expect(plan.rationale).toBe('Auto-recommended based on task count');
    expect(plan.waves).toHaveLength(1);
    expect(plan.hash).toBe('sha256abc123');
    expect(plan.artifacts_hash).toBe('artifacts_sha256');
    expect(plan.contract_hash).toBe('contract_sha256');
    expect(plan.revision).toBe(1);
  });

  it('should support user-override source', () => {
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'user-override',
      rationale: 'User explicitly chose sdd mode',
      waves: [],
      hash: 'sha256override',
      artifacts_hash: 'a_hash',
      contract_hash: 'c_hash',
      revision: 1,
    };

    expect(plan.source).toBe('user-override');
    expect(plan.mode).toBe('sdd');
  });

  it('should support multiple waves with dependencies', () => {
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'Complex execution with dependencies',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        { id: 'W3', strategy: 'parallel', tasks: ['3.1', '3.2'], depends_on: ['W1', 'W2'] },
      ],
      hash: 'multi_wave_hash',
      artifacts_hash: 'a_hash',
      contract_hash: 'c_hash',
      revision: 2,
    };

    expect(plan.waves).toHaveLength(3);
    expect(plan.waves[1].depends_on).toEqual(['W1']);
    expect(plan.waves[2].depends_on).toEqual(['W1', 'W2']);
    expect(plan.revision).toBe(2);
  });
});
