/**
 * State Manager tests — detectStateMismatch, upgradeMode, buildPause, updateSubagentProgress
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile, access } from 'fs/promises';
import { join } from 'path';
import { createStateManager, detectStateMismatch, simpleHash, writeStateFile } from '../features/state-manager.js';
// P1-1: Import migration helper functions
import {
  ensureMigrateDir,
  migrateSingleArtifact,
  migrateLegacyArtifacts
} from '../features/state-manager/state-detection.js';
// P1-2: Import artifact path helpers
import {
  resolveArtifactPath,
  readArtifactContent,
  isArtifactNewPath,
  resolveSpecsDir,
  listSpecFiles,
  readSpecContent
} from '../features/state-manager/artifact-paths.js';

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

// ─── Dual-Path Compatibility Tests (Wave 7) ───────────────────────────────────

describe('detectArtifactExistence — dual-path compatibility', () => {
  const dir = tempDir('dual-path');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should detect artifacts in new path (.flow-engine/sflow/)', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# Proposal');
    await writeFile(dir + '/.flow-engine/sflow/design.md', '# Design');
    await writeFile(dir + '/.flow-engine/sflow/tasks.md', '# Tasks');
    await writeFile(dir + '/.flow-engine/sflow/execution-contract.md', '# Contract');

    const { detectArtifactExistence } = await import('../features/state-manager/state-detection.js');
    const result = await detectArtifactExistence(dir);

    expect(result.proposal).toBe(true);
    expect(result.design).toBe(true);
    expect(result.tasks).toBe(true);
    expect(result.contract).toBe(true);
  });

  it('should fallback to legacy path when new path does not exist', async () => {
    await writeFile(dir + '/proposal.md', '# Proposal');
    await writeFile(dir + '/design.md', '# Design');
    await writeFile(dir + '/tasks.md', '# Tasks');
    await writeFile(dir + '/execution-contract.md', '# Contract');

    const { detectArtifactExistence } = await import('../features/state-manager/state-detection.js');
    const result = await detectArtifactExistence(dir);

    expect(result.proposal).toBe(true);
    expect(result.design).toBe(true);
    expect(result.tasks).toBe(true);
    expect(result.contract).toBe(true);
  });

  it('should prefer new path over legacy path', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# New Proposal');
    await writeFile(dir + '/proposal.md', '# Old Proposal');

    const { detectArtifactExistence } = await import('../features/state-manager/state-detection.js');
    const result = await detectArtifactExistence(dir);

    expect(result.proposal).toBe(true);
  });

  it('should auto-migrate legacy artifacts to new path', async () => {
    await writeFile(dir + '/proposal.md', '# Legacy Proposal');
    await writeFile(dir + '/design.md', '# Legacy Design');

    const { detectArtifactExistence } = await import('../features/state-manager/state-detection.js');
    await detectArtifactExistence(dir);

    const newProposal = await import('fs/promises').then(m => m.readFile(dir + '/.flow-engine/sflow/proposal.md', 'utf-8').catch(() => null));
    const newDesign = await import('fs/promises').then(m => m.readFile(dir + '/.flow-engine/sflow/design.md', 'utf-8').catch(() => null));

    expect(newProposal).toBe('# Legacy Proposal');
    expect(newDesign).toBe('# Legacy Design');
  });

  it('should detect specs in new path', async () => {
    await ensureDir(dir + '/.flow-engine/sflow/specs');
    await writeFile(dir + '/.flow-engine/sflow/specs/auth.md', '# Auth Spec');

    const { detectArtifactExistence } = await import('../features/state-manager/state-detection.js');
    const result = await detectArtifactExistence(dir);

    expect(result.specs).toBe(true);
    expect(result.specsFileCount).toBe(1);
  });

  it('should fallback to legacy specs directory', async () => {
    await ensureDir(dir + '/specs');
    await writeFile(dir + '/specs/auth.md', '# Auth Spec');

    const { detectArtifactExistence } = await import('../features/state-manager/state-detection.js');
    const result = await detectArtifactExistence(dir);

    expect(result.specs).toBe(true);
    expect(result.specsFileCount).toBe(1);
  });
});

// ─── P1-1: Migration Helper Functions Tests ─────────────────────────────────────

describe('ensureMigrateDir', () => {
  const dir = tempDir('migrate-dir');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should create .flow-engine/sflow directory if not exists', async () => {
    await ensureMigrateDir(dir);
    const stat = await access(dir + '/.flow-engine/sflow').then(() => true).catch(() => false);
    expect(stat).toBe(true);
  });

  it('should succeed if directory already exists', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await ensureMigrateDir(dir);
    const stat = await access(dir + '/.flow-engine/sflow').then(() => true).catch(() => false);
    expect(stat).toBe(true);
  });
});

describe('migrateSingleArtifact', () => {
  const dir = tempDir('migrate-single');
  const srcPath = dir + '/proposal.md';
  const dstPath = dir + '/.flow-engine/sflow/proposal.md';

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should copy file from src to dst if src exists and dst does not', async () => {
    await writeFile(srcPath, '# Proposal');
    await migrateSingleArtifact(srcPath, dstPath);
    const content = await readFile(dstPath, 'utf-8');
    expect(content).toBe('# Proposal');
  });

  it('should preserve original file (non-destructive)', async () => {
    await writeFile(srcPath, '# Proposal');
    await migrateSingleArtifact(srcPath, dstPath);
    const originalExists = await access(srcPath).then(() => true).catch(() => false);
    expect(originalExists).toBe(true);
  });

  it('should skip migration if dst already exists', async () => {
    await writeFile(srcPath, '# Old Proposal');
    await writeFile(dstPath, '# New Proposal');
    await migrateSingleArtifact(srcPath, dstPath);
    const content = await readFile(dstPath, 'utf-8');
    expect(content).toBe('# New Proposal');
  });

  it('should skip migration if src does not exist', async () => {
    await migrateSingleArtifact(srcPath, dstPath);
    const dstExists = await access(dstPath).then(() => true).catch(() => false);
    expect(dstExists).toBe(false);
  });
});

describe('migrateLegacyArtifacts', () => {
  const dir = tempDir('migrate-legacy');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should migrate all legacy artifacts to .flow-engine/sflow/', async () => {
    await writeFile(dir + '/proposal.md', '# Proposal');
    await writeFile(dir + '/design.md', '# Design');
    await writeFile(dir + '/tasks.md', '# Tasks');
    await writeFile(dir + '/execution-contract.md', '# Contract');
    await writeFile(dir + '/ui-design.md', '# UI Design');

    await migrateLegacyArtifacts(dir);

    const files = ['proposal.md', 'design.md', 'tasks.md', 'execution-contract.md', 'ui-design.md'];
    for (const file of files) {
      const content = await readFile(dir + '/.flow-engine/sflow/' + file, 'utf-8');
      expect(content.startsWith('#')).toBe(true);
    }
  });

  it('should migrate specs directory', async () => {
    await ensureDir(dir + '/specs');
    await writeFile(dir + '/specs/auth.md', '# Auth Spec');
    await writeFile(dir + '/specs/user.md', '# User Spec');

    await migrateLegacyArtifacts(dir);

    const authContent = await readFile(dir + '/.flow-engine/sflow/specs/auth.md', 'utf-8');
    const userContent = await readFile(dir + '/.flow-engine/sflow/specs/user.md', 'utf-8');
    expect(authContent).toBe('# Auth Spec');
    expect(userContent).toBe('# User Spec');
  });

  it('should preserve original files (non-destructive)', async () => {
    await writeFile(dir + '/proposal.md', '# Proposal');
    await migrateLegacyArtifacts(dir);

    const originalExists = await access(dir + '/proposal.md').then(() => true).catch(() => false);
    expect(originalExists).toBe(true);
  });

  it('should skip migration if artifacts already in new location', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# New Proposal');
    await writeFile(dir + '/proposal.md', '# Old Proposal');

    await migrateLegacyArtifacts(dir);

    const content = await readFile(dir + '/.flow-engine/sflow/proposal.md', 'utf-8');
    expect(content).toBe('# New Proposal');
  });
});

// ─── P1-2: Artifact Path Helpers Tests ──────────────────────────────────────────

describe('resolveArtifactPath', () => {
  const dir = tempDir('artifact-path');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return new path if artifact exists in .flow-engine/sflow/', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# New Proposal');
    const path = await resolveArtifactPath(dir, 'proposal.md');
    expect(path).toBe(dir + '/.flow-engine/sflow/proposal.md');
  });

  it('should return legacy path if artifact only in root', async () => {
    await writeFile(dir + '/proposal.md', '# Legacy Proposal');
    const path = await resolveArtifactPath(dir, 'proposal.md');
    expect(path).toBe(dir + '/proposal.md');
  });

  it('should prefer new path over legacy path', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# New Proposal');
    await writeFile(dir + '/proposal.md', '# Legacy Proposal');
    const path = await resolveArtifactPath(dir, 'proposal.md');
    expect(path).toBe(dir + '/.flow-engine/sflow/proposal.md');
  });

  it('should return legacy path if artifact does not exist anywhere', async () => {
    const path = await resolveArtifactPath(dir, 'proposal.md');
    expect(path).toBe(dir + '/proposal.md');
  });
});

describe('readArtifactContent', () => {
  const dir = tempDir('artifact-read');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should read from new path if exists', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# New Proposal');
    const content = await readArtifactContent(dir, 'proposal.md');
    expect(content).toBe('# New Proposal');
  });

  it('should read from legacy path if new path does not exist', async () => {
    await writeFile(dir + '/proposal.md', '# Legacy Proposal');
    const content = await readArtifactContent(dir, 'proposal.md');
    expect(content).toBe('# Legacy Proposal');
  });

  it('should prefer new path over legacy path', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# New Proposal');
    await writeFile(dir + '/proposal.md', '# Legacy Proposal');
    const content = await readArtifactContent(dir, 'proposal.md');
    expect(content).toBe('# New Proposal');
  });

  it('should return null if artifact does not exist', async () => {
    const content = await readArtifactContent(dir, 'proposal.md');
    expect(content).toBeNull();
  });
});

describe('isArtifactNewPath', () => {
  const dir = tempDir('artifact-new-path');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return true if artifact exists in new path', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# New Proposal');
    const isNew = await isArtifactNewPath(dir, 'proposal.md');
    expect(isNew).toBe(true);
  });

  it('should return false if artifact only in legacy path', async () => {
    await writeFile(dir + '/proposal.md', '# Legacy Proposal');
    const isNew = await isArtifactNewPath(dir, 'proposal.md');
    expect(isNew).toBe(false);
  });

  it('should return false if artifact does not exist', async () => {
    const isNew = await isArtifactNewPath(dir, 'proposal.md');
    expect(isNew).toBe(false);
  });
});

// ─── P1-3: Migration Marker Tests ───────────────────────────────────────────────

describe('Migration Marker', () => {
  const dir = tempDir('migration-marker');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should write migration marker after migration', async () => {
    await writeFile(dir + '/proposal.md', '# Proposal');
    await migrateLegacyArtifacts(dir);
    
    const markerExists = await access(dir + '/.flow-engine/sflow/.artifacts-migrated').then(() => true).catch(() => false);
    expect(markerExists).toBe(true);
  });

  it('should skip migration if marker exists', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/.artifacts-migrated', new Date().toISOString());
    await writeFile(dir + '/proposal.md', '# Proposal');
    
    await migrateLegacyArtifacts(dir);
    
    const proposalExists = await access(dir + '/.flow-engine/sflow/proposal.md').then(() => true).catch(() => false);
    expect(proposalExists).toBe(false);
  });

  it('should execute migration if marker does not exist', async () => {
    await writeFile(dir + '/proposal.md', '# Proposal');
    await migrateLegacyArtifacts(dir);
    
    const content = await readFile(dir + '/.flow-engine/sflow/proposal.md', 'utf-8');
    expect(content).toBe('# Proposal');
  });

  it('should write timestamp in marker', async () => {
    await writeFile(dir + '/proposal.md', '# Proposal');
    await migrateLegacyArtifacts(dir);
    
    const markerContent = await readFile(dir + '/.flow-engine/sflow/.artifacts-migrated', 'utf-8');
    const timestamp = new Date(markerContent);
    expect(timestamp.getTime()).not.toBeNaN();
  });
});

// ─── Specs Path Helpers Tests ───────────────────────────────────────────────────

describe('resolveSpecsDir', () => {
  const dir = tempDir('specs-dir');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return new path if specs exists in .flow-engine/sflow/specs', async () => {
    await ensureDir(dir + '/.flow-engine/sflow/specs');
    const path = await resolveSpecsDir(dir);
    expect(path).toBe(dir + '/.flow-engine/sflow/specs');
  });

  it('should return legacy path if specs only in root', async () => {
    await ensureDir(dir + '/specs');
    const path = await resolveSpecsDir(dir);
    expect(path).toBe(dir + '/specs');
  });

  it('should prefer new path over legacy path', async () => {
    await ensureDir(dir + '/.flow-engine/sflow/specs');
    await ensureDir(dir + '/specs');
    const path = await resolveSpecsDir(dir);
    expect(path).toBe(dir + '/.flow-engine/sflow/specs');
  });

  it('should return legacy path if specs does not exist anywhere', async () => {
    const path = await resolveSpecsDir(dir);
    expect(path).toBe(dir + '/specs');
  });
});

describe('listSpecFiles', () => {
  const dir = tempDir('specs-list');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should list files from new path if exists', async () => {
    await ensureDir(dir + '/.flow-engine/sflow/specs');
    await writeFile(dir + '/.flow-engine/sflow/specs/auth.md', '# Auth Spec');
    await writeFile(dir + '/.flow-engine/sflow/specs/user.md', '# User Spec');
    const files = await listSpecFiles(dir);
    expect(files.sort()).toEqual(['auth.md', 'user.md']);
  });

  it('should NOT fallback to legacy path (project root specs/)', async () => {
    // Project root specs/ exists but should NOT be detected
    await ensureDir(dir + '/specs');
    await writeFile(dir + '/specs/auth.md', '# Auth Spec');
    const files = await listSpecFiles(dir);
    // Should return empty array, not fallback to legacy path
    expect(files).toEqual([]);
  });

  it('should return empty array if specs does not exist', async () => {
    const files = await listSpecFiles(dir);
    expect(files).toEqual([]);
  });
});

describe('readSpecContent', () => {
  const dir = tempDir('specs-read');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should read from new path if exists', async () => {
    await ensureDir(dir + '/.flow-engine/sflow/specs');
    await writeFile(dir + '/.flow-engine/sflow/specs/auth.md', '# Auth Spec');
    const content = await readSpecContent(dir, 'auth.md');
    expect(content).toBe('# Auth Spec');
  });

  it('should read from legacy path if new path does not exist', async () => {
    await ensureDir(dir + '/specs');
    await writeFile(dir + '/specs/auth.md', '# Auth Spec');
    const content = await readSpecContent(dir, 'auth.md');
    expect(content).toBe('# Auth Spec');
  });

  it('should prefer new path over legacy path', async () => {
    await ensureDir(dir + '/.flow-engine/sflow/specs');
    await writeFile(dir + '/.flow-engine/sflow/specs/auth.md', '# New Auth Spec');
    await ensureDir(dir + '/specs');
    await writeFile(dir + '/specs/auth.md', '# Legacy Auth Spec');
    const content = await readSpecContent(dir, 'auth.md');
    expect(content).toBe('# New Auth Spec');
  });

  it('should return null if spec does not exist', async () => {
    const content = await readSpecContent(dir, 'auth.md');
    expect(content).toBeNull();
  });
});
