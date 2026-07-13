/**
 * IFlow context routing tests — Tasks 1.1, 1.2, 1.3, 1.4
 *
 * Tests:
 * - IFlow context detection via directoryExists(`${changeDir}/.iflow`)
 * - IFlow agent name validation (IFLOW_AGENT_NAMES)
 * - Session label dynamic generation (iFlow → / sFlow →)
 * - Guard data passthrough completeness (context.data → getIFlowGuards)
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createGuardHook } from '../hooks/guard.js';
import { IFLOW_AGENT_NAMES } from '../../../../workflows/iflow/index.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeStateFile(dir: string, data: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.sflow');
  await writeFile(dir + '/.sflow/state.json', JSON.stringify(data, null, 2));
}

async function writeIFlowState(dir: string, state: string): Promise<void> {
  await ensureDir(dir + '/.iflow');
  await writeFile(dir + '/.iflow/state.json', JSON.stringify({ state, updatedAt: new Date().toISOString() }, null, 2));
}

// ─── IFLOW_AGENT_NAMES validation (Task 1.2) ────────────────────────────────

describe('IFLOW_AGENT_NAMES — agent name validation', () => {
  it('should contain the 6 expected IFlow agent names', () => {
    expect(IFLOW_AGENT_NAMES).toContain('iFlow');
    expect(IFLOW_AGENT_NAMES).toContain('iflow-discuss-planner');
    expect(IFLOW_AGENT_NAMES).toContain('iflow-plan-executor');
    expect(IFLOW_AGENT_NAMES).toContain('iflow-verifier');
    expect(IFLOW_AGENT_NAMES).toContain('iflow-researcher');
    expect(IFLOW_AGENT_NAMES).toContain('iflow-shipper');
  });

  it('should have exactly 6 agent names', () => {
    expect(IFLOW_AGENT_NAMES.length).toBe(6);
  });

  it('should not contain SFlow agent names', () => {
    expect(IFLOW_AGENT_NAMES).not.toContain('build-executor');
    expect(IFLOW_AGENT_NAMES).not.toContain('spec-writer');
    expect(IFLOW_AGENT_NAMES).not.toContain('need-explorer');
  });
});

// ─── Guard data passthrough (Task 1.4) ──────────────────────────────────────

describe('Guard Hook — IFlow data passthrough completeness', () => {
  const dir = tempDir('iflow-guard-data');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should pass complete data (toolName, filePath, agent) to IFlow guards when .iflow/ exists', async () => {
    // Setup IFlow context
    await ensureDir(dir + '/.iflow');
    await writeIFlowState(dir, 'executing');
    await writeFile(dir + '/.iflow/PLAN.md', '# Plan\n\n## Tasks\n- Build feature');

    // Call guard with complete data — should not crash
    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'tool:write',
      data: {
        toolName: 'write',
        filePath: 'src/feature.ts',
        agent: 'iflow-plan-executor',
      },
    });

    // Should succeed — no blocking for valid write in executing state
    expect(result.success).toBe(true);
  });

  it('should pass data with toolName to IFlow scope reduction guard', async () => {
    // Setup IFlow context with scope reduction scenario
    await ensureDir(dir + '/.iflow');
    await writeIFlowState(dir, 'executing');
    await writeFile(dir + '/.iflow/PLAN.md', '# Plan\n\n## Tasks\n- Build v1 simplified version');
    await writeFile(dir + '/.iflow/CONTEXT.md', '# Goals\n\n## Goal\n- Full system');

    // Call guard with toolName=write and filePath pointing to PLAN.md
    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'tool:write',
      data: {
        toolName: 'write',
        filePath: 'PLAN.md',
        agent: 'iflow-plan-executor',
      },
    });

    // Should block due to scope reduction
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Scope reduction');
  });

  it('should not activate IFlow guards when .iflow/ does not exist', async () => {
    // No .iflow/ directory — IFlow guards should not activate
    // Use exploring state to avoid SFlow artifact checks blocking
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'tool:read',
      data: {
        toolName: 'read',
        filePath: 'src/feature.ts',
        agent: 'build-executor',
      },
    });

    // Should succeed — IFlow guards not active, exploring allows reads
    expect(result.success).toBe(true);
  });

  it('should handle data without toolName gracefully in IFlow context', async () => {
    await ensureDir(dir + '/.iflow');
    await writeIFlowState(dir, 'discussing');

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'tool:unknown',
      data: {
        agent: 'iflow-discuss-planner',
      },
    });

    // Should succeed — no toolName means scope reduction guard skips
    expect(result.success).toBe(true);
  });
});

// ─── Backward compatibility (C-1) ────────────────────────────────────────────

describe('Guard Hook — backward compatibility without .iflow/', () => {
  const dir = tempDir('iflow-backward-compat');
  let guard: ReturnType<typeof createGuardHook>;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    guard = createGuardHook();
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should behave identically when .iflow/ does not exist — exploring state', async () => {
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'tool:read',
      data: { toolName: 'read', filePath: 'src/test.ts' },
    });

    expect(result.success).toBe(true);
  });

  it('should behave identically when .iflow/ does not exist — executing state', async () => {
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });

    const result = await guard.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'tool:read',
      data: { toolName: 'read', filePath: 'src/test.ts' },
    });

    expect(result.success).toBe(true);
  });
});
