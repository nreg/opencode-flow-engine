/**
 * Tests for Workflow Recommendation Feature (P0-2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { 
  normalizeWorkflowFacts,
  recommendWorkflowPath,
  saveWorkflowRecommendation,
  readWorkflowSelection,
  recordWorkflowSelection,
  acceptWorkflowRecommendation,
  isDirectWorkflowReceipt,
  type WorkflowFacts,
  type WorkflowSelectionRecord,
} from '../workflow-recommendation.js';
import { fileExists, readFile, ensureDir, removeFile, directoryExists } from '@opencode-flow-engine/shared';
import { join } from 'path';

const TEST_DIR = join(import.meta.dir, '__test_workflow_recommendation__');
const WORKFLOW_SELECTION_FILE = '.flow-engine/sflow/workflow-selection.json';

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
});

afterEach(async () => {
  await cleanup();
});

// ─── normalizeWorkflowFacts Tests ───────────────────────────────────────────

describe('normalizeWorkflowFacts', () => {
  it('should normalize complete facts', () => {
    const input = {
      task_count: 2,
      file_count: 3,
      config_doc_only: 'no' as const,
      schema_api_change: 'no' as const,
      new_module: 'no' as const,
      behavioral_constraint_change: 'no' as const,
      cross_module_change: 'no' as const,
      uncertainty: 'low' as const,
      request_kind: 'standard' as const,
    };
    
    const result = normalizeWorkflowFacts(input);
    
    expect(result.task_count).toBe(2);
    expect(result.file_count).toBe(3);
    expect(result.config_doc_only).toBe('no');
    expect(result.request_kind).toBe('standard');
  });

  it('should handle missing facts with unknown', () => {
    const input = {
      task_count: 1,
      file_count: 1,
    };
    
    const result = normalizeWorkflowFacts(input);
    
    expect(result.task_count).toBe(1);
    expect(result.file_count).toBe(1);
    expect(result.config_doc_only).toBe('unknown');
    expect(result.schema_api_change).toBe('unknown');
    expect(result.request_kind).toBe('standard');
  });

  it('should throw on invalid enum value', () => {
    expect(() => {
      normalizeWorkflowFacts({ config_doc_only: 'maybe' as any });
    }).toThrow('invalid workflow fact value');
  });

  it('should throw on invalid count', () => {
    expect(() => {
      normalizeWorkflowFacts({ task_count: -1 });
    }).toThrow('task_count and file_count must be non-negative integers');
  });
});

// ─── recommendWorkflowPath Tests ─────────────────────────────────────────────

describe('recommendWorkflowPath', () => {
  it('should return needs-input when facts are missing', () => {
    const result = recommendWorkflowPath({ task_count: 2, file_count: 2 });
    
    expect(result.status).toBe('needs-input');
    expect(result.recommendation).toBeNull();
    expect(result.missing_facts.length).toBeGreaterThan(0);
  });

  it('should recommend full for risk signals', () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'yes',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    const result = recommendWorkflowPath(facts);
    
    expect(result.status).toBe('ready');
    expect(result.recommendation?.mode).toBe('full');
    expect(result.recommendation?.risk_reasons?.length).toBeGreaterThan(0);
  });

  it('should recommend quick for low-risk code work', () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    const result = recommendWorkflowPath(facts);
    
    expect(result.status).toBe('ready');
    expect(result.recommendation?.mode).toBe('quick');
  });

  it('should recommend tweak for config/doc-only work', () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 3,
      file_count: 3,
      config_doc_only: 'yes',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    const result = recommendWorkflowPath(facts);
    
    expect(result.status).toBe('ready');
    expect(result.recommendation?.mode).toBe('tweak');
  });

  it('should recommend hotfix for incident', () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'incident',
    };
    
    const result = recommendWorkflowPath(facts);
    
    expect(result.status).toBe('ready');
    expect(result.recommendation?.mode).toBe('hotfix');
  });
});

// ─── saveWorkflowRecommendation Tests ───────────────────────────────────────

describe('saveWorkflowRecommendation', () => {
  it('should save recommendation to file', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    const record = await saveWorkflowRecommendation(TEST_DIR, facts);
    
    expect(record.schema_version).toBe(1);
    expect(record.status).toBe('ready');
    expect(record.recommendation?.mode).toBe('quick');
    expect(record.hash).toMatch(/^sha256:/);
    
    // Verify file exists
    const filePath = join(TEST_DIR, WORKFLOW_SELECTION_FILE);
    expect(await fileExists(filePath)).toBe(true);
  });

  it('should create valid hash', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 1,
      file_count: 1,
      config_doc_only: 'yes',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    const record = await saveWorkflowRecommendation(TEST_DIR, facts);
    
    // Read back and verify hash
    const loaded = await readWorkflowSelection(TEST_DIR);
    expect(loaded.valid).toBe(true);
    expect(loaded.record?.hash).toBe(record.hash);
  });
});

// ─── readWorkflowSelection Tests ────────────────────────────────────────────

describe('readWorkflowSelection', () => {
  it('should return exists=false when file missing', async () => {
    const result = await readWorkflowSelection(TEST_DIR);
    
    expect(result.exists).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('should read and validate existing file', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    
    const result = await readWorkflowSelection(TEST_DIR);
    
    expect(result.exists).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.record?.recommendation?.mode).toBe('quick');
  });
});

// ─── recordWorkflowSelection Tests ───────────────────────────────────────────

describe('recordWorkflowSelection', () => {
  it('should record selection following recommendation', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    
    const record = await recordWorkflowSelection(TEST_DIR, {
      mode: 'quick',
      reason: 'Test selection',
      confirmed: true,
    });
    
    expect(record.selection?.mode).toBe('quick');
    expect(record.selection?.followed_recommendation).toBe(true);
    expect(record.selection?.acknowledged_non_recommendation).toBe(false);
  });

  it('should require acknowledgement for non-recommended selection', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 3,
      file_count: 3,
      config_doc_only: 'no',
      schema_api_change: 'yes', // Risk signal → recommends full
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    
    // Recommendation should be full (due to risk signal)
    const loaded = await readWorkflowSelection(TEST_DIR);
    expect(loaded.record?.recommendation?.mode).toBe('full');
    
    // Should throw without acknowledgement
    await expect(
      recordWorkflowSelection(TEST_DIR, {
        mode: 'quick',
        reason: 'Non-recommended selection',
        confirmed: true,
      })
    ).rejects.toThrow('non-recommended workflow selection requires acknowledgement');
    
    // Should succeed with acknowledgement
    const record = await recordWorkflowSelection(TEST_DIR, {
      mode: 'quick',
      reason: 'Non-recommended selection with acknowledgement',
      confirmed: true,
      acknowledged: true,
      verificationStrategy: 'bounded',
    });
    
    expect(record.selection?.mode).toBe('quick');
    expect(record.selection?.acknowledged_non_recommendation).toBe(true);
  });
});

// ─── acceptWorkflowRecommendation Tests ──────────────────────────────────────

describe('acceptWorkflowRecommendation', () => {
  it('should accept quick recommendation automatically', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    
    const record = await acceptWorkflowRecommendation(TEST_DIR, {
      source: 'direct-request',
      verificationStrategy: 'tdd',
    });
    
    expect(record.selection?.mode).toBe('quick');
    expect(record.selection?.accepted_automatically).toBe(true);
    expect(record.selection?.source).toBe('direct-request');
  });

  it('should accept hotfix for incident', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
      request_kind: 'incident',
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    
    const record = await acceptWorkflowRecommendation(TEST_DIR, {
      source: 'direct-request',
      verificationStrategy: 'new-test',
    });
    
    expect(record.selection?.mode).toBe('hotfix');
    expect(record.selection?.accepted_automatically).toBe(true);
  });

  it('should reject full recommendation', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 10,
      file_count: 10,
      config_doc_only: 'no',
      schema_api_change: 'yes',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    
    await expect(
      acceptWorkflowRecommendation(TEST_DIR, {
        source: 'direct-request',
        verificationStrategy: 'tdd',
      })
    ).rejects.toThrow('only a recommended quick or hotfix workflow can be accepted directly');
  });
});

// ─── isDirectWorkflowReceipt Tests ───────────────────────────────────────────

describe('isDirectWorkflowReceipt', () => {
  it('should validate direct acceptance receipt', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    const record = await acceptWorkflowRecommendation(TEST_DIR, {
      source: 'direct-request',
      verificationStrategy: 'tdd',
    });
    
    const state = { workflow: 'quick' };
    expect(isDirectWorkflowReceipt(record, state)).toBe(true);
  });

  it('should reject mismatched workflow', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 2,
      file_count: 2,
      config_doc_only: 'no',
      schema_api_change: 'no',
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    const record = await acceptWorkflowRecommendation(TEST_DIR, {
      source: 'direct-request',
      verificationStrategy: 'tdd',
    });
    
    const state = { workflow: 'full' };
    expect(isDirectWorkflowReceipt(record, state)).toBe(false);
  });

  it('should validate acknowledged quick receipt', async () => {
    const facts: Partial<WorkflowFacts> = {
      task_count: 3,
      file_count: 3,
      config_doc_only: 'no',
      schema_api_change: 'yes', // Risk signal → recommends full
      new_module: 'no',
      behavioral_constraint_change: 'no',
      cross_module_change: 'no',
      uncertainty: 'low',
    };
    
    await saveWorkflowRecommendation(TEST_DIR, facts);
    
    // Recommendation should be full
    const loaded = await readWorkflowSelection(TEST_DIR);
    expect(loaded.record?.recommendation?.mode).toBe('full');
    
    const record = await recordWorkflowSelection(TEST_DIR, {
      mode: 'quick',
      reason: 'Risk override with acknowledgement',
      confirmed: true,
      acknowledged: true,
      verificationStrategy: 'bounded',
    });
    
    const state = { workflow: 'quick' };
    expect(isDirectWorkflowReceipt(record, state)).toBe(true);
  });
});
