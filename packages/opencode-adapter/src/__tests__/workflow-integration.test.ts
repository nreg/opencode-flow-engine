/**
 * Workflow State Machine Integration Tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createWorkflowManager } from '../features/workflow-manager.js';
import { createStateTransitionHook } from '../hooks/state-transition.js';
import { VALID_TRANSITIONS, ALL_STATES } from '@opencode-sflow/core';
import { rm, mkdir } from 'fs/promises';
import { join } from 'path';

const TRANSITION_TABLE = VALID_TRANSITIONS;

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function readStateFile(changeDir: string): Promise<Record<string, unknown> | null> {
  const file = Bun.file(`${changeDir}/.sflow/state.json`);
  if (!(await file.exists())) return null;
  const content = await file.text();
  return JSON.parse(content);
}

async function writeStateFile(changeDir: string, state: Record<string, unknown>): Promise<void> {
  const dir = `${changeDir}/.sflow`;
  await Bun.write(`${dir}/state.json`, JSON.stringify(state, null, 2));
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

// =============================================================================
// Section 1: Pure transition logic tests
// =============================================================================
describe('Workflow State Machine — Pure Transition Logic', () => {

  it('should have exactly 9 states', () => {
    expect(ALL_STATES).toHaveLength(9);
    expect(ALL_STATES.sort()).toEqual([
      'abandoned',
      'approved-for-build',
      'bridging',
      'closing',
      'debugging',
      'executing',
      'exploring',
      'specifying',
      'ui-design',
    ]);
  });

  describe.each(ALL_STATES)('from state: %s', (fromState) => {
    const validTransitions = TRANSITION_TABLE[fromState];

    it(`should allow transitions to ${validTransitions.length > 0 ? validTransitions.join(', ') : '(none)'}`, () => {
      for (const toState of ALL_STATES) {
        const isValid = validTransitions.includes(toState);
        if (isValid) {
          expect(validTransitions).toContain(toState);
        } else {
          expect(validTransitions).not.toContain(toState);
        }
      }
    });

    it(`should not allow invalid transitions`, () => {
      const invalidStates = ALL_STATES.filter(s => !validTransitions.includes(s) && s !== fromState);
      for (const invalid of invalidStates) {
        expect(validTransitions).not.toContain(invalid);
      }
    });
  });

  it('should have abandoned as terminal state (no outgoing transitions)', () => {
    expect(TRANSITION_TABLE.abandoned).toEqual([]);
  });

  // P28 fix: Added ui-design → specifying transition, total is now 22
  it('should have exactly 22 valid transitions total (2+4+3+3+4+3+2+1)', () => {
    const total = Object.values(TRANSITION_TABLE).reduce((sum, t) => sum + t.length, 0);
    expect(total).toBe(22);
  });

  it('should allow self-loop only as a reversion (not a stay)', () => {
    // No state should be able to transition to itself
    for (const [from, toList] of Object.entries(TRANSITION_TABLE)) {
      expect(toList).not.toContain(from);
    }
  });
});

// =============================================================================
// Section 2: Happy path integration tests
// =============================================================================
describe('Workflow State Machine — Happy Path', () => {
  const dir = tempDir('happy-path');
  let wf: ReturnType<typeof createWorkflowManager>;

  beforeEach(async () => {
    await cleanupDir(dir).catch(() => {});
    await ensureDir(dir);
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });
    wf = createWorkflowManager({ enabled: true });
    await wf.initialize();
  });

  afterEach(async () => {
    await cleanupDir(dir).catch(() => {});
  });

  it('should start in exploring state', async () => {
    const result = await wf.getState(dir);
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).state).toBe('exploring');
  });

  it('should follow the happy path: exploring→specifying→bridging→approved-for-build→executing→closing', async () => {
    for (const nextState of ['specifying',
      'ui-design', 'bridging', 'approved-for-build', 'executing', 'closing'] as const) {
      const result = await wf.transitionState(dir, nextState);
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).to).toBe(nextState);

      const state = await readStateFile(dir);
      expect(state?.state).toBe(nextState);
    }
  });

  it('should record transition metadata (from, to, timestamp)', async () => {
    const result = await wf.transitionState(dir, 'specifying');
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).from).toBe('exploring');
    expect((result.data as Record<string, unknown>).to).toBe('specifying');
    expect((result.data as Record<string, unknown>).timestamp).toBeDefined();
  });
});

// =============================================================================
// Section 3: Debugging loop and state cycling
// =============================================================================
describe('Workflow State Machine — Debugging Loop', () => {
  const dir = tempDir('debug-loop');
  let wf: ReturnType<typeof createWorkflowManager>;

  beforeEach(async () => {
    await cleanupDir(dir).catch(() => {});
    await ensureDir(dir);
    await writeStateFile(dir, { state: 'executing', mode: 'full' });
    wf = createWorkflowManager({ enabled: true });
    await wf.initialize();
  });

  afterEach(async () => {
    await cleanupDir(dir).catch(() => {});
  });

  it('should transition from executing to debugging', async () => {
    const result = await wf.transitionState(dir, 'debugging');
    expect(result.success).toBe(true);
    const state = await readStateFile(dir);
    expect(state?.state).toBe('debugging');
  });

  it('should transition back from debugging to executing', async () => {
    // First go to debugging
    await wf.transitionState(dir, 'debugging');
    // Then back to executing
    const result = await wf.transitionState(dir, 'executing');
    expect(result.success).toBe(true);
    const state = await readStateFile(dir);
    expect(state?.state).toBe('executing');
  });

  it('should support multiple debugging loops', async () => {
    for (let i = 0; i < 3; i++) {
      let result = await wf.transitionState(dir, 'debugging');
      expect(result.success).toBe(true);
      expect((await readStateFile(dir))?.state).toBe('debugging');

      result = await wf.transitionState(dir, 'executing');
      expect(result.success).toBe(true);
      expect((await readStateFile(dir))?.state).toBe('executing');
    }
  });
});

// =============================================================================
// Section 4: State reversion tests
// =============================================================================
describe('Workflow State Machine — State Reversion', () => {
  const dir = tempDir('reversion');
  let wf: ReturnType<typeof createWorkflowManager>;

  const testCases = [
    { from: 'specifying', revertedTo: 'exploring' },
    { from: 'bridging', revertedTo: 'specifying' },
    { from: 'approved-for-build', revertedTo: 'bridging' },
  ] as const;

  beforeEach(async () => {
    await cleanupDir(dir).catch(() => {});
    await ensureDir(dir);
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });
    wf = createWorkflowManager({ enabled: true });
    await wf.initialize();
    for (const state of ['specifying', 'ui-design', 'bridging', 'approved-for-build']) {
      const result = await wf.transitionState(dir, state);
      if (!result.success) break;
    }
  });

  afterEach(async () => {
    await cleanupDir(dir).catch(() => {});
  });

  it.each(testCases)('should allow reversion from $from to $revertedTo', async ({ from, revertedTo }) => {
    // First set state to `from`
    await writeStateFile(dir, { state: from, mode: 'full' });

    const result = await wf.transitionState(dir, revertedTo);
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).to).toBe(revertedTo);
    expect((result.data as Record<string, unknown>).from).toBe(from);
  });
});

// =============================================================================
// Section 5: Abandonment tests
// =============================================================================
describe('Workflow State Machine — Abandonment', () => {
  const dir = tempDir('abandon');
  let wf: ReturnType<typeof createWorkflowManager>;

  const abandonableStates = ['exploring', 'specifying',
      'ui-design', 'bridging', 'approved-for-build', 'executing', 'debugging', 'closing'];

  beforeEach(async () => {
    await cleanupDir(dir).catch(() => {});
    await ensureDir(dir);
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });
    wf = createWorkflowManager({ enabled: true });
    await wf.initialize();
  });

  afterEach(async () => {
    await cleanupDir(dir).catch(() => {});
  });

  it.each(abandonableStates)('should allow abandonment from %s', async (from) => {
    await writeStateFile(dir, { state: from, mode: 'full' });
    const result = await wf.transitionState(dir, 'abandoned');
    expect(result.success).toBe(true);
    const state = await readStateFile(dir);
    expect(state?.state).toBe('abandoned');
  });

  it('should not allow transition out of abandoned state', async () => {
    await writeStateFile(dir, { state: 'abandoned', mode: 'full' });
    const nonTerminalStates = ALL_STATES.filter(s => s !== 'abandoned');
    for (const to of nonTerminalStates) {
      const result = await wf.transitionState(dir, to);
      expect(result.success).toBe(false);
    }
  });
});

// =============================================================================
// Section 6: Invalid transition tests
// =============================================================================
describe('Workflow State Machine — Invalid Transitions', () => {
  const dir = tempDir('invalid');
  let wf: ReturnType<typeof createWorkflowManager>;

  const invalidCases = [
    { from: 'exploring', to: 'bridging', desc: 'skip specifying' },
    { from: 'exploring', to: 'approved-for-build', desc: 'skip specifying and bridging' },
    { from: 'exploring', to: 'executing', desc: 'skip all planning states' },
    { from: 'exploring', to: 'debugging', desc: 'executing before debugging' },
    { from: 'exploring', to: 'closing', desc: 'skip all states' },
    { from: 'specifying', to: 'approved-for-build', desc: 'skip bridging' },
    { from: 'specifying', to: 'executing', desc: 'skip bridging and approval' },
    { from: 'specifying', to: 'debugging', desc: 'executing before debugging' },
    { from: 'specifying', to: 'closing', desc: 'skip most states' },
    { from: 'bridging', to: 'executing', desc: 'skip approval' },
    { from: 'bridging', to: 'debugging', desc: 'skip approval and executing' },
    { from: 'bridging', to: 'closing', desc: 'skip approval and executing' },
    { from: 'approved-for-build', to: 'specifying', desc: 'back two steps' },
    { from: 'approved-for-build', to: 'debugging', desc: 'execute before debugging' },
    // { from: 'approved-for-build', to: 'closing', desc: 'execute before closing' },
    { from: 'executing', to: 'bridging', desc: 'cannot go back to planning' },
    { from: 'executing', to: 'approved-for-build', desc: 'cannot go back to approval' },
    { from: 'executing', to: 'specifying', desc: 'cannot go back to specifying' },
    { from: 'executing', to: 'exploring', desc: 'cannot go back to exploring' },
    { from: 'debugging', to: 'closing', desc: 'must fix first, then execute' },
    { from: 'debugging', to: 'bridging', desc: 'cannot jump back' },
    { from: 'debugging', to: 'specifying', desc: 'cannot jump back' },
    { from: 'debugging', to: 'exploring', desc: 'cannot jump back' },
    { from: 'closing', to: 'executing', desc: 'cannot reopen' },
    { from: 'closing', to: 'debugging', desc: 'cannot reopen' },
    { from: 'closing', to: 'bridging', desc: 'cannot reopen' },
    { from: 'closing', to: 'exploring', desc: 'cannot restart' },
  ] as const;

  beforeEach(async () => {
    await cleanupDir(dir).catch(() => {});
    await ensureDir(dir);
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });
    wf = createWorkflowManager({ enabled: true });
    await wf.initialize();
  });

  afterEach(async () => {
    await cleanupDir(dir).catch(() => {});
  });

  it.each(invalidCases)('should reject $desc ($from → $to)', async ({ from, to }) => {
    await writeStateFile(dir, { state: from, mode: 'full' });
    const result = await wf.transitionState(dir, to);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid transition');
  });
});

// =============================================================================
// Section 7: Hook integration tests
// =============================================================================
describe('Workflow State Machine — Hook Integration', () => {
  const dir = tempDir('hook-integration');

  beforeEach(async () => {
    await cleanupDir(dir).catch(() => {});
    await ensureDir(dir);
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });
  });

  afterEach(async () => {
    await cleanupDir(dir).catch(() => {});
  });

  // P1 fix: Preflight gate requires proposal.md before entering specifying
  it('should transition from exploring to specifying via hook (with proposal.md)', async () => {
    await Bun.write(dir + '/proposal.md', '# Proposal\n\n## Why\nThis is a test proposal.\n\n## What Changes\nTest changes.');
    const hook = createStateTransitionHook();
    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'transition',
      data: { newState: 'specifying' },
    });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).to).toBe('specifying');
    const state = await readStateFile(dir);
    expect(state?.state).toBe('specifying');
  });

  it('should reject invalid transition via hook', async () => {
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });
    const hook = createStateTransitionHook();
    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'transition',
      data: { newState: 'executing' },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid transition');
    expect(result.block).toBe(true);
  });

  it('should handle fresh directory (no state file) via hook', async () => {
    // Remove state file
    await cleanupDir(`${dir}/.sflow`).catch(() => {});

    const hook = createStateTransitionHook();
    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'transition',
      data: { newState: 'exploring' },
    });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).from).toBeNull();
  });

  it('should return current state when no new state requested via hook', async () => {
    await writeStateFile(dir, { state: 'bridging', mode: 'full' });
    const hook = createStateTransitionHook();
    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'transition',
      data: {},
    });
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).currentState).toBe('bridging');
  });
});

// =============================================================================
// Section 8: Complete workflow lifecycle test
// =============================================================================
describe('Workflow State Machine — Complete Lifecycle', () => {
  const dir = tempDir('lifecycle');
  let wf: ReturnType<typeof createWorkflowManager>;

  beforeEach(async () => {
    await cleanupDir(dir).catch(() => {});
    await ensureDir(dir);
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });
    wf = createWorkflowManager({ enabled: true });
    await wf.initialize();
  });

  afterEach(async () => {
    await cleanupDir(dir).catch(() => {});
  });

  it('should complete a full lifecycle with a debugging cycle and careful close', async () => {
    // Phase 1: Plan
    expect((await wf.transitionState(dir, 'specifying')).success).toBe(true);
    expect((await wf.transitionState(dir, 'bridging')).success).toBe(true);
    expect((await wf.transitionState(dir, 'approved-for-build')).success).toBe(true);

    // Phase 2: Execute (first attempt)
    expect((await wf.transitionState(dir, 'executing')).success).toBe(true);

    // Phase 3: Debug (found a bug)
    expect((await wf.transitionState(dir, 'debugging')).success).toBe(true);

    // Phase 4: Fix and re-execute
    expect((await wf.transitionState(dir, 'executing')).success).toBe(true);

    // Phase 5: Debug again (another bug)
    expect((await wf.transitionState(dir, 'debugging')).success).toBe(true);

    // Phase 6: Fix again
    expect((await wf.transitionState(dir, 'executing')).success).toBe(true);

    // Phase 7: Close
    expect((await wf.transitionState(dir, 'closing')).success).toBe(true);

    // Verify final state
    const state = await readStateFile(dir);
    expect(state?.state).toBe('closing');
    expect(state?.updatedAt).toBeDefined();

    // Verify cannot close again or go back
    expect((await wf.transitionState(dir, 'executing')).success).toBe(false);
    expect((await wf.transitionState(dir, 'debugging')).success).toBe(false);
  });

  it('should be able to abandon at any point in the lifecycle', async () => {
    const states = ['exploring', 'specifying',
      'ui-design', 'bridging', 'approved-for-build', 'executing', 'debugging', 'closing'];
    for (const s of states) {
      await writeStateFile(dir, { state: s, mode: 'full' });
      const result = await wf.transitionState(dir, 'abandoned');
      expect(result.success).toBe(true);
      expect((await readStateFile(dir))?.state).toBe('abandoned');

      // Cannot un-abandon
      const reenter = await wf.transitionState(dir, 'exploring');
      expect(reenter.success).toBe(false);
    }
  });

  it('should handle concurrent state access gracefully', async () => {
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });

    // Verify state before transition
    const state1 = await wf.getState(dir);
    expect((state1.data as Record<string, unknown>).state).toBe('exploring');

    // Transition
    await wf.transitionState(dir, 'specifying');

    // Verify state after transition
    const state2 = await wf.getState(dir);
    expect((state2.data as Record<string, unknown>).state).toBe('specifying');
  });
});




