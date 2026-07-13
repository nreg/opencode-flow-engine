/**
 * Guard hook tests — preset upgrade, phase consistency, debugging gate
 */
import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createGuardHook } from '../hooks/guard.js';
import * as shared from '@opencode-flow-engine/shared';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
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

describe('Guard Hook — Preset Upgrade Detection', () => {
  const dir = tempDir('guard-preset-upgrade');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should not block full workflow', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should block hotfix with too many tasks', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'hotfix' });
    // Write tasks.md with 3 tasks (exceeds hotfix MAX_TASKS=2)
    await writeFileContent(dir + '/tasks.md', '- [ ] task one\n- [ ] task two\n- [ ] task three');
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Preset upgrade');
  });

  it('should not block exploring state without artifacts', async () => {
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should block tweak with too many tasks', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'tweak' });
    await writeFileContent(dir + '/tasks.md', '- [ ] t1\n- [ ] t2\n- [ ] t3\n- [ ] t4\n- [ ] t5');
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Preset upgrade');
  });

  it('should detect schema change in hotfix and trigger upgrade', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'hotfix' });
    await writeFileContent(dir + '/tasks.md', '- [ ] alter table users add column email text');
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('schema');
  });

  it('should not block when no tasks.md exists', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'hotfix' });
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should return upgrade signal data (C1 read-only)', async () => {
    await writeStateFile(dir, { state: 'executing', mode: 'hotfix' });
    await writeFileContent(dir + '/proposal.md', '# Test Proposal\n\n## Why\nSome motivation description for the test to pass the guard.');
    await writeFileContent(dir + '/design.md', '# Design\n\n## Architecture\nSome arch design.');
    await ensureDir(dir + '/specs');
    await writeFileContent(dir + '/specs/test.md', '# Test Spec\n\n## Purpose\nTest spec.');
    await writeFileContent(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nHotfix scope.\n\n## Task Batches\n- [ ] task one\n- [ ] task two\n- [ ] task three');
    await writeFileContent(dir + '/tasks.md', '- [ ] task one\n- [ ] task two\n- [ ] task three');
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toMatch(/Preset upgrade|upgrade/i);
  });
});


// ─── IFlow guard skip tests (Batch 3 — P2 Architecture Fix) ──────────────────

describe('Guard Hook — IFlow mode skips SFlow guards', () => {
  const dir = tempDir('guard-iflow-skip');
  let guard: ReturnType<typeof createGuardHook>;

  async function writeIFlowDir(d: string): Promise<void> {
    await ensureDir(d + '/.iflow');
  }

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should skip checkArtifactAndPhaseConsistency when .iflow/ exists (no .sflow/)', async () => {
    // IFlow mode: .iflow/ exists, no .sflow/ — should not block even without SFlow artifacts
    await writeIFlowDir(dir);

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
    });

    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should skip checkPresetUpgrade when .iflow/ exists', async () => {
    // IFlow mode with tasks.md that would trigger hotfix upgrade in SFlow
    await writeIFlowDir(dir);
    await writeFileContent(dir + '/tasks.md', '- [ ] t1\n- [ ] t2\n- [ ] t3');

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
    });

    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should skip checkDebuggingState when .iflow/ exists', async () => {
    // IFlow mode — no debugging state concept, should not block
    await writeIFlowDir(dir);

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'tool:write',
    });

    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('should skip checkFileWriteGuard SFlow rules when .iflow/ exists', async () => {
    // IFlow mode — SFlow write guards should not apply
    await writeIFlowDir(dir);

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'tool:write',
      data: {
        toolName: 'write',
        filePath: 'src/feature.ts',
        agent: 'iflow-plan-executor',
      },
    });

    expect(result.success).toBe(true);
  });

  it('should skip checkContractStalenessGuard when .iflow/ exists', async () => {
    // IFlow mode — no SFlow contract staleness concept
    await writeIFlowDir(dir);

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
    });

    expect(result.success).toBe(true);
  });

  it('should skip checkTaskCompletion when .iflow/ exists', async () => {
    // IFlow mode with incomplete tasks.md — should not block
    await writeIFlowDir(dir);
    await writeFileContent(dir + '/tasks.md', '- [ ] incomplete task');

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
    });

    expect(result.success).toBe(true);
  });

  it('should maintain backward compatibility — SFlow still works without .iflow/', async () => {
    // No .iflow/ directory — SFlow guards should still function normally
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'tool:read',
      data: { toolName: 'read', filePath: 'src/test.ts' },
    });

    expect(result.success).toBe(true);
  });
});

describe('Guard Hook — Debugging State', () => {
  const dir = tempDir('guard-debugging');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block non-debugging actions in debugging state', async () => {
    await writeStateFile(dir, { state: 'debugging', mode: 'full' });
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'tool:write' });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('debugging state');
  });

  it('should allow bug-investigator actions in debugging state', async () => {
    await writeStateFile(dir, { state: 'debugging', mode: 'full' });
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'bug-investigator:investigate' });
    expect(result.block).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('should allow build-executor in debugging state (for fix verification)', async () => {
    await writeStateFile(dir, { state: 'debugging', mode: 'full' });
    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'build-executor:verify' });
    expect(result.block).toBeUndefined();
    expect(result.success).toBe(true);
  });
});

// ─── P0: detectActiveWorkflow single-call optimization ───────────────────────

describe('Guard Hook — detectActiveWorkflow single-call optimization', () => {
  const dir = tempDir('guard-detect-single-call');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should call directoryExists only 2 times (once for .iflow, once for .sflow) in SFlow mode', async () => {
    // SFlow mode: .sflow/ exists, no .iflow/
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });

    let directoryExistsCallCount = 0;
    const originalDirectoryExists = shared.directoryExists;
    const spy = spyOn(shared, 'directoryExists').mockImplementation(async (path: string) => {
      directoryExistsCallCount++;
      return originalDirectoryExists(path);
    });

    try {
      await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });

      // After optimization: detectActiveWorkflow called once at entry,
      // which calls directoryExists at most 2 times (.iflow + .sflow)
      expect(directoryExistsCallCount).toBeLessThanOrEqual(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('should call directoryExists only 1 time in IFlow mode (.iflow/ exists, short-circuit)', async () => {
    // IFlow mode: .iflow/ exists — detectActiveWorkflow returns 'iflow' after first check
    await ensureDir(dir + '/.iflow');

    let directoryExistsCallCount = 0;
    const originalDirectoryExists = shared.directoryExists;
    const spy = spyOn(shared, 'directoryExists').mockImplementation(async (path: string) => {
      directoryExistsCallCount++;
      return originalDirectoryExists(path);
    });

    try {
      await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });

      // IFlow short-circuit: only 1 directoryExists call for .iflow/
      expect(directoryExistsCallCount).toBeLessThanOrEqual(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('should maintain SFlow behavior after optimization — full workflow still works', async () => {
    // Verify no regression: SFlow full workflow still passes guards
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    await writeFileContent(dir + '/proposal.md', '# Proposal\n\n## Why\nMotivation.');
    await writeFileContent(dir + '/design.md', '# Design\n\n## Architecture\nArch.');
    await ensureDir(dir + '/specs');
    await writeFileContent(dir + '/specs/test.md', '# Spec');
    await writeFileContent(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nFull scope.');
    await writeFileContent(dir + '/tasks.md', '- [x] done task');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
  });

  it('should maintain IFlow skip behavior after optimization', async () => {
    // IFlow mode: all SFlow guards should still be skipped
    await ensureDir(dir + '/.iflow');

    const result = await guard.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'check' });
    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });
});
