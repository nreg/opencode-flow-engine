/**
 * State Manager tests — detectStateMismatch, upgradeMode, buildPause, updateSubagentProgress
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createStateManager, detectStateMismatch, simpleHash, writeStateFile } from '../features/state-manager.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

describe('State Manager — upgradeMode', () => {
  const dir = tempDir('state-upgrade');
  let sm: ReturnType<typeof createStateManager>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({ state: 'executing', mode: 'hotfix' }));
    sm = createStateManager({ enabled: true });
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should upgrade hotfix to full', async () => {
    const result = await sm.upgradeMode(dir, 'full', 'Hotfix scope exceeded 3 files');
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.upgraded).toBe(true);
    expect(data?.from).toBe('hotfix');
    expect(data?.to).toBe('full');
  });

  it('should upgrade tweak to full', async () => {
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({ state: 'executing', mode: 'tweak' }));
    const result = await sm.upgradeMode(dir, 'full', 'Tweak requires cross-module coordination');
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.upgraded).toBe(true);
    expect(data?.from).toBe('tweak');
    expect(data?.to).toBe('full');
  });

  it('should fail when no state file exists', async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    const result = await sm.upgradeMode(dir, 'full', 'test');
    expect(result.success).toBe(false);
  });
});

describe('State Manager — buildPause control', () => {
  const dir = tempDir('state-pause');
  let sm: ReturnType<typeof createStateManager>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({ state: 'executing', mode: 'full' }));
    sm = createStateManager({ enabled: true });
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should set build_pause', async () => {
    const result = await sm.setBuildPause(dir, 'plan-ready');
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.build_pause).toBe('plan-ready');
  });

  it('should clear build_pause', async () => {
    await sm.setBuildPause(dir, 'plan-ready');
    const result = await sm.clearBuildPause(dir);
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.build_pause).toBeNull();
  });

  it('should fail clearing pause when no state file', async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    const result = await sm.clearBuildPause(dir);
    expect(result.success).toBe(false);
  });
});

describe('State Manager — updateSubagentProgress', () => {
  const dir = tempDir('state-progress');
  let sm: ReturnType<typeof createStateManager>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    sm = createStateManager({ enabled: true });
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should write subagent-progress.md', async () => {
    const result = await sm.updateSubagentProgress(dir, {
      planTask: 'Implement user login endpoint',
      specTask: 'AUTH-001: User authentication',
      stage: 'implementing',
      reviewFixRound: 1,
      commitHash: 'abc123',
      changedFiles: ['src/auth/login.ts', 'src/auth/login.test.ts'],
      redEvidence: 'Test: login fails with invalid password',
      greenEvidence: 'Test: login succeeds with valid password',
    });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.written).toBe(true);
    expect(data?.stage).toBe('implementing');
  });

  it('should create minimal checkpoint', async () => {
    const result = await sm.updateSubagentProgress(dir, {
      planTask: 'Fix typo in README',
      stage: 'checkoff',
    });
    expect(result.success).toBe(true);
  });
});

describe('simpleHash', () => {
  it('should produce consistent hashes', async () => {
    const h1 = await simpleHash('hello');
    const h2 = await simpleHash('hello');
    expect(h1).toBe(h2);
  });

  it('should produce different hashes for different inputs', async () => {
    const h1 = await simpleHash('hello');
    const h2 = await simpleHash('world');
    expect(h1).not.toBe(h2);
  });

  it('should return 16 hex characters', async () => {
    const hash = await simpleHash('test content');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should handle empty string', async () => {
    const hash = await simpleHash('');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('detectStateMismatch — contract_hash edge cases', () => {
  const dir = tempDir('detect-contract-hash');

  beforeEach(async () => { await cleanupDir(dir); await ensureDir(dir); });
  afterEach(async () => { await cleanupDir(dir); });

  it('should detect contract_hash mismatch and return bridging', async () => {
    const contractContent = '# Contract\n\n## Intent Lock\nOriginal intent.';
    await writeFile(dir + '/execution-contract.md', contractContent);
    const hash = await simpleHash(contractContent);
    await ensureDir(dir + '/.flow-engine/sflow');
    // Store a DIFFERENT hash
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'approved-for-build', mode: 'full', contract_hash: 'DIFFERENT_HASH_123',
    }));
    const result = await detectStateMismatch(dir, 'approved-for-build');
    expect(result).toBe('bridging');
  });

  it('should NOT repair when contract_hash matches', async () => {
    const contractContent = '# Contract\n\n## Intent Lock\nStable intent.';
    await writeFile(dir + '/execution-contract.md', contractContent);
    const hash = await simpleHash(contractContent);
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'approved-for-build', mode: 'full', contract_hash: hash,
    }));
    const result = await detectStateMismatch(dir, 'approved-for-build');
    // Should not repair since hash matches or there's no mismatch
    expect(result).toBe('approved-for-build');
  });
});

// ─── AFK Mode Tests (Task 2.1 + 2.2) ──────────────────────────────────────────

describe('writeStateFile — AFK fields', () => {
  const dir = tempDir('afk-write-state');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  async function readState(): Promise<Record<string, unknown>> {
    const content = await import('fs/promises').then(m => m.readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8'));
    return JSON.parse(content);
  }

  it('should include afk=false and afkTier=0 in default state', async () => {
    await writeStateFile(dir, 'exploring');
    const state = await readState();
    expect(state.afk).toBe(false);
    expect(state.afkTier).toBe(0);
  });

  it('should write afk=true and afkTier=N via extra', async () => {
    await writeStateFile(dir, 'executing', { afk: true, afkTier: 1 });
    const state = await readState();
    expect(state.afk).toBe(true);
    expect(state.afkTier).toBe(1);
  });

  it('should auto-close AFK when entering closing state', async () => {
    await writeStateFile(dir, 'executing', { afk: true, afkTier: 2 });
    await writeStateFile(dir, 'closing');
    const state = await readState();
    expect(state.state).toBe('closing');
    expect(state.afk).toBe(false);
    expect(state.afkTier).toBe(0);
  });

  it('should auto-close AFK when entering abandoned state', async () => {
    await writeStateFile(dir, 'executing', { afk: true, afkTier: 3 });
    await writeStateFile(dir, 'abandoned');
    const state = await readState();
    expect(state.state).toBe('abandoned');
    expect(state.afk).toBe(false);
    expect(state.afkTier).toBe(0);
  });

  it('should NOT auto-close AFK on non-terminal states', async () => {
    await writeStateFile(dir, 'executing', { afk: true, afkTier: 1 });
    await writeStateFile(dir, 'debugging');
    const state = await readState();
    expect(state.state).toBe('debugging');
    expect(state.afk).toBe(true);
    expect(state.afkTier).toBe(1);
  });

  it('should enforce consistency: afk=false forces afkTier=0', async () => {
    // Write with afk=false but afkTier=3 — should be corrected to afkTier=0
    await writeStateFile(dir, 'executing', { afk: false, afkTier: 3 });
    const state = await readState();
    expect(state.afk).toBe(false);
    expect(state.afkTier).toBe(0);
  });

  it('should preserve AFK state when writing non-terminal state update', async () => {
    await writeStateFile(dir, 'executing', { afk: true, afkTier: 2 });
    await writeStateFile(dir, 'debugging');
    const state = await readState();
    expect(state.afk).toBe(true);
    expect(state.afkTier).toBe(2);
  });
});

describe('restoreState — AFK force-close on terminal boulder-state', () => {
  const dir = tempDir('afk-restore-state');
  let sm: ReturnType<typeof createStateManager>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    sm = createStateManager({ enabled: true });
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should force-close AFK when restoring from closing boulder-state', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    // Write boulder-state with AFK active + closing state
    await writeFile(dir + '/.flow-engine/sflow/boulder-state.json', JSON.stringify({
      state: 'closing',
      mode: 'full',
      afk: true,
      afkTier: 2,
    }));
    const result = await sm.restoreState(dir);
    expect(result.success).toBe(true);
    // Read the restored state.json
    const content = await import('fs/promises').then(m => m.readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8'));
    const state = JSON.parse(content);
    expect(state.afk).toBe(false);
    expect(state.afkTier).toBe(0);
  });

  it('should force-close AFK when restoring from abandoned boulder-state', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/boulder-state.json', JSON.stringify({
      state: 'abandoned',
      mode: 'full',
      afk: true,
      afkTier: 3,
    }));
    const result = await sm.restoreState(dir);
    expect(result.success).toBe(true);
    const content = await import('fs/promises').then(m => m.readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8'));
    const state = JSON.parse(content);
    expect(state.afk).toBe(false);
    expect(state.afkTier).toBe(0);
  });

  it('should preserve AFK when restoring from non-terminal boulder-state', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/boulder-state.json', JSON.stringify({
      state: 'executing',
      mode: 'full',
      afk: true,
      afkTier: 1,
    }));
    const result = await sm.restoreState(dir);
    expect(result.success).toBe(true);
    const content = await import('fs/promises').then(m => m.readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8'));
    const state = JSON.parse(content);
    expect(state.afk).toBe(true);
    expect(state.afkTier).toBe(1);
  });
});
