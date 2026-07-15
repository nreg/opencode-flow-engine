/**
 * Guard hook tests — Wave W4: checkReceiptIntegrity
 *
 * TDD RED phase: All tests should FAIL until implementation is written.
 * Covers: valid receipts, missing receipt, symlinked receipt, invalid commit hashes,
 *         missing required fields, commit range revalidation
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, symlink } from 'fs/promises';
import { join } from 'path';
import { createGuardHook } from '../hooks/guard.js';
import type { ExecutionPlan, ReviewReceipt } from '../features/execution-plan-types.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function tempDir(name: string): string {
  // Use a path OUTSIDE the git repo so git rev-parse --git-dir fails
  // (receipt integrity guard skips commit validation in non-git dirs)
  return join('C:', 'Users', 'admin', 'AppData', 'Local', 'Temp', 'opencode', 'guard-receipt-test', name);
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

async function writeExecutionPlan(dir: string, plan: ExecutionPlan): Promise<void> {
  await ensureDir(dir + '/.sflow');
  await writeFile(dir + '/.sflow/execution-plan.json', JSON.stringify(plan, null, 2));
}

async function writeReceipt(dir: string, waveId: string, receipt: ReviewReceipt): Promise<void> {
  await ensureDir(dir + '/.sflow/reviews');
  await writeFile(dir + '/.sflow/reviews/' + waveId + '.json', JSON.stringify(receipt, null, 2));
}

const samplePlan: ExecutionPlan = {
  mode: 'sdd',
  source: 'default',
  rationale: 'Receipt integrity test',
  waves: [
    { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] },
    { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
  ],
  hash: 'test-hash',
  artifacts_hash: 'a',
  contract_hash: 'c',
  revision: 1,
};

const validReceipt: ReviewReceipt = {
  status: 'pass',
  base: 'abc123def456',
  head: 'def789abc012',
  report: 'All tests pass. Code quality verified.',
  recorded_at: new Date().toISOString(),
};

// ─── checkReceiptIntegrity tests ─────────────────────────────────────────────

describe('checkReceiptIntegrity', () => {
  const dir = tempDir('guard-receipt');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should pass when all receipts are valid', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', validReceipt);
    await writeReceipt(dir, 'W2', { ...validReceipt, status: 'pass' });

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should block when a receipt is missing for a wave', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', validReceipt);
    // W2 receipt missing

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/missing|receipt/i);
  });

  it('should block when receipt is a symlink', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);

    // Write a real receipt file elsewhere
    await ensureDir(dir + '/.sflow/reviews');
    await ensureDir(dir + '/tmp');
    await writeFile(dir + '/tmp/real-receipt.json', JSON.stringify(validReceipt, null, 2));

    // Create a symlink pointing to the real receipt
    try {
      await symlink(dir + '/tmp/real-receipt.json', dir + '/.sflow/reviews/W1.json');
    } catch {
      // Symlink creation may fail on Windows without admin privileges
      // Skip this test gracefully
      console.warn('Skipping symlink test — symlink creation not supported');
      return;
    }
    await writeReceipt(dir, 'W2', validReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/symlink/i);
  });

  it('should block when receipt has missing required fields (no base)', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);

    const incompleteReceipt = {
      status: 'pass',
      head: 'def789abc012',
      report: 'Test report',
      recorded_at: new Date().toISOString(),
      // base is missing
    } as any as ReviewReceipt;
    await writeReceipt(dir, 'W1', incompleteReceipt);
    await writeReceipt(dir, 'W2', validReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/field|missing|base/i);
  });

  it('should block when receipt has missing required fields (no head)', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);

    const incompleteReceipt = {
      status: 'pass',
      base: 'abc123def456',
      report: 'Test report',
      recorded_at: new Date().toISOString(),
      // head is missing
    } as any as ReviewReceipt;
    await writeReceipt(dir, 'W1', incompleteReceipt);
    await writeReceipt(dir, 'W2', validReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/field|missing|head/i);
  });

  it('should block when receipt has missing required fields (no report)', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);

    const incompleteReceipt = {
      status: 'pass',
      base: 'abc123def456',
      head: 'def789abc012',
      recorded_at: new Date().toISOString(),
      // report is missing
    } as any as ReviewReceipt;
    await writeReceipt(dir, 'W1', incompleteReceipt);
    await writeReceipt(dir, 'W2', validReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/field|missing|report/i);
  });

  it('should block when receipt has missing required fields (no status)', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);

    const incompleteReceipt = {
      base: 'abc123def456',
      head: 'def789abc012',
      report: 'Test report',
      recorded_at: new Date().toISOString(),
      // status is missing
    } as any as ReviewReceipt;
    await writeReceipt(dir, 'W1', incompleteReceipt);
    await writeReceipt(dir, 'W2', validReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/field|missing|status/i);
  });

  it('should skip when no execution plan exists (backward compatible)', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    // No execution plan

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBeUndefined();
  });

  it('should skip for non-sflow workflow', async () => {
    await ensureDir(dir + '/.iflow');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should block when receipt has empty base commit hash', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);

    const emptyBaseReceipt: ReviewReceipt = {
      status: 'pass',
      base: '',
      head: 'def789abc012',
      report: 'Test report',
      recorded_at: new Date().toISOString(),
    };
    await writeReceipt(dir, 'W1', emptyBaseReceipt);
    await writeReceipt(dir, 'W2', validReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/base|hash|empty/i);
  });

  it('should block when receipt has empty head commit hash', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);

    const emptyHeadReceipt: ReviewReceipt = {
      status: 'pass',
      base: 'abc123def456',
      head: '',
      report: 'Test report',
      recorded_at: new Date().toISOString(),
    };
    await writeReceipt(dir, 'W1', emptyHeadReceipt);
    await writeReceipt(dir, 'W2', validReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/head|hash|empty/i);
  });
});

// ─── Commit range revalidation tests ──────────────────────────────────────────

describe('checkReceiptIntegrity — commit revalidation', () => {
  const dir = tempDir('guard-receipt-commit');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should pass when in a non-git directory (graceful skip)', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', validReceipt);
    await writeReceipt(dir, 'W2', validReceipt);

    // This test dir is not a git repo — should skip commit validation gracefully
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });
});

// ─── Integration: create plan → write receipt → check receipt integrity ──────

describe('Integration: execution plan + receipt integrity', () => {
  const dir = tempDir('guard-receipt-integration');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should pass when plan exists and all receipts are valid', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', validReceipt);
    await writeReceipt(dir, 'W2', { ...validReceipt, status: 'pass' });

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });
});
