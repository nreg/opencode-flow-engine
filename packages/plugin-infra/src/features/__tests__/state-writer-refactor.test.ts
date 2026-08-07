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
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
    await writeStateFile(dir, 'exploring');

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
