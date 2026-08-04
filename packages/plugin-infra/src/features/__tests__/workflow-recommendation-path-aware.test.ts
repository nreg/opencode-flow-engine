/**
 * Tests for Path-Aware Two-Stage Quick Judgment (Wave 1)
 * 
 * Covers:
 * - WorkflowFacts extension (affected_paths, exclusion_checks)
 * - Path normalization and whitelist validation
 * - Two-stage quick judgment logic
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeWorkflowFacts,
  recommendWorkflowPath,
  normalizeAffectedPaths,
  isLightweightPath,
  type WorkflowFacts,
} from '../workflow-recommendation';

// ─── Task 1.1: WorkflowFacts Extension ─────────────────────────────────────

describe('WorkflowFacts Extension', () => {
  it('should accept affected_paths and exclusion_checks fields', () => {
    const facts = normalizeWorkflowFacts({
      task_count: 2,
      file_count: 3,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'standard',
      affected_paths: ['tests/unit/foo.test.ts', 'docs/guide.md'],
      exclusion_checks: {
        production_behavior: 'yes',
        public_boundary: 'yes',
        installer: 'yes',
        state_machine: 'yes',
        external_side_effect: 'yes',
        data_permission_config_semantics: 'yes',
        expected_behavior_clear: 'yes',
        verification_reproducible: 'yes',
        impact_paths_complete: 'yes',
      },
    });

    expect(facts.affected_paths).toEqual(['tests/unit/foo.test.ts', 'docs/guide.md']);
    expect(facts.exclusion_checks).toBeDefined();
    expect(facts.exclusion_checks!.production_behavior).toBe('yes');
    expect(facts.exclusion_checks!.data_permission_config_semantics).toBe('yes');
  });

  it('should default data_permission_config_semantics to no when missing', () => {
    const facts = normalizeWorkflowFacts({
      task_count: 2,
      file_count: 3,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'standard',
      affected_paths: ['tests/unit/foo.test.ts'],
      exclusion_checks: {
        production_behavior: 'yes',
        public_boundary: 'yes',
        installer: 'yes',
        state_machine: 'yes',
        external_side_effect: 'yes',
        // data_permission_config_semantics omitted
        expected_behavior_clear: 'yes',
        verification_reproducible: 'yes',
        impact_paths_complete: 'yes',
      },
    });

    expect(facts.exclusion_checks!.data_permission_config_semantics).toBe('no');
  });

  it('should be backward compatible when new fields are absent', () => {
    const facts = normalizeWorkflowFacts({
      task_count: 2,
      file_count: 3,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'standard',
    });

    expect(facts.affected_paths).toBeNull();
    expect(facts.exclusion_checks).toBeNull();
  });
});

// ─── Task 1.2: Path Normalization and Whitelist Validation ────────────────

describe('Path Normalization', () => {
  it('should reject absolute paths', () => {
    const result = normalizeAffectedPaths(['/home/user/repo/src/foo.ts', 'tests/bar.test.ts']);
    expect(result.rejected).toContain('/home/user/repo/src/foo.ts');
    expect(result.normalized).not.toContain('/home/user/repo/src/foo.ts');
    expect(result.normalized).toContain('tests/bar.test.ts');
  });

  it('should reject parent traversal paths', () => {
    const result = normalizeAffectedPaths(['../scripts/setup.sh', 'docs/guide.md']);
    expect(result.rejected).toContain('../scripts/setup.sh');
    expect(result.normalized).not.toContain('../scripts/setup.sh');
    expect(result.normalized).toContain('docs/guide.md');
  });

  it('should normalize valid relative paths', () => {
    const result = normalizeAffectedPaths(['tests/unit/foo.test.ts', 'docs/guide.md']);
    expect(result.normalized).toEqual(['tests/unit/foo.test.ts', 'docs/guide.md']);
    expect(result.rejected).toEqual([]);
  });

  it('should handle null input', () => {
    const result = normalizeAffectedPaths(null);
    expect(result.normalized).toEqual([]);
    expect(result.rejected).toEqual([]);
  });
});

describe('Whitelist Validation', () => {
  it('should match tests/ prefix', () => {
    expect(isLightweightPath('tests/unit/foo.test.ts')).toBe(true);
    expect(isLightweightPath('tests/integration/bar.test.ts')).toBe(true);
  });

  it('should match docs/ prefix', () => {
    expect(isLightweightPath('docs/guide.md')).toBe(true);
    expect(isLightweightPath('docs/api/readme.md')).toBe(true);
  });

  it('should match test-support/ prefix', () => {
    expect(isLightweightPath('test-support/fixtures/data.json')).toBe(true);
  });

  it('should reject non-whitelisted paths', () => {
    expect(isLightweightPath('src/index.ts')).toBe(false);
    expect(isLightweightPath('lib/utils.js')).toBe(false);
    expect(isLightweightPath('package.json')).toBe(false);
  });

  it('should validate all paths in array', () => {
    const paths = ['tests/foo.test.ts', 'docs/guide.md', 'src/index.ts'];
    const allWhitelisted = paths.every(isLightweightPath);
    expect(allWhitelisted).toBe(false);
  });
});

// ─── Task 1.3: Two-Stage Quick Judgment ────────────────────────────────────

describe('Two-Stage Quick Judgment', () => {
  it('Stage ①: should apply relaxed threshold when all paths whitelisted and all checks pass', () => {
    const result = recommendWorkflowPath({
      task_count: 8,
      file_count: 10,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'standard',
      affected_paths: ['tests/unit/foo.test.ts', 'docs/guide.md'],
      exclusion_checks: {
        production_behavior: 'yes',
        public_boundary: 'yes',
        installer: 'yes',
        state_machine: 'yes',
        external_side_effect: 'yes',
        data_permission_config_semantics: 'yes',
        expected_behavior_clear: 'yes',
        verification_reproducible: 'yes',
        impact_paths_complete: 'yes',
      },
    });

    expect(result.status).toBe('ready');
    expect(result.recommendation!.mode).toBe('quick');
    expect(result.recommendation!.reasons[0]).toContain('Relaxed threshold');
  });

  it('Stage ① miss: should fallback to existing threshold when path not whitelisted', () => {
    const result = recommendWorkflowPath({
      task_count: 4,
      file_count: 4,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'standard',
      affected_paths: ['src/index.ts', 'tests/foo.test.ts'],
      exclusion_checks: {
        production_behavior: 'yes',
        public_boundary: 'yes',
        installer: 'yes',
        state_machine: 'yes',
        external_side_effect: 'yes',
        data_permission_config_semantics: 'yes',
        expected_behavior_clear: 'yes',
        verification_reproducible: 'yes',
        impact_paths_complete: 'yes',
      },
    });

    // Should fallback to standard threshold (task≤3 && file≤3)
    // 4 tasks and 4 files exceeds standard threshold, so should recommend full
    expect(result.status).toBe('ready');
    expect(result.recommendation!.mode).toBe('full');
  });

  it('Stage ① miss: should fallback when exclusion check fails', () => {
    const result = recommendWorkflowPath({
      task_count: 4,
      file_count: 4,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'standard',
      affected_paths: ['tests/foo.test.ts'],
      exclusion_checks: {
        production_behavior: 'no', // This check fails
        public_boundary: 'yes',
        installer: 'yes',
        state_machine: 'yes',
        external_side_effect: 'yes',
        data_permission_config_semantics: 'yes',
        expected_behavior_clear: 'yes',
        verification_reproducible: 'yes',
        impact_paths_complete: 'yes',
      },
    });

    // Should fallback to standard threshold
    expect(result.status).toBe('ready');
    expect(result.recommendation!.mode).toBe('full');
  });

  it('Stage ②: should fallback when file count exceeds relaxed threshold', () => {
    const result = recommendWorkflowPath({
      task_count: 8,
      file_count: 12, // Exceeds relaxed threshold (10)
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'standard',
      affected_paths: ['tests/foo.test.ts', 'docs/guide.md'],
      exclusion_checks: {
        production_behavior: 'yes',
        public_boundary: 'yes',
        installer: 'yes',
        state_machine: 'yes',
        external_side_effect: 'yes',
        data_permission_config_semantics: 'yes',
        expected_behavior_clear: 'yes',
        verification_reproducible: 'yes',
        impact_paths_complete: 'yes',
      },
    });

    expect(result.status).toBe('ready');
    expect(result.recommendation!.mode).toBe('full');
  });

  it('should maintain backward compatibility without new fields', () => {
    const result = recommendWorkflowPath({
      task_count: 3,
      file_count: 3,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'standard',
    });

    // Should use existing threshold (task≤3 && file≤3)
    expect(result.status).toBe('ready');
    expect(result.recommendation!.mode).toBe('quick');
  });

  it('should respect risk signals regardless of path whitelist', () => {
    const result = recommendWorkflowPath({
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'yes', // Risk signal
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'standard',
      affected_paths: ['tests/foo.test.ts'],
      exclusion_checks: {
        production_behavior: 'yes',
        public_boundary: 'yes',
        installer: 'yes',
        state_machine: 'yes',
        external_side_effect: 'yes',
        data_permission_config_semantics: 'yes',
        expected_behavior_clear: 'yes',
        verification_reproducible: 'yes',
        impact_paths_complete: 'yes',
      },
    });

    // Risk signals should take precedence
    expect(result.status).toBe('ready');
    expect(result.recommendation!.mode).toBe('full');
    expect(result.recommendation!.risk_reasons).toContain('schema or API changes');
  });
});
