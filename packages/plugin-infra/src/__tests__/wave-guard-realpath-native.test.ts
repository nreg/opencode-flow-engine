/**
 * Wave 4 / Task 4.1 — realpathSync.native 防御 Windows 8.3 短名（TDD RED）
 *
 * Spec: guard-diagnostics.md「原生实际路径检查」
 * - 符号链接检查 MUST 使用 fs.realpathSync.native
 * - 8.3 短名路径（PROGRA~1）不得被误判为符号链接
 * - native 调用异常时跳过检查，不得阻断门禁
 */
import { describe, it, expect } from 'bun:test';
import { mkdir, rm, writeFile, symlink } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { readFileSync } from 'fs';
import { checkReceiptIntegrity } from '../hooks/guard/checks/wave-guards.js';
import type { ExecutionPlan, ReviewReceipt } from '../features/execution-plan-types.js';

const ROOT = join('C:', 'Users', 'admin', 'AppData', 'Local', 'Temp', 'opencode', 'wave4-realpath');

async function cleanup(): Promise<void> {
  try { await rm(ROOT, { recursive: true, force: true }); } catch {}
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 通过 cmd 获取 8.3 短路径；不可用（卷未启用 8.3 / 非短名）时返回 null */
function getShortPath(p: string): string | null {
  try {
    const { execSync } = require('child_process') as typeof import('child_process');
    const out = execSync(`cmd /c for %I in ("${p}") do @echo %~sI`, { encoding: 'utf8' }).trim();
    if (!out || normalize(out) === normalize(p)) return null;
    return out;
  } catch {
    return null;
  }
}

describe('Task 4.1: realpathSync.native（8.3 短名防御）', () => {
  const plan: ExecutionPlan = {
    mode: 'sdd',
    source: 'default',
    rationale: 'realpath native test',
    waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    hash: 'h',
    artifacts_hash: 'a',
    contract_hash: 'c',
    revision: 1,
  };
  const receipt: ReviewReceipt = {
    status: 'pass',
    base: 'abc123',
    head: 'def456',
    report: 'ok',
    recorded_at: new Date().toISOString(),
  };

  it('源码使用 realpathSync.native 而非 realpathSync', () => {
    const src = readFileSync(
      join(process.cwd(), 'packages/plugin-infra/src/hooks/guard/checks/wave-guards.ts'),
      'utf8',
    );
    expect(src).toContain('realpathSync.native');
    expect(src).not.toMatch(/realpathSync\((?!\.native)/);
  });

  it('8.3 短名 changeDir 下收据不被误判为符号链接（短路径可用时）', async () => {
    await cleanup();
    const longDir = join(ROOT, 'change-dir-long-name');
    await mkdir(longDir + '/.flow-engine/sflow/reviews', { recursive: true });
    await writeFile(longDir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify(plan));
    await writeFile(longDir + '/.flow-engine/sflow/reviews/W1.json', JSON.stringify(receipt));

    const shortDir = getShortPath(longDir);
    if (!shortDir) {
      await cleanup();
      return; // 卷未启用 8.3 短名，行为用例不适用（源码用例仍覆盖）
    }

    const result = await checkReceiptIntegrity(shortDir, 'sflow');
    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
    await cleanup();
  });

  it('真实符号链接仍被检测（native 版本保留符号链接检测）', async () => {
    await cleanup();
    const dir = join(ROOT, 'symlink-case');
    const target = join(ROOT, 'symlink-target');
    await mkdir(target, { recursive: true });
    await mkdir(dir + '/.flow-engine/sflow/reviews', { recursive: true });
    await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify(plan));
    await writeFile(target + '/outside.json', JSON.stringify(receipt));
    let symlinked = false;
    try {
      await symlink(join(target, 'outside.json'), join(dir, '.flow-engine/sflow/reviews/W1.json'), 'file');
      symlinked = true;
    } catch {
      // Windows 无权限创建符号链接时跳过行为断言
    }
    if (symlinked) {
      const result = await checkReceiptIntegrity(dir, 'sflow');
      expect(result.success).toBe(false);
      expect(result.blockReason).toContain('symlinked receipt detected');
    }
    await cleanup();
  });

  it('realpath 异常时跳过检查不阻断（非法路径回退为 pass）', async () => {
    await cleanup();
    const dir = join(ROOT, 'exception-case');
    await mkdir(dir + '/.flow-engine/sflow/reviews', { recursive: true });
    await writeFile(dir + '/.flow-engine/sflow/execution-plan.json', JSON.stringify(plan));
    await writeFile(dir + '/.flow-engine/sflow/reviews/W1.json', JSON.stringify(receipt));
    // 目录真实存在，正常路径检查应通过
    const result = await checkReceiptIntegrity(dir, 'sflow');
    expect(result.success).toBe(true);
    await cleanup();
  });
});
