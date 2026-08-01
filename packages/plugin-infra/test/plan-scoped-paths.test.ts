/**
 * Unit tests for plan-scoped-paths module (T2.8)
 *
 * Tests:
 * - getOverlayPaths: 根级路径派生
 * - getPlanIdentity: plan identity 计算
 * - getPlanScopedPaths: plan-scoped 路径派生
 * - getCurrentPlanScopedPaths: 当前 plan 路径读取
 * - resolveRecordDirectory: 收据目录解析
 * - hasMatchingPlan: plan 匹配检查
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import {
  getOverlayPaths,
  getPlanIdentity,
  getPlanScopedPaths,
  getCurrentPlanScopedPaths,
  resolveRecordDirectory,
  hasMatchingPlan,
  safeName,
} from '../src/features/plan-scoped-paths.js';
import type { ExecutionPlan } from '../src/features/execution-plan-types.js';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

const TEST_DIR = join(import.meta.dir, 'tmp-plan-scoped-paths');
const SDD_ROOT = join(TEST_DIR, '.flow-engine', 'sflow');

function createTestPlan(revision: number = 1): ExecutionPlan {
  return {
    mode: 'sdd',
    source: 'default',
    rationale: 'Test plan',
    waves: [
      { id: 'W1', strategy: 'serial', tasks: ['T1'], depends_on: [] },
    ],
    hash: 'sha256:' + 'a'.repeat(64), // 64 hex chars
    artifacts_hash: 'sha256:' + 'b'.repeat(64),
    contract_hash: 'sha256:' + 'c'.repeat(64),
    revision,
  };
}

// ─── Setup & Teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  // Clean up test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  // Clean up test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getOverlayPaths', () => {
  it('should return root-level SDD paths', () => {
    const paths = getOverlayPaths(TEST_DIR);

    expect(paths.root).toBe(SDD_ROOT);
    expect(paths.reviews).toBe(join(SDD_ROOT, 'reviews'));
    expect(paths.checkpoints).toBe(join(SDD_ROOT, 'checkpoints'));
    expect(paths.handoffs).toBe(join(SDD_ROOT, 'handoffs'));
    expect(paths.repairState).toBe(join(SDD_ROOT, 'repair-state'));
    expect(paths.executionPlan).toBe(join(SDD_ROOT, 'execution-plan.json'));
  });
});

describe('getPlanIdentity', () => {
  it('should compute identity from plan hash and revision', () => {
    const plan = createTestPlan(1);
    const identity = getPlanIdentity(plan);

    // Format: r<revision>-<hash-hex>
    expect(identity).toBe('r1-' + 'a'.repeat(64));
  });

  it('should produce different identities for different revisions', () => {
    const plan1 = createTestPlan(1);
    const plan2 = createTestPlan(2);

    const identity1 = getPlanIdentity(plan1);
    const identity2 = getPlanIdentity(plan2);

    expect(identity1).not.toBe(identity2);
    expect(identity1).toBe('r1-' + 'a'.repeat(64));
    expect(identity2).toBe('r2-' + 'a'.repeat(64));
  });

  it('should throw for invalid hash format', () => {
    const plan = createTestPlan(1);
    plan.hash = 'invalid-hash';

    expect(() => getPlanIdentity(plan)).toThrow('Execution plan hash must be a sha256 digest');
  });

  it('should throw for invalid revision', () => {
    const plan = createTestPlan(1);
    plan.revision = 0;

    expect(() => getPlanIdentity(plan)).toThrow('Execution plan revision must be a positive integer');
  });
});

describe('getPlanScopedPaths', () => {
  it('should derive plan-scoped paths from plan identity', () => {
    const plan = createTestPlan(1);
    const paths = getPlanScopedPaths(TEST_DIR, plan);

    const expectedPlanRoot = join(SDD_ROOT, 'plans', 'r1-' + 'a'.repeat(64));

    expect(paths.root).toBe(SDD_ROOT);
    expect(paths.planIdentity).toBe('r1-' + 'a'.repeat(64));
    expect(paths.planRoot).toBe(expectedPlanRoot);
    expect(paths.reviews).toBe(join(expectedPlanRoot, 'reviews'));
    expect(paths.checkpoints).toBe(join(expectedPlanRoot, 'checkpoints'));
    expect(paths.handoffs).toBe(join(expectedPlanRoot, 'handoffs'));
    expect(paths.repairState).toBe(join(expectedPlanRoot, 'repair-state'));
  });

  it('should produce different paths for different plan identities', () => {
    const plan1 = createTestPlan(1);
    const plan2 = createTestPlan(2);

    const paths1 = getPlanScopedPaths(TEST_DIR, plan1);
    const paths2 = getPlanScopedPaths(TEST_DIR, plan2);

    expect(paths1.planRoot).not.toBe(paths2.planRoot);
    expect(paths1.reviews).not.toBe(paths2.reviews);
  });
});

describe('getCurrentPlanScopedPaths', () => {
  it('should return null if no execution plan exists', async () => {
    const paths = await getCurrentPlanScopedPaths(TEST_DIR);
    expect(paths).toBeNull();
  });

  it('should return plan-scoped paths if execution plan exists', async () => {
    const plan = createTestPlan(1);

    // Write execution plan
    mkdirSync(SDD_ROOT, { recursive: true });
    const planPath = join(SDD_ROOT, 'execution-plan.json');
    writeFileSync(planPath, JSON.stringify(plan), 'utf8');

    const paths = await getCurrentPlanScopedPaths(TEST_DIR);

    expect(paths).not.toBeNull();
    expect(paths!.plan).toEqual(plan);
    expect(paths!.planIdentity).toBe('r1-' + 'a'.repeat(64));
  });

  it('should throw if execution plan is malformed', async () => {
    mkdirSync(SDD_ROOT, { recursive: true });
    const planPath = join(SDD_ROOT, 'execution-plan.json');
    writeFileSync(planPath, 'invalid json', 'utf8');

    await expect(getCurrentPlanScopedPaths(TEST_DIR)).rejects.toThrow('Unable to read execution plan');
  });
});

describe('resolveRecordDirectory', () => {
  it('should return root directory if no plan exists', async () => {
    const result = await resolveRecordDirectory(TEST_DIR, 'reviews');

    expect(result.directory).toBe(join(SDD_ROOT, 'reviews'));
    expect(result.legacyPlan).toBeNull();
  });

  it('should return root directory if plan-scoped directory does not exist', async () => {
    const plan = createTestPlan(1);

    // Write execution plan but don't create plan-scoped directory
    mkdirSync(SDD_ROOT, { recursive: true });
    const planPath = join(SDD_ROOT, 'execution-plan.json');
    writeFileSync(planPath, JSON.stringify(plan), 'utf8');

    const result = await resolveRecordDirectory(TEST_DIR, 'reviews');

    expect(result.directory).toBe(join(SDD_ROOT, 'reviews'));
    expect(result.legacyPlan).toEqual(plan);
  });

  it('should return plan-scoped directory if it exists', async () => {
    const plan = createTestPlan(1);

    // Write execution plan
    mkdirSync(SDD_ROOT, { recursive: true });
    const planPath = join(SDD_ROOT, 'execution-plan.json');
    writeFileSync(planPath, JSON.stringify(plan), 'utf8');

    // Create plan-scoped directory (must be the exact path that getCurrentPlanScopedPaths checks)
    const paths = getPlanScopedPaths(TEST_DIR, plan);
    mkdirSync(paths.planRoot, { recursive: true });

    const result = await resolveRecordDirectory(TEST_DIR, 'reviews');

    expect(result.directory).toBe(paths.reviews);
    expect(result.legacyPlan).toBeNull();
  });
});

describe('hasMatchingPlan', () => {
  it('should return true if plan_hash and plan_revision match', () => {
    const plan = createTestPlan(1);
    const record = {
      plan_hash: plan.hash,
      plan_revision: plan.revision,
    };

    expect(hasMatchingPlan(record, plan)).toBe(true);
  });

  it('should return false if plan_hash does not match', () => {
    const plan = createTestPlan(1);
    const record = {
      plan_hash: 'sha256:' + 'z'.repeat(64),
      plan_revision: plan.revision,
    };

    expect(hasMatchingPlan(record, plan)).toBe(false);
  });

  it('should return false if plan_revision does not match', () => {
    const plan = createTestPlan(1);
    const record = {
      plan_hash: plan.hash,
      plan_revision: 999,
    };

    expect(hasMatchingPlan(record, plan)).toBe(false);
  });

  it('should return false for null or undefined record', () => {
    const plan = createTestPlan(1);

    expect(hasMatchingPlan(null, plan)).toBe(false);
    expect(hasMatchingPlan(undefined, plan)).toBe(false);
  });
});

describe('safeName', () => {
  it('should preserve safe characters', () => {
    expect(safeName('abc123')).toBe('abc123');
    expect(safeName('test-file.json')).toBe('test-file.json');
    expect(safeName('T1.2.3')).toBe('T1.2.3');
  });

  it('should replace unsafe characters with underscore', () => {
    expect(safeName('test file')).toBe('test_file');
    expect(safeName('test/file')).toBe('test_file');
    expect(safeName('test:file')).toBe('test_file');
  });
});
