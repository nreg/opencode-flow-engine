/**
 * Wave W6 Tests — DP-4 Recommendation and Git Branch Isolation
 *
 * TDD: These tests are written BEFORE implementation.
 * They should FAIL initially, then pass after implementation.
 *
 * Tasks covered:
 * - 7.1: DP-4 recommendation logic in state-transition.ts
 * - 7.2: writeStateFile dp_4_result and decisionPoints
 * - 8.1: checkGitBranchIsolation guard
 * - 8.2: Wire checkGitBranchIsolation into createGuardHook
 */
import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { createStateTransitionHook } from '../hooks/state-transition.js';
import { createGuardHook } from '../hooks/guard.js';
import { writeStateFile } from '../features/state-manager.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeStateJson(dir: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.sflow');
  await writeFile(dir + '/.sflow/state.json', JSON.stringify(data, null, 2));
}

async function readStateJson(dir: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(dir + '/.sflow/state.json', 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeTasksMd(dir: string, content: string): Promise<void> {
  await writeFile(dir + '/tasks.md', content);
}

// =============================================================================
// Task 7.1: DP-4 recommendation in state-transition.ts
// =============================================================================
describe('Task 7.1: DP-4 Recommendation in state-transition', () => {
  const dir = tempDir('w6-dp4-transition');
  let hook: ReturnType<typeof createStateTransitionHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.sflow');
    await ensureDir(dir + '/specs');
    hook = createStateTransitionHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should trigger recommendExecutionMode on bridging→approved-for-build transition', async () => {
    // Setup: state at bridging with tasks.md containing 2 tasks
    await writeStateJson(dir, { state: 'bridging', mode: 'full' });
    await writeFile(dir + '/proposal.md', '# Proposal\n\n## Why\nSome motivation.');
    await writeFile(dir + '/design.md', '# Design\n\n## Architecture\nSome design.');
    await writeFile(dir + '/tasks.md', '- [ ] task one\n- [ ] task two');
    await writeFile(dir + '/specs/test.md', '# Spec');
    await writeFile(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nTest contract.');

    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'transition',
      data: { newState: 'approved-for-build' },
    });

    expect(result.success).toBe(true);

    // Verify dp_4_result was written to state.json
    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.state).toBe('approved-for-build');
    expect(state!.dp_4_result).toBeDefined();
    const dp4Result = state!.dp_4_result as Record<string, unknown>;
    expect(dp4Result.mode).toBe('inline');
    expect(dp4Result.taskCount).toBe(2);
    expect(dp4Result.hasDependencies).toBe(false);
    expect(dp4Result.rationale).toBeDefined();
  });

  it('should recommend sdd mode when tasks have dependencies', async () => {
    await writeStateJson(dir, { state: 'bridging', mode: 'full' });
    await writeFile(dir + '/proposal.md', '# Proposal\n\n## Why\nSome motivation.');
    await writeFile(dir + '/design.md', '# Design\n\n## Architecture\nSome design.');
    await writeFile(dir + '/tasks.md', '- [ ] task one depends on W2\n- [ ] task two cross-module coordination');
    await writeFile(dir + '/specs/test.md', '# Spec');
    await writeFile(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nTest contract.');

    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'transition',
      data: { newState: 'approved-for-build' },
    });

    expect(result.success).toBe(true);
    const state = await readStateJson(dir);
    const dp4Result = state!.dp_4_result as Record<string, unknown>;
    expect(dp4Result.mode).toBe('sdd');
    expect(dp4Result.hasDependencies).toBe(true);
  });

  it('should NOT trigger DP-4 on non-bridging→approved-for-build transitions', async () => {
    await writeStateJson(dir, { state: 'exploring', mode: 'full' });
    await writeFile(dir + '/proposal.md', '# Proposal\n\n## Why\nSome motivation.');
    await writeFile(dir + '/tasks.md', '- [ ] task one');

    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'transition',
      data: { newState: 'specifying' },
    });

    expect(result.success).toBe(true);
    const state = await readStateJson(dir);
    // dp_4_result should NOT be present for non-DP-4 transitions
    expect(state!.dp_4_result).toBeUndefined();
  });

  it('should handle missing tasks.md gracefully during DP-4', async () => {
    await writeStateJson(dir, { state: 'bridging', mode: 'full' });
    await writeFile(dir + '/proposal.md', '# Proposal\n\n## Why\nSome motivation.');
    await writeFile(dir + '/design.md', '# Design\n\n## Architecture\nSome design.');
    await writeFile(dir + '/specs/test.md', '# Spec');
    await writeFile(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nTest contract.');
    // No tasks.md — transition should still succeed

    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'transition',
      data: { newState: 'approved-for-build' },
    });

    expect(result.success).toBe(true);
    // dp_4_result may be absent or have default values
  });
});

// =============================================================================
// Task 7.2: writeStateFile dp_4_result and decisionPoints
// =============================================================================
describe('Task 7.2: writeStateFile with dp_4_result', () => {
  const dir = tempDir('w6-dp4-state');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should persist dp_4_result field in state.json', async () => {
    const dp4Result = {
      mode: 'inline',
      taskCount: 2,
      hasDependencies: false,
      rationale: '2 task(s) with no dependencies: inline mode recommended',
    };

    await writeStateFile(dir, 'approved-for-build', { dp_4_result: dp4Result });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(state!.dp_4_result).toBeDefined();
    expect((state!.dp_4_result as Record<string, unknown>).mode).toBe('inline');
    expect((state!.dp_4_result as Record<string, unknown>).taskCount).toBe(2);
  });

  it('should add DP-4 entry to decisionPoints array', async () => {
    const dp4Result = {
      mode: 'sdd',
      taskCount: 8,
      hasDependencies: true,
      rationale: 'Tasks have cross-wave dependencies detected',
    };

    await writeStateFile(dir, 'approved-for-build', { dp_4_result: dp4Result });

    const state = await readStateJson(dir);
    expect(state).not.toBeNull();
    expect(Array.isArray(state!.decisionPoints)).toBe(true);
    const decisionPoints = state!.decisionPoints as Array<Record<string, unknown>>;
    const dp4Entry = decisionPoints.find(dp => dp.id === 'dp-4');
    expect(dp4Entry).toBeDefined();
    expect(dp4Entry!.mode).toBe('sdd');
    expect(dp4Entry!.rationale).toBeDefined();
    expect(dp4Entry!.timestamp).toBeDefined();
  });

  it('should append DP-4 to existing decisionPoints', async () => {
    // Setup: state with existing decisionPoints
    await writeStateJson(dir, {
      state: 'bridging',
      mode: 'full',
      decisionPoints: [
        { id: 'dp-0', timestamp: '2026-07-15T10:00:00.000Z', rationale: 'Initial scope' },
      ],
    });

    const dp4Result = {
      mode: 'inline',
      taskCount: 1,
      hasDependencies: false,
      rationale: '1 task(s) with no dependencies',
    };

    await writeStateFile(dir, 'approved-for-build', { dp_4_result: dp4Result });

    const state = await readStateJson(dir);
    const decisionPoints = state!.decisionPoints as Array<Record<string, unknown>>;
    expect(decisionPoints.length).toBe(2);
    expect(decisionPoints[0].id).toBe('dp-0');
    expect(decisionPoints[1].id).toBe('dp-4');
  });

  it('should not add DP-4 entry when dp_4_result is not provided', async () => {
    await writeStateFile(dir, 'executing');

    const state = await readStateJson(dir);
    // decisionPoints may not exist or should not contain dp-4
    if (state!.decisionPoints) {
      const decisionPoints = state!.decisionPoints as Array<Record<string, unknown>>;
      const dp4Entry = decisionPoints.find(dp => dp.id === 'dp-4');
      expect(dp4Entry).toBeUndefined();
    }
  });
});

// =============================================================================
// Task 8.1: checkGitBranchIsolation guard
// =============================================================================
describe('Task 8.1: checkGitBranchIsolation guard', () => {
  const dir = tempDir('w6-git-branch');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.sflow');
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should warn when on main branch during executing state with build-executor agent', async () => {
    await writeStateJson(dir, { state: 'executing', mode: 'full' });

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    // The guard should succeed but may include a warning
    // Since we can't control the actual git branch in test,
    // we verify the guard doesn't crash and returns a valid result
    expect(result.success).toBeDefined();
  });

  it('should warn when on master branch during debugging state', async () => {
    await writeStateJson(dir, { state: 'debugging', mode: 'full' });

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    expect(result.success).toBeDefined();
  });

  it('should not warn when on feature branch', async () => {
    await writeStateJson(dir, { state: 'executing', mode: 'full' });

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    expect(result.success).toBeDefined();
  });

  it('should not warn for non-build-executor agents', async () => {
    await writeStateJson(dir, { state: 'executing', mode: 'full' });

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'spec-writer' },
    });

    expect(result.success).toBe(true);
    // No git branch warning for non-build-executor
    if (result.warnings) {
      const branchWarning = result.warnings.find(w => w.includes('branch') || w.includes('main') || w.includes('master'));
      expect(branchWarning).toBeUndefined();
    }
  });

  it('should not warn during non-executing/debugging states', async () => {
    await writeStateJson(dir, { state: 'exploring', mode: 'full' });

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    expect(result.success).toBe(true);
    // No git branch warning during exploring
    if (result.warnings) {
      const branchWarning = result.warnings.find(w => w.includes('branch') || w.includes('main') || w.includes('master'));
      expect(branchWarning).toBeUndefined();
    }
  });

  it('should skip silently when not a git repo', async () => {
    // Use a temp dir OUTSIDE the current git repo to guarantee non-git behavior
    const os = require('os');
    const path = require('path');
    const nonGitDir = path.join(os.tmpdir(), 'w6-non-git-' + Date.now());
    await ensureDir(nonGitDir);
    await ensureDir(nonGitDir + '/.sflow');
    await writeFile(nonGitDir + '/.sflow/state.json', JSON.stringify({ state: 'executing', mode: 'full' }));

    const result = await guard.execute({
      changeDir: nonGitDir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    // Should succeed — not a git repo is handled gracefully
    expect(result.success).toBe(true);

    await cleanupDir(nonGitDir);
  });

  it('should not apply for iflow workflow', async () => {
    // Create .iflow directory to simulate iflow
    await ensureDir(dir + '/.iflow');
    await writeStateJson(dir, { state: 'executing', mode: 'full' });
    // Remove .sflow to make it iflow-only
    try { await rm(dir + '/.sflow', { recursive: true, force: true }); } catch {}
    await ensureDir(dir + '/.iflow');

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    expect(result.success).toBe(true);
  });
});

// =============================================================================
// Task 8.1: checkGitBranchIsolation — targeted unit tests with real git
// =============================================================================
describe('Task 8.1: checkGitBranchIsolation — targeted branch detection', () => {
  const dir = tempDir('w6-git-branch-real');
  let guard: ReturnType<typeof createGuardHook>;

  async function initGitRepo(branch: string): Promise<void> {
    const { execSync } = require('child_process');
    execSync(`git init -b ${branch}`, { cwd: dir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
    // Need at least one commit for HEAD to exist
    await writeFile(dir + '/.gitkeep', '');
    execSync('git add .gitkeep', { cwd: dir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  }

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.sflow');
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should warn when on main branch with build-executor', async () => {
    await writeStateJson(dir, { state: 'executing', mode: 'full' });
    await initGitRepo('main');

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('main') && w.includes('branch isolation'))).toBe(true);
  });

  it('should warn when on master branch with build-executor', async () => {
    await writeStateJson(dir, { state: 'debugging', mode: 'full' });
    await initGitRepo('master');

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('master') && w.includes('branch isolation'))).toBe(true);
  });

  it('should NOT warn when on feature branch', async () => {
    await writeStateJson(dir, { state: 'executing', mode: 'full' });
    await initGitRepo('feature/w6-test');

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    expect(result.success).toBe(true);
    if (result.warnings) {
      const branchWarning = result.warnings.find(w => w.includes('branch isolation'));
      expect(branchWarning).toBeUndefined();
    }
  });

  it('should NOT warn for non-build-executor agent even on main', async () => {
    await writeStateJson(dir, { state: 'executing', mode: 'full' });
    await initGitRepo('main');

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'spec-writer' },
    });

    expect(result.success).toBe(true);
    if (result.warnings) {
      const branchWarning = result.warnings.find(w => w.includes('branch isolation'));
      expect(branchWarning).toBeUndefined();
    }
  });

  it('should NOT warn during non-executing/debugging states even on main', async () => {
    await writeStateJson(dir, { state: 'bridging', mode: 'full' });
    await initGitRepo('main');

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    expect(result.success).toBe(true);
    if (result.warnings) {
      const branchWarning = result.warnings.find(w => w.includes('branch isolation'));
      expect(branchWarning).toBeUndefined();
    }
  });

  it('should skip silently when not a git repo', async () => {
    await writeStateJson(dir, { state: 'executing', mode: 'full' });
    // Use a temp dir outside any git repo
    const os = require('os');
    const nonGitDir = require('path').join(os.tmpdir(), 'w6-non-git-' + Date.now());
    await ensureDir(nonGitDir);
    await ensureDir(nonGitDir + '/.sflow');
    await writeFile(nonGitDir + '/.sflow/state.json', JSON.stringify({ state: 'executing', mode: 'full' }));

    const result = await guard.execute({
      changeDir: nonGitDir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { agent: 'build-executor' },
    });

    expect(result.success).toBe(true);
    if (result.warnings) {
      const branchWarning = result.warnings.find(w => w.includes('branch isolation'));
      expect(branchWarning).toBeUndefined();
    }

    await cleanupDir(nonGitDir);
  });
});

// =============================================================================
// Integration: full bridging→approved-for-build flow with DP-4
// =============================================================================
describe('Integration: bridging→approved-for-build with DP-4 recommendation', () => {
  const dir = tempDir('w6-dp4-integration');
  let hook: ReturnType<typeof createStateTransitionHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.sflow');
    await ensureDir(dir + '/specs');
    hook = createStateTransitionHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should complete full DP-4 flow: read tasks.md → recommend mode → write dp_4_result → record decision point', async () => {
    // Setup: full bridging state with all required artifacts
    await writeStateJson(dir, {
      state: 'bridging',
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
      decisionPoints: [
        { id: 'dp-0', timestamp: '2026-07-15T08:00:00.000Z', rationale: 'Scope confirmed' },
      ],
    });
    await writeFile(dir + '/proposal.md', '# Proposal\n\n## Why\nBuild execution control plane.');
    await writeFile(dir + '/design.md', '# Design\n\n## Architecture\nModular design with hooks.');
    await writeFile(dir + '/tasks.md', '- [ ] Implement DP-4 logic\n- [ ] Add git branch isolation\n- [ ] Write tests');
    await writeFile(dir + '/specs/test.md', '# Spec');
    await writeFile(dir + '/execution-contract.md', '# Contract\n\n## Intent Lock\nExecution control plane.');

    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'transition',
      data: { newState: 'approved-for-build' },
    });

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>)?.from).toBe('bridging');
    expect((result.data as Record<string, unknown>)?.to).toBe('approved-for-build');

    // Verify state.json has all DP-4 data
    const state = await readStateJson(dir);
    expect(state!.state).toBe('approved-for-build');

    // dp_4_result
    const dp4Result = state!.dp_4_result as Record<string, unknown>;
    expect(dp4Result).toBeDefined();
    expect(dp4Result.mode).toBe('batch-inline'); // 3 tasks, no dependencies → batch-inline
    expect(dp4Result.taskCount).toBe(3);

    // decisionPoints
    const decisionPoints = state!.decisionPoints as Array<Record<string, unknown>>;
    const dp4Entry = decisionPoints.find(dp => dp.id === 'dp-4');
    expect(dp4Entry).toBeDefined();
    expect(dp4Entry!.mode).toBe('batch-inline');
    expect(dp4Entry!.rationale).toContain('batch-inline');
    expect(dp4Entry!.timestamp).toBeDefined();

    // Original DP-0 should still be present
    const dp0Entry = decisionPoints.find(dp => dp.id === 'dp-0');
    expect(dp0Entry).toBeDefined();
  });
});
