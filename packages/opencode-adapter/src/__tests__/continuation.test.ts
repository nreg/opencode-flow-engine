/**
 * Continuation hook tests — build_pause 3-state, terminal states, auto_transition config
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createContinuationHook } from '../hooks/continuation.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeState(dir: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.sflow');
  await writeFile(dir + '/.sflow/state.json', JSON.stringify(data, null, 2));
}

async function writeConfig(dir: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.sflow');
  await writeFile(dir + '/.sflow/config.json', JSON.stringify(data, null, 2));
}

describe('Continuation Hook — Build Pause 3-State', () => {
  const dir = tempDir('continuation-build-pause');
  let hook: ReturnType<typeof createContinuationHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    hook = createContinuationHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should detect corrupted pause: build_pause set but contract missing', async () => {
    await writeState(dir, { state: 'executing', mode: 'full', build_pause: 'plan-ready' });
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.pause_state).toBe('corrupted');
    expect(data?.shouldContinue).toBe(false);
    expect(data?.skill).toBe('contract-builder');
  });

  it('should detect normal pause: build_pause set but isolation/build_mode not set', async () => {
    await writeState(dir, { state: 'executing', mode: 'full', build_pause: 'plan-ready' });
    await writeFile(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nTest');
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.pause_state).toBe('normal');
    expect(data?.shouldContinue).toBe(false);
    expect(data?.skill).toBe('build-executor');
  });

  it('should detect stale pause: build_pause set but isolation/build_mode already set', async () => {
    await writeState(dir, {
      state: 'executing', mode: 'full', build_pause: 'plan-ready',
      isolation: 'branch', build_mode: 'inline',
    });
    await writeFile(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nTest');
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.pause_state).toBe('stale');
    expect(data?.shouldContinue).toBe(true);
    expect(data?.stale_pause_cleared).toBe(true);
  });

  it('should not treat executing without build_pause as paused', async () => {
    await writeState(dir, { state: 'executing', mode: 'full' });
    await writeFile(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nTest');
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    // executing requires user consent before dispatching build-executor
    expect(data?.shouldContinue).toBe(false);
    expect(data?.pause_state).toBeUndefined();
  });
});

describe('Continuation Hook — Terminal States', () => {
  const dir = tempDir('continuation-terminal');
  let hook: ReturnType<typeof createContinuationHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    hook = createContinuationHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return next:done for closing state', async () => {
    await writeState(dir, { state: 'closing', mode: 'full' });
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    const data = result.data as Record<string, unknown>;
    expect(data?.shouldContinue).toBe(false);
    expect(data?.next).toBe('done');
  });

  it('should return next:done for abandoned state', async () => {
    await writeState(dir, { state: 'abandoned', mode: 'full' });
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    const data = result.data as Record<string, unknown>;
    expect(data?.shouldContinue).toBe(false);
    expect(data?.next).toBe('done');
  });
});

describe('Continuation Hook — Auto-Transition Config', () => {
  const dir = tempDir('continuation-config');
  let hook: ReturnType<typeof createContinuationHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    hook = createContinuationHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should auto-transition by default for non-manual states', async () => {
    await writeState(dir, { state: 'specifying', mode: 'full' });
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    const data = result.data as Record<string, unknown>;
    expect(data?.shouldContinue).toBe(true);
    expect(data?.next).toBe('auto');
    expect(data?.skill).toBe('spec-writer');
  });

  it('should not auto-transition for executing state', async () => {
    await writeState(dir, { state: 'executing', mode: 'full' });
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    const data = result.data as Record<string, unknown>;
    expect(data?.shouldContinue).toBe(false);
    expect(data?.next).toBe('manual');
  });

  it('should not auto-transition for approved-for-build state', async () => {
    await writeState(dir, { state: 'approved-for-build', mode: 'full' });
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    const data = result.data as Record<string, unknown>;
    expect(data?.shouldContinue).toBe(false);
    expect(data?.next).toBe('manual');
  });

  it('should respect auto_transition: false in config', async () => {
    await writeState(dir, { state: 'specifying', mode: 'full' });
    await writeConfig(dir, { auto_transition: false });
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    const data = result.data as Record<string, unknown>;
    expect(data?.shouldContinue).toBe(false);
    expect(data?.next).toBe('manual');
    expect(data?.skill).toBe('spec-writer');
  });

  it('should return correct skill for each state', async () => {
    const stateSkillMap: Record<string, string> = {
      exploring: 'need-explorer',
      specifying: 'spec-writer',
      bridging: 'contract-builder',
      'approved-for-build': 'build-executor',
      executing: 'build-executor',
      debugging: 'bug-investigator',
    };
    for (const [state, expectedSkill] of Object.entries(stateSkillMap)) {
      await writeState(dir, { state, mode: 'full' });
      const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
      const data = result.data as Record<string, unknown>;
      expect(data?.skill).toBe(expectedSkill);
    }
  });

  it('should handle no state file', async () => {
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'autocontinue' });
    const data = result.data as Record<string, unknown>;
    expect(data?.shouldContinue).toBe(false);
    expect(data?.next).toBe('manual');
  });
});
