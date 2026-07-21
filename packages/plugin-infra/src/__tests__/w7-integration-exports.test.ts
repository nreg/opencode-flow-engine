/**
 * Wave W7: Integration and Exports tests
 *
 * TDD RED phase: Tests for:
 * - Task 10.1: features/index.ts re-exports execution-plan functions (recordReviewReceipt)
 * - Task 10.2: detectArtifactExistence reports execution-plan.json when present
 * - Task 10.3: detectStateMismatch flags mismatch when plan exists but contract doesn't match
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';

// Task 10.1: Import from features/index.ts
import {
  recordReviewReceipt,
  createExecutionPlan,
  readExecutionPlan,
  validatePlanHashes,
  reviseExecutionPlan,
  computeContentHash,
  recommendExecutionMode,
} from '../features/index.js';

import type {
  ExecutionPlan,
  Wave,
  ReviewReceipt,
  DP4Result,
  ExecutionMode,
  ReceiptStatus,
  WaveStrategy,
  PlanSource,
} from '../features/index.js';

// Task 10.2 & 10.3: Import state detection functions
import {
  detectArtifactExistence,
  detectStateMismatch,
  simpleHash,
} from '../features/state-manager.js';

import type { WorkflowStateDetection } from '../features/state-manager.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', `w7-${name}`);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

/** Create a minimal state.json for testing */
async function setupStateJson(dir: string, overrides?: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow');
  const state = {
    state: 'approved-for-build',
    mode: 'full',
    artifacts_hash: 'test-artifacts-hash-1234',
    contract_hash: 'test-contract-hash-5678',
    batches_completed: 0,
    dp_0_confirmed: false,
    contractApproved: true,
    verificationStatus: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify(state, null, 2));
}

const sampleWaves: Wave[] = [
  { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
  { id: 'W2', strategy: 'serial', tasks: ['2.1', '2.2'], depends_on: ['W1'] },
];

// ─── Task 10.1: features/index.ts re-exports ──────────────────────────────────

describe('Task 10.1: features/index.ts re-exports execution-plan functions', () => {
  it('should export recordReviewReceipt from features/index.ts', () => {
    // This test verifies that recordReviewReceipt is re-exported
    // If not exported, the import at the top of this file would fail at compile time
    expect(typeof recordReviewReceipt).toBe('function');
  });

  it('should export createExecutionPlan from features/index.ts', () => {
    expect(typeof createExecutionPlan).toBe('function');
  });

  it('should export readExecutionPlan from features/index.ts', () => {
    expect(typeof readExecutionPlan).toBe('function');
  });

  it('should export validatePlanHashes from features/index.ts', () => {
    expect(typeof validatePlanHashes).toBe('function');
  });

  it('should export reviseExecutionPlan from features/index.ts', () => {
    expect(typeof reviseExecutionPlan).toBe('function');
  });

  it('should export computeContentHash from features/index.ts', () => {
    expect(typeof computeContentHash).toBe('function');
  });

  it('should export recommendExecutionMode from features/index.ts', () => {
    expect(typeof recommendExecutionMode).toBe('function');
  });

  it('should re-export types from execution-plan-types.js', () => {
    // Type-level check: if these types are not exported, the import would fail
    // We verify at runtime by checking that the type imports compile
    const _typeCheck: ExecutionMode = 'inline';
    const _statusCheck: ReceiptStatus = 'approved';
    const _strategyCheck: WaveStrategy = 'parallel';
    const _sourceCheck: PlanSource = 'default';
    expect(_typeCheck).toBe('inline');
    expect(_statusCheck).toBe('approved');
  });

  it('should allow recordReviewReceipt to be called through index.ts re-export', async () => {
    const dir = tempDir('reexport-receipt');
    try {
      await cleanupDir(dir);
      await ensureDir(dir);
      await setupStateJson(dir);

      // Create a plan first
      await createExecutionPlan(dir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'Test re-export',
        waves: sampleWaves,
      });

      // Call recordReviewReceipt through the re-export
      const receipt = await recordReviewReceipt(dir, 'W1', {
        status: 'approved',
        base: 'abc123',
        head: 'def456',
        report: 'All tests pass',
      });

      expect(receipt.status).toBe('approved');
      expect(receipt.base).toBe('abc123');
      expect(receipt.head).toBe('def456');
      expect(receipt.report).toBe('All tests pass');
      expect(receipt.recorded_at).toBeTruthy();
    } finally {
      await cleanupDir(dir);
    }
  });
});

// ─── Task 10.2: detectArtifactExistence reports execution-plan.json ───────────

describe('Task 10.2: detectArtifactExistence reports execution-plan.json', () => {
  const dir = tempDir('artifact-existence');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should report executionPlan: false when execution-plan.json does not exist', async () => {
    const result = await detectArtifactExistence(dir);
    expect(result).toHaveProperty('executionPlan');
    expect(result.executionPlan).toBe(false);
  });

  it('should report executionPlan: true when execution-plan.json exists', async () => {
    // Create the execution plan file
    const plan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'Test',
      waves: sampleWaves,
      hash: 'abc123',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify(plan, null, 2));

    const result = await detectArtifactExistence(dir);
    expect(result).toHaveProperty('executionPlan');
    expect(result.executionPlan).toBe(true);
  });

  it('should include executionPlan in WorkflowStateDetection.artifacts type', async () => {
    // This is a type-level check. If executionPlan is not in the artifacts type,
    // the following line would not compile. We also verify at runtime.
    const dir2 = tempDir('artifact-type-check');
    try {
      await cleanupDir(dir2);
      await ensureDir(dir2);
      await ensureDir(dir2 + '/.flow-engine/sflow');

      const result = await detectArtifactExistence(dir2);
      // The result should have the executionPlan field
      expect('executionPlan' in result).toBe(true);
    } finally {
      await cleanupDir(dir2);
    }
  });

  it('should detect execution-plan.json alongside other artifacts', async () => {
    // Create all artifacts
    await writeFile(dir + '/proposal.md', '# Proposal\nSome content');
    await writeFile(dir + '/design.md', '# Design');
    await writeFile(dir + '/tasks.md', '- [ ] Task 1');
    await writeFile(dir + '/execution-contract.md', '# Contract');
    await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify({ mode: 'inline' }));

    const result = await detectArtifactExistence(dir);
    expect(result.proposal).toBe(true);
    expect(result.design).toBe(true);
    expect(result.tasks).toBe(true);
    expect(result.contract).toBe(true);
    expect(result.executionPlan).toBe(true);
  });
});

// ─── Task 10.3: detectStateMismatch with execution-plan.json awareness ───────

describe('Task 10.3: detectStateMismatch flags mismatch when plan exists but contract hash differs', () => {
  const dir = tempDir('state-mismatch-plan');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    await ensureDir(dir + '/.flow-engine/sflow');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should return bridging when execution-plan.json exists but contract_hash in plan does not match current contract', async () => {
    // Setup: create contract and state.json with matching hash
    const contractContent = '# Contract\n\n## Intent Lock\nOriginal intent.';
    await writeFile(dir + '/execution-contract.md', contractContent);
    const contractHash = await simpleHash(contractContent);

    // Create state.json in executing state
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'executing',
      mode: 'full',
      contract_hash: contractHash,
      contractApproved: true,
    }));

    // Create execution-plan.json with a DIFFERENT contract_hash
    await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify({
      mode: 'sdd',
      source: 'default',
      rationale: 'Test',
      waves: sampleWaves,
      hash: 'plan-hash-123',
      artifacts_hash: 'a',
      contract_hash: 'STALE_CONTRACT_HASH_999', // Different from current contract
      revision: 1,
    }));

    const result = await detectStateMismatch(dir, 'executing');
    expect(result).toBe('bridging');
  });

  it('should NOT return bridging when execution-plan.json contract_hash matches current contract', async () => {
    // Setup: create contract and state.json
    const contractContent = '# Contract\n\n## Intent Lock\nStable intent.';
    await writeFile(dir + '/execution-contract.md', contractContent);
    const contractHash = await simpleHash(contractContent);

    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'executing',
      mode: 'full',
      contract_hash: contractHash,
      contractApproved: true,
    }));

    // Create execution-plan.json with MATCHING contract_hash
    await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify({
      mode: 'sdd',
      source: 'default',
      rationale: 'Test',
      waves: sampleWaves,
      hash: 'plan-hash-456',
      artifacts_hash: 'a',
      contract_hash: contractHash, // Same as current contract
      revision: 1,
    }));

    const result = await detectStateMismatch(dir, 'executing');
    // Should not flag as bridging since hashes match
    expect(result).toBe('executing');
  });

  it('should return bridging when debugging state and plan contract_hash mismatches', async () => {
    const contractContent = '# Contract\n\nDebugging test.';
    await writeFile(dir + '/execution-contract.md', contractContent);
    const contractHash = await simpleHash(contractContent);

    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'debugging',
      mode: 'full',
      contract_hash: contractHash,
      contractApproved: true,
    }));

    await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify({
      mode: 'inline',
      source: 'default',
      rationale: 'Debug plan',
      waves: [{ id: 'W1', strategy: 'parallel', tasks: ['1.1'], depends_on: [] }],
      hash: 'debug-plan-hash',
      artifacts_hash: 'a',
      contract_hash: 'MISMATCHED_HASH',
      revision: 1,
    }));

    const result = await detectStateMismatch(dir, 'debugging');
    expect(result).toBe('bridging');
  });

  it('should NOT flag mismatch when no execution-plan.json exists', async () => {
    const contractContent = '# Contract\nNo plan file.';
    await writeFile(dir + '/execution-contract.md', contractContent);
    const contractHash = await simpleHash(contractContent);

    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'executing',
      mode: 'full',
      contract_hash: contractHash,
      contractApproved: true,
    }));

    // No execution-plan.json created
    const result = await detectStateMismatch(dir, 'executing');
    expect(result).toBe('executing');
  });

  it('should NOT flag mismatch when state is not executing or debugging', async () => {
    const contractContent = '# Contract\nNot executing.';
    await writeFile(dir + '/execution-contract.md', contractContent);
    const contractHash = await simpleHash(contractContent);

    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({
      state: 'bridging',
      mode: 'full',
      contract_hash: contractHash,
      contractApproved: false,
    }));

    await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify({
      mode: 'sdd',
      source: 'default',
      rationale: 'Test',
      waves: sampleWaves,
      hash: 'plan-hash',
      artifacts_hash: 'a',
      contract_hash: 'MISMATCHED_HASH',
      revision: 1,
    }));

    const result = await detectStateMismatch(dir, 'bridging');
    // bridging state should not trigger the execution-plan mismatch check
    expect(result).toBe('approved-for-build');
  });
});
