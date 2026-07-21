/**
 * Handoff infrastructure tests — createHandoff, finishHandoff,
 * resolveHandoff, readHandoff, listHandoffs
 *
 * TDD RED phase: tests written before implementation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import {
  createHandoff,
  finishHandoff,
  resolveHandoff,
  readHandoff,
  listHandoffs,
  type HandoffFile,
  type HandoffStatus,
  type HandoffDecision,
  HANDOFF_DIR,
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

// ─── HandoffFile, HandoffStatus, HandoffDecision types ────────────────────

describe('HandoffFile interface and type definitions', () => {
  it('should have HANDOFF_DIR set to .flow-engine/sflow/handoffs', () => {
    expect(HANDOFF_DIR).toBe('.flow-engine/sflow/handoffs');
  });

  it('should allow constructing a valid HandoffFile with all fields', () => {
    const hf: HandoffFile = {
      id: 'ho-001',
      type: 'task-handoff',
      objective: 'Implement auth module',
      expectedOutput: 'Working auth with JWT',
      acceptance: 'All auth tests pass',
      boundary: 'Only auth module, no UI changes',
      status: 'created',
      decision: 'accept',
      decisionReason: 'Output matches expected',
      output: 'Auth module implemented with JWT',
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
    };
    expect(hf.id).toBe('ho-001');
    expect(hf.status).toBe('created');
    expect(hf.decision).toBe('accept');
  });

  it('should allow HandoffFile with only required fields', () => {
    const hf: HandoffFile = {
      id: 'ho-002',
      type: 'task-handoff',
      objective: 'Implement auth module',
      expectedOutput: 'Working auth with JWT',
      acceptance: 'All auth tests pass',
      boundary: 'Only auth module, no UI changes',
      status: 'created',
      createdAt: new Date().toISOString(),
    };
    expect(hf.decision).toBeUndefined();
    expect(hf.decisionReason).toBeUndefined();
    expect(hf.output).toBeUndefined();
    expect(hf.finishedAt).toBeUndefined();
    expect(hf.resolvedAt).toBeUndefined();
  });

  it('should have correct HandoffStatus type values', () => {
    const statuses: HandoffStatus[] = ['created', 'finished', 'resolved'];
    expect(statuses).toHaveLength(3);
    expect(statuses).toContain('created');
    expect(statuses).toContain('finished');
    expect(statuses).toContain('resolved');
  });

  it('should have correct HandoffDecision type values', () => {
    const decisions: HandoffDecision[] = ['accept', 'reject', 'defer'];
    expect(decisions).toHaveLength(3);
    expect(decisions).toContain('accept');
    expect(decisions).toContain('reject');
    expect(decisions).toContain('defer');
  });
});

// ─── createHandoff ──────────────────────────────────────────────────────

describe('createHandoff', () => {
  const dir = tempDir('handoff-create');

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

  it('should create handoff file with status "created" and generated id', async () => {
    const handoff = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Implement auth module',
      expectedOutput: 'Working auth with JWT',
      acceptance: 'All auth tests pass',
      boundary: 'Only auth module, no UI changes',
    });

    expect(handoff.id).toBeTruthy();
    expect(handoff.status).toBe('created');
    expect(handoff.type).toBe('task-handoff');
    expect(handoff.objective).toBe('Implement auth module');
    expect(handoff.expectedOutput).toBe('Working auth with JWT');
    expect(handoff.acceptance).toBe('All auth tests pass');
    expect(handoff.boundary).toBe('Only auth module, no UI changes');
    expect(handoff.createdAt).toBeTruthy();
    expect(handoff.decision).toBeUndefined();
    expect(handoff.output).toBeUndefined();
  });

  it('should persist handoff to .flow-engine/sflow/handoffs/<id>.json', async () => {
    const handoff = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Test persistence',
      expectedOutput: 'File exists on disk',
      acceptance: 'File readable',
      boundary: 'None',
    });

    const filePath = dir + '/.flow-engine/sflow/handoffs/' + handoff.id + '.json';
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe(handoff.id);
    expect(parsed.status).toBe('created');
    expect(parsed.objective).toBe('Test persistence');
  });

  it('should generate unique IDs for different handoffs', async () => {
    const h1 = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'First handoff',
      expectedOutput: 'Output 1',
      acceptance: 'Accept 1',
      boundary: 'Boundary 1',
    });

    const h2 = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Second handoff',
      expectedOutput: 'Output 2',
      acceptance: 'Accept 2',
      boundary: 'Boundary 2',
    });

    expect(h1.id).not.toBe(h2.id);
  });

  it('should create handoffs directory if not exists', async () => {
    // Don't create handoffs dir — createHandoff should create it
    const handoff = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Auto-create dir',
      expectedOutput: 'Dir created',
      acceptance: 'Dir exists',
      boundary: 'None',
    });

    const filePath = dir + '/.flow-engine/sflow/handoffs/' + handoff.id + '.json';
    const content = await readFile(filePath, 'utf-8');
    expect(content).toBeTruthy();
  });

  it('should set createdAt to a valid ISO 8601 timestamp', async () => {
    const before = new Date().toISOString();
    const handoff = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Timestamp test',
      expectedOutput: 'Valid ISO timestamp',
      acceptance: 'Parseable date',
      boundary: 'None',
    });
    const after = new Date().toISOString();

    const createdAt = new Date(handoff.createdAt);
    expect(createdAt.getTime()).not.toBeNaN();
    expect(handoff.createdAt >= before).toBe(true);
    expect(handoff.createdAt <= after).toBe(true);
  });

  it('should allow optional fields in params (decision, decisionReason, output, finishedAt, resolvedAt)', async () => {
    const handoff = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Optional fields test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
      decision: 'accept',
      decisionReason: 'Pre-filled for testing',
      output: 'Pre-filled output',
      finishedAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
    });

    expect(handoff.decision).toBe('accept');
    expect(handoff.decisionReason).toBe('Pre-filled for testing');
    expect(handoff.output).toBe('Pre-filled output');
    expect(handoff.finishedAt).toBeTruthy();
    expect(handoff.resolvedAt).toBeTruthy();
  });
});

// ─── finishHandoff ──────────────────────────────────────────────────────

describe('finishHandoff', () => {
  const dir = tempDir('handoff-finish');

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

  it('should update status to "finished" and set output and finishedAt', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Finish test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });

    const finished = await finishHandoff(dir, created.id, 'Task completed successfully');

    expect(finished.status).toBe('finished');
    expect(finished.output).toBe('Task completed successfully');
    expect(finished.finishedAt).toBeTruthy();
    expect(finished.id).toBe(created.id);
  });

  it('should persist finishedAt as valid ISO 8601 timestamp', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Timestamp test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });

    const finished = await finishHandoff(dir, created.id, 'Done');

    const finishedAt = new Date(finished.finishedAt!);
    expect(finishedAt.getTime()).not.toBeNaN();
  });

  it('should preserve all other fields when finishing', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Preserve fields',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'Boundary value',
    });

    const finished = await finishHandoff(dir, created.id, 'Done');

    expect(finished.type).toBe('task-handoff');
    expect(finished.objective).toBe('Preserve fields');
    expect(finished.expectedOutput).toBe('Output');
    expect(finished.acceptance).toBe('Accept');
    expect(finished.boundary).toBe('Boundary value');
    expect(finished.createdAt).toBe(created.createdAt);
  });

  it('should throw when handoff not found', async () => {
    await expect(
      finishHandoff(dir, 'nonexistent-id', 'output')
    ).rejects.toThrow();
  });

  it('should throw when handoff is already finished', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Double finish test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });

    await finishHandoff(dir, created.id, 'First finish');

    await expect(
      finishHandoff(dir, created.id, 'Second finish')
    ).rejects.toThrow();
  });
});

// ─── resolveHandoff ─────────────────────────────────────────────────────

describe('resolveHandoff', () => {
  const dir = tempDir('handoff-resolve');

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

  it('should resolve with accept decision', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Accept test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });
    await finishHandoff(dir, created.id, 'Done');

    const resolved = await resolveHandoff(dir, created.id, 'accept');

    expect(resolved.status).toBe('resolved');
    expect(resolved.decision).toBe('accept');
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it('should resolve with reject decision and reason', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Reject test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });
    await finishHandoff(dir, created.id, 'Done');

    const resolved = await resolveHandoff(dir, created.id, 'reject', 'Output does not meet acceptance criteria');

    expect(resolved.status).toBe('resolved');
    expect(resolved.decision).toBe('reject');
    expect(resolved.decisionReason).toBe('Output does not meet acceptance criteria');
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it('should resolve with defer decision and reason', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Defer test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });
    await finishHandoff(dir, created.id, 'Done');

    const resolved = await resolveHandoff(dir, created.id, 'defer', 'Waiting for external dependency');

    expect(resolved.status).toBe('resolved');
    expect(resolved.decision).toBe('defer');
    expect(resolved.decisionReason).toBe('Waiting for external dependency');
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it('should resolve with accept without reason', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'No reason test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });
    await finishHandoff(dir, created.id, 'Done');

    const resolved = await resolveHandoff(dir, created.id, 'accept');

    expect(resolved.decision).toBe('accept');
    expect(resolved.decisionReason).toBeUndefined();
  });

  it('should set resolvedAt as valid ISO 8601 timestamp', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Timestamp test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });
    await finishHandoff(dir, created.id, 'Done');

    const resolved = await resolveHandoff(dir, created.id, 'accept');

    const resolvedAt = new Date(resolved.resolvedAt!);
    expect(resolvedAt.getTime()).not.toBeNaN();
  });

  it('should throw when handoff not found', async () => {
    await expect(
      resolveHandoff(dir, 'nonexistent-id', 'accept')
    ).rejects.toThrow();
  });

  it('should throw when handoff is not in "finished" status', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Invalid state test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });

    // Handoff is still in "created" status, not "finished"
    await expect(
      resolveHandoff(dir, created.id, 'accept')
    ).rejects.toThrow();
  });

  it('should preserve all other fields when resolving', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Preserve fields',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'Boundary value',
    });
    await finishHandoff(dir, created.id, 'Task output');

    const resolved = await resolveHandoff(dir, created.id, 'accept');

    expect(resolved.type).toBe('task-handoff');
    expect(resolved.objective).toBe('Preserve fields');
    expect(resolved.output).toBe('Task output');
    expect(resolved.boundary).toBe('Boundary value');
  });
});

// ─── readHandoff ────────────────────────────────────────────────────────

describe('readHandoff', () => {
  const dir = tempDir('handoff-read');

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

  it('should read existing handoff file', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Read test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });

    const result = await readHandoff(dir, created.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(created.id);
    expect(result!.objective).toBe('Read test');
    expect(result!.status).toBe('created');
  });

  it('should return null when handoff file does not exist', async () => {
    const result = await readHandoff(dir, 'nonexistent-id');
    expect(result).toBeNull();
  });

  it('should return null when handoffs directory does not exist', async () => {
    await rm(dir + '/.flow-engine/sflow', { recursive: true, force: true });
    const result = await readHandoff(dir, 'any-id');
    expect(result).toBeNull();
  });
});

// ─── listHandoffs ───────────────────────────────────────────────────────

describe('listHandoffs', () => {
  const dir = tempDir('handoff-list');

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

  it('should return array of handoff summaries', async () => {
    await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'First',
      expectedOutput: 'Output 1',
      acceptance: 'Accept 1',
      boundary: 'None',
    });
    await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Second',
      expectedOutput: 'Output 2',
      acceptance: 'Accept 2',
      boundary: 'None',
    });

    const handoffs = await listHandoffs(dir);
    expect(handoffs).toHaveLength(2);
    expect(handoffs.some(h => h.objective === 'First')).toBe(true);
    expect(handoffs.some(h => h.objective === 'Second')).toBe(true);
  });

  it('should return empty array when no handoffs exist', async () => {
    const handoffs = await listHandoffs(dir);
    expect(handoffs).toEqual([]);
  });

  it('should return empty array when handoffs directory does not exist', async () => {
    await rm(dir + '/.flow-engine/sflow', { recursive: true, force: true });
    const handoffs = await listHandoffs(dir);
    expect(handoffs).toEqual([]);
  });

  it('should return full HandoffFile objects with all fields', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Full fields test',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'Boundary',
    });

    const handoffs = await listHandoffs(dir);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].id).toBe(created.id);
    expect(handoffs[0].type).toBe('task-handoff');
    expect(handoffs[0].status).toBe('created');
    expect(handoffs[0].objective).toBe('Full fields test');
    expect(handoffs[0].expectedOutput).toBe('Output');
    expect(handoffs[0].acceptance).toBe('Accept');
    expect(handoffs[0].boundary).toBe('Boundary');
  });
});

// ─── Integration: create → finish → resolve(accept) → read ─────────────

describe('Handoff integration: create → finish → resolve(accept) → read', () => {
  const dir = tempDir('handoff-integration');

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

  it('should complete full lifecycle: create, finish, resolve(accept), read confirms final state', async () => {
    // 1. Create handoff
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Integration test',
      expectedOutput: 'Working handoff lifecycle',
      acceptance: 'All lifecycle steps pass',
      boundary: 'Handoff module only',
    });
    expect(created.status).toBe('created');
    expect(created.decision).toBeUndefined();

    // 2. Read it back — should be "created"
    let read = await readHandoff(dir, created.id);
    expect(read).not.toBeNull();
    expect(read!.status).toBe('created');

    // 3. Finish handoff
    const finished = await finishHandoff(dir, created.id, 'Auth module implemented with tests');
    expect(finished.status).toBe('finished');
    expect(finished.output).toBe('Auth module implemented with tests');
    expect(finished.finishedAt).toBeTruthy();

    // 4. Read it back — should be "finished"
    read = await readHandoff(dir, created.id);
    expect(read!.status).toBe('finished');
    expect(read!.output).toBe('Auth module implemented with tests');

    // 5. Resolve with accept
    const resolved = await resolveHandoff(dir, created.id, 'accept', 'Output meets acceptance criteria');
    expect(resolved.status).toBe('resolved');
    expect(resolved.decision).toBe('accept');
    expect(resolved.decisionReason).toBe('Output meets acceptance criteria');
    expect(resolved.resolvedAt).toBeTruthy();

    // 6. Read it back — should be "resolved"
    read = await readHandoff(dir, created.id);
    expect(read!.status).toBe('resolved');
    expect(read!.decision).toBe('accept');
    expect(read!.decisionReason).toBe('Output meets acceptance criteria');

    // 7. List handoffs — should include the resolved one
    const handoffs = await listHandoffs(dir);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].status).toBe('resolved');
  });

  it('should complete lifecycle with reject decision', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Reject lifecycle',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });
    await finishHandoff(dir, created.id, 'Incomplete output');
    const resolved = await resolveHandoff(dir, created.id, 'reject', 'Missing test coverage');

    expect(resolved.status).toBe('resolved');
    expect(resolved.decision).toBe('reject');
    expect(resolved.decisionReason).toBe('Missing test coverage');
  });

  it('should complete lifecycle with defer decision', async () => {
    const created = await createHandoff(dir, {
      type: 'task-handoff',
      objective: 'Defer lifecycle',
      expectedOutput: 'Output',
      acceptance: 'Accept',
      boundary: 'None',
    });
    await finishHandoff(dir, created.id, 'Partial output');
    const resolved = await resolveHandoff(dir, created.id, 'defer', 'Waiting for API spec');

    expect(resolved.status).toBe('resolved');
    expect(resolved.decision).toBe('defer');
    expect(resolved.decisionReason).toBe('Waiting for API spec');
  });
});
