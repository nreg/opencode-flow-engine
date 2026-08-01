/**
 * Tests for Direct Short-Path Guard Check (P0-2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  checkDirectShortPath,
  checkDirectTestResult,
  isDirectShortPathTransition,
  getDirectShortPathChecks,
} from '../check-direct-short-path.js';
import { 
  saveWorkflowRecommendation,
  acceptWorkflowRecommendation,
  recordWorkflowSelection,
} from '../../workflow-recommendation.js';
import { ensureDir, writeJsonFile, directoryExists } from '@opencode-flow-engine/shared';
import { join } from 'path';

const TEST_DIR = join(import.meta.dir, '__test_check_direct_short_path__');
const STATE_FILE = '.flow-engine/sflow/state.json';

// ─── Test Setup ────────────────────────────────────────────────────────────

async function cleanup() {
  if (await directoryExists(TEST_DIR)) {
    const { rm } = await import('fs/promises');
    await rm(TEST_DIR, { recursive: true, force: true });
  }
}

beforeEach(async () => {
  await cleanup();
  await ensureDir(TEST_DIR);
  await ensureDir(join(TEST_DIR, '.flow-engine/sflow'));
});

afterEach(async () => {
  await cleanup();
});

async function writeState(workflow: string, testResult?: string) {
  await writeJsonFile(join(TEST_DIR, STATE_FILE), {
    state: 'approved-for-build',
    workflow,
    test_result: testResult,
    updatedAt: new Date().toISOString(),
  });
}

// ─── checkDirectShortPath Tests ─────────────────────────────────────────────

describe('checkDirectShortPath', () => {
  it('should pass for valid quick workflow receipt', async () => {
    const facts = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no' as const,
      schema_api_change: 'no' as const,
      new_module: 'no' as const,
      behavioral_constraint_change: 'no' as const,
      cross_module_change: 'no' as const,
      uncertainty: 'low' as const,
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    await acceptWorkflowRecommendation(TEST_DIR, {
      source: 'direct-request',
      verificationStrategy: 'tdd',
    });
    await writeState('quick');
    
    const result = await checkDirectShortPath(TEST_DIR, 'quick');
    
    expect(result.pass).toBe(true);
    expect(result.failures.length).toBe(0);
  });

  it('should fail for missing receipt', async () => {
    await writeState('quick');
    
    const result = await checkDirectShortPath(TEST_DIR, 'quick');
    
    expect(result.pass).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0]).toContain('valid direct receipt is required');
  });

  it('should fail for mismatched workflow', async () => {
    const facts = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no' as const,
      schema_api_change: 'no' as const,
      new_module: 'no' as const,
      behavioral_constraint_change: 'no' as const,
      cross_module_change: 'no' as const,
      uncertainty: 'low' as const,
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    await acceptWorkflowRecommendation(TEST_DIR, {
      source: 'direct-request',
      verificationStrategy: 'tdd',
    });
    await writeState('full');
    
    const result = await checkDirectShortPath(TEST_DIR, 'quick');
    
    expect(result.pass).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('should pass for hotfix workflow receipt', async () => {
    const facts = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no' as const,
      schema_api_change: 'no' as const,
      new_module: 'no' as const,
      behavioral_constraint_change: 'no' as const,
      cross_module_change: 'no' as const,
      uncertainty: 'low' as const,
      request_kind: 'incident' as const,
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    await acceptWorkflowRecommendation(TEST_DIR, {
      source: 'direct-request',
      verificationStrategy: 'new-test',
    });
    await writeState('hotfix');
    
    const result = await checkDirectShortPath(TEST_DIR, 'hotfix');
    
    expect(result.pass).toBe(true);
  });

  it('should pass for acknowledged quick receipt', async () => {
    const facts = {
      task_count: 3,
      file_count: 3,
      config_doc_only: 'no' as const,
      schema_api_change: 'yes' as const, // Risk signal → recommends full
      new_module: 'no' as const,
      behavioral_constraint_change: 'no' as const,
      cross_module_change: 'no' as const,
      uncertainty: 'low' as const,
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    await recordWorkflowSelection(TEST_DIR, {
      mode: 'quick',
      reason: 'Risk override',
      confirmed: true,
      acknowledged: true,
      verificationStrategy: 'bounded',
    });
    await writeState('quick');
    
    const result = await checkDirectShortPath(TEST_DIR, 'quick');
    
    expect(result.pass).toBe(true);
  });
});

// ─── checkDirectTestResult Tests ────────────────────────────────────────────

describe('checkDirectTestResult', () => {
  it('should pass for test_result starting with pass', async () => {
    await writeState('quick', 'pass: all tests passed');
    
    const result = await checkDirectTestResult(TEST_DIR);
    
    expect(result.pass).toBe(true);
  });

  it('should pass for test_result PASS (case insensitive)', async () => {
    await writeState('quick', 'PASS: 100% coverage');
    
    const result = await checkDirectTestResult(TEST_DIR);
    
    expect(result.pass).toBe(true);
  });

  it('should fail for missing test_result', async () => {
    await writeState('quick');
    
    const result = await checkDirectTestResult(TEST_DIR);
    
    expect(result.pass).toBe(false);
    expect(result.failures[0]).toContain('test_result starting with pass');
  });

  it('should fail for test_result not starting with pass', async () => {
    await writeState('quick', 'fail: 2 tests failed');
    
    const result = await checkDirectTestResult(TEST_DIR);
    
    expect(result.pass).toBe(false);
  });
});

// ─── isDirectShortPathTransition Tests ──────────────────────────────────────

describe('isDirectShortPathTransition', () => {
  it('should identify quick transitions as direct short path', () => {
    expect(isDirectShortPathTransition('exploring', 'approved-for-build', 'quick')).toBe(true);
    expect(isDirectShortPathTransition('approved-for-build', 'executing', 'quick')).toBe(true);
    expect(isDirectShortPathTransition('executing', 'closing', 'quick')).toBe(true);
    expect(isDirectShortPathTransition('debugging', 'executing', 'quick')).toBe(true);
  });

  it('should identify hotfix exploring→approved-for-build as direct short path', () => {
    expect(isDirectShortPathTransition('exploring', 'approved-for-build', 'hotfix')).toBe(true);
    expect(isDirectShortPathTransition('approved-for-build', 'executing', 'hotfix')).toBe(false);
  });

  it('should identify tweak transitions as direct short path', () => {
    expect(isDirectShortPathTransition('exploring', 'approved-for-build', 'tweak')).toBe(true);
    expect(isDirectShortPathTransition('approved-for-build', 'executing', 'tweak')).toBe(true);
    expect(isDirectShortPathTransition('executing', 'closing', 'tweak')).toBe(true);
  });

  it('should not identify full transitions as direct short path', () => {
    expect(isDirectShortPathTransition('exploring', 'specifying', 'full')).toBe(false);
    expect(isDirectShortPathTransition('specifying', 'bridging', 'full')).toBe(false);
  });
});

// ─── getDirectShortPathChecks Tests ─────────────────────────────────────────

describe('getDirectShortPathChecks', () => {
  it('should return correct checks for quick transitions', () => {
    expect(getDirectShortPathChecks('exploring', 'approved-for-build', 'quick')).toEqual(['direct-short-path']);
    expect(getDirectShortPathChecks('executing', 'closing', 'quick')).toEqual(['direct-short-path', 'direct-test-result']);
  });

  it('should return correct checks for hotfix transitions', () => {
    expect(getDirectShortPathChecks('exploring', 'approved-for-build', 'hotfix')).toEqual(['direct-short-path']);
    expect(getDirectShortPathChecks('approved-for-build', 'executing', 'hotfix')).toEqual([]);
  });

  it('should return correct checks for tweak transitions', () => {
    expect(getDirectShortPathChecks('exploring', 'approved-for-build', 'tweak')).toEqual(['direct-short-path']);
    expect(getDirectShortPathChecks('executing', 'closing', 'tweak')).toEqual(['direct-short-path', 'direct-test-result']);
  });

  it('should return empty for full transitions', () => {
    expect(getDirectShortPathChecks('exploring', 'specifying', 'full')).toEqual([]);
    expect(getDirectShortPathChecks('specifying', 'bridging', 'full')).toEqual([]);
  });
});
