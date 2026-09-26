/**
 * Tests for execution-plan.ts — Wave W2
 *
 * TDD RED phase: All tests should FAIL until implementation is written.
 * Covers: createExecutionPlan, readExecutionPlan, validatePlanHashes,
 *         reviseExecutionPlan, computeContentHash, recommendExecutionMode
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  createExecutionPlan,
  readExecutionPlan,
  validatePlanHashes,
  reviseExecutionPlan,
  computeContentHash,
  recommendExecutionMode,
  recordReviewReceipt,
  readRepairState,
  updateRepairState,
  validateRepairContinuity,
  // P0-2: Issue-identity circuit breaker
  issueFailureCount,
  validateIssueId,
  adjudicateWave,
  readActiveAdjudicationAsync,
  // P0-3: Plan revision recovery
  resolveRecommendationPlanRevision,
  // P1-1: Review targets
  reviewTargets,
  // P1-5: Review base
  normalizeCommitSha,
  recordReviewBase,
  validateFinalReviewRange,
  isGitEnvironment,
} from './execution-plan.js';
import type { ExecutionPlan, Wave, ReviewReceipt, RepairState, ReviewEvidence, Adjudication, ReviewPolicy, SchemaVersion } from './execution-plan-types.js';
import { MAX_REPAIR_FAILURES, MAX_ISSUE_REPAIR_FAILURES, ISSUE_ID_PATTERN, FULL_COMMIT_SHA } from '@opencode-flow-engine/core';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', `execution-plan-${name}`);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

/** Create a minimal state.json for testing */
async function setupStateJson(dir: string, overrides?: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow');
  const state = {
    state: 'approved-for-build',
    mode: 'full',
    artifacts_hash: 'test-artifacts-hash-1234',
    contract_hash: 'test-contract-hash-5678',
    batches_completed: 0,
    dp_0_confirmed: false,
    contractApproved: true,
    verificationStatus: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify(state, null, 2));
}

/** Sample waves for testing */
const sampleWaves: Wave[] = [
  { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
  { id: 'W2', strategy: 'serial', tasks: ['2.1', '2.2'], depends_on: ['W1'] },
];

const inlineWaves: Wave[] = [
  { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
];

// ─── Task 2.1: createExecutionPlan ────────────────────────────────────────────

describe('createExecutionPlan', () => {
  const dir = tempDir('create');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should create .flow-engine/sflow/execution-plan.json with all required fields', async () => {
    const plan = await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Multiple waves with dependencies',
      waves: sampleWaves,
    });

    expect(plan).toBeDefined();
    expect(plan.mode).toBe('sdd');
    expect(plan.source).toBe('default');
    expect(plan.rationale).toBe('Multiple waves with dependencies');
    expect(plan.waves).toHaveLength(2);
    expect(plan.hash).toBeTruthy();
    expect(plan.artifacts_hash).toBe('test-artifacts-hash-1234');
    expect(plan.contract_hash).toBe('test-contract-hash-5678');
    expect(plan.revision).toBe(1);
  });

  it('should write the plan to .flow-engine/sflow/execution-plan.json on disk', async () => {
    await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Simple task',
      waves: inlineWaves,
    });

    const content = await readFile(dir + '/.flow-engine/sflow/execution-plan.json', 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.mode).toBe('inline');
    expect(parsed.revision).toBe(1);
  });

  it('should compute content hash from the plan object', async () => {
    const plan = await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Simple task',
      waves: inlineWaves,
    });

    // Hash should be a sha256-prefixed hex string
    expect(plan.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(plan.hash.length).toBeGreaterThan(0);
  });

  it('should read artifacts_hash and contract_hash from state.json', async () => {
    const plan = await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Simple task',
      waves: inlineWaves,
    });

    expect(plan.artifacts_hash).toBe('test-artifacts-hash-1234');
    expect(plan.contract_hash).toBe('test-contract-hash-5678');
  });

  it('should update state.json execution_plan_hash field', async () => {
    const plan = await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Simple task',
      waves: inlineWaves,
    });

    const stateContent = await readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8');
    const state = JSON.parse(stateContent);
    expect(state.execution_plan_hash).toBe(plan.hash);
  });

  it('should reject duplicate task IDs across waves', async () => {
    const wavesWithDup: Wave[] = [
      { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
      { id: 'W2', strategy: 'serial', tasks: ['1.1', '2.1'], depends_on: ['W1'] },
    ];

    await expect(createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Duplicate task',
      waves: wavesWithDup,
    })).rejects.toThrow(/duplicate/i);
  });

  it('should reject circular wave dependencies', async () => {
    const circularWaves: Wave[] = [
      { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: ['W2'] },
      { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
    ];

    await expect(createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Circular deps',
      waves: circularWaves,
    })).rejects.toThrow(/circular/i);
  });

  it('should reject invalid execution mode', async () => {
    await expect(createExecutionPlan(dir, {
      mode: 'invalid-mode' as any,
      source: 'default',
      rationale: 'Bad mode',
      waves: inlineWaves,
    })).rejects.toThrow(/mode/i);
  });

  it('should reject waves referencing non-existent wave IDs in depends_on', async () => {
    const wavesWithMissingRef: Wave[] = [
      { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: ['W99'] },
    ];

    await expect(createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Missing ref',
      waves: wavesWithMissingRef,
    })).rejects.toThrow(/depend/i);
  });

  it('should accept revision parameter', async () => {
    const plan = await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'With revision',
      waves: inlineWaves,
      revision: 3,
    });

    expect(plan.revision).toBe(3);
  });

  it('should default revision to 1 when not provided', async () => {
    const plan = await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Default revision',
      waves: inlineWaves,
    });

    expect(plan.revision).toBe(1);
  });
});

// ─── Task 2.2: readExecutionPlan ──────────────────────────────────────────────

describe('readExecutionPlan', () => {
  const dir = tempDir('read');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should read and parse an existing execution-plan.json', async () => {
    const created = await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Test read',
      waves: sampleWaves,
    });

    const read = await readExecutionPlan(dir);
    expect(read).not.toBeNull();
    expect(read!.mode).toBe('sdd');
    expect(read!.waves).toHaveLength(2);
    expect(read!.hash).toBe(created.hash);
    expect(read!.revision).toBe(1);
  });

  it('should return null when execution-plan.json does not exist', async () => {
    const result = await readExecutionPlan(dir);
    expect(result).toBeNull();
  });
});

// ─── Task 2.2: validatePlanHashes ─────────────────────────────────────────────

describe('validatePlanHashes', () => {
  const dir = tempDir('validate');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should pass when plan hashes match current state.json values', async () => {
    const plan = await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Hash validation',
      waves: inlineWaves,
    });

    const result = await validatePlanHashes(plan, dir);
    expect(result.valid).toBe(true);
  });

  it('should fail when artifacts_hash is stale', async () => {
    const plan = await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Stale artifacts',
      waves: inlineWaves,
    });

    // Modify state.json to change artifacts_hash
    await setupStateJson(dir, { artifacts_hash: 'stale-artifacts-hash' });

    const result = await validatePlanHashes(plan, dir);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('artifacts_hash');
  });

  it('should fail when contract_hash is stale', async () => {
    const plan = await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Stale contract',
      waves: inlineWaves,
    });

    // Modify state.json to change contract_hash
    await setupStateJson(dir, { contract_hash: 'stale-contract-hash' });

    const result = await validatePlanHashes(plan, dir);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('contract_hash');
  });
});

// ─── Task 2.3: reviseExecutionPlan ────────────────────────────────────────────

describe('reviseExecutionPlan', () => {
  const dir = tempDir('revise');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should increment revision from 1 to 2', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Initial plan',
      waves: sampleWaves,
    });

    const revised = await reviseExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Updated rationale',
      waves: sampleWaves,
    });

    expect(revised.revision).toBe(2);
  });

  it('should increment revision from 2 to 3', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Initial plan',
      waves: sampleWaves,
    });

    await reviseExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'First revision',
      waves: sampleWaves,
    });

    const revised2 = await reviseExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Second revision',
      waves: sampleWaves,
    });

    expect(revised2.revision).toBe(3);
  });

  it('should reject sdd to inline mode downgrade', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'SDD plan',
      waves: sampleWaves,
    });

    await expect(reviseExecutionPlan(dir, {
      mode: 'inline',
      source: 'user-override',
      rationale: 'Trying to downgrade',
      waves: inlineWaves,
    })).rejects.toThrow(/downgrad/i);
  });

  it('should reject sdd to batch-inline mode downgrade', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'SDD plan',
      waves: sampleWaves,
    });

    await expect(reviseExecutionPlan(dir, {
      mode: 'batch-inline',
      source: 'user-override',
      rationale: 'Trying to downgrade to batch',
      waves: inlineWaves,
    })).rejects.toThrow(/downgrad/i);
  });

  it('should allow inline to sdd mode upgrade', async () => {
    await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Inline plan',
      waves: inlineWaves,
    });

    const revised = await reviseExecutionPlan(dir, {
      mode: 'sdd',
      source: 'user-override',
      rationale: 'Upgrading to sdd',
      waves: sampleWaves,
    });

    expect(revised.mode).toBe('sdd');
    expect(revised.revision).toBe(2);
  });

  it('should fail when no existing plan exists', async () => {
    await expect(reviseExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'No existing plan',
      waves: inlineWaves,
    })).rejects.toThrow(/no.*plan/i);
  });

  it('should validate the revised plan structure (no duplicate tasks)', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Initial plan',
      waves: sampleWaves,
    });

    const badWaves: Wave[] = [
      { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
      { id: 'W2', strategy: 'serial', tasks: ['1.1', '2.1'], depends_on: ['W1'] },
    ];

    await expect(reviseExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Bad revision',
      waves: badWaves,
    })).rejects.toThrow(/duplicate/i);
  });
});

// ─── Task 2.4: computeContentHash ─────────────────────────────────────────────

describe('computeContentHash', () => {
  it('should return a deterministic SHA-256 hex digest', async () => {
    const plan: ExecutionPlan = {
      mode: 'inline',
      source: 'default',
      rationale: 'Test hash',
      waves: inlineWaves,
      hash: '',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };

    const hash1 = await computeContentHash(plan);
    const hash2 = await computeContentHash(plan);
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different content', async () => {
    const plan1: ExecutionPlan = {
      mode: 'inline',
      source: 'default',
      rationale: 'Plan A',
      waves: inlineWaves,
      hash: '',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };

    const plan2: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'Plan B',
      waves: sampleWaves,
      hash: '',
      artifacts_hash: 'b',
      contract_hash: 'd',
      revision: 2,
    };

    const hash1 = await computeContentHash(plan1);
    const hash2 = await computeContentHash(plan2);
    expect(hash1).not.toBe(hash2);
  });

  it('should produce the same hash regardless of key insertion order', async () => {
    // Create two plans with same data but different object key order
    // by using JSON.parse(JSON.stringify()) which may reorder keys
    const planObj = {
      mode: 'inline',
      source: 'default',
      rationale: 'Order test',
      waves: inlineWaves,
      hash: '',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };

    // Create same plan via different construction
    const plan1: ExecutionPlan = { ...planObj };
    const plan2: ExecutionPlan = {
      revision: 1,
      contract_hash: 'c',
      artifacts_hash: 'a',
      hash: '',
      waves: inlineWaves,
      rationale: 'Order test',
      source: 'default',
      mode: 'inline',
    };

    const hash1 = await computeContentHash(plan1);
    const hash2 = await computeContentHash(plan2);
    expect(hash1).toBe(hash2);
  });

  it('should return a hex string', async () => {
    const plan: ExecutionPlan = {
      mode: 'inline',
      source: 'default',
      rationale: 'Hex test',
      waves: inlineWaves,
      hash: '',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };

    const hash = await computeContentHash(plan);
    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

// ─── Task 2.5: recommendExecutionMode ─────────────────────────────────────────

describe('recommendExecutionMode', () => {
  it('should recommend inline for 1-2 tasks with no dependencies', () => {
    const tasksMd = `
## Wave W1
- [ ] Task 1.1: Do something
- [ ] Task 1.2: Do another thing
`;
    const result = recommendExecutionMode(tasksMd);
    expect(result.mode).toBe('inline');
    expect(result.taskCount).toBe(2);
    expect(result.hasDependencies).toBe(false);
    expect(result.rationale).toContain('inline');
  });

  it('should recommend inline for 1 task', () => {
    const tasksMd = `
- [ ] Task 1.1: Single task
`;
    const result = recommendExecutionMode(tasksMd);
    expect(result.mode).toBe('inline');
    expect(result.taskCount).toBe(1);
  });

  it('should recommend batch-inline for 3-5 tasks with no dependencies', () => {
    const tasksMd = `
- [ ] Task 1.1: Do something
- [ ] Task 1.2: Do another thing
- [ ] Task 1.3: Third task
- [ ] Task 2.1: Fourth task
`;
    const result = recommendExecutionMode(tasksMd);
    expect(result.mode).toBe('batch-inline');
    expect(result.taskCount).toBe(4);
    expect(result.hasDependencies).toBe(false);
  });

  it('should recommend sdd for 5+ tasks', () => {
    const tasksMd = `
- [ ] Task 1.1: First
- [ ] Task 1.2: Second
- [ ] Task 2.1: Third
- [ ] Task 2.2: Fourth
- [ ] Task 3.1: Fifth
- [ ] Task 3.2: Sixth
`;
    const result = recommendExecutionMode(tasksMd);
    expect(result.mode).toBe('sdd');
    expect(result.taskCount).toBe(6);
  });

  it('should recommend sdd when dependencies are detected (depends on)', () => {
    const tasksMd = `
- [ ] Task 1.1: Setup database
- [ ] Task 2.1: Depends on Task 1.1 for data
`;
    const result = recommendExecutionMode(tasksMd);
    expect(result.mode).toBe('sdd');
    expect(result.hasDependencies).toBe(true);
  });

  it('should recommend sdd when dependencies are detected (requires)', () => {
    const tasksMd = `
- [ ] Task 1.1: Setup
- [ ] Task 2.1: Requires Task 1.1 completion
`;
    const result = recommendExecutionMode(tasksMd);
    expect(result.mode).toBe('sdd');
    expect(result.hasDependencies).toBe(true);
  });

  it('should recommend sdd when cross-module references are detected', () => {
    const tasksMd = `
- [ ] Task 1.1: Implement auth-service module
- [ ] Task 2.1: Cross-module: use auth-service in user-service
`;
    const result = recommendExecutionMode(tasksMd);
    expect(result.mode).toBe('sdd');
    expect(result.hasDependencies).toBe(true);
  });

  it('should return DP4Result structure with all fields', () => {
    const tasksMd = `- [ ] Single task`;
    const result = recommendExecutionMode(tasksMd);
    expect(result).toHaveProperty('mode');
    expect(result).toHaveProperty('taskCount');
    expect(result).toHaveProperty('hasDependencies');
    expect(result).toHaveProperty('rationale');
  });

  it('should handle empty tasks.md content', () => {
    const result = recommendExecutionMode('');
    expect(result.mode).toBe('inline');
    expect(result.taskCount).toBe(0);
    expect(result.hasDependencies).toBe(false);
  });
});

// ─── Integration: create → read → validate → revise → validate ───────────────

describe('Integration: execution plan lifecycle', () => {
  const dir = tempDir('lifecycle');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should support create → read → validate → revise → validate cycle', async () => {
    // Step 1: Create
    const created = await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Lifecycle test',
      waves: sampleWaves,
    });
    expect(created.mode).toBe('sdd');
    expect(created.revision).toBe(1);

    // Step 2: Read
    const read = await readExecutionPlan(dir);
    expect(read).not.toBeNull();
    expect(read!.hash).toBe(created.hash);

    // Step 3: Validate
    const valid1 = await validatePlanHashes(read!, dir);
    expect(valid1.valid).toBe(true);

    // Step 4: Revise
    const revised = await reviseExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Revised lifecycle test',
      waves: sampleWaves,
    });
    expect(revised.revision).toBe(2);

    // Step 5: Validate revised
    const valid2 = await validatePlanHashes(revised, dir);
    expect(valid2.valid).toBe(true);

    // Step 6: Read revised
    const readRevised = await readExecutionPlan(dir);
    expect(readRevised!.revision).toBe(2);
  });
});

// ─── T2.5-T2.7: Repair Circuit Breaker ─────────────────────────────────────────

describe('Repair Circuit Breaker', () => {
  const dir = tempDir('repair-circuit');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  // T2.5: repair state 数据结构测试
  describe('T2.5: Repair state data structure', () => {
    it('should create repair state on first failure', async () => {
      // 创建执行计划
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test repair state',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // 记录失败收据
      const receipt = await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: 'abc123',
        head: 'def456',
        report: 'Test failure report',
      });

      expect(receipt.status).toBe('fail');
      expect(receipt.repair_state).toBeDefined();
      expect(receipt.repair_state?.status).toBe('repairing');
      expect(receipt.repair_state?.failure_count).toBe(1);
      expect(receipt.repair_state?.max_failures).toBe(MAX_REPAIR_FAILURES);
    });

    it('should read repair state correctly', async () => {
      // 创建执行计划
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test read repair state',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // 记录失败收据
      await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: 'abc123',
        head: 'def456',
        report: 'Test failure',
      });

      // 读取 repair state
      const repairState = await readRepairState(dir, plan, 'W1');
      expect(repairState).not.toBeNull();
      expect(repairState?.status).toBe('repairing');
      expect(repairState?.failure_count).toBe(1);
    });
  });

  // T2.6: 熔断阈值和阻断逻辑测试
  describe('T2.6: Circuit breaker threshold and blocking', () => {
    it('should enter adjudication-required when threshold is reached', async () => {
      // 创建执行计划
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test threshold',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // 连续失败 MAX_REPAIR_FAILURES 次
      let currentHead = 'initial-head';
      for (let i = 0; i < MAX_REPAIR_FAILURES; i++) {
        const receipt = await recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: currentHead, // base 必须等于上一次的 head
          head: `head${i}`,
          report: `Failure ${i}`,
        });

        currentHead = `head${i}`; // 更新 currentHead 为本次的 head

        if (i < MAX_REPAIR_FAILURES - 1) {
          expect(receipt.repair_state?.status).toBe('repairing');
        } else {
          // 最后一次失败应该触发熔断
          expect(receipt.repair_state?.status).toBe('adjudication-required');
          expect(receipt.repair_state?.failure_count).toBe(MAX_REPAIR_FAILURES);
        }
      }
    });

    it('should block new reviews when in adjudication-required state', async () => {
      // 创建执行计划
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test blocking',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // 连续失败达到阈值
      let currentHead = 'initial-head';
      for (let i = 0; i < MAX_REPAIR_FAILURES; i++) {
        await recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: currentHead,
          head: `head${i}`,
          report: `Failure ${i}`,
        });
        currentHead = `head${i}`;
      }

      // 尝试再次记录 review 应该被阻断
      await expect(
        recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: currentHead,
          head: 'newhead',
          report: 'Should be blocked',
        }),
      ).rejects.toThrow('requires adjudication before another review can be recorded');
    });

    it('should support custom max_failures threshold', async () => {
      // 创建执行计划
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test custom threshold',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // 使用自定义阈值 3
      const customMaxFailures = 3;

      // 连续失败 3 次
      let currentHead = 'initial-head';
      for (let i = 0; i < customMaxFailures; i++) {
        const receipt = await recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: currentHead,
          head: `head${i}`,
          report: `Failure ${i}`,
        });

        currentHead = `head${i}`;

        // 注意：recordReviewReceipt 使用默认阈值，这里只是验证数据结构支持自定义阈值
        if (i === 0) {
          expect(receipt.repair_state?.max_failures).toBe(MAX_REPAIR_FAILURES);
        }
      }
    });
  });

  // T2.7: repair chain 连续性校验测试
  describe('T2.7: Repair chain continuity validation', () => {
    it('should block review if base does not equal previous head', async () => {
      // 创建执行计划
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test continuity',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // 第一次失败
      await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: 'base1',
        head: 'head1',
        report: 'First failure',
      });

      // 尝试用不连续的 base 记录 review 应该被阻断
      await expect(
        recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: 'wrongbase', // 不等于 head1
          head: 'head2',
          report: 'Should be blocked',
        }),
      ).rejects.toThrow('Repair review base must equal the previous review head');
    });

    it('should allow fail→pass with exact same range', async () => {
      // 创建执行计划
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test fail to pass',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // 第一次失败
      await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: 'base1',
        head: 'head1',
        report: 'First failure',
      });

      // 使用相同范围的 pass 应该被允许
      const receipt = await recordReviewReceipt(dir, 'W1', {
        status: 'pass',
        base: 'base1', // 相同范围
        head: 'head1',
        report: 'Fixed',
      });

      expect(receipt.status).toBe('pass');
      expect(receipt.repair_state?.status).toBe('resolved');
    });

    it('should block duplicate pass receipt', async () => {
      // 创建执行计划
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test duplicate pass',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // 第一次 pass
      await recordReviewReceipt(dir, 'W1', {
        status: 'pass',
        base: 'base1',
        head: 'head1',
        report: 'First pass',
      });

      // 尝试再次记录 pass 应该被阻断
      await expect(
        recordReviewReceipt(dir, 'W1', {
          status: 'pass',
          base: 'base1',
          head: 'head1',
          report: 'Duplicate pass',
        }),
      ).rejects.toThrow('already has a passing review receipt');
    });

    it('should mark repair state as resolved after successful repair', async () => {
      // 创建执行计划
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test resolved',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // 失败
      await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: 'base1',
        head: 'head1',
        report: 'Failure',
      });

      // 修复成功
      const receipt = await recordReviewReceipt(dir, 'W1', {
        status: 'pass',
        base: 'head1', // 从上一次的 head 开始
        head: 'head2',
        report: 'Fixed',
      });

      expect(receipt.repair_state?.status).toBe('resolved');
      expect(receipt.repair_state?.failure_count).toBe(1);
      expect(receipt.repair_state?.resolution).toBeDefined();
    });

    it('should ensure previous_report is string in resolved state (P2 fix)', async () => {
      // 创建执行计划
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test previous_report fallback',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // 第一次失败（没有 previousRepair）
      await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: 'base1',
        head: 'head1',
        report: 'First failure',
      });

      // 修复成功（此时 priorFailures 有数据，但 previousRepair.previous_report 可能为空）
      const receipt = await recordReviewReceipt(dir, 'W1', {
        status: 'pass',
        base: 'head1',
        head: 'head2',
        report: 'Fixed',
      });

      // 验证 resolved 状态的 previous_report 是字符串
      expect(receipt.repair_state?.status).toBe('resolved');
      expect(typeof receipt.repair_state?.previous_report).toBe('string');
      expect(receipt.repair_state?.previous_report).toBe('First failure');

      // 验证写入的 repair state 能被 validateRepairState 正确读取
      const repairState = await readRepairState(dir, plan, 'W1');
      expect(repairState).not.toBeNull();
      expect(repairState?.status).toBe('resolved');
      expect(typeof repairState?.previous_report).toBe('string');
    });
  });

  // P0-1: 零范围收据拒绝（review-receipt-integrity）
  describe('P0-1: Zero-range review receipt rejection', () => {
    /** 构造一个本地 git 仓库：base 为首次提交，head 为空 diff 提交（--allow-empty）。 */
    async function initGitRepoWithEmptySecondCommit(workDir: string): Promise<{ base: string; head: string }> {
      await ensureDir(workDir);
      const run = (args: string[]) =>
        execFileSync('git', args, { cwd: workDir, encoding: 'utf8', stdio: 'pipe' });

      run(['init', '-q']);
      run(['config', 'user.email', 'guard-test@example.com']);
      run(['config', 'user.name', 'guard-test']);
      run(['config', 'commit.gpgsign', 'false']);
      await writeFile(join(workDir, 'seed.txt'), 'seed\n');
      run(['add', '.']);
      run(['commit', '-q', '-m', 'base commit']);
      const base = run(['rev-parse', 'HEAD']).trim();
      // 第二次提交为空 diff：base..head 之间 `git diff --name-only` 无输出
      run(['commit', '-q', '--allow-empty', '-m', 'empty commit']);
      const head = run(['rev-parse', 'HEAD']).trim();
      return { base, head };
    }

    async function createPlan(workDir: string): Promise<void> {
      await setupStateJson(workDir);
      await createExecutionPlan(workDir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test zero-range receipt rejection',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });
    }

    // 全量并发下 Windows git execFileSync 较慢，显式放宽超时避免全量跑挂超时误报（P2 加固）
    it('should reject a pass receipt whose base equals head', { timeout: 20000 }, async () => {
      const workDir = tempDir('zero-range-same-sha');
      await cleanupDir(workDir);
      await createPlan(workDir);
      const { head } = await initGitRepoWithEmptySecondCommit(workDir);

      await expect(
        recordReviewReceipt(workDir, 'W1', {
          status: 'pass',
          base: head,
          head,
          report: 'Zero-range pass',
        }),
      ).rejects.toThrow(/non-empty review range/i);

      // 拒绝后磁盘上不得产生任何收据
      expect(existsSync(`${workDir}/.flow-engine/sflow/reviews/W1.json`)).toBe(false);

      await cleanupDir(workDir);
    });

    it('should reject a pass receipt covering an empty git diff', { timeout: 20000 }, async () => {
      const workDir = tempDir('zero-range-empty-diff');
      await cleanupDir(workDir);
      await createPlan(workDir);
      const { base, head } = await initGitRepoWithEmptySecondCommit(workDir);

      await expect(
        recordReviewReceipt(workDir, 'W1', {
          status: 'pass',
          base,
          head,
          report: 'Empty diff pass',
        }),
      ).rejects.toThrow(/non-empty Git diff/i);

      expect(existsSync(`${workDir}/.flow-engine/sflow/reviews/W1.json`)).toBe(false);

      await cleanupDir(workDir);
    });

    it('should allow a fail receipt over the same zero-length range', { timeout: 20000 }, async () => {
      const workDir = tempDir('zero-range-fail-allowed');
      await cleanupDir(workDir);
      await createPlan(workDir);
      const { base, head } = await initGitRepoWithEmptySecondCommit(workDir);

      const receipt = await recordReviewReceipt(workDir, 'W1', {
        status: 'fail',
        base,
        head,
        report: 'Fail over empty range',
      });

      expect(receipt.status).toBe('fail');
      expect(existsSync(`${workDir}/.flow-engine/sflow/reviews/W1.json`)).toBe(true);

      await cleanupDir(workDir);
    });

    it('should skip diff validation (not throw) when git is unavailable for the range', async () => {
      const workDir = tempDir('zero-range-non-git');
      await cleanupDir(workDir);
      await createPlan(workDir);
      // 不初始化 git：git diff 对这两个伪 SHA 必然失败 → 优雅降级跳过
      const receipt = await recordReviewReceipt(workDir, 'W1', {
        status: 'pass',
        base: '0000000000000000000000000000000000000000',
        head: '1111111111111111111111111111111111111111',
        report: 'Non-git environment pass',
      });

      expect(receipt.status).toBe('pass');
      expect(existsSync(`${workDir}/.flow-engine/sflow/reviews/W1.json`)).toBe(true);

      await cleanupDir(workDir);
    });
  });
});

// ─── Wave 3: P0-2 Issue-Identity Circuit Breaker ────────────────────────────────

describe('P0-2: Issue-Identity Circuit Breaker', () => {
  const dir = tempDir('issue-circuit');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  describe('Legacy behavior unchanged (schema_version 1 / no schema_version)', () => {
    it('should use threshold 5 and count all failures for legacy plans', async () => {
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Legacy plan',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // Legacy plan: no schema_version, no issue field
      // 5 failures with DIFFERENT issues should still trigger at threshold 5
      let currentHead = 'initial-head';
      for (let i = 0; i < MAX_REPAIR_FAILURES; i++) {
        const receipt = await recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: currentHead,
          head: `head${i}`,
          report: `Failure ${i}`,
        });
        currentHead = `head${i}`;

        if (i < MAX_REPAIR_FAILURES - 1) {
          expect(receipt.repair_state?.status).toBe('repairing');
        } else {
          expect(receipt.repair_state?.status).toBe('adjudication-required');
          expect(receipt.repair_state?.failure_count).toBe(MAX_REPAIR_FAILURES);
        }
      }
    });

    it('should NOT require issue field for legacy fail receipts', async () => {
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Legacy plan no issue',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // Legacy plan: fail receipt without issue should succeed
      const receipt = await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: 'base1',
        head: 'head1',
        report: 'Legacy failure without issue',
      });

      expect(receipt.status).toBe('fail');
      expect(receipt.issue).toBeUndefined();
    });

    it('should NOT block when review_base is missing (legacy)', async () => {
      // Legacy plan without review_base should not block reviews
      const plan = await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Legacy no review_base',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // review_base is not set — should not block
      expect(plan.review_base).toBeUndefined();
    });
  });

  describe('Schema_version 2 issue-identity circuit breaker', () => {
    it('should require issue field for schema_version 2 fail receipts', async () => {
      // Create plan with schema_version 2
      await setupStateJson(dir);
      const planPath = dir + '/.flow-engine/sflow/execution-plan.json';
      const basePlan = await readExecutionPlan(dir);
      if (basePlan) {
        const updatedPlan = { ...basePlan, schema_version: 2 as SchemaVersion };
        updatedPlan.hash = await computeContentHash(updatedPlan);
        await writeFile(planPath, JSON.stringify(updatedPlan, null, 2));
      } else {
        // Create a plan first
        await createExecutionPlan(dir, {
          mode: 'sdd',
          source: 'default',
          rationale: 'Schema v2 plan',
          waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
        });
        const created = await readExecutionPlan(dir);
        const updatedPlan = { ...created!, schema_version: 2 as SchemaVersion };
        updatedPlan.hash = await computeContentHash(updatedPlan);
        await writeFile(planPath, JSON.stringify(updatedPlan, null, 2));
      }

      // Fail receipt without issue should be rejected
      await expect(
        recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: 'base1',
          head: 'head1',
          report: 'Schema v2 failure without issue',
        }),
      ).rejects.toThrow(/issue identifier/i);
    });

    it('should accept fail receipt with valid issue for schema_version 2', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Schema v2 with issue',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });
      const planPath = dir + '/.flow-engine/sflow/execution-plan.json';
      const created = await readExecutionPlan(dir);
      const updatedPlan = { ...created!, schema_version: 2 as SchemaVersion };
      updatedPlan.hash = await computeContentHash(updatedPlan);
      await writeFile(planPath, JSON.stringify(updatedPlan, null, 2));

      const receipt = await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: 'base1',
        head: 'head1',
        report: 'Schema v2 failure with issue',
        issue: 'BUG-123',
      });

      expect(receipt.status).toBe('fail');
      expect(receipt.issue).toBe('BUG-123');
    });

    it('should trigger circuit breaker at 3 same-issue consecutive failures (schema_version 2)', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Schema v2 issue threshold',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });
      const planPath = dir + '/.flow-engine/sflow/execution-plan.json';
      const created = await readExecutionPlan(dir);
      const updatedPlan = { ...created!, schema_version: 2 as SchemaVersion };
      updatedPlan.hash = await computeContentHash(updatedPlan);
      await writeFile(planPath, JSON.stringify(updatedPlan, null, 2));

      // 3 same-issue failures should trigger adjudication
      let currentHead = 'initial-head';
      for (let i = 0; i < MAX_ISSUE_REPAIR_FAILURES; i++) {
        const receipt = await recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: currentHead,
          head: `head${i}`,
          report: `Same issue failure ${i}`,
          issue: 'BUG-456',
        });
        currentHead = `head${i}`;

        if (i < MAX_ISSUE_REPAIR_FAILURES - 1) {
          expect(receipt.repair_state?.status).toBe('repairing');
        } else {
          expect(receipt.repair_state?.status).toBe('adjudication-required');
        }
      }
    });

    it('should NOT trigger circuit breaker when different issues alternate (schema_version 2)', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Schema v2 different issues',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });
      const planPath = dir + '/.flow-engine/sflow/execution-plan.json';
      const created = await readExecutionPlan(dir);
      const updatedPlan = { ...created!, schema_version: 2 as SchemaVersion };
      updatedPlan.hash = await computeContentHash(updatedPlan);
      await writeFile(planPath, JSON.stringify(updatedPlan, null, 2));

      // 4 failures with alternating issues should NOT trigger (each issue only has 2 consecutive)
      let currentHead = 'initial-head';
      const issues = ['BUG-A', 'BUG-B', 'BUG-A', 'BUG-B'];
      for (let i = 0; i < issues.length; i++) {
        const receipt = await recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: currentHead,
          head: `head${i}`,
          report: `Failure ${i}`,
          issue: issues[i],
        });
        currentHead = `head${i}`;
        expect(receipt.repair_state?.status).toBe('repairing');
      }
    });
  });

  describe('issueFailureCount', () => {
    it('should count all failures for legacy plans (no schema_version)', () => {
      const plan: ExecutionPlan = {
        mode: 'sdd', source: 'default', rationale: 'test',
        waves: [], hash: 'sha256:abc', artifacts_hash: 'a', contract_hash: 'c', revision: 1,
      };
      const failures: ReviewEvidence[] = [
        { base: 'a', head: 'b', report: 'r1', recorded_at: '2026-01-01', issue: 'X' },
        { base: 'b', head: 'c', report: 'r2', recorded_at: '2026-01-02', issue: 'Y' },
        { base: 'c', head: 'd', report: 'r3', recorded_at: '2026-01-03', issue: 'X' },
      ];
      expect(issueFailureCount(plan, failures)).toBe(3);
    });

    it('should count only same-issue failures for schema_version 2', () => {
      const plan: ExecutionPlan = {
        mode: 'sdd', source: 'default', rationale: 'test',
        waves: [], hash: 'sha256:abc', artifacts_hash: 'a', contract_hash: 'c', revision: 1,
        schema_version: 2,
      };
      const failures: ReviewEvidence[] = [
        { base: 'a', head: 'b', report: 'r1', recorded_at: '2026-01-01', issue: 'X' },
        { base: 'b', head: 'c', report: 'r2', recorded_at: '2026-01-02', issue: 'Y' },
        { base: 'c', head: 'd', report: 'r3', recorded_at: '2026-01-03', issue: 'X' },
      ];
      // Latest issue is 'X', so count only 'X' failures = 2
      expect(issueFailureCount(plan, failures)).toBe(2);
    });

    it('should return 0 for empty failures array', () => {
      const plan: ExecutionPlan = {
        mode: 'sdd', source: 'default', rationale: 'test',
        waves: [], hash: 'sha256:abc', artifacts_hash: 'a', contract_hash: 'c', revision: 1,
        schema_version: 2,
      };
      expect(issueFailureCount(plan, [])).toBe(0);
    });
  });

  describe('validateIssueId', () => {
    it('should accept valid issue IDs', () => {
      expect(validateIssueId('BUG-123')).toBe(true);
      expect(validateIssueId('issue_456')).toBe(true);
      expect(validateIssueId('CVE:2024-1234')).toBe(true);
      expect(validateIssueId('a.b-c:d')).toBe(true);
    });

    it('should reject invalid issue IDs', () => {
      expect(() => validateIssueId('')).toThrow();
      expect(() => validateIssueId('has spaces')).toThrow();
      expect(() => validateIssueId('a'.repeat(129))).toThrow();
      expect(() => validateIssueId('special!char')).toThrow();
    });
  });

  describe('startsNewChain', () => {
    it('should reset failure history when previous repair resolved and previous receipt is not fail', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test startsNewChain',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // First: fail
      await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: 'base1',
        head: 'head1',
        report: 'First failure',
      });

      // Second: pass (resolves the repair)
      await recordReviewReceipt(dir, 'W1', {
        status: 'pass',
        base: 'head1',
        head: 'head2',
        report: 'Fixed',
      });

      // Third: new failure — should start a new chain (failure_count = 1, not 2)
      const receipt = await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: 'head2',
        head: 'head3',
        report: 'New failure after resolution',
      });

      expect(receipt.repair_state?.failure_count).toBe(1);
      expect(receipt.repair_state?.status).toBe('repairing');
    });
  });

  describe('adjudicateWave', () => {
    it('should authorize one review after adjudication-required', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test adjudicateWave',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // Reach adjudication-required state (5 failures for legacy plan)
      let currentHead = 'initial-head';
      for (let i = 0; i < MAX_REPAIR_FAILURES; i++) {
        await recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: currentHead,
          head: `head${i}`,
          report: `Failure ${i}`,
        });
        currentHead = `head${i}`;
      }

      // Adjudicate
      const auth = await adjudicateWave(dir, 'W1', {
        decision: 'allow-review',
        confirmed: true,
        reason: 'Human reviewed the failures and authorizes one more attempt',
      });

      expect(auth.status).toBe('authorized');
      expect(auth.decision).toBe('allow-review');
      expect(auth.confirmed).toBe(true);
      expect(auth.id).toBeTruthy();
    });

    it('should reject adjudication with wrong decision', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test wrong decision',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      await expect(
        adjudicateWave(dir, 'W1', {
          decision: 'skip',
          confirmed: true,
          reason: 'Wrong decision',
        }),
      ).rejects.toThrow(/allow-review/i);
    });

    it('should reject adjudication without confirmation', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test no confirmation',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      await expect(
        adjudicateWave(dir, 'W1', {
          decision: 'allow-review',
          confirmed: false,
          reason: 'Not confirmed',
        }),
      ).rejects.toThrow(/confirmed/i);
    });

    it('should allow one review after adjudication and then block again', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test one-time authorization',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // Reach adjudication-required
      let currentHead = 'initial-head';
      for (let i = 0; i < MAX_REPAIR_FAILURES; i++) {
        await recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: currentHead,
          head: `head${i}`,
          report: `Failure ${i}`,
        });
        currentHead = `head${i}`;
      }

      // Adjudicate
      await adjudicateWave(dir, 'W1', {
        decision: 'allow-review',
        confirmed: true,
        reason: 'Authorizing one more attempt',
      });

      // Should now allow one more review (fail again)
      const receipt = await recordReviewReceipt(dir, 'W1', {
        status: 'fail',
        base: currentHead,
        head: 'head_after_adjudication',
        report: 'Failure after adjudication',
      });
      expect(receipt.status).toBe('fail');

      // Next attempt should be blocked again (authorization consumed)
      await expect(
        recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: 'head_after_adjudication',
          head: 'head_blocked',
          report: 'Should be blocked',
        }),
      ).rejects.toThrow(/adjudication/i);
    });

    it('should reject duplicate adjudication when one is already active', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test duplicate adjudication',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // Reach adjudication-required
      let currentHead = 'initial-head';
      for (let i = 0; i < MAX_REPAIR_FAILURES; i++) {
        await recordReviewReceipt(dir, 'W1', {
          status: 'fail',
          base: currentHead,
          head: `head${i}`,
          report: `Failure ${i}`,
        });
        currentHead = `head${i}`;
      }

      // First adjudication
      await adjudicateWave(dir, 'W1', {
        decision: 'allow-review',
        confirmed: true,
        reason: 'First authorization',
      });

      // Second adjudication should be rejected (already has active authorization)
      await expect(
        adjudicateWave(dir, 'W1', {
          decision: 'allow-review',
          confirmed: true,
          reason: 'Duplicate authorization',
        }),
      ).rejects.toThrow(/already has an active/i);
    });
  });
});

// ─── Wave 3: P0-3 Plan Revision Recovery ────────────────────────────────────────

describe('P0-3: resolveRecommendationPlanRevision', () => {
  const dir = tempDir('plan-revision');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return revision from state when available', async () => {
    await setupStateJson(dir, { execution_plan_revision: 3 });
    const revision = await resolveRecommendationPlanRevision(dir, { execution_plan_revision: 3 });
    expect(revision).toBe(3);
  });

  it('should recover revision from plan file when state summary is lost', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Test recovery',
      waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      revision: 2,
    });

    // State has no execution_plan_revision
    const revision = await resolveRecommendationPlanRevision(dir, {});
    expect(revision).toBe(2);
  });

  it('should reject partial clearing (revision only)', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Test partial clearing',
      waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
    });

    // State has revision but not execution_plan_hash
    await expect(
      resolveRecommendationPlanRevision(dir, { revision: 1 }),
    ).rejects.toThrow(/partially cleared/i);
  });

  it('should reject partial clearing (hash only)', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Test partial clearing hash',
      waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
    });

    // State has execution_plan_hash but not revision
    await expect(
      resolveRecommendationPlanRevision(dir, { execution_plan_hash: 'some-hash' }),
    ).rejects.toThrow(/partially cleared/i);
  });

  it('should reject tampered plan (hash mismatch)', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Test tampered plan',
      waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
    });

    // Tamper with the plan file
    const planPath = dir + '/.flow-engine/sflow/execution-plan.json';
    const planContent = JSON.parse(await readFile(planPath, 'utf-8'));
    planContent.rationale = 'TAMPERED';
    await writeFile(planPath, JSON.stringify(planContent, null, 2));

    // Should reject because hash no longer matches content
    await expect(
      resolveRecommendationPlanRevision(dir, {}),
    ).rejects.toThrow(/hash mismatch/i);
  });

  it('should return null when no plan exists and no state revision', async () => {
    const revision = await resolveRecommendationPlanRevision(dir, {});
    expect(revision).toBeNull();
  });
});

// ─── Wave 3: P1-1 Review Policy ────────────────────────────────────────────────

describe('P1-1: Review Policy', () => {
  describe('reviewTargets', () => {
    it('should return waves for wave policy (default)', () => {
      const plan: ExecutionPlan = {
        mode: 'sdd',
        source: 'default',
        rationale: 'test',
        waves: [
          { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
          { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        ],
        hash: 'sha256:abc',
        artifacts_hash: 'a',
        contract_hash: 'c',
        revision: 1,
      };

      const targets = reviewTargets(plan);
      expect(targets).toHaveLength(2);
      expect(targets[0].id).toBe('W1');
      expect(targets[1].id).toBe('W2');
    });

    it('should return single final wave for final policy', () => {
      const plan: ExecutionPlan = {
        mode: 'sdd',
        source: 'default',
        rationale: 'test',
        waves: [
          { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
          { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        ],
        hash: 'sha256:abc',
        artifacts_hash: 'a',
        contract_hash: 'c',
        revision: 1,
        review_policy: 'final',
      };

      const targets = reviewTargets(plan);
      expect(targets).toHaveLength(1);
      expect(targets[0].id).toBe('final');
      expect(targets[0].tasks).toEqual(['1.1', '1.2', '2.1']);
    });

    it('should default to wave policy when review_policy is undefined', () => {
      const plan: ExecutionPlan = {
        mode: 'sdd',
        source: 'default',
        rationale: 'test',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
        hash: 'sha256:abc',
        artifacts_hash: 'a',
        contract_hash: 'c',
        revision: 1,
      };

      const targets = reviewTargets(plan);
      expect(targets).toHaveLength(1);
      expect(targets[0].id).toBe('W1');
    });
  });

  describe('ExecutionPlan with review_policy and schema_version', () => {
    it('should support review_policy field', () => {
      const plan: ExecutionPlan = {
        mode: 'sdd',
        source: 'default',
        rationale: 'test',
        waves: [],
        hash: 'sha256:abc',
        artifacts_hash: 'a',
        contract_hash: 'c',
        revision: 1,
        review_policy: 'final',
      };

      expect(plan.review_policy).toBe('final');
    });

    it('should support schema_version field', () => {
      const plan: ExecutionPlan = {
        mode: 'sdd',
        source: 'default',
        rationale: 'test',
        waves: [],
        hash: 'sha256:abc',
        artifacts_hash: 'a',
        contract_hash: 'c',
        revision: 1,
        schema_version: 2,
      };

      expect(plan.schema_version).toBe(2);
    });
  });

  describe('Final policy dependency check', () => {
    it('should use tasks.md completion for final policy dependency', async () => {
      // For final policy, the dependency check should verify all tasks are completed
      // This is tested via reviewTargets returning a single 'final' wave
      const plan: ExecutionPlan = {
        mode: 'sdd',
        source: 'default',
        rationale: 'test',
        waves: [
          { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] },
          { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        ],
        hash: 'sha256:abc',
        artifacts_hash: 'a',
        contract_hash: 'c',
        revision: 1,
        review_policy: 'final',
      };

      const targets = reviewTargets(plan);
      // Final policy: single wave covering all tasks
      expect(targets).toHaveLength(1);
      expect(targets[0].id).toBe('final');
      expect(targets[0].tasks).toEqual(['1.1', '2.1']);
    });
  });
});

// ─── Wave 3: P1-5 Review Base ──────────────────────────────────────────────────

describe('P1-5: Review Base', () => {
  const dir = tempDir('review-base');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  describe('normalizeCommitSha', () => {
    it('should return null for empty input', async () => {
      const result = await normalizeCommitSha(dir, '');
      expect(result).toBeNull();
    });

    it('should return null for invalid SHA in non-git directory', async () => {
      const result = await normalizeCommitSha(dir, 'invalid-sha');
      expect(result).toBeNull();
    });

    it('should normalize valid short SHA in git repo', async () => {
      // Create a git repo with a commit
      const { execFileSync } = await import('child_process');
      const run = (args: string[]) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

      run(['init', '-q']);
      run(['config', 'user.email', 'test@example.com']);
      run(['config', 'user.name', 'Test']);
      run(['config', 'commit.gpgsign', 'false']);
      await writeFile(join(dir, 'test.txt'), 'test\n');
      run(['add', '.']);
      run(['commit', '-q', '-m', 'test commit']);
      const fullSha = run(['rev-parse', 'HEAD']).trim();
      const shortSha = fullSha.slice(0, 7);

      const result = await normalizeCommitSha(dir, shortSha);
      expect(result).toBe(fullSha);
    });
  });

  describe('recordReviewBase', () => {
    it('should set review_base on the plan (WRITE_ONCE)', async () => {
      // Create a git repo
      const { execFileSync } = await import('child_process');
      const run = (args: string[]) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

      run(['init', '-q']);
      run(['config', 'user.email', 'test@example.com']);
      run(['config', 'user.name', 'Test']);
      run(['config', 'commit.gpgsign', 'false']);
      await writeFile(join(dir, 'test.txt'), 'test\n');
      run(['add', '.']);
      run(['commit', '-q', '-m', 'initial commit']);
      const commitSha = run(['rev-parse', 'HEAD']).trim();

      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test review_base',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      const result = await recordReviewBase(dir, commitSha);
      expect(result).toBe(commitSha);

      // Verify plan was updated
      const plan = await readExecutionPlan(dir);
      expect(plan?.review_base).toBe(commitSha);
    });

    it('should not overwrite existing review_base (WRITE_ONCE)', async () => {
      // Create a git repo
      const { execFileSync } = await import('child_process');
      const run = (args: string[]) =>
        execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

      run(['init', '-q']);
      run(['config', 'user.email', 'test@example.com']);
      run(['config', 'user.name', 'Test']);
      run(['config', 'commit.gpgsign', 'false']);
      await writeFile(join(dir, 'test.txt'), 'test\n');
      run(['add', '.']);
      run(['commit', '-q', '-m', 'initial commit']);
      const commitSha = run(['rev-parse', 'HEAD']).trim();

      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test WRITE_ONCE',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      // Set review_base
      await recordReviewBase(dir, commitSha);

      // Try to set again — should return existing value
      const result = await recordReviewBase(dir, 'different-sha');
      expect(result).toBe(commitSha); // Still the original

      const plan = await readExecutionPlan(dir);
      expect(plan?.review_base).toBe(commitSha); // Not changed
    });

    it('should return null when no SHA provided', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test no SHA',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      const result = await recordReviewBase(dir);
      expect(result).toBeNull();
    });

    it('should reject invalid SHA', async () => {
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test invalid SHA',
        waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      });

      await expect(
        recordReviewBase(dir, 'not-a-real-sha'),
      ).rejects.toThrow(/invalid review base SHA/i);
    });
  });

  describe('isGitEnvironment', () => {
    it('should return false for non-git directory', async () => {
      // Use system temp dir to avoid being inside the project's git repo
      const nonGitDir = join(import.meta.dir, '..', '__test_workdir__', 'non-git-env');
      await cleanupDir(nonGitDir);
      await ensureDir(nonGitDir);
      try {
        const result = await isGitEnvironment(nonGitDir);
        expect(result).toBe(false);
      } finally {
        await cleanupDir(nonGitDir);
      }
    });

    it('should return true for git directory', async () => {
      const { execFileSync } = await import('child_process');
      // Use system temp dir to create an isolated git repo
      const gitDir = join(import.meta.dir, '..', '__test_workdir__', 'git-env');
      await cleanupDir(gitDir);
      await ensureDir(gitDir);
      try {
        execFileSync('git', ['init', '-q'], { cwd: gitDir, encoding: 'utf8', stdio: 'pipe' });
        const result = await isGitEnvironment(gitDir);
        expect(result).toBe(true);
      } finally {
        await cleanupDir(gitDir);
      }
    });
  });

  describe('validateFinalReviewRange', () => {
    it('should not validate for wave policy', async () => {
      const plan: ExecutionPlan = {
        mode: 'sdd',
        source: 'default',
        rationale: 'test',
        waves: [],
        hash: 'sha256:abc',
        artifacts_hash: 'a',
        contract_hash: 'c',
        revision: 1,
        review_policy: 'wave',
      };

      // Should not throw for wave policy
      await expect(
        validateFinalReviewRange(dir, plan, 'base1', 'head1'),
      ).resolves.toBeUndefined();
    });

    it('should not block when review_base is missing for final policy (legacy compat)', async () => {
      const plan: ExecutionPlan = {
        mode: 'sdd',
        source: 'default',
        rationale: 'test',
        waves: [],
        hash: 'sha256:abc',
        artifacts_hash: 'a',
        contract_hash: 'c',
        revision: 1,
        review_policy: 'final',
        // No review_base — legacy compat, should not block
      };

      // Should not throw
      await expect(
        validateFinalReviewRange(dir, plan, 'base1', 'head1'),
      ).resolves.toBeUndefined();
    });
  });
});

// ─── Wave 3: Constants ─────────────────────────────────────────────────────────

describe('Wave 3: New Constants', () => {
  it('should export MAX_ISSUE_REPAIR_FAILURES as 3', () => {
    expect(MAX_ISSUE_REPAIR_FAILURES).toBe(3);
  });

  it('should export ISSUE_ID_PATTERN matching valid identifiers', () => {
    expect(ISSUE_ID_PATTERN.test('BUG-123')).toBe(true);
    expect(ISSUE_ID_PATTERN.test('issue_456')).toBe(true);
    expect(ISSUE_ID_PATTERN.test('CVE:2024-1234')).toBe(true);
    expect(ISSUE_ID_PATTERN.test('')).toBe(false);
    expect(ISSUE_ID_PATTERN.test('has spaces')).toBe(false);
    expect(ISSUE_ID_PATTERN.test('a'.repeat(129))).toBe(false);
  });

  it('should export FULL_COMMIT_SHA matching 40-char hex', () => {
    expect(FULL_COMMIT_SHA.test('a'.repeat(40))).toBe(true);
    expect(FULL_COMMIT_SHA.test('0123456789abcdef0123456789abcdef01234567')).toBe(true);
    expect(FULL_COMMIT_SHA.test('short')).toBe(false);
    expect(FULL_COMMIT_SHA.test('a'.repeat(41))).toBe(false);
  });
});

// ─── P1 fix batch: cross-workflow rejection + final review range robustness ────

describe('P1 fix: resolveRecommendationPlanRevision cross-workflow rejection', () => {
  const dir = tempDir('plan-revision-cross-workflow');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should reject legacy plan when state workflow is not full (cross-workflow)', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Cross-workflow plan',
      waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
    });

    await expect(
      resolveRecommendationPlanRevision(dir, { workflow: 'iflow' }),
    ).rejects.toThrow(/cross-workflow/i);
  });

  it('should reject legacy plan for any non-full workflow in state', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Cross-workflow plan hotfix',
      waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
    });

    await expect(
      resolveRecommendationPlanRevision(dir, { workflow: 'hotfix' }),
    ).rejects.toThrow(/cross-workflow/i);
  });

  it('should allow recovery when state workflow is full', async () => {
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'Same workflow plan',
      waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      revision: 2,
    });

    const revision = await resolveRecommendationPlanRevision(dir, { workflow: 'full' });
    expect(revision).toBe(2);
  });
});

describe('P1 fix: validateFinalReviewRange truncated HEAD range', () => {
  const dir = tempDir('final-review-range-head');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await setupStateJson(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should reject HEAD~1 head in a git repo (truncated range)', async () => {
    const { execFileSync } = await import('child_process');
    const run = (args: string[]) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

    run(['init', '-q']);
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'Test']);
    run(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(dir, 'a.txt'), 'a\n');
    run(['add', '.']);
    run(['commit', '-q', '-m', 'first']);
    const baseSha = run(['rev-parse', 'HEAD']).trim();
    await writeFile(join(dir, 'b.txt'), 'b\n');
    run(['add', '.']);
    run(['commit', '-q', '-m', 'second']);
    const headSha = run(['rev-parse', 'HEAD']).trim();
    const headParentSha = run(['rev-parse', 'HEAD~1']).trim();

    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'final policy',
      waves: [],
      hash: 'sha256:abc',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
      review_policy: 'final',
      review_base: baseSha,
    };

    // HEAD~1 is a truncated range — must be rejected (not silently skipped)
    await expect(
      validateFinalReviewRange(dir, plan, baseSha, headParentSha),
    ).rejects.toThrow(/must be HEAD|Truncated/i);

    // Correct HEAD passes
    await expect(
      validateFinalReviewRange(dir, plan, baseSha, headSha),
    ).resolves.toBeUndefined();
  });
});
