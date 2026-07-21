/**
 * Guard hook tests — Wave W5: checkClosingGate, extended checkTaskCompletion,
 * checkSpecsMerged, and BUG-B fix (readStateFile ghost state)
 *
 * TDD RED phase: All tests should FAIL until implementation is written.
 * Covers:
 *   - checkClosingGate: all receipts pass, fail receipt, missing receipt, skip without plan
 *   - Extended checkTaskCompletion: wave completion alongside task checkbox check
 *   - BUG-B: readStateFile throws on missing state.json with .flow-engine/sflow/ dir
 *   - checkSpecsMerged: blocks when spec_merged=false, allows when true, skips when no delta-specs
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createGuardHook } from '../hooks/guard.js';
import { createWorkflowManager } from '../features/workflow-manager.js';
import type { ExecutionPlan, ReviewReceipt } from '../features/execution-plan-types.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function tempDir(name: string): string {
  // Use a path OUTSIDE the git repo so git rev-parse --git-dir fails
  return join('C:', 'Users', 'admin', 'AppData', 'Local', 'Temp', 'opencode', 'guard-closing-test', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeStateFile(dir: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow');
  await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify(data, null, 2));
}

async function writeExecutionPlan(dir: string, plan: ExecutionPlan): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow');
  await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify(plan, null, 2));
}

async function writeReceipt(dir: string, waveId: string, receipt: ReviewReceipt): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow/reviews');
  await writeFile(dir + '/.flow-engine/sflow/reviews/' + waveId + '.json', JSON.stringify(receipt, null, 2));
}

async function writeTasksMd(dir: string, content: string): Promise<void> {
  await writeFile(dir + '/tasks.md', content);
}

const samplePlan: ExecutionPlan = {
  mode: 'sdd',
  source: 'default',
  rationale: 'Closing gate test',
  waves: [
    { id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] },
    { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
  ],
  hash: 'test-hash',
  artifacts_hash: 'a',
  contract_hash: 'c',
  revision: 1,
};

const passReceipt: ReviewReceipt = {
  status: 'pass',
  base: 'abc123def456',
  head: 'def789abc012',
  report: 'All tests pass. Code quality verified.',
  recorded_at: new Date().toISOString(),
};

const failReceipt: ReviewReceipt = {
  status: 'fail',
  base: 'abc123def456',
  head: 'def789abc012',
  report: 'Some tests failed.',
  recorded_at: new Date().toISOString(),
};

// ─── checkClosingGate tests ──────────────────────────────────────────────────

describe('checkClosingGate', () => {
  const dir = tempDir('closing-gate');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should allow closing when all receipts have status=pass', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', passReceipt);
    await writeReceipt(dir, 'W2', passReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
    // Should not be blocked by closing gate
    expect(result.blockReason || '').not.toMatch(/closing gate|receipt.*fail|receipt.*missing/i);
  });

  it('should block closing when a receipt has status=fail', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', passReceipt);
    await writeReceipt(dir, 'W2', failReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason || '').toMatch(/closing|fail|receipt/i);
  });

  it('should block closing when a receipt is missing for a wave', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', passReceipt);
    // W2 receipt is missing

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason || '').toMatch(/closing|missing|receipt/i);
  });

  it('should skip closing gate check when no execution plan exists (backward compatible)', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full' });
    // No execution plan
    await writeTasksMd(dir, '- [x] Task 1\n- [x] Task 2\n');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    // Should not be blocked by closing gate (no plan → skip)
    expect(result.blockReason || '').not.toMatch(/closing gate/i);
  });

  it('should skip for non-sflow workflow', async () => {
    await ensureDir(dir + '/.iflow');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });
});

// ─── Extended checkTaskCompletion — wave completion ───────────────────────────

describe('Extended checkTaskCompletion — wave completion', () => {
  const dir = tempDir('task-completion-wave');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block closing when tasks.md is complete but waves lack receipts', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);
    // tasks.md all complete
    await writeTasksMd(dir, '- [x] Task 1\n- [x] Task 2\n');
    // No receipts for any wave

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason || '').toMatch(/wave|receipt|completion/i);
  });

  it('should allow closing when tasks.md complete and all waves have pass receipts', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);
    await writeTasksMd(dir, '- [x] Task 1\n- [x] Task 2\n');
    await writeReceipt(dir, 'W1', passReceipt);
    await writeReceipt(dir, 'W2', passReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should block closing when tasks.md has incomplete tasks', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full' });
    await writeExecutionPlan(dir, samplePlan);
    await writeTasksMd(dir, '- [x] Task 1\n- [ ] Task 2\n');
    await writeReceipt(dir, 'W1', passReceipt);
    await writeReceipt(dir, 'W2', passReceipt);

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason || '').toMatch(/incomplete|task/i);
  });
});

// ─── BUG-B: readStateFile ghost state fix ─────────────────────────────────────

describe('BUG-B: readStateFile ghost state', () => {
  const dir = tempDir('bug-b-ghost-state');
  let wm: ReturnType<typeof createWorkflowManager>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    wm = createWorkflowManager();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should throw when state.json is missing but .flow-engine/sflow/ directory exists', async () => {
    // .flow-engine/sflow/ directory exists (indicating active workflow)
    await ensureDir(dir + '/.flow-engine/sflow');
    // No state.json file

    const result = await wm.getState(dir);
    // The workflow manager catches the error, so we check for failure
    expect(result.success).toBe(false);
    expect(result.error || '').toMatch(/state\.json|missing|not found/i);
  });

  it('should return default state when .flow-engine/sflow/ directory does not exist', async () => {
    // No .flow-engine/sflow/ directory at all — backward compatible

    const result = await wm.getState(dir);
    // Should succeed with default state (backward compatible)
    expect(result.success).toBe(true);
  });
});

// ─── checkSpecsMerged tests ───────────────────────────────────────────────────

describe('checkSpecsMerged', () => {
  const dir = tempDir('specs-merged');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block closing when spec_merged is not true and delta-specs exists', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full', spec_merged: false });
    await ensureDir(dir + '/specs/delta');
    // Create a delta spec file to make the directory non-empty
    await writeFile(dir + '/specs/delta/feature-a.md', '# Delta Spec\n');
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', passReceipt);
    await writeReceipt(dir, 'W2', passReceipt);
    await writeTasksMd(dir, '- [x] Task 1\n');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason || '').toMatch(/spec.*merged|delta/i);
  });

  it('should allow closing when spec_merged is true', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full', spec_merged: true });
    await ensureDir(dir + '/specs/delta');
    await writeFile(dir + '/specs/delta/feature-a.md', '# Delta Spec\n');
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', passReceipt);
    await writeReceipt(dir, 'W2', passReceipt);
    await writeTasksMd(dir, '- [x] Task 1\n');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should skip when no delta-specs directory exists (backward compatible)', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full' });
    // No specs/delta/ directory
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', passReceipt);
    await writeReceipt(dir, 'W2', passReceipt);
    await writeTasksMd(dir, '- [x] Task 1\n');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should block closing when spec_merged is missing (undefined) and delta-specs exists', async () => {
    // spec_merged field not present in state.json
    await writeStateFile(dir, { state: 'closing', mode: 'full' });
    await ensureDir(dir + '/specs/delta');
    await writeFile(dir + '/specs/delta/feature-a.md', '# Delta Spec\n');
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', passReceipt);
    await writeReceipt(dir, 'W2', passReceipt);
    await writeTasksMd(dir, '- [x] Task 1\n');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason || '').toMatch(/spec.*merged|delta/i);
  });

  it('should skip for non-sflow workflow', async () => {
    await ensureDir(dir + '/.iflow');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });
});

// ─── Integration: executing → closing with all checks ─────────────────────────

describe('Integration: full closing gate flow', () => {
  const dir = tempDir('closing-integration');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should allow closing when all conditions are met', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full', spec_merged: true });
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', passReceipt);
    await writeReceipt(dir, 'W2', passReceipt);
    await writeTasksMd(dir, '- [x] Task 1\n- [x] Task 2\n');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should block closing when receipts pass but spec_merged is false with delta-specs', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full', spec_merged: false });
    await writeExecutionPlan(dir, samplePlan);
    await writeReceipt(dir, 'W1', passReceipt);
    await writeReceipt(dir, 'W2', passReceipt);
    await writeTasksMd(dir, '- [x] Task 1\n- [x] Task 2\n');
    await ensureDir(dir + '/specs/delta');
    await writeFile(dir + '/specs/delta/feature-a.md', '# Delta Spec\n');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason || '').toMatch(/spec.*merged|delta/i);
  });
});
