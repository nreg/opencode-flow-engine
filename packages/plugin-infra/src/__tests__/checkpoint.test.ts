/**
 * Checkpoint infrastructure tests — saveCheckpoint, readCheckpoint,
 * detectStaleCheckpoints, clearCheckpoint
 *
 * TDD RED phase: tests written before implementation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import {
  saveCheckpoint,
  readCheckpoint,
  detectStaleCheckpoints,
  clearCheckpoint,
  type CheckpointFile,
  CHECKPOINT_DIR,
  simpleHash,
} from '../features/state-manager.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

// ─── CheckpointFile interface & constant ──────────────────────────────────

describe('CheckpointFile interface and CHECKPOINT_DIR constant', () => {
  it('should have CHECKPOINT_DIR set to .flow-engine/sflow/checkpoints', () => {
    expect(CHECKPOINT_DIR).toBe('.flow-engine/sflow/checkpoints');
  });

  it('should allow constructing a valid CheckpointFile with all fields', () => {
    const cp: CheckpointFile = {
      taskId: 'task-1.1',
      commitStart: 'abc1234',
      commitEnd: 'def5678',
      evidence: 'All tests pass',
      reviewStatus: 'pass',
      contractHash: 'abcd1234ef567890',
      timestamp: new Date().toISOString(),
      nextStep: 'Run integration tests',
    };
    expect(cp.taskId).toBe('task-1.1');
    expect(cp.reviewStatus).toBe('pass');
  });

  it('should allow CheckpointFile with only required fields', () => {
    const cp: CheckpointFile = {
      taskId: 'task-1.2',
      contractHash: 'abcd1234ef567890',
      timestamp: new Date().toISOString(),
    };
    expect(cp.commitStart).toBeUndefined();
    expect(cp.commitEnd).toBeUndefined();
    expect(cp.evidence).toBeUndefined();
    expect(cp.reviewStatus).toBeUndefined();
    expect(cp.nextStep).toBeUndefined();
  });
});

// ─── saveCheckpoint ──────────────────────────────────────────────────────

describe('saveCheckpoint', () => {
  const dir = tempDir('checkpoint-save');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
    // Set up state.json with activeWorkflow = 'sflow'
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'executing',
      mode: 'full',
    }));
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should create checkpoint file with all fields', async () => {
    const checkpoint: CheckpointFile = {
      taskId: 'task-1.1',
      commitStart: 'abc1234',
      commitEnd: 'def5678',
      evidence: 'All tests pass',
      reviewStatus: 'pass',
      contractHash: 'abcd1234ef567890',
      timestamp: new Date().toISOString(),
      nextStep: 'Run integration tests',
    };

    await saveCheckpoint(dir, checkpoint);

    const filePath = dir + '/.flow-engine/sflow/checkpoints/task-1.1.json';
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.taskId).toBe('task-1.1');
    expect(parsed.commitStart).toBe('abc1234');
    expect(parsed.commitEnd).toBe('def5678');
    expect(parsed.evidence).toBe('All tests pass');
    expect(parsed.reviewStatus).toBe('pass');
    expect(parsed.contractHash).toBe('abcd1234ef567890');
    expect(parsed.nextStep).toBe('Run integration tests');
  });

  it('should create checkpoint file with only required fields', async () => {
    const checkpoint: CheckpointFile = {
      taskId: 'task-1.2',
      contractHash: 'abcd1234ef567890',
      timestamp: new Date().toISOString(),
    };

    await saveCheckpoint(dir, checkpoint);

    const filePath = dir + '/.flow-engine/sflow/checkpoints/task-1.2.json';
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.taskId).toBe('task-1.2');
    expect(parsed.contractHash).toBe('abcd1234ef567890');
    expect(parsed.commitStart).toBeUndefined();
  });

  it('should overwrite existing checkpoint', async () => {
    const cp1: CheckpointFile = {
      taskId: 'task-1.1',
      contractHash: 'hash1',
      timestamp: new Date().toISOString(),
    };
    await saveCheckpoint(dir, cp1);

    const cp2: CheckpointFile = {
      taskId: 'task-1.1',
      contractHash: 'hash2',
      timestamp: new Date().toISOString(),
      reviewStatus: 'pass',
    };
    await saveCheckpoint(dir, cp2);

    const result = await readCheckpoint(dir, 'task-1.1');
    expect(result).not.toBeNull();
    expect(result!.contractHash).toBe('hash2');
    expect(result!.reviewStatus).toBe('pass');
  });

  it('should create checkpoints directory if not exists', async () => {
    // Don't create checkpoints dir — saveCheckpoint should create it
    const checkpoint: CheckpointFile = {
      taskId: 'task-1.3',
      contractHash: 'testhash',
      timestamp: new Date().toISOString(),
    };

    await saveCheckpoint(dir, checkpoint);

    const filePath = dir + '/.flow-engine/sflow/checkpoints/task-1.3.json';
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBeTruthy();
  });
});

// ─── readCheckpoint ──────────────────────────────────────────────────────

describe('readCheckpoint', () => {
  const dir = tempDir('checkpoint-read');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
    await ensureDir(dir + '/.flow-engine/sflow/checkpoints');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'executing',
      mode: 'full',
    }));
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should read existing checkpoint file', async () => {
    const checkpoint: CheckpointFile = {
      taskId: 'task-1.1',
      commitStart: 'abc1234',
      contractHash: 'testhash123',
      timestamp: new Date().toISOString(),
    };
    await saveCheckpoint(dir, checkpoint);

    const result = await readCheckpoint(dir, 'task-1.1');
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('task-1.1');
    expect(result!.commitStart).toBe('abc1234');
    expect(result!.contractHash).toBe('testhash123');
  });

  it('should return null when checkpoint file does not exist', async () => {
    const result = await readCheckpoint(dir, 'nonexistent-task');
    expect(result).toBeNull();
  });

  it('should return null when checkpoints directory does not exist', async () => {
    await rm(dir + '/.flow-engine/sflow/checkpoints', { recursive: true, force: true });
    const result = await readCheckpoint(dir, 'any-task');
    expect(result).toBeNull();
  });
});

// ─── detectStaleCheckpoints ──────────────────────────────────────────────

describe('detectStaleCheckpoints', () => {
  const dir = tempDir('checkpoint-stale');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
    await ensureDir(dir + '/.flow-engine/sflow/checkpoints');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'executing',
      mode: 'full',
    }));
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return stale task IDs when contractHash mismatches current contract hash', async () => {
    // Create a contract file
    const contractContent = '# Execution Contract\n\n## Intent Lock\nSome intent.';
    await writeFile(dir + '/execution-contract.md', contractContent);
    const currentHash = await simpleHash(contractContent);

    // Save checkpoint with a DIFFERENT contract hash
    const checkpoint: CheckpointFile = {
      taskId: 'task-1.1',
      contractHash: 'STALE_HASH_DIFFERENT',
      timestamp: new Date().toISOString(),
    };
    await saveCheckpoint(dir, checkpoint);

    const staleIds = await detectStaleCheckpoints(dir);
    expect(staleIds).toContain('task-1.1');
  });

  it('should return empty array when all checkpoints match current contract hash', async () => {
    const contractContent = '# Execution Contract\n\n## Intent Lock\nStable intent.';
    await writeFile(dir + '/execution-contract.md', contractContent);
    const currentHash = await simpleHash(contractContent);

    // Save checkpoint with MATCHING contract hash
    const checkpoint: CheckpointFile = {
      taskId: 'task-1.2',
      contractHash: currentHash,
      timestamp: new Date().toISOString(),
    };
    await saveCheckpoint(dir, checkpoint);

    const staleIds = await detectStaleCheckpoints(dir);
    expect(staleIds).not.toContain('task-1.2');
  });

  it('should return empty array when no checkpoints exist', async () => {
    const staleIds = await detectStaleCheckpoints(dir);
    expect(staleIds).toEqual([]);
  });

  it('should return empty array when no contract file exists', async () => {
    const checkpoint: CheckpointFile = {
      taskId: 'task-1.3',
      contractHash: 'somehash',
      timestamp: new Date().toISOString(),
    };
    await saveCheckpoint(dir, checkpoint);

    // No execution-contract.md file — cannot determine staleness
    const staleIds = await detectStaleCheckpoints(dir);
    expect(staleIds).toEqual([]);
  });

  it('should detect multiple stale checkpoints', async () => {
    const contractContent = '# Execution Contract\n\n## Intent Lock\nMulti stale.';
    await writeFile(dir + '/execution-contract.md', contractContent);

    const cp1: CheckpointFile = {
      taskId: 'task-1.1',
      contractHash: 'stale_hash_1',
      timestamp: new Date().toISOString(),
    };
    await saveCheckpoint(dir, cp1);

    const cp2: CheckpointFile = {
      taskId: 'task-1.2',
      contractHash: 'stale_hash_2',
      timestamp: new Date().toISOString(),
    };
    await saveCheckpoint(dir, cp2);

    const staleIds = await detectStaleCheckpoints(dir);
    expect(staleIds).toContain('task-1.1');
    expect(staleIds).toContain('task-1.2');
  });
});

// ─── clearCheckpoint ─────────────────────────────────────────────────────

describe('clearCheckpoint', () => {
  const dir = tempDir('checkpoint-clear');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'executing',
      mode: 'full',
    }));
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should mark existing checkpoint as stale instead of deleting it', async () => {
    const checkpoint: CheckpointFile = {
      taskId: 'task-1.1',
      contractHash: 'testhash',
      timestamp: new Date().toISOString(),
    };
    await saveCheckpoint(dir, checkpoint);

    // Verify it exists
    const before = await readCheckpoint(dir, 'task-1.1');
    expect(before).not.toBeNull();

    await clearCheckpoint(dir, 'task-1.1');

    // File still exists on disk
    const filePath = dir + '/.flow-engine/sflow/checkpoints/task-1.1.json';
    const fileExists = await Bun.file(filePath).exists();
    expect(fileExists).toBe(true);

    // readCheckpoint returns null by default (skips stale)
    const after = await readCheckpoint(dir, 'task-1.1');
    expect(after).toBeNull();

    // readCheckpoint with includeStale=true returns the stale record
    const staleRecord = await readCheckpoint(dir, 'task-1.1', true);
    expect(staleRecord).not.toBeNull();
    expect(staleRecord!.status).toBe('stale');
    expect(staleRecord!.taskId).toBe('task-1.1');
  });

  it('should create a stub stale record when checkpoint file does not exist', async () => {
    // Should not throw
    await expect(clearCheckpoint(dir, 'nonexistent-task')).resolves.toBeUndefined();

    // Stub stale record created
    const staleRecord = await readCheckpoint(dir, 'nonexistent-task', true);
    expect(staleRecord).not.toBeNull();
    expect(staleRecord!.status).toBe('stale');
    expect(staleRecord!.taskId).toBe('nonexistent-task');
    expect(staleRecord!.contractHash).toBe('');
  });
});

// ─── Integration: save → read → detect stale → clear ────────────────────

describe('Checkpoint integration: save → read → detect stale → clear', () => {
  const dir = tempDir('checkpoint-integration');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'executing',
      mode: 'full',
    }));
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should complete full lifecycle: save, read, detect stale, clear', async () => {
    // 1. Save checkpoint
    const contractContent = '# Execution Contract\n\n## Intent Lock\nIntegration test.';
    await writeFile(dir + '/execution-contract.md', contractContent);
    const currentHash = await simpleHash(contractContent);

    const checkpoint: CheckpointFile = {
      taskId: 'task-integration',
      contractHash: currentHash,
      timestamp: new Date().toISOString(),
      evidence: 'All green',
      reviewStatus: 'pending',
    };
    await saveCheckpoint(dir, checkpoint);

    // 2. Read it back
    const read = await readCheckpoint(dir, 'task-integration');
    expect(read).not.toBeNull();
    expect(read!.taskId).toBe('task-integration');
    expect(read!.evidence).toBe('All green');

    // 3. Detect stale — should not be stale (hash matches)
    let staleIds = await detectStaleCheckpoints(dir);
    expect(staleIds).not.toContain('task-integration');

    // 4. Change contract hash (simulate contract change)
    const newContractContent = '# Execution Contract\n\n## Intent Lock\nChanged intent.';
    await writeFile(dir + '/execution-contract.md', newContractContent);

    // 5. Detect stale — should now be stale
    staleIds = await detectStaleCheckpoints(dir);
    expect(staleIds).toContain('task-integration');

    // 6. Clear checkpoint (marks as stale, does not delete)
    await clearCheckpoint(dir, 'task-integration');

    // 7. readCheckpoint returns null by default (skips stale)
    const afterClear = await readCheckpoint(dir, 'task-integration');
    expect(afterClear).toBeNull();

    // 8. File still exists on disk with stale status
    const staleRecord = await readCheckpoint(dir, 'task-integration', true);
    expect(staleRecord).not.toBeNull();
    expect(staleRecord!.status).toBe('stale');
    expect(staleRecord!.taskId).toBe('task-integration');
  });
});
