/**
 * Artifact preflight cache invalidation tests — P1-3
 *
 * TDD RED phase: tests written before implementation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { checkArtifactPreflight } from '../features/artifact-preflight.js';
import { caches } from '@opencode-flow-engine/shared';
import { fileExists, directoryExists } from '@opencode-flow-engine/shared';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

// ─── P1-3: Cache Invalidation ──────────────────────────────────────────────

describe('Artifact preflight cache invalidation (P1-3)', () => {
  const dir = tempDir('preflight-cache');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
    caches.artifactPreflight.clear();
  });

  afterEach(async () => {
    await cleanupDir(dir);
    caches.artifactPreflight.clear();
  });

  it('should re-check when artifact is modified after caching', async () => {
    await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# Proposal v1');
    await ensureDir(dir + '/.flow-engine/sflow/specs');
    await writeFile(dir + '/.flow-engine/sflow/specs/test.md', '# Test Spec');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'bridging',
      mode: 'full',
    }));

    const params = {
      changeDir: dir,
      targetState: 'bridging',
      fileExists,
      directoryExists,
    };

    const result1 = await checkArtifactPreflight(params);
    expect(result1.passed).toBe(false);
    expect(result1.missing).toContain('design.md');
    expect(result1.missing).toContain('tasks.md');

    await writeFile(dir + '/.flow-engine/sflow/design.md', '# Design');
    await writeFile(dir + '/.flow-engine/sflow/tasks.md', '# Tasks');

    const result2 = await checkArtifactPreflight(params);
    expect(result2.passed).toBe(true);
    expect(result2.missing).toEqual([]);

    expect(result2.existence!['design.md']).toBe(true);
    expect(result2.existence!['tasks.md']).toBe(true);
  });

  it('should not use stale cache when artifacts change', async () => {
    await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# Proposal');
    await ensureDir(dir + '/.flow-engine/sflow/specs');
    await writeFile(dir + '/.flow-engine/sflow/specs/test.md', '# Test Spec');
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'bridging',
      mode: 'full',
    }));

    const params = {
      changeDir: dir,
      targetState: 'bridging',
      fileExists,
      directoryExists,
    };

    const result1 = await checkArtifactPreflight(params);
    expect(result1.existence!['design.md']).toBe(false);

    await writeFile(dir + '/.flow-engine/sflow/design.md', '# Design v1');

    const result2 = await checkArtifactPreflight(params);
    expect(result2.existence!['design.md']).toBe(true);

    await writeFile(dir + '/.flow-engine/sflow/design.md', '# Design v2 (modified)');

    const result3 = await checkArtifactPreflight(params);
    expect(result3.existence!['design.md']).toBe(true);
  });
});
