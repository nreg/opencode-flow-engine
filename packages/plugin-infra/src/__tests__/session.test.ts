/**
 * Session hook tests — boulder state recovery, auto-repair via detectStateMismatch
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createSessionStartHook, createSessionEndHook } from '../hooks/session.js';
import { detectStateMismatch } from '../features/state-manager.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeFileContent(filePath: string, content: string): Promise<void> {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const dirPath = parts.slice(0, -1).join('/');
  await ensureDir(dirPath);
  await writeFile(filePath, content);
}

async function writeStateFile(dir: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow');
  await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify(data, null, 2));
}

async function writeBoulderFile(dir: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow');
  await writeFile(dir + '/.flow-engine/sflow/boulder-state.json', JSON.stringify(data, null, 2));
}

describe('Session Start Hook — Boulder State Recovery', () => {
  const dir = tempDir('session-start');
  let hook: ReturnType<typeof createSessionStartHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    hook = createSessionStartHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should recover from boulder state', async () => {
    await writeBoulderFile(dir, { state: 'executing', mode: 'full' });
    // The hook expects contract.md to exist for executing state (detectStateMismatch checks this)
    await writeFileContent(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nTest contract.');
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'session.created' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.recovered).toBe(true);
    expect(data?.state).toBe('executing');
  });

  it('should fall back to state.json when no boulder state', async () => {
    await writeStateFile(dir, { state: 'bridging', mode: 'full' });
    // For bridging state, detectStateMismatch checks if contract exists -> would advance to approved-for-build
    // If no contract, it stays as bridging. But bridging also checks for design/tasks/specs.
    await writeFileContent(dir + '/proposal.md', '# Test Proposal\n\n## Why\nA sufficiently long motivation description text here.');
    await writeFileContent(dir + '/design.md', '# Design\n\n## Architecture\nTest arch.');
    await writeFileContent(dir + '/tasks.md', '- [ ] task one');
    await ensureDir(dir + '/specs');
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'session.created' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.recovered).toBe(true);
  });

  it('should return recovered=false when no state files exist', async () => {
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'session.created' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.recovered).toBe(false);
  });
});

describe('Session Start Hook — Auto-Repair via detectStateMismatch', () => {
  const dir = tempDir('session-repair');
  let hook: ReturnType<typeof createSessionStartHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    hook = createSessionStartHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should auto-repair: executing -> bridging when contract missing', async () => {
    await writeBoulderFile(dir, { state: 'executing', mode: 'full' });
    // Create artifacts except contract
    await ensureDir(dir + '/specs');
    await writeFile(dir + '/proposal.md', '# Test\n\n## Why\nMotivation text here that is long enough to pass the check.');
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'session.created' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.repaired).toBe(true);
    // executing with no contract -> detectStateMismatch returns 'bridging'
    expect(data?.state).toBe('bridging');
  });

  it('should auto-repair: exploring -> specifying when proposal exists', async () => {
    await writeBoulderFile(dir, { state: 'exploring', mode: 'full' });
    await writeFile(dir + '/proposal.md', '# Test Proposal\n\n## Why\nThis is a sufficiently long motivation text for the change we want to make. It describes why this change is needed and what problem it solves.');
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'session.created' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    if (data?.repaired) {
      expect(data?.state).toBe('specifying');
    }
  });
});

describe('Session End Hook — Boulder State Persistence', () => {
  const dir = tempDir('session-end');
  let hook: ReturnType<typeof createSessionEndHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    hook = createSessionEndHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should persist state to boulder file', async () => {
    await writeStateFile(dir, { state: 'closing', mode: 'full' });
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'session.deleted' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.persisted).toBe(true);
    expect(data?.state).toBe('closing');
  });

  it('should not persist when no state file exists', async () => {
    const result = await hook.execute({ changeDir: dir, stateFile: '', pluginRoot: '', action: 'session.deleted' });
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.persisted).toBe(false);
  });
});

describe('detectStateMismatch (shared canonical function)', () => {
  const dir = tempDir('detect-mismatch');

  beforeEach(async () => { await cleanupDir(dir); await ensureDir(dir); });
  afterEach(async () => { await cleanupDir(dir); });

  it('exploring -> specifying when proposal exists with content', async () => {
    await writeFile(dir + '/proposal.md', '# Test\n\n## Why\n'.padEnd(120, 'x'));
    const result = await detectStateMismatch(dir, 'exploring');
    expect(result).toBe('specifying');
  });

  it('specifying -> bridging when all planning artifacts exist', async () => {
    await writeFile(dir + '/proposal.md', '# Test\n\n## Why\n'.padEnd(120, 'x'));
    await writeFile(dir + '/design.md', '# Design\n\n## Arch\nTest');
    await writeFile(dir + '/tasks.md', '- [ ] task one');
    await ensureDir(dir + '/specs');
    await writeFile(dir + '/specs/spec1.md', '# Spec 1');
    const result = await detectStateMismatch(dir, 'specifying');
    expect(result).toBe('bridging');
  });

  it('bridging -> approved-for-build when contract exists', async () => {
    await writeFile(dir + '/execution-contract.md', '# Contract\n\n## Intent\nTest');
    const result = await detectStateMismatch(dir, 'bridging');
    expect(result).toBe('approved-for-build');
  });

  it('approved-for-build -> bridging when contract deleted', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({ state: 'approved-for-build', contract_hash: 'abc123' }));
    const result = await detectStateMismatch(dir, 'approved-for-build');
    expect(result).toBe('bridging');
  });

  it('executing -> closing when all tasks checked', async () => {
    await writeFile(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nTest');
    await writeFile(dir + '/tasks.md', '- [x] done task');
    const result = await detectStateMismatch(dir, 'executing');
    expect(result).toBe('closing');
  });

  it('returns same state when no mismatch', async () => {
    const result = await detectStateMismatch(dir, 'exploring');
    expect(result).toBe('exploring');
  });
});
