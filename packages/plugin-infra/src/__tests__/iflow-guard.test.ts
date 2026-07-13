/**
 * IFlow Guard tests — scope reduction, artifact completeness, cyclic transitions
 * Also tests data missing warning behavior (Task 1.5)
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { checkIFlowGuards, iflowDirectoryExists } from '../hooks/iflow-guard.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeIFlowState(dir: string, state: string): Promise<void> {
  await ensureDir(dir + '/.iflow');
  await writeFile(dir + '/.iflow/state.json', JSON.stringify({ state, updatedAt: new Date().toISOString() }, null, 2));
}

async function writeIFlowArtifact(dir: string, name: string, content: string): Promise<void> {
  await ensureDir(dir + '/.iflow');
  await writeFile(dir + '/.iflow/' + name, content);
}

// ─── iflowDirectoryExists ────────────────────────────────────────────────────

describe('iflowDirectoryExists', () => {
  const dir = tempDir('iflow-dir-exists');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return true when .iflow/ directory exists', async () => {
    await ensureDir(dir + '/.iflow');
    const result = await iflowDirectoryExists(dir);
    expect(result).toBe(true);
  });

  it('should return false when .iflow/ directory does not exist', async () => {
    const result = await iflowDirectoryExists(dir);
    expect(result).toBe(false);
  });
});

// ─── checkIFlowGuards — data missing warnings (Task 1.5) ────────────────────

describe('checkIFlowGuards — data missing warning behavior', () => {
  const dir = tempDir('iflow-data-warning');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return success when data is undefined (no crash)', async () => {
    const result = await checkIFlowGuards(dir, undefined);
    expect(result.success).toBe(true);
  });

  it('should warn when data exists but toolName is missing for write operation', async () => {
    // This tests Task 1.5: when data exists but lacks toolName,
    // a warning should be logged instead of silently skipping
    const warnSpy = spyOn(console, 'warn');

    // data with no toolName — scope reduction guard should warn and skip
    const result = await checkIFlowGuards(dir, { filePath: 'some/PLAN.md' });
    expect(result.success).toBe(true);

    warnSpy.mockRestore();
  });

  it('should warn when data exists but filePath is missing for scope reduction check', async () => {
    const warnSpy = spyOn(console, 'warn');

    // data with toolName=write but no filePath — scope reduction guard should warn
    const result = await checkIFlowGuards(dir, { toolName: 'write' });
    expect(result.success).toBe(true);

    warnSpy.mockRestore();
  });

  it('should warn when data exists but targetState is missing for artifact completeness check', async () => {
    const warnSpy = spyOn(console, 'warn');

    // data without targetState — artifact completeness guard should warn
    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);

    warnSpy.mockRestore();
  });

  it('should warn when data exists but currentState/targetState missing for cyclic transition check', async () => {
    const warnSpy = spyOn(console, 'warn');

    // data without currentState or targetState — cyclic transition guard should warn
    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);

    warnSpy.mockRestore();
  });
});

// ─── checkIFlowGuards — scope reduction (existing behavior) ─────────────────

describe('checkIFlowGuards — scope reduction guard', () => {
  const dir = tempDir('iflow-scope-reduction');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block write to PLAN.md with scope reduction language', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan\n\n## Tasks\n- Build v1 simplified version of auth');
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Goals\n\n## Goal\n- Full authentication system');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'PLAN.md',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Scope reduction');
  });

  it('should allow write to PLAN.md without scope reduction language', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan\n\n## Tasks\n- Build complete authentication system');
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Goals\n\n## Goal\n- Full authentication system');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'PLAN.md',
    });
    expect(result.success).toBe(true);
  });

  it('should not block non-write operations', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'read',
      filePath: 'PLAN.md',
    });
    expect(result.success).toBe(true);
  });
});

// ─── checkIFlowGuards — artifact completeness (existing behavior) ────────────

describe('checkIFlowGuards — artifact completeness guard', () => {
  const dir = tempDir('iflow-artifact-completeness');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block transition to executing when PLAN.md is missing', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      targetState: 'executing',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('PLAN.md');
  });

  it('should allow transition to executing when PLAN.md exists', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      targetState: 'executing',
    });
    expect(result.success).toBe(true);
  });
});

// ─── checkIFlowGuards — cyclic transition (existing behavior) ────────────────

describe('checkIFlowGuards — cyclic transition guard', () => {
  const dir = tempDir('iflow-cyclic-transition');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block invalid transition: discussing → executing', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'discussing',
      targetState: 'executing',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Invalid transition');
  });

  it('should allow valid transition: discussing → researching', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'discussing',
      targetState: 'researching',
    });
    expect(result.success).toBe(true);
  });

  it('should allow valid transition: shipping → discussing (cycle restart)', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'shipping',
      targetState: 'discussing',
    });
    expect(result.success).toBe(true);
  });
});
