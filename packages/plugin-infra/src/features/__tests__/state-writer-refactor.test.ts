/**
 * State Writer Refactor Tests — Lock behavior before refactoring
 * 
 * These tests ensure that the refactored writeStateFile maintains
 * exact same behavior as the original implementation.
 * 
 * Tests cover:
 * - AFK auto-deactivation on terminal states
 * - AFK consistency check (afk=false → afkTier=0)
 * - DP-4 special handling (dp_4_result)
 * - Generic decisionPoint handling
 * - All behaviors combined
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeStateFile } from '../state-manager/state-writer.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function readStateJson(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// =============================================================================
// P1-1: Single Responsibility Principle — AFK auto-deactivation
// =============================================================================
describe('writeStateFile — AFK auto-deactivation (SRP)', () => {
  const dir = tempDir('state-writer-afk-deactivation');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should deactivate AFK when transitioning to closing', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'executing', mode: 'full', afk: true, afkTier: 3 })
    );

    await writeStateFile(dir, 'closing');

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('closing');
    expect(state!.afk).toBe(false);
    expect(state!.afkTier).toBe(0);
  });

  it('should deactivate AFK when transitioning to abandoned', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'executing', mode: 'full', afk: true, afkTier: 5 })
    );

    await writeStateFile(dir, 'abandoned');

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('abandoned');
    expect(state!.afk).toBe(false);
    expect(state!.afkTier).toBe(0);
  });

  it('should NOT deactivate AFK when transitioning to non-terminal state', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full', afk: true, afkTier: 2 })
    );

    await writeStateFile(dir, 'specifying');

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('specifying');
    expect(state!.afk).toBe(true);
    expect(state!.afkTier).toBe(2);
  });
});

// =============================================================================
// P1-1: Single Responsibility Principle — AFK consistency check
// =============================================================================
describe('writeStateFile — AFK consistency check (SRP)', () => {
  const dir = tempDir('state-writer-afk-consistency');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should reset afkTier to 0 when afk is set to false', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'executing', mode: 'full', afk: true, afkTier: 3 })
    );

    await writeStateFile(dir, 'executing', { afk: false });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.afk).toBe(false);
    expect(state!.afkTier).toBe(0);
  });

  it('should NOT change afkTier when afk is true', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'executing', mode: 'full', afk: false, afkTier: 0 })
    );

    await writeStateFile(dir, 'executing', { afk: true, afkTier: 2 });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.afk).toBe(true);
    expect(state!.afkTier).toBe(2);
  });
});

// =============================================================================
// P1-2: DP-4 special handling
// =============================================================================
describe('writeStateFile — DP-4 special handling', () => {
  const dir = tempDir('state-writer-dp4');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should append DP-4 entry when dp_4_result is provided', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'bridging', mode: 'full' })
    );

    await writeStateFile(dir, 'approved-for-build', {
      dp_4_result: {
        mode: 'inline',
        taskCount: 2,
        hasDependencies: false,
        rationale: 'Simple tasks, no dependencies',
      },
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('approved-for-build');
    expect(Array.isArray(state!.decisionPoints)).toBe(true);
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    const dp4 = dps.find(dp => dp.id === 'dp-4');
    expect(dp4).toBeDefined();
    expect(dp4!.mode).toBe('inline');
    expect(dp4!.rationale).toBe('Simple tasks, no dependencies');
    expect(dp4!.timestamp).toBeDefined();
  });

  it('should update existing DP-4 entry', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({
        state: 'bridging',
        mode: 'full',
        decisionPoints: [
          {
            id: 'dp-4',
            mode: 'sdd',
            rationale: 'Initial recommendation',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    await writeStateFile(dir, 'approved-for-build', {
      dp_4_result: {
        mode: 'inline',
        taskCount: 1,
        hasDependencies: false,
        rationale: 'Updated recommendation',
      },
    });

    const state = await readStateJson(dir);
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    const dp4 = dps.find(dp => dp.id === 'dp-4');
    expect(dp4).toBeDefined();
    expect(dp4!.mode).toBe('inline');
    expect(dp4!.rationale).toBe('Updated recommendation');
    // Should have exactly one DP-4 entry (updated, not duplicated)
    expect(dps.filter(dp => dp.id === 'dp-4')).toHaveLength(1);
  });

  it('should preserve other decisionPoints when updating DP-4', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({
        state: 'bridging',
        mode: 'full',
        decisionPoints: [
          {
            id: 'dp-3',
            name: 'Contract Approval',
            confirmedInState: 'bridging',
            targetState: 'approved-for-build',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    await writeStateFile(dir, 'approved-for-build', {
      dp_4_result: {
        mode: 'inline',
        taskCount: 2,
        hasDependencies: false,
        rationale: 'Simple tasks',
      },
    });

    const state = await readStateJson(dir);
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    expect(dps).toHaveLength(2);
    const dp3 = dps.find(dp => dp.id === 'dp-3');
    expect(dp3).toBeDefined();
    const dp4 = dps.find(dp => dp.id === 'dp-4');
    expect(dp4).toBeDefined();
  });
});

// =============================================================================
// P1-2: Generic decisionPoint handling
// =============================================================================
describe('writeStateFile — Generic decisionPoint handling', () => {
  const dir = tempDir('state-writer-generic-dp');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should append decisionPoint entry', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    await writeStateFile(dir, 'specifying', {
      decisionPoint: {
        id: 'dp-0',
        name: 'Language Detection',
        confirmedInState: 'exploring',
        targetState: 'specifying',
        metadata: 'Detected TypeScript project',
      },
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(Array.isArray(state!.decisionPoints)).toBe(true);
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    const dp0 = dps.find(dp => dp.id === 'dp-0');
    expect(dp0).toBeDefined();
    expect(dp0!.name).toBe('Language Detection');
    expect(dp0!.confirmedInState).toBe('exploring');
    expect(dp0!.targetState).toBe('specifying');
    expect(dp0!.timestamp).toBeDefined();
  });

  it('should update existing decisionPoint entry', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({
        state: 'exploring',
        mode: 'full',
        decisionPoints: [
          {
            id: 'dp-0',
            name: 'Language Detection',
            confirmedInState: 'exploring',
            targetState: 'specifying',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    await writeStateFile(dir, 'specifying', {
      decisionPoint: {
        id: 'dp-0',
        name: 'Language Detection',
        confirmedInState: 'exploring',
        targetState: 'specifying',
        metadata: 'Updated metadata',
      },
    });

    const state = await readStateJson(dir);
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    const dp0 = dps.find(dp => dp.id === 'dp-0');
    expect(dp0).toBeDefined();
    expect(dp0!.metadata).toBe('Updated metadata');
    // Should have exactly one DP-0 entry (updated, not duplicated)
    expect(dps.filter(dp => dp.id === 'dp-0')).toHaveLength(1);
  });
});

// =============================================================================
// P1-4: Boundary test — dp_4_result and decisionPoint coexistence
// =============================================================================
describe('writeStateFile — dp_4_result and decisionPoint coexistence', () => {
  const dir = tempDir('state-writer-dp-coexistence');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should handle both dp_4_result and decisionPoint in same call', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'bridging', mode: 'full' })
    );

    await writeStateFile(dir, 'approved-for-build', {
      dp_4_result: {
        mode: 'inline',
        taskCount: 2,
        hasDependencies: false,
        rationale: 'Simple tasks',
      },
      decisionPoint: {
        id: 'dp-3',
        name: 'Contract Approval',
        confirmedInState: 'bridging',
        targetState: 'approved-for-build',
        metadata: 'Contract validated',
      },
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(Array.isArray(state!.decisionPoints)).toBe(true);
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    
    // Both DP-4 and DP-3 should be present
    expect(dps).toHaveLength(2);
    
    const dp4 = dps.find(dp => dp.id === 'dp-4');
    expect(dp4).toBeDefined();
    expect(dp4!.mode).toBe('inline');
    expect(dp4!.rationale).toBe('Simple tasks');
    expect(dp4!.timestamp).toBeDefined();
    
    const dp3 = dps.find(dp => dp.id === 'dp-3');
    expect(dp3).toBeDefined();
    expect(dp3!.name).toBe('Contract Approval');
    expect(dp3!.metadata).toBe('Contract validated');
    expect(dp3!.timestamp).toBeDefined();
  });

  it('should update both dp_4_result and decisionPoint when they exist', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({
        state: 'bridging',
        mode: 'full',
        decisionPoints: [
          {
            id: 'dp-4',
            mode: 'sdd',
            rationale: 'Initial recommendation',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
          {
            id: 'dp-3',
            name: 'Contract Approval',
            confirmedInState: 'bridging',
            targetState: 'approved-for-build',
            metadata: 'Initial metadata',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    await writeStateFile(dir, 'approved-for-build', {
      dp_4_result: {
        mode: 'inline',
        taskCount: 1,
        hasDependencies: false,
        rationale: 'Updated recommendation',
      },
      decisionPoint: {
        id: 'dp-3',
        name: 'Contract Approval',
        confirmedInState: 'bridging',
        targetState: 'approved-for-build',
        metadata: 'Updated metadata',
      },
    });

    const state = await readStateJson(dir);
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    
    // Should still have exactly 2 entries (updated, not duplicated)
    expect(dps).toHaveLength(2);
    
    const dp4 = dps.find(dp => dp.id === 'dp-4');
    expect(dp4).toBeDefined();
    expect(dp4!.mode).toBe('inline');
    expect(dp4!.rationale).toBe('Updated recommendation');
    
    const dp3 = dps.find(dp => dp.id === 'dp-3');
    expect(dp3).toBeDefined();
    expect(dp3!.metadata).toBe('Updated metadata');
    
    // Ensure no duplicates
    expect(dps.filter(dp => dp.id === 'dp-4')).toHaveLength(1);
    expect(dps.filter(dp => dp.id === 'dp-3')).toHaveLength(1);
  });

  it('should preserve other decisionPoints when adding both dp_4_result and decisionPoint', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({
        state: 'bridging',
        mode: 'full',
        decisionPoints: [
          {
            id: 'dp-0',
            name: 'Language Detection',
            confirmedInState: 'exploring',
            targetState: 'specifying',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    await writeStateFile(dir, 'approved-for-build', {
      dp_4_result: {
        mode: 'inline',
        taskCount: 2,
        hasDependencies: false,
        rationale: 'Simple tasks',
      },
      decisionPoint: {
        id: 'dp-3',
        name: 'Contract Approval',
        confirmedInState: 'bridging',
        targetState: 'approved-for-build',
      },
    });

    const state = await readStateJson(dir);
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    
    // Should have 3 entries: dp-0 (existing), dp-4 (new), dp-3 (new)
    expect(dps).toHaveLength(3);
    
    const dp0 = dps.find(dp => dp.id === 'dp-0');
    expect(dp0).toBeDefined();
    expect(dp0!.name).toBe('Language Detection');
    
    const dp4 = dps.find(dp => dp.id === 'dp-4');
    expect(dp4).toBeDefined();
    
    const dp3 = dps.find(dp => dp.id === 'dp-3');
    expect(dp3).toBeDefined();
  });
});

// =============================================================================
// Combined behavior tests
// =============================================================================
describe('writeStateFile — Combined behaviors', () => {
  const dir = tempDir('state-writer-combined');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should apply all transformations in correct order', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({
        state: 'bridging',
        mode: 'full',
        afk: true,
        afkTier: 3,
        decisionPoints: [
          {
            id: 'dp-3',
            name: 'Contract Approval',
            confirmedInState: 'bridging',
            targetState: 'approved-for-build',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    await writeStateFile(dir, 'approved-for-build', {
      afk: false,
      dp_4_result: {
        mode: 'inline',
        taskCount: 2,
        hasDependencies: false,
        rationale: 'Simple tasks',
      },
      decisionPoint: {
        id: 'dp-4',
        name: 'Execution Mode Selection',
        confirmedInState: 'bridging',
        targetState: 'approved-for-build',
        metadata: 'Auto-recommended inline mode',
      },
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('approved-for-build');
    
    // AFK consistency should be applied
    expect(state!.afk).toBe(false);
    expect(state!.afkTier).toBe(0);
    
    // Both DP-4 entries should be present (dp_4_result and decisionPoint)
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    expect(dps).toHaveLength(2);
    const dp3 = dps.find(dp => dp.id === 'dp-3');
    expect(dp3).toBeDefined();
    const dp4 = dps.find(dp => dp.id === 'dp-4');
    expect(dp4).toBeDefined();
  });

  it('should create new state file if not exists', async () => {
    const result = await writeStateFile(dir, 'exploring');
    
    expect(result.success).toBe(true);

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('exploring');
    expect(state!.mode).toBe('full');
    expect(state!.afk).toBe(false);
    expect(state!.afkTier).toBe(0);
    expect(state!.createdAt).toBeDefined();
    expect(state!.updatedAt).toBeDefined();
  });
});

// =============================================================================
// P1-2: Defensive checks for malformed decisionPoint input
// =============================================================================
describe('writeStateFile — defensive checks for malformed decisionPoint', () => {
  const dir = tempDir('state-writer-malformed-dp');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should skip null decisionPoint without error', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    // @ts-expect-error - testing malformed input
    await writeStateFile(dir, 'specifying', { decisionPoint: null });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('specifying');
    expect(state!.decisionPoints).toBeUndefined();
  });

  it('should skip decisionPoint without id field without error', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    await writeStateFile(dir, 'specifying', {
      decisionPoint: { rationale: 'test' }
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('specifying');
    expect(state!.decisionPoints).toBeUndefined();
  });

  it('should skip decisionPoint with non-string id without error', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    await writeStateFile(dir, 'specifying', {
      decisionPoint: { id: 123, rationale: 'test' }
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('specifying');
    expect(state!.decisionPoints).toBeUndefined();
  });

  it('should handle valid decisionPoint alongside malformed ones', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    await writeStateFile(dir, 'specifying', {
      decisionPoint: { id: 'dp-1', rationale: 'valid' }
    });

    let state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.decisionPoints).toBeDefined();
    expect(Array.isArray(state!.decisionPoints)).toBe(true);
    expect((state!.decisionPoints as any[]).length).toBe(1);

    await writeStateFile(dir, 'bridging', {
      decisionPoint: { rationale: 'no-id' }
    });

    state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('bridging');
    expect((state!.decisionPoints as any[]).length).toBe(1);
    expect((state!.decisionPoints as any[])[0].id).toBe('dp-1');
  });
});

// =============================================================================
// End-to-End Persistence Verification — Prevent regression of DP persistence issues
// =============================================================================
describe('writeStateFile — End-to-End DP persistence (E2E)', () => {
  const dir = tempDir('state-writer-e2e-persistence');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should persist decisionPoints to state.json after writeStateFile', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    await writeStateFile(dir, 'specifying', {
      decisionPoint: { id: 'dp-1', rationale: 'test rationale' }
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.decisionPoints).toBeDefined();
    expect(Array.isArray(state!.decisionPoints)).toBe(true);
    expect((state!.decisionPoints as any[]).length).toBe(1);
    
    const dp = (state!.decisionPoints as any[])[0];
    expect(dp.id).toBe('dp-1');
    expect(dp.rationale).toBe('test rationale');
    expect(dp.timestamp).toBeDefined();
  });

  it('should persist DP-4 result to state.json decisionPoints', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'bridging', mode: 'full' })
    );

    await writeStateFile(dir, 'approved-for-build', {
      dp_4_result: { mode: 'inline', rationale: '2 tasks, no dependencies' }
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.decisionPoints).toBeDefined();
    expect(Array.isArray(state!.decisionPoints)).toBe(true);
    expect((state!.decisionPoints as any[]).length).toBe(1);
    
    const dp = (state!.decisionPoints as any[])[0];
    expect(dp.id).toBe('dp-4');
    expect(dp.mode).toBe('inline');
    expect(dp.rationale).toBe('2 tasks, no dependencies');
    expect(dp.timestamp).toBeDefined();
  });

  it('should persist multiple decisionPoints across sequential writes', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    await writeStateFile(dir, 'specifying', {
      decisionPoint: { id: 'dp-1', rationale: 'first decision' }
    });

    let state = await readStateJson(dir);
    expect((state!.decisionPoints as any[]).length).toBe(1);

    await writeStateFile(dir, 'bridging', {
      decisionPoint: { id: 'dp-2', rationale: 'second decision' }
    });

    state = await readStateJson(dir);
    expect((state!.decisionPoints as any[]).length).toBe(2);
    expect((state!.decisionPoints as any[]).map((dp: any) => dp.id)).toEqual(['dp-1', 'dp-2']);
  });

  it('should update existing decisionPoint and persist the update', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    await writeStateFile(dir, 'specifying', {
      decisionPoint: { id: 'dp-1', rationale: 'initial' }
    });

    let state = await readStateJson(dir);
    expect((state!.decisionPoints as any[])[0].rationale).toBe('initial');

    await writeStateFile(dir, 'bridging', {
      decisionPoint: { id: 'dp-1', rationale: 'updated' }
    });

    state = await readStateJson(dir);
    expect((state!.decisionPoints as any[]).length).toBe(1);
    expect((state!.decisionPoints as any[])[0].rationale).toBe('updated');
  });
});

// =============================================================================
// P0 Fix: decisionPoints field protection in writeStateFile
// =============================================================================
describe('writeStateFile — decisionPoints field protection (P0 fix)', () => {
  const dir = tempDir('state-writer-dp-protection');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should NOT overwrite existing decisionPoints when extra.decisionPoints is provided', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({
        state: 'exploring',
        mode: 'full',
        decisionPoints: [
          {
            id: 'dp-0',
            name: 'Existing DP',
            timestamp: '2025-01-01T00:00:00.000Z',
          },
        ],
      })
    );

    await writeStateFile(dir, 'specifying', {
      decisionPoints: [],
      mode: 'tweak',
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(Array.isArray(state!.decisionPoints)).toBe(true);
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    expect(dps).toHaveLength(1);
    expect(dps[0].id).toBe('dp-0');
    expect(state!.mode).toBe('tweak');
  });

  it('should NOT pollute state top-level with decisionPoint from extra', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    await writeStateFile(dir, 'specifying', {
      decisionPoint: {
        id: 'dp-1',
        name: 'Test DP',
        rationale: 'test',
      },
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.decisionPoint).toBeUndefined();
    expect(Array.isArray(state!.decisionPoints)).toBe(true);
    const dps = state!.decisionPoints as Array<Record<string, unknown>>;
    expect(dps).toHaveLength(1);
    expect(dps[0].id).toBe('dp-1');
  });

  it('should allow normal extra fields to override state', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({
        state: 'exploring',
        mode: 'full',
        afk: false,
        afkTier: 0,
      })
    );

    await writeStateFile(dir, 'specifying', {
      mode: 'hotfix',
      afk: true,
      afkTier: 2,
      customField: 'custom value',
    });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.mode).toBe('hotfix');
    expect(state!.afk).toBe(true);
    expect(state!.afkTier).toBe(2);
    expect(state!.customField).toBe('custom value');
  });
});

// =============================================================================
// P0: TOCTOU Race Condition Fix — Atomic state transition validation
// =============================================================================
describe('writeStateFile — TOCTOU race condition (P0 fix)', () => {
  const dir = tempDir('state-writer-toctou-race');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should reject concurrent state transition when state changed between read and write', async () => {
    // Initial state: exploring
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    // P0 fix: Atomic state transition validation within mutex
    // Two concurrent calls with same expected state - only one should succeed
    
    // Start both calls concurrently (they will serialize due to mutex)
    const call1Promise = writeStateFile(dir, 'specifying', undefined, { validateTransitionFrom: 'exploring' });
    const call2Promise = writeStateFile(dir, 'abandoned', undefined, { validateTransitionFrom: 'exploring' });

    const [result1, result2] = await Promise.all([call1Promise, call2Promise]);

    // One should succeed, one should fail due to concurrent state change
    const successCount = [result1, result2].filter(r => r.success).length;
    const failureCount = [result1, result2].filter(r => !r.success).length;

    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    // Check that the failure is due to concurrent state change
    const failedResult = [result1, result2].find(r => !r.success);
    expect(failedResult!.error).toContain('State changed concurrently');
  });

  it('should reject invalid state transition within mutex', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    // Try invalid transition: exploring -> executing (not allowed)
    const result = await writeStateFile(dir, 'executing', undefined, { validateTransitionFrom: 'exploring' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid state transition');
  });

  it('should succeed when state matches expected and transition is valid', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    const result = await writeStateFile(dir, 'specifying', undefined, { validateTransitionFrom: 'exploring' });

    expect(result.success).toBe(true);

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('specifying');
  });

  it('should maintain backward compatibility when validateTransitionFrom is not provided', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'exploring', mode: 'full' })
    );

    // Old behavior: no validation option, just write
    await writeStateFile(dir, 'specifying');

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('specifying');
  });
});

// =============================================================================
// P1-1: Non-array decisionPoints handling — Preserve with warning
// =============================================================================
describe('writeStateFile — non-array decisionPoints handling (P1-1 fix)', () => {
  const dir = tempDir('state-writer-non-array-dps');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should preserve non-array decisionPoints and log warning', async () => {
    // Create malformed state with non-array decisionPoints
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({
        state: 'exploring',
        mode: 'full',
        decisionPoints: 'this-is-not-an-array', // Malformed data
      })
    );

    // Capture Logger.warn using spyOn for automatic restoration
    const { Logger } = await import('../../utils/logger.js');
    const warnSpy: string[] = [];
    const spy = spyOn(Logger, 'warn');
    spy.mockImplementation(async (message: string) => {
      warnSpy.push(message);
    });

    try {
      await writeStateFile(dir, 'specifying');

      const state = await readStateJson(dir);
      expect(state).not.toBeNull();
      // Should preserve the original malformed value
      expect(state!.decisionPoints).toBe('this-is-not-an-array');
      // Should have logged a warning
      expect(warnSpy.length).toBeGreaterThan(0);
      expect(warnSpy[0]).toContain('decisionPoints is not an array');
    } finally {
      spy.mockRestore();
    }
  });

  it('should handle null decisionPoints gracefully', async () => {
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({
        state: 'exploring',
        mode: 'full',
        decisionPoints: null,
      })
    );

    await writeStateFile(dir, 'specifying');

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    // null should be treated as missing, so decisionPoints should be created as array
    expect(Array.isArray(state!.decisionPoints)).toBe(true);
  });
});
