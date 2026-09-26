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
  await ensureDir(dir + '/.flow-engine/sflow');
  await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify(data, null, 2));
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

  it('should write .flow-engine/sflow/reviews/W1.json with status/base/head/report/recorded_at', async () => {
    const receipt: Omit<ReviewReceipt, 'recorded_at'> = {
      status: 'pass',
      base: 'abc1234',
      head: 'def5678',
      report: 'All tests passed',
    };

    await recordReviewReceipt(dir, 'W1', receipt);

    const written = await readJsonFileContent(dir + '/.flow-engine/sflow/reviews/W1.json');
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

    const written = await readJsonFileContent(dir + '/.flow-engine/sflow/reviews/W1.json');
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
      base: 'def5678', // 修复：re-review 的 base 应为前一次的 head，满足 P1-2 连续性校验
      head: 'ghi9012',
      report: 'Re-review passed after fixes',
    };

    await recordReviewReceipt(dir, 'W1', receipt1);
    await recordReviewReceipt(dir, 'W1', receipt2);

    const written = await readJsonFileContent(dir + '/.flow-engine/sflow/reviews/W1.json');
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

  it('should create .flow-engine/sflow/reviews/ directory if it does not exist', async () => {
    const receipt: Omit<ReviewReceipt, 'recorded_at'> = {
      status: 'pass',
      base: 'abc1234',
      head: 'def5678',
      report: 'Review passed',
    };

    // The reviews dir should not exist yet
    const { access } = await import('fs/promises');
    await expect(access(dir + '/.flow-engine/sflow/reviews')).rejects.toThrow();

    await recordReviewReceipt(dir, 'W1', receipt);

    // Now it should exist and contain the file
    const content = await readFile(dir + '/.flow-engine/sflow/reviews/W1.json', 'utf-8');
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

    const written = await readJsonFileContent(dir + '/.flow-engine/sflow/reviews/W1.json');
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

  it('should write .flow-engine/sflow/reviews/W1.json with status/base/head/report/recordedAt', async () => {
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
    const written = await readJsonFileContent(receiptDir + '/.flow-engine/sflow/reviews/W1.json');
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
    const written = await readJsonFileContent(integrationDir + '/.flow-engine/sflow/reviews/W1.json');
    expect(written).not.toBeNull();
    expect(written!.status).toBe('pass');
    expect(written!.base).toBe('abc1234');
    expect(written!.head).toBe('def5678');
    expect(written!.report).toBe('Wave 1 review passed — all tests green');
    expect(written!.recorded_at).toBeDefined();

    await cleanupDir(integrationDir);
  });
});

// ─── P1 fix: record_review_receipt issue passthrough + adjudicate_wave tool ────

describe('P1 fix: record_review_receipt issue passthrough', () => {
  const mockClient = {
    session: {
      create: async () => ({ data: { id: 'test-session' } }),
      prompt: async () => ({}),
      abort: async () => ({}),
    },
  };

  it('should expose optional issue arg in the zod args schema', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);
    const args = tools.record_review_receipt.args;
    expect(args).toBeDefined();
    const schemaKeys = Object.keys(args as Record<string, unknown>);
    expect(schemaKeys).toContain('issue');
  });

  it('should persist issue on fail receipt for schema_version 2 plan', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const issueDir = tempDir('receipt-issue-passthrough');
    await cleanupDir(issueDir);
    await ensureDir(issueDir);
    await writeStateFile(issueDir, {
      state: 'executing',
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
    });
    await writeContractFile(issueDir);

    await createExecutionPlan(issueDir, {
      mode: 'inline',
      source: 'default',
      rationale: 'schema v2 plan',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    // Upgrade plan to schema_version 2
    const planPath = issueDir + '/.flow-engine/sflow/execution-plan.json';
    const plan = JSON.parse(await readFile(planPath, 'utf-8'));
    plan.schema_version = 2;
    await writeFile(planPath, JSON.stringify(plan, null, 2));

    const result = await tools.record_review_receipt.execute(
      {
        waveId: 'W1',
        status: 'fail',
        base: 'abc1234',
        head: 'def5678',
        report: 'CRITICAL: logic defect in W1',
        issue: 'BUG-001',
      },
      { directory: issueDir } as any,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(true);

    const written = await readJsonFileContent(issueDir + '/.flow-engine/sflow/reviews/W1.json');
    expect(written).not.toBeNull();
    expect(written!.issue).toBe('BUG-001');

    await cleanupDir(issueDir);
  });

  it('should reject fail receipt without issue on schema_version 2 plan', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const noIssueDir = tempDir('receipt-issue-missing');
    await cleanupDir(noIssueDir);
    await ensureDir(noIssueDir);
    await writeStateFile(noIssueDir, {
      state: 'executing',
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
    });
    await writeContractFile(noIssueDir);

    await createExecutionPlan(noIssueDir, {
      mode: 'inline',
      source: 'default',
      rationale: 'schema v2 plan',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    const planPath = noIssueDir + '/.flow-engine/sflow/execution-plan.json';
    const plan = JSON.parse(await readFile(planPath, 'utf-8'));
    plan.schema_version = 2;
    await writeFile(planPath, JSON.stringify(plan, null, 2));

    const result = await tools.record_review_receipt.execute(
      {
        waveId: 'W1',
        status: 'fail',
        base: 'abc1234',
        head: 'def5678',
        report: 'CRITICAL: no issue id provided',
      },
      { directory: noIssueDir } as any,
    );

    const parsed = JSON.parse(result.output);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/issue/i);

    await cleanupDir(noIssueDir);
  });
});

describe('P1 fix: adjudicate_wave tool', () => {
  const mockClient = {
    session: {
      create: async () => ({ data: { id: 'test-session' } }),
      prompt: async () => ({}),
      abort: async () => ({}),
    },
  };

  async function setupAdjudicationDir(name: string): Promise<string> {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);

    const dir = tempDir(name);
    await cleanupDir(dir);
    await ensureDir(dir);
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
      rationale: 'schema v2 plan',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    const planPath = dir + '/.flow-engine/sflow/execution-plan.json';
    const plan = JSON.parse(await readFile(planPath, 'utf-8'));
    plan.schema_version = 2;
    await writeFile(planPath, JSON.stringify(plan, null, 2));

    // 3 consecutive fail receipts with the same issue → adjudication-required
    // (repair ranges must be continuous: each fail's base equals the previous fail's head)
    const ranges = [
      { base: 'abc1234', head: 'def5678' },
      { base: 'def5678', head: 'hij9012' },
      { base: 'hij9012', head: 'klm3456' },
    ];
    for (let i = 0; i < 3; i++) {
      const result = await tools.record_review_receipt.execute(
        {
          waveId: 'W1',
          status: 'fail',
          base: ranges[i].base,
          head: ranges[i].head,
          report: `CRITICAL: failure ${i}`,
          issue: 'BUG-001',
        },
        { directory: dir } as any,
      );
      const parsed = JSON.parse(result.output);
      expect(parsed.success).toBe(true);
    }
    return dir;
  }

  it('should be registered in createSFlowTools output with args schema', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);
    expect(tools.adjudicate_wave).toBeDefined();
    expect(typeof tools.adjudicate_wave.description).toBe('string');
    const schemaKeys = Object.keys(tools.adjudicate_wave.args as Record<string, unknown>);
    expect(schemaKeys).toContain('waveId');
    expect(schemaKeys).toContain('decision');
    expect(schemaKeys).toContain('confirmed');
    expect(schemaKeys).toContain('reason');
  });

  it('should authorize one additional review end-to-end (fail chain → adjudicate → pass)', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);
    const dir = await setupAdjudicationDir('adjudicate-wave-e2e');

    // Wave is now adjudication-required: further reviews blocked without adjudication
    const blocked = await tools.record_review_receipt.execute(
      {
        waveId: 'W1',
        status: 'fail',
        base: 'klm3456',
        head: 'mno7890',
        report: 'CRITICAL: still failing',
        issue: 'BUG-001',
      },
      { directory: dir } as any,
    );
    expect(JSON.parse(blocked.output).success).toBe(false);

    // Adjudicate via tool
    const adjResult = await tools.adjudicate_wave.execute(
      {
        waveId: 'W1',
        decision: 'allow-review',
        confirmed: true,
        reason: 'Human reviewed the failure chain, authorizing one more attempt',
      },
      { directory: dir } as any,
    );
    const adjParsed = JSON.parse(adjResult.output);
    expect(adjParsed.success).toBe(true);

    // The authorized review can now be recorded
    const retry = await tools.record_review_receipt.execute(
      {
        waveId: 'W1',
        status: 'fail',
        base: 'klm3456',
        head: 'mno7890',
        report: 'CRITICAL: attempt 4',
        issue: 'BUG-001',
      },
      { directory: dir } as any,
    );
    expect(JSON.parse(retry.output).success).toBe(true);

    // A second review without a new adjudication is blocked again (1 auth = 1 review)
    const blockedAgain = await tools.record_review_receipt.execute(
      {
        waveId: 'W1',
        status: 'fail',
        base: 'mno7890',
        head: 'pqr1234',
        report: 'CRITICAL: attempt 5',
        issue: 'BUG-001',
      },
      { directory: dir } as any,
    );
    expect(JSON.parse(blockedAgain.output).success).toBe(false);

    await cleanupDir(dir);
  });

  it('should return error when wave is not adjudication-required', async () => {
    const { createSFlowTools } = await import('../sflow-plugin-factory.js');
    const tools = createSFlowTools(mockClient as any);
    const dir = await setupAdjudicationDir('adjudicate-wave-not-required');

    // Adjudicate first (fail4 requires an active authorization), consume it with
    // an authorized fail; the wave re-enters adjudication-required (same-issue
    // count 4 ≥ 3), so adjudicate again, then resolve with a pass so the wave is
    // no longer adjudication-required
    const adjResult0 = await tools.adjudicate_wave.execute(
      {
        waveId: 'W1',
        decision: 'allow-review',
        confirmed: true,
        reason: 'First authorization for fail 4',
      },
      { directory: dir } as any,
    );
    expect(JSON.parse(adjResult0.output).success).toBe(true);
    await tools.record_review_receipt.execute(
      {
        waveId: 'W1',
        status: 'fail',
        base: 'klm3456',
        head: 'mno7890',
        report: 'CRITICAL: attempt 4',
        issue: 'BUG-001',
      },
      { directory: dir } as any,
    );
    const adjResult2 = await tools.adjudicate_wave.execute(
      {
        waveId: 'W1',
        decision: 'allow-review',
        confirmed: true,
        reason: 'Second authorization to allow the resolving pass',
      },
      { directory: dir } as any,
    );
    expect(JSON.parse(adjResult2.output).success).toBe(true);
    const passResult = await tools.record_review_receipt.execute(
      {
        waveId: 'W1',
        status: 'pass',
        base: 'mno7890',
        head: 'pqr1234',
        report: 'All tests passed after fix',
      },
      { directory: dir } as any,
    );
    expect(JSON.parse(passResult.output).success).toBe(true);

    const adjResult = await tools.adjudicate_wave.execute(
      {
        waveId: 'W1',
        decision: 'allow-review',
        confirmed: true,
        reason: 'Should fail: not adjudication-required',
      },
      { directory: dir } as any,
    );
    const parsed = JSON.parse(adjResult.output);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/not adjudication-required/i);

    await cleanupDir(dir);
  });
});
