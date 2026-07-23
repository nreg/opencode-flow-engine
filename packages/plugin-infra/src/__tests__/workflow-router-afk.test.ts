/**
 * Workflow Router — AFK Phase 0 Handling Tests (Task 3.1)
 *
 * Covers:
 * - set-afk-on action detection in Phase 0
 * - Tier parameter parsing (default 1, explicit tier2/tier3)
 * - state.json afk/afkTier fields written correctly
 * - Confirmation message returned
 * - Non-AFK horizontal commands still work normally
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createWorkflowRouterTool } from '../tools/workflow-router.js';
import { mkdir, rm, writeFile } from 'fs/promises';
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

async function readStateJson(dir: string): Promise<Record<string, unknown>> {
  const content = await import('fs/promises').then(m => m.readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8'));
  return JSON.parse(content);
}

// Minimal ToolContext stub
function makeContext(directory: string) {
  return {
    sessionID: 'test-session',
    messageID: 'test-msg',
    agent: 'test-agent',
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
  };
}

describe('Workflow Router — AFK Phase 0 Handling', () => {
  const dir = tempDir('afk-router');
  const tool = createWorkflowRouterTool();

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'exploring',
      mode: 'full',
      afk: false,
      afkTier: 0,
    }));
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should detect set-afk-on action and write state.json with afk=true, afkTier=1 (default)', async () => {
    const result = await tool.execute(
      { changeDir: dir, intent: '开启afk模式' },
      makeContext(dir),
    );

    expect(result.title).toBe('Workflow Router');
    const output = JSON.parse(result.output as string);
    expect(output.success).toBe(true);
    expect(output.data.source).toBe('horizontal-command');
    expect(output.data.action).toBe('set-afk-on');
    expect(output.data.afkTier).toBe(1);
    expect(output.data.isHorizontalCommand).toBe(true);
    expect(output.data.stateGuardBlocked).toBe(false);

    // Verify state.json was written
    const state = await readStateJson(dir);
    expect(state.afk).toBe(true);
    expect(state.afkTier).toBe(1);
  });

  it('should detect set-afk-on with tier2 and write afkTier=2', async () => {
    const result = await tool.execute(
      { changeDir: dir, intent: 'afk tier2' },
      makeContext(dir),
    );

    const output = JSON.parse(result.output as string);
    expect(output.success).toBe(true);
    expect(output.data.action).toBe('set-afk-on');
    expect(output.data.afkTier).toBe(2);

    const state = await readStateJson(dir);
    expect(state.afk).toBe(true);
    expect(state.afkTier).toBe(2);
  });

  it('should detect set-afk-on with tier3 and write afkTier=3', async () => {
    const result = await tool.execute(
      { changeDir: dir, intent: 'afk tier3' },
      makeContext(dir),
    );

    const output = JSON.parse(result.output as string);
    expect(output.success).toBe(true);
    expect(output.data.action).toBe('set-afk-on');
    expect(output.data.afkTier).toBe(3);

    const state = await readStateJson(dir);
    expect(state.afk).toBe(true);
    expect(state.afkTier).toBe(3);
  });

  it('should return confirmation message with Tier description', async () => {
    const result = await tool.execute(
      { changeDir: dir, intent: '进入无人值守模式' },
      makeContext(dir),
    );

    const output = JSON.parse(result.output as string);
    expect(output.data.description).toContain('AFK');
    expect(output.data.description).toContain('Tier 1');
  });

  it('should preserve existing state when writing AFK fields', async () => {
    // Set up a state with existing fields
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'executing',
      mode: 'full',
      afk: false,
      afkTier: 0,
      contractApproved: true,
      batches_completed: 3,
    }));

    await tool.execute(
      { changeDir: dir, intent: '开启afk模式' },
      makeContext(dir),
    );

    const state = await readStateJson(dir);
    expect(state.afk).toBe(true);
    expect(state.afkTier).toBe(1);
    // Existing fields preserved
    expect(state.state).toBe('executing');
    expect(state.contractApproved).toBe(true);
    expect(state.batches_completed).toBe(3);
  });

  it('should not interfere with non-AFK horizontal commands', async () => {
    const result = await tool.execute(
      { changeDir: dir, intent: '全面测试' },
      makeContext(dir),
    );

    const output = JSON.parse(result.output as string);
    expect(output.success).toBe(true);
    expect(output.data.source).toBe('horizontal-command');
    expect(output.data.action).toBe('full-test');
    expect(output.data.skill).toBe('test-engineer');

    // state.json should NOT have AFK fields changed
    const state = await readStateJson(dir);
    expect(state.afk).toBe(false);
    expect(state.afkTier).toBe(0);
  });

  it('should handle AFK when no state.json exists (fresh directory)', async () => {
    // Remove state.json
    await cleanupDir(dir + '/.flow-engine/sflow');
    await ensureDir(dir);

    const result = await tool.execute(
      { changeDir: dir, intent: 'AFK' },
      makeContext(dir),
    );

    const output = JSON.parse(result.output as string);
    expect(output.success).toBe(true);
    expect(output.data.action).toBe('set-afk-on');

    // state.json should be created with AFK fields
    const state = await readStateJson(dir);
    expect(state.afk).toBe(true);
    expect(state.afkTier).toBe(1);
  });
});
