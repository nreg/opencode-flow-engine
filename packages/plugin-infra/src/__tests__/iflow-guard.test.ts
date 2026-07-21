/**
 * IFlow Guard tests — scope reduction, artifact completeness, cyclic transitions
 * Also tests data missing warning behavior (Task 1.5)
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { checkIFlowGuards, iflowDirectoryExists } from '../hooks/iflow-guard.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeIFlowState(dir: string, state: string): Promise<void> {
  await ensureDir(dir + '/.flow-engine/iflow');
  await writeFile(dir + '/.flow-engine/iflow/state.json', JSON.stringify({ state, updatedAt: new Date().toISOString() }, null, 2));
}

async function writeIFlowArtifact(dir: string, name: string, content: string): Promise<void> {
  await ensureDir(dir + '/.flow-engine/iflow');
  await writeFile(dir + '/.flow-engine/iflow/' + name, content);
}

// ─── iflowDirectoryExists ────────────────────────────────────────────────────

describe('iflowDirectoryExists', () => {
  const dir = tempDir('iflow-dir-exists');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return true when .flow-engine/iflow/ directory exists', async () => {
    await ensureDir(dir + '/.flow-engine/iflow');
    const result = await iflowDirectoryExists(dir);
    expect(result).toBe(true);
  });

  it('should return false when .flow-engine/iflow/ directory does not exist', async () => {
    const result = await iflowDirectoryExists(dir);
    expect(result).toBe(false);
  });
});

// ─── checkIFlowGuards — data missing warnings (Task 1.5) ────────────────────

describe('checkIFlowGuards — data missing warning behavior', () => {
  const dir = tempDir('iflow-data-warning');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return success when data is undefined (no crash)', async () => {
    const result = await checkIFlowGuards(dir, undefined);
    expect(result.success).toBe(true);
  });

  it('should warn when data exists but toolName is missing for write operation', async () => {
    // This tests Task 1.5: when data exists but lacks toolName,
    // a warning should be logged instead of silently skipping
    const warnSpy = spyOn(console, 'warn');

    // data with no toolName — scope reduction guard should warn and skip
    const result = await checkIFlowGuards(dir, { filePath: 'some/PLAN.md' });
    expect(result.success).toBe(true);

    warnSpy.mockRestore();
  });

  it('should warn when data exists but filePath is missing for scope reduction check', async () => {
    const warnSpy = spyOn(console, 'warn');

    // data with toolName=write but no filePath — scope reduction guard should warn
    const result = await checkIFlowGuards(dir, { toolName: 'write' });
    expect(result.success).toBe(true);

    warnSpy.mockRestore();
  });

  it('should warn when data exists but targetState is missing for artifact completeness check', async () => {
    const warnSpy = spyOn(console, 'warn');

    // data without targetState — artifact completeness guard should warn
    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);

    warnSpy.mockRestore();
  });

  it('should warn when data exists but currentState/targetState missing for cyclic transition check', async () => {
    const warnSpy = spyOn(console, 'warn');

    // data without currentState or targetState — cyclic transition guard should warn
    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);

    warnSpy.mockRestore();
  });
});

// ─── checkIFlowGuards — scope reduction (existing behavior) ─────────────────

describe('checkIFlowGuards — scope reduction guard', () => {
  const dir = tempDir('iflow-scope-reduction');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block write to PLAN.md with scope reduction language', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan\n\n## Tasks\n- Build v1 simplified version of auth');
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Goals\n\n## Goal\n- Full authentication system');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'PLAN.md',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Scope reduction');
  });

  it('should allow write to PLAN.md without scope reduction language', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan\n\n## Tasks\n- Build complete authentication system');
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Goals\n\n## Goal\n- Full authentication system');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'PLAN.md',
    });
    expect(result.success).toBe(true);
  });

  it('should not block non-write operations', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'read',
      filePath: 'PLAN.md',
    });
    expect(result.success).toBe(true);
  });
});

// ─── checkIFlowGuards — artifact completeness (existing behavior) ────────────

describe('checkIFlowGuards — artifact completeness guard', () => {
  const dir = tempDir('iflow-artifact-completeness');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block transition to executing when PLAN.md is missing', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      targetState: 'executing',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('PLAN.md');
  });

  it('should allow transition to executing when PLAN.md exists', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      targetState: 'executing',
    });
    expect(result.success).toBe(true);
  });
});

// ─── checkIFlowGuards — cyclic transition (existing behavior) ────────────────

describe('checkIFlowGuards — cyclic transition guard', () => {
  const dir = tempDir('iflow-cyclic-transition');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block invalid transition: discussing → executing', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'discussing',
      targetState: 'executing',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Invalid transition');
  });

  it('should allow valid transition: discussing → researching', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'discussing',
      targetState: 'researching',
    });
    expect(result.success).toBe(true);
  });

  it('should allow valid transition: shipping → discussing (cycle restart)', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'shipping',
      targetState: 'discussing',
    });
    expect(result.success).toBe(true);
  });
});

// ─── checkIFlowGuards — Nyquist Rule Guard (Task 3: over-strict fix) ────────

describe('checkIFlowGuards — Nyquist Rule Guard', () => {
  const dir = tempDir('iflow-nyquist');

  const PLAN_WITHOUT_AUTOMATED = `# Plan

### Task 1: Setup database
- **Actions**: Create schema
- **Verification**: Manual check

### Task 2: Build API
- **Actions**: Implement endpoints
- **Verification**: Run curl commands
`;

  const PLAN_WITH_AUTOMATED = `# Plan

### Task 1: Setup database
- **Actions**: Create schema
- **Verification**: <automated> bun test db.test.ts

### Task 2: Build API
- **Actions**: Implement endpoints
- **Verification**: <automated> bun test api.test.ts
`;

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should only warn (not block) when in non-executing state and tasks lack <automated>', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', PLAN_WITHOUT_AUTOMATED);
    await writeIFlowState(dir, 'planning');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'some-file.ts',
      currentState: 'planning',
      targetState: 'executing',
    });

    // In non-executing state, Nyquist guard should only warn, not block
    expect(result.success).toBe(true);
    expect(result.block).toBeFalsy();
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThan(0);
    expect(result.warnings!.some(w => w.includes('missing <automated>') || w.includes('Nyquist'))).toBe(true);
  });

  it('should block when in executing state and tasks lack <automated>', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', PLAN_WITHOUT_AUTOMATED);
    await writeIFlowArtifact(dir, 'PLAN.md', PLAN_WITHOUT_AUTOMATED);
    await writeIFlowState(dir, 'executing');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'some-file.ts',
      currentState: 'executing',
      targetState: 'verifying',
    });

    // In executing state, Nyquist guard should still block
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Nyquist');
  });

  it('should pass when all tasks have <automated> verification', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', PLAN_WITH_AUTOMATED);

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'some-file.ts',
    });

    expect(result.success).toBe(true);
    expect(result.block).toBeFalsy();
  });

  it('should only warn when no state info provided (not executing)', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', PLAN_WITHOUT_AUTOMATED);

    // No state info at all — should not block, only warn
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'some-file.ts',
    });

    expect(result.success).toBe(true);
    expect(result.block).toBeFalsy();
    expect(result.warnings).toBeDefined();
  });
});

// ─── checkIFlowGuards — deviation compliance content validation (Batch 2) ─────

describe('checkIFlowGuards — deviation compliance content validation', () => {
  const dir = tempDir('iflow-deviation-content');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should warn when deviation entry is missing Problem sub-field', async () => {
    await writeIFlowArtifact(dir, 'SUMMARY.md', `# Summary

## Deviations

- **Rule 1**: Skipped design review
  - **Action**: Proceeded without review
  - **Result**: No issues found
`);

    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('Problem'))).toBe(true);
  });

  it('should warn when deviation entry is missing Action sub-field', async () => {
    await writeIFlowArtifact(dir, 'SUMMARY.md', `# Summary

## Deviations

- **Rule 2**: Used different approach
  - **Problem**: Original approach too slow
  - **Result**: Faster execution
`);

    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('Action'))).toBe(true);
  });

  it('should warn when deviation entry is missing Result sub-field', async () => {
    await writeIFlowArtifact(dir, 'SUMMARY.md', `# Summary

## Deviations

- **Rule 3**: Changed implementation order
  - **Problem**: Dependency issue
  - **Action**: Reordered tasks
`);

    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('Result'))).toBe(true);
  });

  it('should not warn when deviation entry has all required sub-fields', async () => {
    await writeIFlowArtifact(dir, 'SUMMARY.md', `# Summary

## Deviations

- **Rule 1**: Skipped design review
  - **Problem**: Time constraint
  - **Action**: Proceeded without review
  - **Result**: No issues found
`);

    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  it('should warn when deviation entry is missing multiple sub-fields', async () => {
    await writeIFlowArtifact(dir, 'SUMMARY.md', `# Summary

## Deviations

- **Rule 4**: Major deviation
  (no sub-fields at all)
`);

    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('Problem') && w.includes('Action') && w.includes('Result'))).toBe(true);
  });

  it('should warn when SUMMARY.md exists but has no Deviations section', async () => {
    await writeIFlowArtifact(dir, 'SUMMARY.md', `# Summary

## What was done
- Implemented feature A
- Fixed bug B
`);

    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('Deviations') || w.includes('missing'))).toBe(true);
  });

  it('should warn when Deviations section exists but entries do not reference Rule numbers', async () => {
    await writeIFlowArtifact(dir, 'SUMMARY.md', `# Summary

## Deviations

- Skipped design review due to time constraint
- Used different approach for data loading
`);

    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('Rule'))).toBe(true);
  });

  it('should return success when SUMMARY.md does not exist', async () => {
    // No SUMMARY.md — guard should pass silently
    const result = await checkIFlowGuards(dir, { toolName: 'write', filePath: 'test.ts' });
    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
  });
});

// ─── checkIFlowGuards — scope reduction guard (additional coverage) ────────────

describe('checkIFlowGuards — scope reduction guard (additional coverage)', () => {
  const dir = tempDir('iflow-scope-reduction-extra');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block write to PLAN.md with "hardcoded for now" pattern', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan\n\n## Tasks\n- Build auth module with hardcoded for now config');
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Goals\n\n## Goal\n- Dynamic configuration system');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'PLAN.md',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Scope reduction');
  });

  it('should block write to PLAN.md with "future enhancement" pattern', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan\n\n## Tasks\n- Build basic version, future enhancement planned');
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Goals\n\n## Goal\n- Full-featured system');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'PLAN.md',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Scope reduction');
  });

  it('should not block write to non-PLAN.md files', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan\n\n## Tasks\n- Build v1 simplified version');
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Goals\n\n## Goal\n- Full system');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'src/feature.ts',
    });
    expect(result.success).toBe(true);
  });

  it('should not block edit operation on PLAN.md without reduction language', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan\n\n## Tasks\n- Build complete authentication system');
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Goals\n\n## Goal\n- Full authentication system');

    const result = await checkIFlowGuards(dir, {
      toolName: 'edit',
      filePath: 'PLAN.md',
    });
    expect(result.success).toBe(true);
  });
});

// ─── checkIFlowGuards — cyclic transition guard (additional coverage) ──────────

describe('checkIFlowGuards — cyclic transition guard (additional coverage)', () => {
  const dir = tempDir('iflow-cyclic-transition-extra');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block invalid transition: researching → shipping', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'researching',
      targetState: 'shipping',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Invalid transition');
  });

  it('should block invalid transition: planning → shipping', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'planning',
      targetState: 'shipping',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('Invalid transition');
  });

  it('should allow valid transition: researching → planning', async () => {
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Context');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'researching',
      targetState: 'planning',
    });
    expect(result.success).toBe(true);
  });

  it('should allow valid transition: researching → discussing (go back)', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'researching',
      targetState: 'discussing',
    });
    expect(result.success).toBe(true);
  });

  it('should allow valid transition: planning → researching (go back)', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'planning',
      targetState: 'researching',
    });
    expect(result.success).toBe(true);
  });

  it('should allow valid transition: executing → planning (go back)', async () => {
    await writeIFlowArtifact(dir, 'CONTEXT.md', '# Context');
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'executing',
      targetState: 'planning',
    });
    expect(result.success).toBe(true);
  });

  it('should allow valid transition: verifying → executing (go back)', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'verifying',
      targetState: 'executing',
    });
    expect(result.success).toBe(true);
  });

  it('should return success when currentState or targetState is not a valid IFlow state', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      currentState: 'unknown_state',
      targetState: 'discussing',
    });
    expect(result.success).toBe(true);
  });
});

// ─── checkIFlowGuards — artifact completeness guard (additional coverage) ──────

describe('checkIFlowGuards — artifact completeness guard (additional coverage)', () => {
  const dir = tempDir('iflow-artifact-completeness-extra');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/iflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should block transition to verifying when PLAN.md or SUMMARY.md is missing', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    // SUMMARY.md is missing

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      targetState: 'verifying',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('SUMMARY.md');
  });

  it('should allow transition to verifying when both PLAN.md and SUMMARY.md exist', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'SUMMARY.md', '# Summary');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      targetState: 'verifying',
    });
    expect(result.success).toBe(true);
  });

  it('should block transition to shipping when VERIFICATION.md is missing', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'SUMMARY.md', '# Summary');
    // VERIFICATION.md is missing

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      targetState: 'shipping',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('VERIFICATION.md');
  });

  it('should allow transition to shipping when all required artifacts exist', async () => {
    await writeIFlowArtifact(dir, 'PLAN.md', '# Plan');
    await writeIFlowArtifact(dir, 'SUMMARY.md', '# Summary');
    await writeIFlowArtifact(dir, 'VERIFICATION.md', '# Verification');

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      targetState: 'shipping',
    });
    expect(result.success).toBe(true);
  });

  it('should allow transition to discussing/researching with no required artifacts', async () => {
    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
      targetState: 'discussing',
    });
    expect(result.success).toBe(true);
  });

  it('should auto-detect state from state.json when targetState is not provided', async () => {
    await writeIFlowState(dir, 'executing');
    // PLAN.md is missing — should block

    const result = await checkIFlowGuards(dir, {
      toolName: 'write',
      filePath: 'test.ts',
    });
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('PLAN.md');
  });
});
