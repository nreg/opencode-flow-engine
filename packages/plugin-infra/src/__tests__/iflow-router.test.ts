import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, unlink, readFile } from 'fs/promises';
import { join } from 'path';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeIFlowState(dir: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.flow-engine/iflow');
  await writeFile(dir + '/.flow-engine/iflow/state.json', JSON.stringify(data, null, 2));
}

async function writeIFlowArtifact(dir: string, name: string, content: string): Promise<void> {
  await ensureDir(dir + '/.flow-engine/iflow');
  await writeFile(dir + '/.flow-engine/iflow/' + name, content);
}

async function removeIFlowState(dir: string): Promise<void> {
  try { await unlink(dir + '/.flow-engine/iflow/state.json'); } catch {}
}

async function removeIFlowArtifact(dir: string, name: string): Promise<void> {
  try { await unlink(dir + '/.flow-engine/iflow/' + name); } catch {}
}

async function fileExistsAt(path: string): Promise<boolean> {
  try { await readFile(path); return true; } catch { return false; }
}

describe('IFlow Router — EXECUTING marker fallback detection', () => {
  const dir = tempDir('iflow-router-marker');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should use state.json when it exists and is valid', async () => {
    await writeIFlowState(dir, { state: 'executing', iteration: 2 });
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'EXECUTING', JSON.stringify({
      enteredAt: '2025-01-01T00:00:00Z',
      fromState: 'planning',
      iteration: 2,
    }));

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('executing');
    expect(data.data.iteration).toBe(2);
  });

  it('should fallback to executing when state.json is missing but EXECUTING marker exists', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan\n\n## Tasks\n- Task 1');
    await writeIFlowArtifact(dir, 'EXECUTING', JSON.stringify({
      enteredAt: '2025-01-01T00:00:00Z',
      fromState: 'planning',
      iteration: 1,
    }));

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('executing');
  });

  it('should rebuild state.json from EXECUTING marker when state.json was lost', async () => {
    await writeIFlowState(dir, { state: 'executing', iteration: 1 });
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'EXECUTING', JSON.stringify({
      enteredAt: '2025-01-01T00:00:00Z',
      fromState: 'planning',
      iteration: 1,
    }));

    await removeIFlowState(dir);

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('executing');

    const { readJsonFile } = await import('@opencode-flow-engine/shared');
    const restored = await readJsonFile<{ state?: string }>(dir + '/.flow-engine/iflow/state.json');
    expect(restored?.state).toBe('executing');
  });

  it('should use artifact-based detection when neither state.json nor EXECUTING marker exists', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('planning');
  });

  it('should detect executing via EXECUTING marker even when only PLAN.md exists (not SUMMARY/UAT)', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'EXECUTING', JSON.stringify({
      enteredAt: '2025-01-01T00:00:00Z',
      fromState: 'planning',
      iteration: 1,
    }));

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('executing');
  });

  it('should include EXECUTING marker metadata in artifacts', async () => {
    await writeIFlowArtifact(dir, 'EXECUTING', JSON.stringify({
      enteredAt: '2025-01-01T00:00:00Z',
      fromState: 'planning',
      iteration: 1,
    }));

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.artifacts.EXECUTING).toBe(true);
  });
});

// ─── IFlow Router — determineArtifactState ────────────────────────────────────

describe('IFlow Router — determineArtifactState', () => {
  const dir = tempDir('iflow-router-artifact-state');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should detect "discussing" when no artifacts exist', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('discussing');
  });

  it('should detect "researching" when only CONTEXT.md exists', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Context');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('researching');
  });

  it('should detect "planning" when only PLAN.md exists', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('planning');
  });

  it('should detect "executing" when EXECUTING marker exists', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'EXECUTING', JSON.stringify({
      enteredAt: '2025-01-01T00:00:00Z',
      fromState: 'planning',
      iteration: 1,
    }));

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('executing');
  });

  it('should detect "verifying" when SUMMARY.md exists', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'SUMMARY.md', '# Summary');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('verifying');
  });

  it('should detect "shipping" when UAT.md exists', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'SUMMARY.md', '# Summary');
    await writeIFlowArtifact(dir, 'UAT.md', '# UAT');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('shipping');
  });

  it('should use most advanced artifact (UAT > SUMMARY > EXECUTING > PLAN > CONTEXT)', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Context');
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'SUMMARY.md', '# Summary');
    await writeIFlowArtifact(dir, 'UAT.md', '# UAT');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('shipping');
  });
});

// ─── IFlow Router — matchIFlowIntent ──────────────────────────────────────────

describe('IFlow Router — matchIFlowIntent', () => {
  const dir = tempDir('iflow-router-intent');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should route "讨论需求" to discussing state', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: '讨论需求' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('discussing');
    expect(data.data.source).toBe('intent');
  });

  it('should route "research technical options" to researching state', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: 'research technical options' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('researching');
    expect(data.data.source).toBe('intent');
  });

  it('should route "plan the tasks" to planning state', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: 'plan the tasks' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('planning');
    expect(data.data.source).toBe('intent');
  });

  it('should route "implement the feature" to executing state', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: 'implement the feature' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('executing');
    expect(data.data.source).toBe('intent');
  });

  it('should route "verify the results" to verifying state', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: 'verify the results' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('verifying');
    expect(data.data.source).toBe('intent');
  });

  it('should route "ship to production" to shipping state', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: 'ship to production' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('shipping');
    expect(data.data.source).toBe('intent');
  });

  it('should route "继续" (continue) to discussing state for next iteration', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: '继续' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('discussing');
    expect(data.data.source).toBe('intent');
  });

  it('should route "下一轮" (next round) to discussing state for next iteration', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: '下一轮' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('discussing');
    expect(data.data.source).toBe('intent');
  });

  it('should fall back to artifact-based detection when intent does not match', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: 'unrecognized gibberish xyz' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.source).toBe('artifacts');
    expect(data.data.state).toBe('planning');
  });
});

// ─── IFlow Router — EXECUTING file lifecycle ──────────────────────────────────

describe('IFlow Router — EXECUTING file lifecycle', () => {
  const dir = tempDir('iflow-router-executing-lifecycle');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should create EXECUTING marker when state is executing and marker does not exist', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');
    await writeIFlowState(dir, { state: 'executing', iteration: 1 });
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'SUMMARY.md', '# Summary');

    const existsBefore = await fileExistsAt(dir + '/.flow-engine/iflow/EXECUTING');
    expect(existsBefore).toBe(false);

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const existsAfter = await fileExistsAt(dir + '/.flow-engine/iflow/EXECUTING');
    expect(existsAfter).toBe(true);
  });

  it('should remove EXECUTING marker when leaving executing state via artifact detection', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'SUMMARY.md', '# Summary');
    await writeIFlowArtifact(dir, 'EXECUTING', JSON.stringify({
      enteredAt: '2025-01-01T00:00:00Z',
      fromState: 'planning',
      iteration: 1,
    }));

    const existsBefore = await fileExistsAt(dir + '/.flow-engine/iflow/EXECUTING');
    expect(existsBefore).toBe(true);

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const existsAfter = await fileExistsAt(dir + '/.flow-engine/iflow/EXECUTING');
    expect(existsAfter).toBe(false);
  });
});

// ─── IFlow Router — fresh start (no .flow-engine/iflow/ directory) ────────────────────────

describe('IFlow Router — fresh start', () => {
  const dir = tempDir('iflow-router-fresh');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return "discussing" state when no .flow-engine/iflow/ directory exists', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('discussing');
    expect(data.data.iteration).toBe(0);
    expect(data.data.reasons).toBeDefined();
    expect(data.data.reasons[0]).toContain('starting fresh');
  });

  it('should create .flow-engine/iflow/ directory and state.json on fresh start', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const { readJsonFile } = await import('@opencode-flow-engine/shared');
    const state = await readJsonFile<{ state?: string }>(dir + '/.flow-engine/iflow/state.json');
    expect(state?.state).toBe('discussing');
  });
});

// ─── IFlow Router — rollback detection ────────────────────────────────────────

describe('IFlow Router — rollback detection', () => {
  const dir = tempDir('iflow-router-rollback');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should detect rollback when state.json says "executing" but only CONTEXT.md exists', async () => {
    await writeIFlowState(dir, { state: 'executing', iteration: 1 });
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Context');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('researching');
    expect(data.data.reasons).toBeDefined();
    expect(data.data.reasons.some((r: string) => r.includes('Rollback'))).toBe(true);
  });

  it('should detect rollback when state.json says "verifying" but only PLAN.md exists', async () => {
    await writeIFlowState(dir, { state: 'verifying', iteration: 1 });
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('planning');
    expect(data.data.reasons).toBeDefined();
    expect(data.data.reasons.some((r: string) => r.includes('Rollback'))).toBe(true);
  });

  it('should not detect rollback when state.json matches artifacts', async () => {
    await writeIFlowState(dir, { state: 'planning', iteration: 1 });
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.state).toBe('planning');
    expect(data.data.reasons).toBeDefined();
    expect(data.data.reasons.every((r: string) => !r.includes('Rollback'))).toBe(true);
  });
});

// ─── IFlow Router — Phase 0 Horizontal Command Detection ────────────────────

describe('IFlow Router — Phase 0 Horizontal Command Detection', () => {
  const dir = tempDir('iflow-router-horizontal');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should detect "全面test" as horizontal command', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: '全面test' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.isHorizontalCommand).toBe(true);
    expect(data.data.skill).toBe('test-engineer');
    expect(data.data.state).toBeNull();
    expect(data.data.stateGuardBlocked).toBe(false);
  });

  it('should detect "全面review" as horizontal command', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: '全面review' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.isHorizontalCommand).toBe(true);
    expect(data.data.skill).toBe('review-engineer');
    expect(data.data.state).toBeNull();
    expect(data.data.stateGuardBlocked).toBe(false);
  });

  it('should detect "comprehensive test" as horizontal command', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: 'comprehensive test' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.isHorizontalCommand).toBe(true);
    expect(data.data.skill).toBe('test-engineer');
  });

  it('should detect "只测性能" as partial test horizontal command', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: '只测性能' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.isHorizontalCommand).toBe(true);
    expect(data.data.skill).toBe('test-engineer');
    expect(data.data.action).toBe('partial-test');
  });

  it('should detect "只看代码质量" as partial review horizontal command', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: '只看代码质量' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.isHorizontalCommand).toBe(true);
    expect(data.data.skill).toBe('review-engineer');
    expect(data.data.action).toBe('partial-review');
  });

  it('should bypass state guard even when in a non-discussing state', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');
    await writeFile(dir + '/.flow-engine/iflow/CONTEXT.md', '# Context');

    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: '全面test' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    expect(data.data.isHorizontalCommand).toBe(true);
    // Horizontal command should bypass state — state should be null
    expect(data.data.state).toBeNull();
    expect(data.data.skill).toBe('test-engineer');
  });

  it('should route normally when no horizontal command matches', async () => {
    const { createIFlowRouterTool } = await import('../tools/iflow-router.js');
    const tool = createIFlowRouterTool();
    const result = await tool.execute(
      { changeDir: dir, intent: '开始一个新功能' },
      { directory: dir } as any,
    );

    const data = JSON.parse(result.output);
    expect(data.success).toBe(true);
    // Should not be horizontal command
    expect(data.data.isHorizontalCommand).toBeUndefined();
    // Should have a valid state
    expect(data.data.state).toBeDefined();
  });
});
