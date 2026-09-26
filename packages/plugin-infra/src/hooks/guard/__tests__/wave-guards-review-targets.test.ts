/**
 * P1 fix: 收据门禁改用 reviewTargets（final 策略单一区间）
 *
 * 覆盖 spec: review-receipt-integrity / P1-1 review_policy
 * - final 策略计划：门禁按 reviewTargets(plan)（单一 'final' 区间）判定收据，
 *   不得因 plan.waves 缺少收据误报 missing receipt
 * - wave 策略（默认）：按 plan.waves 逐个 wave 判定（回归行为不变）
 * - checkReceiptIntegrity / checkWaveDependencies / checkClosingGate 三处对齐
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { checkReceiptIntegrity, checkWaveDependencies, checkClosingGate } from '../checks/wave-guards.js';
import { reviewTargets } from '../../../features/execution-plan/review-receipts.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', `wave-guards-${name}`);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

/** Create a git repo with two commits; returns [baseSha, headSha]. */
function initGitRepo(dir: string): [string, string] {
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  run(['init', '-q']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'commit.gpgsign', 'false']);
  return ['', ''];
}

async function commitFile(dir: string, file: string, content: string): Promise<string> {
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  await writeFile(join(dir, file), content);
  run(['add', '.']);
  run(['commit', '-q', '-m', `add ${file}`]);
  return run(['rev-parse', 'HEAD']).trim();
}

async function writePlan(dir: string, plan: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow');
  await writeFile(
    dir + '/.flow-engine/sflow/execution-plan.json',
    JSON.stringify(plan, null, 2),
  );
}

function basePlan(): Record<string, unknown> {
  return {
    mode: 'sdd',
    source: 'default',
    rationale: 'test',
    hash: 'sha256:abc',
    artifacts_hash: 'a',
    contract_hash: 'c',
    revision: 1,
  };
}

async function writeReceipt(dir: string, waveId: string, receipt: Record<string, unknown>): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow/reviews');
  await writeFile(
    dir + `/.flow-engine/sflow/reviews/${waveId}.json`,
    JSON.stringify(receipt, null, 2),
  );
}

function passReceipt(base: string, head: string): Record<string, unknown> {
  return { status: 'pass', base, head, report: 'ok', recorded_at: new Date().toISOString() };
}

describe('P1 fix: checkReceiptIntegrity 按 reviewTargets 判定', () => {
  const dir = tempDir('receipt-integrity-final');
  let baseSha = '';
  let headSha = '';

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    initGitRepo(dir);
    baseSha = await commitFile(dir, 'a.txt', 'a\n');
    headSha = await commitFile(dir, 'b.txt', 'b\n');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('final 策略：仅有 final.json 收据即通过，不因 waves 缺收据误报', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
      review_policy: 'final',
    });
    await writeReceipt(dir, 'final', passReceipt(baseSha, headSha));

    const result = await checkReceiptIntegrity(dir, 'sflow');
    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('final 策略：缺 final.json 收据仍阻断（单一区间必须有收据）', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
      review_policy: 'final',
    });

    const result = await checkReceiptIntegrity(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('"final"');
  });

  it('wave 策略（默认）：按 plan.waves 逐个 wave 判定（回归）', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [
        { id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
      ],
    });
    await writeReceipt(dir, 'W1', passReceipt(baseSha, headSha));

    const result = await checkReceiptIntegrity(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('"W2"');
  });

  it('wave 策略：所有 wave 均有收据时通过（回归）', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });
    await writeReceipt(dir, 'W1', passReceipt(baseSha, headSha));

    const result = await checkReceiptIntegrity(dir, 'sflow');
    expect(result.success).toBe(true);
  });

  it('wave 策略：空 waves 计划按 missing receipt 安全语义阻断（P1-1 fail-open 修复）', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [],
    });

    const result = await checkReceiptIntegrity(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });
});

describe('P1 fix: checkWaveDependencies 按 reviewTargets 判定', () => {
  const dir = tempDir('wave-deps-final');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('final 策略：单一 final 区间覆盖全部 tasks，不报循环/缺引用', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [
        { id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
      ],
      review_policy: 'final',
    });

    const result = await checkWaveDependencies(dir, 'sflow');
    expect(result.success).toBe(true);
  });

  it('final 策略：所有 waves 均无 tasks 时报 final 为空', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [],
      review_policy: 'final',
    });

    const result = await checkWaveDependencies(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('"final"');
  });

  it('wave 策略（默认）：循环依赖仍被检出（回归）', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [
        { id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: ['W2'] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W1'] },
      ],
    });

    const result = await checkWaveDependencies(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('ircular');
  });
});

describe('P1 fix: checkClosingGate 按 reviewTargets 判定', () => {
  const dir = tempDir('closing-gate-final');
  let baseSha = '';
  let headSha = '';

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    initGitRepo(dir);
    baseSha = await commitFile(dir, 'a.txt', 'a\n');
    headSha = await commitFile(dir, 'b.txt', 'b\n');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('final 策略：final.json pass 收据放行 closing，不因 waves 缺收据阻断', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
      review_policy: 'final',
    });
    await writeReceipt(dir, 'final', passReceipt(baseSha, headSha));

    const result = await checkClosingGate(dir, 'sflow');
    expect(result.success).toBe(true);
  });

  it('final 策略：final.json 非 pass 收据仍阻断 closing', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
      review_policy: 'final',
    });
    await writeReceipt(dir, 'final', { status: 'fail', base: baseSha, head: headSha, report: 'bad', recorded_at: new Date().toISOString() });

    const result = await checkClosingGate(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('wave 策略（默认）：缺收据仍阻断 closing（回归）', async () => {
    await writePlan(dir, {
      ...basePlan(),
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    const result = await checkClosingGate(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('"W1"');
  });
});

// ─── P1-1（fail-open 修复）：畸形 plan 防御 ─────────────────────────────────────

describe('P1-1 fail-open 修复：畸形 plan（缺 waves）防御', () => {
  const dir = tempDir('receipt-integrity-malformed');
  let baseSha = '';
  let headSha = '';

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
    initGitRepo(dir);
    baseSha = await commitFile(dir, 'a.txt', 'a\n');
    headSha = await commitFile(dir, 'b.txt', 'b\n');
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('reviewTargets 对缺 waves 的 plan 返回空数组（不抛错）', () => {
    const malformed = { ...basePlan(), waves: undefined } as unknown as Parameters<typeof reviewTargets>[0];
    expect(() => reviewTargets(malformed)).not.toThrow();
    expect(reviewTargets(malformed)).toEqual([]);
  });

  it('reviewTargets 对 waves 非数组的 plan 返回空数组', () => {
    const malformed = { ...basePlan(), waves: 'not-an-array' } as unknown as Parameters<typeof reviewTargets>[0];
    expect(reviewTargets(malformed)).toEqual([]);
  });

  it('checkReceiptIntegrity 对缺 waves 的 plan 返回 block:true（不静默通过）', async () => {
    await writePlan(dir, { ...basePlan(), waves: undefined });
    const result = await checkReceiptIntegrity(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('missing receipt');
  });

  it('checkClosingGate 对缺 waves 的 plan 返回 block:true（不静默通过）', async () => {
    await writePlan(dir, { ...basePlan(), waves: undefined });
    const result = await checkClosingGate(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('checkWaveDependencies 对缺 waves 的 plan 返回 block:true（不抛 TypeError）', async () => {
    await writePlan(dir, { ...basePlan(), waves: undefined });
    const result = await checkWaveDependencies(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });
});
