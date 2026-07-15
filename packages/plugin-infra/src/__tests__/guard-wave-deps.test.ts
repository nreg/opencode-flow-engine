/**
 * Guard hook tests — Wave W4: checkWaveDependencies and topological sort
 *
 * TDD RED phase: All tests should FAIL until implementation is written.
 * Covers: checkWaveDependencies (valid chain, circular deps, missing ref, empty wave),
 *         topologicalSort (linear deps, cycle detection)
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createGuardHook } from '../hooks/guard.js';
import { readExecutionPlan, createExecutionPlan, recordReviewReceipt } from '../features/execution-plan.js';
import type { Wave, ExecutionPlan, ReviewReceipt } from '../features/execution-plan-types.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function tempDir(name: string): string {
  // Use a path OUTSIDE the git repo so git rev-parse --git-dir fails
  // (receipt integrity guard skips commit validation in non-git dirs)
  return join('C:', 'Users', 'admin', 'AppData', 'Local', 'Temp', 'opencode', 'guard-wave-deps-test', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeStateFile(dir: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.sflow');
  await writeFile(dir + '/.sflow/state.json', JSON.stringify(data, null, 2));
}

async function writeFileContent(filePath: string, content: string): Promise<void> {
  const parts = filePath.replace(/\\/g, '/').split('/');
  parts.pop(); // remove filename
  const dir = parts.join('/');
  await ensureDir(dir);
  await writeFile(filePath, content);
}

/** Write execution-plan.json directly to disk (for guard testing without going through createExecutionPlan) */
async function writeExecutionPlan(dir: string, plan: ExecutionPlan): Promise<void> {
  await ensureDir(dir + '/.sflow');
  await writeFile(dir + '/.sflow/execution-plan.json', JSON.stringify(plan, null, 2));
}

const validReceipt: ReviewReceipt = {
  status: 'pass',
  base: 'abc123def456',
  head: 'def789abc012',
  report: 'All tests pass.',
  recorded_at: new Date().toISOString(),
};

/** Write receipts for all waves in the plan (so checkReceiptIntegrity passes) */
async function writeReceiptsForPlan(dir: string, plan: ExecutionPlan): Promise<void> {
  await ensureDir(dir + '/.sflow/reviews');
  for (const wave of plan.waves) {
    await writeFile(dir + '/.sflow/reviews/' + wave.id + '.json', JSON.stringify(validReceipt, null, 2));
  }
}

// ─── checkWaveDependencies tests ──────────────────────────────────────────────

describe('checkWaveDependencies', () => {
  const dir = tempDir('guard-wave-deps');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should pass for valid W1→W2→W3 dependency chain', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'Test',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        { id: 'W3', strategy: 'serial', tasks: ['3.1'], depends_on: ['W2'] },
      ],
      hash: 'test-hash',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeExecutionPlan(dir, plan);
    await writeReceiptsForPlan(dir, plan);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should block on circular W1↔W2 dependency', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'Circular test',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: ['W2'] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
      ],
      hash: 'test-hash',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeExecutionPlan(dir, plan);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/circular/i);
  });

  it('should block on missing wave reference W99 in depends_on', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'Missing ref test',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: ['W99'] },
      ],
      hash: 'test-hash',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeExecutionPlan(dir, plan);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/missing|non-existent|reference/i);
  });

  it('should block on empty wave (no tasks)', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'Empty wave test',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: [], depends_on: [] },
      ],
      hash: 'test-hash',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeExecutionPlan(dir, plan);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/empty/i);
  });

  it('should skip when no execution plan exists (backward compatible)', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    // No execution-plan.json written

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    // Should not block — backward compatible
    expect(result.block).toBeUndefined();
  });

  it('should skip for non-sflow workflow', async () => {
    // No .sflow/ directory — no sflow workflow detected
    await ensureDir(dir + '/.iflow');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should pass for waves with no dependencies', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'No deps test',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] },
        { id: 'W2', strategy: 'parallel', tasks: ['2.1'], depends_on: [] },
      ],
      hash: 'test-hash',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeExecutionPlan(dir, plan);
    await writeReceiptsForPlan(dir, plan);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should detect 3-node cycle W1→W2→W3→W1', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: '3-node cycle test',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: ['W3'] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        { id: 'W3', strategy: 'serial', tasks: ['3.1'], depends_on: ['W2'] },
      ],
      hash: 'test-hash',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeExecutionPlan(dir, plan);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/circular/i);
  });
});

// ─── topologicalSort tests ────────────────────────────────────────────────────

describe('topologicalSort for cycle detection', () => {
  const dir = tempDir('guard-topo-sort');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should pass for linear dependency W1→W2→W3 (topological order)', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'Topo sort linear',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        { id: 'W3', strategy: 'serial', tasks: ['3.1'], depends_on: ['W2'] },
      ],
      hash: 'test-hash',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeExecutionPlan(dir, plan);
    await writeReceiptsForPlan(dir, plan);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should pass for diamond dependency pattern W1→W2, W1→W3, W2→W4, W3→W4', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'Diamond deps',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        { id: 'W3', strategy: 'serial', tasks: ['3.1'], depends_on: ['W1'] },
        { id: 'W4', strategy: 'serial', tasks: ['4.1'], depends_on: ['W2', 'W3'] },
      ],
      hash: 'test-hash',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeExecutionPlan(dir, plan);
    await writeReceiptsForPlan(dir, plan);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should block on self-referencing wave W1→W1', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'Self-ref cycle',
      waves: [
        { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: ['W1'] },
      ],
      hash: 'test-hash',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeExecutionPlan(dir, plan);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/circular/i);
  });
});
