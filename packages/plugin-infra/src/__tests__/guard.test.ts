/**
 * Guard hook tests — preset upgrade, phase consistency, debugging gate
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createGuardHook } from '../hooks/guard.js';

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
