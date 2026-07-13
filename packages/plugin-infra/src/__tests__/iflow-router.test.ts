import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, unlink } from 'fs/promises';
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
  await ensureDir(dir + '/.iflow');
  await writeFile(dir + '/.iflow/state.json', JSON.stringify(data, null, 2));
}

async function writeIFlowArtifact(dir: string, name: string, content: string): Promise<void> {
  await ensureDir(dir + '/.iflow');
  await writeFile(dir + '/.iflow/' + name, content);
}

async function removeIFlowState(dir: string): Promise<void> {
  try { await unlink(dir + '/.iflow/state.json'); } catch {}
}

async function removeIFlowArtifact(dir: string, name: string): Promise<void> {
  try { await unlink(dir + '/.iflow/' + name); } catch {}
}

describe('IFlow Router — EXECUTING marker fallback detection', () => {
  const dir = tempDir('iflow-router-marker');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.iflow');
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
    const restored = await readJsonFile<{ state?: string }>(dir + '/.iflow/state.json');
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
