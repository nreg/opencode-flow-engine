/**
 * Tests for Wave W3: Tool Registration — Record Execution Plan + Record Review Receipt
 *
 * Covers:
 * - Task 9.1: recordReviewReceipt() function in execution-plan.ts
 * - Task 3.1/3.2: record_execution_plan tool definition and execute handler
 * - Task 9.2: record_review_receipt tool definition and execute handler
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { recordReviewReceipt, readExecutionPlan, createExecutionPlan } from '../features/execution-plan.js';
import type { ReviewReceipt } from '../features/execution-plan-types.js';

// ─── Test helpers ──────────────────────────────────────────────────────────────

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

async function writeContractFile(dir: string): Promise<void> {
  await writeFile(dir + '/execution-contract.md', '# Execution Contract\n\nTest contract content.');
}

async function readJsonFileContent(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ─── Task 9.1: recordReviewReceipt function ────────────────────────────────────

describe('recordReviewReceipt', () => {
  const dir = tempDir('execution-plan-receipt');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    // Set up a minimal state.json and execution plan
    await writeStateFile(dir, {
      state: 'executing',
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
    });
    await writeContractFile(dir);
    await createExecutionPlan(dir, {
      mode: 'inline',
      source: 'default',
      rationale: 'test plan',
      waves: [
        { id: 'W1', strategy: 'serial', tasks: ['1.1', '1.2'], depends_on: [] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
      ],
    });
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('should write .sflow/reviews/W1.json with status/base/head/report/recorded_at', async () => {
    const receipt: Omit<ReviewReceipt, 'recorded_at'> = {
      status: 'pass',
      base: 'abc1234',
      head: 'def5678',
      report: 'All tests passed',
    };

    await recordReviewReceipt(dir, 'W1', receipt);

    const written = await readJsonFileContent(dir + '/.sflow/reviews/W1.json');
    expect(written).not.toBeNull();
    expect(written!.status).toBe('pass');
    expect(written!.base).toBe('abc1234');
    expect(written!.head).toBe('def5678');
    expect(written!.report).toBe('All tests passed');
    expect(written!.recorded_at).toBeDefined();
    expect(typeof written!.recorded_at).toBe('string');
  });

  it('should write a fail receipt', async () => {
    const receipt: Omit<ReviewReceipt, 'recorded_at'> = {
      status: 'fail',
      base: 'abc1234',
      head: 'def5678',
      report: '2 tests failed',
    };

    await recordReviewReceipt(dir, 'W1', receipt);

    const written = await readJsonFileContent(dir + '/.sflow/reviews/W1.json');
    expect(written).not.toBeNull();
    expect(written!.status).toBe('fail');
    expect(written!.report).toBe('2 tests failed');
  });

  it('should overwrite on re-review', async () => {
    const receipt1: Omit<ReviewReceipt, 'recorded_at'> = {
      status: 'fail',
      base: 'abc1234',
      head: 'def5678',
      report: 'Initial review failed',
    };
    const receipt2: Omit<ReviewReceipt, 'recorded_at'> = {
      status: 'pass',
      base: 'abc1234',
      head: 'ghi9012',
      report: 'Re-review passed after fixes',
    };

    await recordReviewReceipt(dir, 'W1', receipt1);
    await recordReviewReceipt(dir, 'W1', receipt2);

    const written = await readJsonFileContent(dir + '/.sflow/reviews/W1.json');
    expect(written).not.toBeNull();
    expect(written!.status).toBe('pass');
    expect(written!.head).toBe('ghi9012');
    expect(written!.report).toBe('Re-review passed after fixes');
  });

  it('should throw if waveId does not exist in execution plan', async () => {
    const receipt: Omit<ReviewReceipt, 'recorded_at'> = {
      status: 'pass',
      base: 'abc1234',
      head: 'def5678',
      report: 'Review passed',
    };

    await expect(recordReviewReceipt(dir, 'W99', receipt)).rejects.toThrow(
      /Wave "W99" not found/,
    );
  });

  it('should throw if no execution plan exists', async () => {
    // Create a new dir without an execution plan
    const noPlanDir = tempDir('execution-plan-no-plan');
    await cleanupDir(noPlanDir);
    await ensureDir(noPlanDir);

    const receipt: Omit<ReviewReceipt, 'recorded_at'> = {
      status: 'pass',
      base: 'abc1234',
      head: 'def5678',
      report: 'Review passed',
    };

    await expect(recordReviewReceipt(noPlanDir, 'W1', receipt)).rejects.toThrow(
      /No execution plan found/,
    );

    await cleanupDir(noPlanDir);
  });

  it('should create .sflow/reviews/ directory if it does not exist', async () => {
    const receipt: Omit<ReviewReceipt, 'recorded_at'> = {
      status: 'pass',
      base: 'abc1234',
      head: 'def5678',
      report: 'Review passed',
    };

    // The reviews dir should not exist yet
    const { access } = await import('fs/promises');
    await expect(access(dir + '/.sflow/reviews')).rejects.toThrow();

    await recordReviewReceipt(dir, 'W1', receipt);

    // Now it should exist and contain the file
    const content = await readFile(dir + '/.sflow/reviews/W1.json', 'utf-8');
    expect(content).toBeDefined();
  });

  it('should include recorded_at as ISO 8601 timestamp', async () => {
    const receipt: Omit<ReviewReceipt, 'recorded_at'> = {
      status: 'pass',
      base: 'abc1234',
      head: 'def5678',
      report: 'Review passed',
    };

    const before = new Date();
    await recordReviewReceipt(dir, 'W1', receipt);
    const after = new Date();

    const written = await readJsonFileContent(dir + '/.sflow/reviews/W1.json');
    expect(written).not.toBeNull();
    const recordedAt = new Date(written!.recorded_at as string);
    expect(recordedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(recordedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });
});

// ─── Task 3.1/3.2: record_execution_plan tool ─────────────────────────────────

describe('record_execution_plan tool', () => {
  // We test the tool by importing the factory function and checking
  // the tool definitions are properly registered.
  // Since createSFlowTools requires a client, we mock it.

  const mockClient = {
    session: {
      create: async () => ({ data: { id: 'test-session' } }),
      prompt: async () => ({}),
      abort: async () => ({}),
    },
  };

  it('should be registered in createSFlowTools output', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);
    expect(tools.record_execution_plan).toBeDefined();
    expect(tools.record_execution_plan.description).toBeDefined();
    expect(typeof tools.record_execution_plan.description).toBe('string');
  });

  it('should have zod args schema with mode, waves, source, rationale', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);
    const args = tools.record_execution_plan.args;
    expect(args).toBeDefined();
    // Verify zod schema shape
    const schemaKeys = Object.keys(args as Record<string, unknown>);
    expect(schemaKeys).toContain('mode');
    expect(schemaKeys).toContain('waves');
    expect(schemaKeys).toContain('source');
    expect(schemaKeys).toContain('rationale');
  });

  it('should have optional override parameter in args', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);
    const args = tools.record_execution_plan.args as Record<string, any>;
    expect(args.override).toBeDefined();
  });

  it('should reject when execution-contract.md does not exist', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const noContractDir = tempDir('no-contract');
    await cleanupDir(noContractDir);
    await ensureDir(noContractDir);

    const result = await tools.record_execution_plan.execute(
      {
        mode: 'inline',
        waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
        source: 'default',
        rationale: 'test',
      },
      { directory: noContractDir } as any,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('contract');

    await cleanupDir(noContractDir);
  });

  it('should reject when state is not approved-for-build or executing', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const exploringDir = tempDir('exploring-state');
    await cleanupDir(exploringDir);
    await ensureDir(exploringDir);
    await writeStateFile(exploringDir, { state: 'exploring', mode: 'full' });
    await writeContractFile(exploringDir);

    const result = await tools.record_execution_plan.execute(
      {
        mode: 'inline',
        waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
        source: 'default',
        rationale: 'test',
      },
      { directory: exploringDir } as any,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/invalid state|not in.*state/i);

    await cleanupDir(exploringDir);
  });

  it('should create execution plan when state is approved-for-build and no plan exists', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const approvedDir = tempDir('approved-state');
    await cleanupDir(approvedDir);
    await ensureDir(approvedDir);
    await writeStateFile(approvedDir, {
      state: 'approved-for-build',
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
    });
    await writeContractFile(approvedDir);

    const result = await tools.record_execution_plan.execute(
      {
        mode: 'inline',
        waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
        source: 'default',
        rationale: 'Simple inline plan',
      },
      { directory: approvedDir } as any,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(true);
    expect(parsed.plan).toBeDefined();
    expect(parsed.plan.mode).toBe('inline');
    expect(parsed.plan.revision).toBe(1);
    expect(parsed.plan.hash).toBeDefined();

    // Verify the plan was written to disk
    const plan = await readExecutionPlan(approvedDir);
    expect(plan).not.toBeNull();
    expect(plan!.mode).toBe('inline');

    await cleanupDir(approvedDir);
  });

  it('should revise execution plan when state is executing and plan exists', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const executingDir = tempDir('executing-state');
    await cleanupDir(executingDir);
    await ensureDir(executingDir);
    await writeStateFile(executingDir, {
      state: 'executing',
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
    });
    await writeContractFile(executingDir);

    // Create initial plan
    await createExecutionPlan(executingDir, {
      mode: 'inline',
      source: 'default',
      rationale: 'Initial plan',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    // Now revise via the tool
    const result = await tools.record_execution_plan.execute(
      {
        mode: 'sdd',
        waves: [
          { id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
          { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        ],
        source: 'user-override',
        rationale: 'Upgrading to sdd due to complexity',
        override: true,
      },
      { directory: executingDir } as any,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(true);
    expect(parsed.plan).toBeDefined();
    expect(parsed.plan.mode).toBe('sdd');
    expect(parsed.plan.revision).toBe(2);

    await cleanupDir(executingDir);
  });

  it('should return plan summary with mode, revision, waves, hash', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const summaryDir = tempDir('plan-summary');
    await cleanupDir(summaryDir);
    await ensureDir(summaryDir);
    await writeStateFile(summaryDir, {
      state: 'approved-for-build',
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
    });
    await writeContractFile(summaryDir);

    const result = await tools.record_execution_plan.execute(
      {
        mode: 'batch-inline',
        waves: [
          { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
          { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        ],
        source: 'default',
        rationale: 'Batch-inline for moderate complexity',
      },
      { directory: summaryDir } as any,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(true);
    expect(parsed.plan.mode).toBe('batch-inline');
    expect(parsed.plan.revision).toBe(1);
    expect(parsed.plan.waves).toHaveLength(2);
    expect(parsed.plan.hash).toBeDefined();
    expect(typeof parsed.plan.hash).toBe('string');
    expect(parsed.plan.hash.length).toBeGreaterThan(0);

    await cleanupDir(summaryDir);
  });
});

// ─── Task 9.2: record_review_receipt tool ──────────────────────────────────────

describe('record_review_receipt tool', () => {
  const mockClient = {
    session: {
      create: async () => ({ data: { id: 'test-session' } }),
      prompt: async () => ({}),
      abort: async () => ({}),
    },
  };

  it('should be registered in createSFlowTools output', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);
    expect(tools.record_review_receipt).toBeDefined();
    expect(tools.record_review_receipt.description).toBeDefined();
    expect(typeof tools.record_review_receipt.description).toBe('string');
  });

  it('should have zod args schema with waveId, status, base, head, report', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);
    const args = tools.record_review_receipt.args;
    expect(args).toBeDefined();
    const schemaKeys = Object.keys(args as Record<string, unknown>);
    expect(schemaKeys).toContain('waveId');
    expect(schemaKeys).toContain('status');
    expect(schemaKeys).toContain('base');
    expect(schemaKeys).toContain('head');
    expect(schemaKeys).toContain('report');
  });

  it('should write .sflow/reviews/W1.json with status/base/head/report/recordedAt', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const receiptDir = tempDir('receipt-tool');
    await cleanupDir(receiptDir);
    await ensureDir(receiptDir);
    await writeStateFile(receiptDir, {
      state: 'executing',
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
    });
    await writeContractFile(receiptDir);

    // Create execution plan first
    await createExecutionPlan(receiptDir, {
      mode: 'inline',
      source: 'default',
      rationale: 'test plan',
      waves: [
        { id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
      ],
    });

    const result = await tools.record_review_receipt.execute(
      {
        waveId: 'W1',
        status: 'pass',
        base: 'abc1234',
        head: 'def5678',
        report: 'All tests passed',
      },
      { directory: receiptDir } as any,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(true);

    // Verify the receipt was written to disk
    const written = await readJsonFileContent(receiptDir + '/.sflow/reviews/W1.json');
    expect(written).not.toBeNull();
    expect(written!.status).toBe('pass');
    expect(written!.base).toBe('abc1234');
    expect(written!.head).toBe('def5678');
    expect(written!.report).toBe('All tests passed');
    expect(written!.recorded_at).toBeDefined();

    await cleanupDir(receiptDir);
  });

  it('should return error when waveId does not exist in plan', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const invalidWaveDir = tempDir('receipt-invalid-wave');
    await cleanupDir(invalidWaveDir);
    await ensureDir(invalidWaveDir);
    await writeStateFile(invalidWaveDir, {
      state: 'executing',
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
    });
    await writeContractFile(invalidWaveDir);

    await createExecutionPlan(invalidWaveDir, {
      mode: 'inline',
      source: 'default',
      rationale: 'test plan',
      waves: [
        { id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
      ],
    });

    const result = await tools.record_review_receipt.execute(
      {
        waveId: 'W99',
        status: 'pass',
        base: 'abc1234',
        head: 'def5678',
        report: 'Review passed',
      },
      { directory: invalidWaveDir } as any,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('W99');

    await cleanupDir(invalidWaveDir);
  });
});

// ─── Integration: record_execution_plan → record_review_receipt → read receipt ─

describe('Integration: execution plan + review receipt flow', () => {
  const mockClient = {
    session: {
      create: async () => ({ data: { id: 'test-session' } }),
      prompt: async () => ({}),
      abort: async () => ({}),
    },
  };

  it('should support full flow: create plan → record receipt → read receipt', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const integrationDir = tempDir('integration-flow');
    await cleanupDir(integrationDir);
    await ensureDir(integrationDir);
    await writeStateFile(integrationDir, {
      state: 'approved-for-build',
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
    });
    await writeContractFile(integrationDir);

    // Step 1: Create execution plan via tool
    const planResult = await tools.record_execution_plan.execute(
      {
        mode: 'sdd',
        waves: [
          { id: 'W1', strategy: 'parallel', tasks: ['1.1', '1.2'], depends_on: [] },
          { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
        ],
        source: 'default',
        rationale: 'SDD for complex project',
      },
      { directory: integrationDir } as any,
    );

    const planParsed = JSON.parse(planResult.output);
    expect(planParsed.success).toBe(true);
    expect(planParsed.plan.mode).toBe('sdd');

    // Step 2: Record review receipt via tool
    const receiptResult = await tools.record_review_receipt.execute(
      {
        waveId: 'W1',
        status: 'pass',
        base: 'abc1234',
        head: 'def5678',
        report: 'Wave 1 review passed — all tests green',
      },
      { directory: integrationDir } as any,
    );

    const receiptParsed = JSON.parse(receiptResult.output);
    expect(receiptParsed.success).toBe(true);

    // Step 3: Read the receipt from disk
    const written = await readJsonFileContent(integrationDir + '/.sflow/reviews/W1.json');
    expect(written).not.toBeNull();
    expect(written!.status).toBe('pass');
    expect(written!.base).toBe('abc1234');
    expect(written!.head).toBe('def5678');
    expect(written!.report).toBe('Wave 1 review passed — all tests green');
    expect(written!.recorded_at).toBeDefined();

    await cleanupDir(integrationDir);
  });
});
