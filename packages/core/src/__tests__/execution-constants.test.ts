/**
 * Tests for constants.ts additions — Wave W1 Tasks 1.2 & 1.3
 *
 * Validates EXECUTION_MODE_THRESHOLDS, RECEIPT_STATUS constants,
 * and ARTIFACT_PREFLIGHT entries for execution-plan.json.
 */
import { describe, it, expect } from 'bun:test';
import {
  EXECUTION_MODE_THRESHOLDS,
  RECEIPT_STATUS,
  ARTIFACT_PREFLIGHT,
} from '@opencode-flow-engine/core';

// ─── EXECUTION_MODE_THRESHOLDS ───────────────────────────────────────────────

describe('EXECUTION_MODE_THRESHOLDS', () => {
  it('should be defined and exported', () => {
    expect(EXECUTION_MODE_THRESHOLDS).toBeDefined();
  });

  it('should have inline threshold with maxTasks = 2', () => {
    expect(EXECUTION_MODE_THRESHOLDS.inline).toBeDefined();
    expect(EXECUTION_MODE_THRESHOLDS.inline.maxTasks).toBe(2);
  });

  it('should have batch-inline threshold with maxTasks = 5', () => {
    expect(EXECUTION_MODE_THRESHOLDS['batch-inline']).toBeDefined();
    expect(EXECUTION_MODE_THRESHOLDS['batch-inline'].maxTasks).toBe(5);
  });

  it('should be readonly (as const)', () => {
    expect(typeof EXECUTION_MODE_THRESHOLDS).toBe('object');
    expect(Object.keys(EXECUTION_MODE_THRESHOLDS)).toContain('inline');
    expect(Object.keys(EXECUTION_MODE_THRESHOLDS)).toContain('batch-inline');
  });
});

// ─── RECEIPT_STATUS ──────────────────────────────────────────────────────────

describe('RECEIPT_STATUS', () => {
  it('should be defined and exported', () => {
    expect(RECEIPT_STATUS).toBeDefined();
  });

  it('should have PASS = "pass"', () => {
    expect(RECEIPT_STATUS.PASS).toBe('pass');
  });

  it('should have FAIL = "fail"', () => {
    expect(RECEIPT_STATUS.FAIL).toBe('fail');
  });

  it('should be readonly (as const)', () => {
    expect(typeof RECEIPT_STATUS).toBe('object');
    expect(Object.keys(RECEIPT_STATUS)).toEqual(['PASS', 'FAIL']);
  });
});

// ─── ARTIFACT_PREFLIGHT: execution-plan.json ─────────────────────────────────

describe('ARTIFACT_PREFLIGHT execution-plan.json', () => {
  it('should list execution-plan.json as optional for approved-for-build', () => {
    const entry = ARTIFACT_PREFLIGHT['approved-for-build'];
    expect(entry).toBeDefined();
    expect(entry.optional).toContain('execution-plan.json');
  });

  it('should list execution-plan.json as optional for executing', () => {
    const entry = ARTIFACT_PREFLIGHT['executing'];
    expect(entry).toBeDefined();
    expect(entry.optional).toContain('execution-plan.json');
  });

  it('should list execution-plan.json as optional for debugging', () => {
    const entry = ARTIFACT_PREFLIGHT['debugging'];
    expect(entry).toBeDefined();
    expect(entry.optional).toContain('execution-plan.json');
  });

  it('should list execution-plan.json as optional for closing', () => {
    const entry = ARTIFACT_PREFLIGHT['closing'];
    expect(entry).toBeDefined();
    expect(entry.optional).toContain('execution-plan.json');
  });

  it('should NOT list execution-plan.json as required for any state', () => {
    for (const [state, entry] of Object.entries(ARTIFACT_PREFLIGHT)) {
      if (entry.required) {
        expect(entry.required).not.toContain('execution-plan.json');
      }
    }
  });

  it('should preserve existing required artifacts for approved-for-build', () => {
    const entry = ARTIFACT_PREFLIGHT['approved-for-build'];
    expect(entry.required).toContain('proposal.md');
    expect(entry.required).toContain('specs/');
    expect(entry.required).toContain('design.md');
    expect(entry.required).toContain('tasks.md');
    expect(entry.required).toContain('execution-contract.md');
  });

  it('should preserve existing optional artifacts for approved-for-build', () => {
    const entry = ARTIFACT_PREFLIGHT['approved-for-build'];
    expect(entry.optional).toContain('ui-design.md');
  });
});
