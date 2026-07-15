/**
 * Tests for execution-plan.ts — Wave W2
 *
 * TDD RED phase: All tests should FAIL until implementation is written.
 * Covers: createExecutionPlan, readExecutionPlan, validatePlanHashes,
 *         reviseExecutionPlan, computeContentHash, recommendExecutionMode
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import {
  createExecutionPlan,
  readExecutionPlan,
  validatePlanHashes,
  reviseExecutionPlan,
  computeContentHash,
  recommendExecutionMode,
} from './execution-plan.js';
import type { ExecutionPlan, Wave } from './execution-plan-types.js';

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
  await ensureDir(dir + '/.sflow');
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
  await writeFile(dir + '/.sflow/state.json', JSON.stringify(state, null, 2));
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

  it('should create .sflow/execution-plan.json with all required fields', async () => {
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

  it('should write the plan to .sflow/execution-plan.json on disk', async () => {
    await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Simple task',
      waves: inlineWaves,
    });

    const content = await readFile(dir + '/.sflow/execution-plan.json', 'utf-8');
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

    // Hash should be a non-empty hex string
    expect(plan.hash).toMatch(/^[a-f0-9]+$/);
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

    const stateContent = await readFile(dir + '/.sflow/state.json', 'utf-8');
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
    expect(hash).toMatch(/^[a-f0-9]+$/);
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
