/**
 * Tests for Wave 3: P1 Spec Baseline Preflight
 *
 * Validates that delta specs are checked against baseline specs for conflicts
 * before entering the bridging state (DP-2 artifact review gate).
 *
 * Preflight behavior:
 * - Calls applyDeltaToBaselineDetailed to detect conflicts
 * - Reports (baseline preflight) errors with conflict paths
 * - Gracefully skips when no delta spec or non-standard change directory
 * - Independent pipeline step (not in guard)
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { createArtifactValidationHook } from '../artifact-validation.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

// ─── Wave 3: P1 Spec Baseline Preflight ──────────────────────────────────────

describe('Wave 3: P1 Spec Baseline Preflight', () => {
  const projectRoot = tempDir('wave3-preflight-project');
  const changeDir = join(projectRoot, 'changes', 'test-change');

  beforeEach(async () => {
    await cleanupDir(projectRoot);
    await ensureDir(changeDir);
  });

  afterEach(async () => {
    await cleanupDir(projectRoot);
  });

  // ─── Preflight should detect conflicts ──────────────────────────────────

  it('should fail when delta spec conflicts with baseline', async () => {
    // Setup: Create baseline spec
    const baselineSpecDir = join(projectRoot, 'specs', 'auth');
    await ensureDir(baselineSpecDir);
    await writeFile(
      join(baselineSpecDir, 'spec.md'),
      `# auth

## Purpose

Authentication capability.

## Requirements

### Requirement: Login

Users SHALL be able to login with email and password.

#### Scenario: Successful login
**Given:** Valid credentials
**When:** User submits login form
**Then:** User is authenticated
`
    );

    // Setup: Create delta spec with conflict (MODIFY non-existent requirement)
    const deltaSpecDir = join(changeDir, 'specs');
    await ensureDir(deltaSpecDir);
    await writeFile(
      join(deltaSpecDir, 'auth.md'),
      `## MODIFIED Requirements

### Requirement: NonExistent

This requirement SHALL not exist in baseline.

#### Scenario: Test
**Given:** Test
**When:** Test
**Then:** Test
`
    );

    // Execute validation
    const hook = createArtifactValidationHook();
    const result = await hook.execute({
      changeDir,
      data: { newState: 'bridging' },
    } as any);

    // Assert: Should fail with (baseline preflight) error
    expect(result.success).toBe(false);
    expect(result.error).toContain('(baseline preflight)');
    expect(result.error).toContain('NonExistent');
  });

  it('should pass when delta spec is compatible with baseline', async () => {
    // Setup: Create baseline spec
    const baselineSpecDir = join(projectRoot, 'specs', 'auth');
    await ensureDir(baselineSpecDir);
    await writeFile(
      join(baselineSpecDir, 'spec.md'),
      `# auth

## Purpose

Authentication capability.

## Requirements

### Requirement: Login

Users SHALL be able to login with email and password.

#### Scenario: Successful login
**Given:** Valid credentials
**When:** User submits login form
**Then:** User is authenticated
`
    );

    // Setup: Create delta spec with ADDED (compatible)
    const deltaSpecDir = join(changeDir, 'specs');
    await ensureDir(deltaSpecDir);
    await writeFile(
      join(deltaSpecDir, 'auth.md'),
      `## ADDED Requirements

### Requirement: Logout

Users SHALL be able to logout.

#### Scenario: Successful logout
**Given:** User is logged in
**When:** User clicks logout
**Then:** User is logged out
`
    );

    // Execute validation
    const hook = createArtifactValidationHook();
    const result = await hook.execute({
      changeDir,
      data: { newState: 'bridging' },
    } as any);

    // Assert: Should pass
    expect(result.success).toBe(true);
  });

  // ─── Backward compatibility ─────────────────────────────────────────────

  it('should skip preflight when no delta spec exists', async () => {
    // Setup: Create baseline spec
    const baselineSpecDir = join(projectRoot, 'specs', 'auth');
    await ensureDir(baselineSpecDir);
    await writeFile(
      join(baselineSpecDir, 'spec.md'),
      `# auth

## Purpose

Authentication capability.
`
    );

    // Create a delta spec for a different capability (no baseline for this one)
    const deltaSpecDir = join(changeDir, 'specs');
    await ensureDir(deltaSpecDir);
    await writeFile(
      join(deltaSpecDir, 'new-feature.md'),
      `## ADDED Requirements

### Requirement: NewFeature

New feature SHALL work.

#### Scenario: Test
**Given:** Test
**When:** Test
**Then:** Test
`
    );

    // Execute validation
    const hook = createArtifactValidationHook();
    const result = await hook.execute({
      changeDir,
      data: { newState: 'bridging' },
    } as any);

    // Assert: Should pass (skip preflight for new-feature.md since no baseline exists)
    expect(result.success).toBe(true);
  });

  it('should skip preflight when changeDir is not in changes/ directory', async () => {
    // Setup: Use a changeDir that doesn't follow changes/ convention
    const nonStandardChangeDir = join(projectRoot, 'workflows', 'test');
    await ensureDir(nonStandardChangeDir);

    // Setup: Create baseline spec
    const baselineSpecDir = join(projectRoot, 'specs', 'auth');
    await ensureDir(baselineSpecDir);
    await writeFile(
      join(baselineSpecDir, 'spec.md'),
      `# auth

## Purpose

Authentication capability.
`
    );

    // Setup: Create delta spec (but preflight should skip)
    const deltaSpecDir = join(nonStandardChangeDir, 'specs');
    await ensureDir(deltaSpecDir);
    await writeFile(
      join(deltaSpecDir, 'auth.md'),
      `## ADDED Requirements

### Requirement: Test

Test requirement SHALL work.

#### Scenario: Test
**Given:** Test
**When:** Test
**Then:** Test
`
    );

    // Execute validation
    const hook = createArtifactValidationHook();
    const result = await hook.execute({
      changeDir: nonStandardChangeDir,
      data: { newState: 'bridging' },
    } as any);

    // Assert: Should pass (skip preflight)
    expect(result.success).toBe(true);
  });

  it('should skip preflight when no baseline spec exists', async () => {
    // Setup: No baseline spec

    // Setup: Create delta spec
    const deltaSpecDir = join(changeDir, 'specs');
    await ensureDir(deltaSpecDir);
    await writeFile(
      join(deltaSpecDir, 'auth.md'),
      `## ADDED Requirements

### Requirement: Login

Users SHALL be able to login.

#### Scenario: Test
**Given:** Test
**When:** Test
**Then:** Test
`
    );

    // Execute validation
    const hook = createArtifactValidationHook();
    const result = await hook.execute({
      changeDir,
      data: { newState: 'bridging' },
    } as any);

    // Assert: Should pass (skip preflight, will create new baseline)
    expect(result.success).toBe(true);
  });
});
