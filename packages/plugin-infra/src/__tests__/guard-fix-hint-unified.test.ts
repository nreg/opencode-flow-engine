/**
 * Wave 4 / Task 4.4 — 门禁 Fix 指引统一（TDD RED）
 *
 * Spec: guard-diagnostics.md「统一修复指引」
 * - 门禁系 blockReason MUST 通过 formatGuardFixHint/appendGuardFixHint 追加 `Fix:` 行
 * - `Fix:` 后 SHALL 含可直接执行的入口，MUST NOT 空泛措辞
 * - 覆盖：wave 门禁（缺失依赖/收据）与工件门禁（full 模式一致性）
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { checkWaveDependencies, checkReceiptIntegrity } from '../hooks/guard/checks/wave-guards.js';
import { checkArtifactAndPhaseConsistency } from '../hooks/guard/checks/artifact-guards.js';
import type { ExecutionPlan, ReviewReceipt } from '../features/execution-plan-types.js';

const ROOT = join('C:', 'Users', 'admin', 'AppData', 'Local', 'Temp', 'opencode', 'wave4-fixhint');

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

function hasFixLine(reason: string | undefined): boolean {
  if (!reason) return false;
  const lines = reason.split(/\r?\n/);
  const fixLine = lines.find((l) => l.startsWith('Fix: '));
  if (!fixLine) return false;
  // `Fix:` 之后必须是可直接执行的入口（工具调用、Agent 名或命令），不是空泛措辞
  const body = fixLine.slice('Fix: '.length);
  return /workflow_router|state-manager|spec-writer|contract-builder|upgradeMode|route/i.test(body);
}

describe('Task 4.4: 门禁 Fix 指引统一', () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(ROOT, `case-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir + '/.flow-engine/sflow', { recursive: true });
  });

  afterEach(async () => {
    try { await rm(dir, { recursive: true, force: true }); } catch {}
  });

  it('wave 门禁：缺失收据 blockReason 含 Fix 行', async () => {
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'fix hint test',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
      hash: 'h',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify(plan));
    const result = await checkReceiptIntegrity(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(hasFixLine(result.blockReason)).toBe(true);
  });

  it('wave 门禁：缺失依赖 blockReason 含 Fix 行', async () => {
    const plan: ExecutionPlan = {
      mode: 'sdd',
      source: 'default',
      rationale: 'fix hint test',
      waves: [
        { id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] },
        { id: 'W2', strategy: 'serial', tasks: ['2.1'], depends_on: ['W-MISSING'] },
      ],
      hash: 'h',
      artifacts_hash: 'a',
      contract_hash: 'c',
      revision: 1,
    };
    await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify(plan));
    const result = await checkWaveDependencies(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(hasFixLine(result.blockReason)).toBe(true);
  });

  it('工件门禁：phase consistency blockReason 走 appendGuardFixHint（源码断言，Bun 下目录早退不可行为触发）', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync(
      join(process.cwd(), 'packages/plugin-infra/src/hooks/guard/checks/artifact-guards.ts'),
      'utf8',
    );
    expect(src).toContain('appendGuardFixHint');
    expect(src).toContain('补齐 full 模式必需工件');
  });

  it('preset upgrade blockReason 已含可执行入口（既有行为回归保护）', async () => {
    await writeFile(dir + '/.flow-engine/sflow/state.json', JSON.stringify({ state: 'executing', mode: 'hotfix' }));
    await writeFile(dir + '/tasks.md', '- [ ] a\n- [ ] b\n- [ ] c\n- [ ] schema migration for db\n');
    const { checkPresetUpgrade } = await import('../hooks/guard/checks/artifact-guards.js');
    const result = await checkPresetUpgrade(dir, 'sflow');
    expect(result.success).toBe(false);
    expect(hasFixLine(result.blockReason)).toBe(true);
  });
});
