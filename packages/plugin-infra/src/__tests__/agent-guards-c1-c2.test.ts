/**
 * Tests for CRITICAL defect fixes:
 * - C1: agent-guards.ts guard checks should read decisionPoints array, not top-level fields
 * - C2: frontend-detector.ts findConfigFile pattern matching fix
 * - I1: checkFlowArchitectWriteGuard path prefix normalization
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, mkdirSync } from 'fs/promises';
import { join } from 'path';
import { checkFlowIntelScanGuard, checkFlowArchitectWriteGuard } from '../hooks/guard/agent-guards.js';
import { isFrontendProject, clearFrontendCache } from '../features/frontend-detector.js';

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
  await ensureDir(dir + '/.flow-engine/sflow');
  await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify(data, null, 2));
}

async function writeFileContent(filePath: string, content: string): Promise<void> {
  const parts = filePath.replace(/\\/g, '/').split('/');
  parts.pop(); // remove filename
  const dir = parts.join('/');
  await ensureDir(dir);
  await writeFile(filePath, content);
}

// ─── C1: Agent Guards — decisionPoints array ──────────────────────────────

describe('C1: checkFlowIntelScanGuard — decisionPoints array', () => {
  const dir = tempDir('c1-intel-scan');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block flow-intel write when no decisionPoints exist', async () => {
    await writeStateFile(dir, { state: 'exploring', mode: 'full' });
    const result = await checkFlowIntelScanGuard(dir, {
      agent: 'flow-intel',
      toolName: 'write',
    });
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('should block flow-intel write when decisionPoints exist but no intel_scan_confirmed metadata', async () => {
    await writeStateFile(dir, {
      state: 'exploring',
      mode: 'full',
      decisionPoints: [
        { id: 'dp-0', name: 'dp-0', confirmedInState: 'exploring', targetState: 'specifying', timestamp: '2025-01-01T00:00:00Z', metadata: 'some other metadata' },
      ],
    });
    const result = await checkFlowIntelScanGuard(dir, {
      agent: 'flow-intel',
      toolName: 'write',
    });
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('should allow flow-intel write when decisionPoints contain intel_scan_confirmed metadata', async () => {
    await writeStateFile(dir, {
      state: 'exploring',
      mode: 'full',
      decisionPoints: [
        { id: 'dp-0', name: 'dp-0', confirmedInState: 'exploring', targetState: 'specifying', timestamp: '2025-01-01T00:00:00Z', metadata: 'intel_scan_confirmed' },
      ],
    });
    const result = await checkFlowIntelScanGuard(dir, {
      agent: 'flow-intel',
      toolName: 'write',
    });
    expect(result.success).toBe(true);
  });

  it('should allow flow-intel write when decisionPoints metadata contains intel_scan_confirmed as substring', async () => {
    await writeStateFile(dir, {
      state: 'exploring',
      mode: 'full',
      decisionPoints: [
        { id: 'dp-1', name: 'dp-1', confirmedInState: 'exploring', targetState: 'specifying', timestamp: '2025-01-01T00:00:00Z', metadata: 'intel_scan_confirmed: true' },
      ],
    });
    const result = await checkFlowIntelScanGuard(dir, {
      agent: 'flow-intel',
      toolName: 'write',
    });
    expect(result.success).toBe(true);
  });

  it('should NOT check top-level intel_scan_confirmed field (old broken behavior)', async () => {
    // This test ensures we do NOT rely on top-level field
    await writeStateFile(dir, {
      state: 'exploring',
      mode: 'full',
      intel_scan_confirmed: true, // Old top-level field — should be IGNORED
    });
    const result = await checkFlowIntelScanGuard(dir, {
      agent: 'flow-intel',
      toolName: 'write',
    });
    // Should still block because decisionPoints array is empty/missing
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('should pass through non-flow-intel agents', async () => {
    const result = await checkFlowIntelScanGuard(dir, {
      agent: 'flow-architect',
      toolName: 'write',
    });
    expect(result.success).toBe(true);
  });

  it('should pass through non-write tools', async () => {
    const result = await checkFlowIntelScanGuard(dir, {
      agent: 'flow-intel',
      toolName: 'read',
    });
    expect(result.success).toBe(true);
  });
});

describe('C1: checkFlowArchitectWriteGuard — decisionPoints array', () => {
  const dir = tempDir('c1-architect-write');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block flow-architect write to existing ARCHITECTURE.md when no approval in decisionPoints', async () => {
    await writeStateFile(dir, { state: 'specifying', mode: 'full' });
    // Create existing ARCHITECTURE.md
    await writeFileContent(join(dir, 'ARCHITECTURE.md'), '# Architecture\n');
    const result = await checkFlowArchitectWriteGuard(dir, {
      agent: 'flow-architect',
      toolName: 'write',
      filePath: join(dir, 'ARCHITECTURE.md'),
    });
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('should allow flow-architect write to existing ARCHITECTURE.md when architect_write_approved in decisionPoints', async () => {
    await writeStateFile(dir, {
      state: 'specifying',
      mode: 'full',
      decisionPoints: [
        { id: 'dp-2', name: 'dp-2', confirmedInState: 'specifying', targetState: 'bridging', timestamp: '2025-01-01T00:00:00Z', metadata: 'architect_write_approved' },
      ],
    });
    // Create existing ARCHITECTURE.md
    await writeFileContent(join(dir, 'ARCHITECTURE.md'), '# Architecture\n');
    const result = await checkFlowArchitectWriteGuard(dir, {
      agent: 'flow-architect',
      toolName: 'write',
      filePath: join(dir, 'ARCHITECTURE.md'),
    });
    expect(result.success).toBe(true);
  });

  it('should allow first-time creation of ARCHITECTURE.md (file does not exist)', async () => {
    await writeStateFile(dir, { state: 'specifying', mode: 'full' });
    // Do NOT create ARCHITECTURE.md — first-time creation should be allowed
    const result = await checkFlowArchitectWriteGuard(dir, {
      agent: 'flow-architect',
      toolName: 'write',
      filePath: join(dir, 'ARCHITECTURE.md'),
    });
    expect(result.success).toBe(true);
  });

  it('should NOT check top-level architect_write_approved field (old broken behavior)', async () => {
    await writeStateFile(dir, {
      state: 'specifying',
      mode: 'full',
      architect_write_approved: true, // Old top-level field — should be IGNORED
    });
    // Create existing ARCHITECTURE.md
    await writeFileContent(join(dir, 'ARCHITECTURE.md'), '# Architecture\n');
    const result = await checkFlowArchitectWriteGuard(dir, {
      agent: 'flow-architect',
      toolName: 'write',
      filePath: join(dir, 'ARCHITECTURE.md'),
    });
    // Should still block because decisionPoints array is empty/missing
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('should pass through non-architect agents', async () => {
    const result = await checkFlowArchitectWriteGuard(dir, {
      agent: 'flow-intel',
      toolName: 'write',
      filePath: join(dir, 'ARCHITECTURE.md'),
    });
    expect(result.success).toBe(true);
  });

  it('should pass through non-write/edit tools', async () => {
    const result = await checkFlowArchitectWriteGuard(dir, {
      agent: 'flow-architect',
      toolName: 'read',
      filePath: join(dir, 'ARCHITECTURE.md'),
    });
    expect(result.success).toBe(true);
  });

  it('should pass through when file is not ARCHITECTURE.md', async () => {
    const result = await checkFlowArchitectWriteGuard(dir, {
      agent: 'flow-architect',
      toolName: 'write',
      filePath: join(dir, 'design.md'),
    });
    expect(result.success).toBe(true);
  });
});

// ─── C2: Frontend Detector — config file pattern matching ─────────────────

describe('C2: isFrontendProject — config file detection', () => {
  const dir = tempDir('c2-frontend-detector');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    clearFrontendCache();
  });

  afterEach(async () => {
    await cleanupDir(dir);
    clearFrontendCache();
  });

  it('should detect tailwind.config.ts as frontend config', async () => {
    await writeFileContent(join(dir, 'tailwind.config.ts'), 'export default {}');
    const result = await isFrontendProject(dir);
    expect(result).toBe(true);
  });

  it('should detect tailwind.config.js as frontend config', async () => {
    await writeFileContent(join(dir, 'tailwind.config.js'), 'module.exports = {}');
    const result = await isFrontendProject(dir);
    expect(result).toBe(true);
  });

  it('should detect vite.config.ts as frontend config', async () => {
    await writeFileContent(join(dir, 'vite.config.ts'), 'export default {}');
    const result = await isFrontendProject(dir);
    expect(result).toBe(true);
  });

  it('should detect next.config.mjs as frontend config', async () => {
    await writeFileContent(join(dir, 'next.config.mjs'), 'export default {}');
    const result = await isFrontendProject(dir);
    expect(result).toBe(true);
  });

  it('should detect nuxt.config.ts as frontend config', async () => {
    await writeFileContent(join(dir, 'nuxt.config.ts'), 'export default {}');
    const result = await isFrontendProject(dir);
    expect(result).toBe(true);
  });

  it('should NOT detect a project with no frontend indicators as frontend', async () => {
    // Only a package.json with no frontend deps
    await writeFileContent(join(dir, 'package.json'), JSON.stringify({ name: 'backend-app', dependencies: { express: '4.0.0' } }));
    const result = await isFrontendProject(dir);
    expect(result).toBe(false);
  });
});

// ─── I1: Architect Guard — path prefix normalization ──────────────────────

describe('I1: checkFlowArchitectWriteGuard — path prefix normalization', () => {
  const dir = tempDir('i1-architect-path');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should handle relative path to ARCHITECTURE.md by resolving against changeDir', async () => {
    await writeStateFile(dir, { state: 'specifying', mode: 'full' });
    // Create existing ARCHITECTURE.md
    await writeFileContent(join(dir, 'ARCHITECTURE.md'), '# Architecture\n');
    const result = await checkFlowArchitectWriteGuard(dir, {
      agent: 'flow-architect',
      toolName: 'write',
      filePath: 'ARCHITECTURE.md', // Relative path
    });
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('should handle Windows-style backslash path to ARCHITECTURE.md', async () => {
    await writeStateFile(dir, { state: 'specifying', mode: 'full' });
    await writeFileContent(join(dir, 'ARCHITECTURE.md'), '# Architecture\n');
    const result = await checkFlowArchitectWriteGuard(dir, {
      agent: 'flow-architect',
      toolName: 'write',
      filePath: dir + '\\ARCHITECTURE.md', // Windows backslash path
    });
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('should allow first-time creation with relative path', async () => {
    await writeStateFile(dir, { state: 'specifying', mode: 'full' });
    // Do NOT create ARCHITECTURE.md
    const result = await checkFlowArchitectWriteGuard(dir, {
      agent: 'flow-architect',
      toolName: 'write',
      filePath: 'ARCHITECTURE.md', // Relative path, file does not exist
    });
    expect(result.success).toBe(true);
  });
});
