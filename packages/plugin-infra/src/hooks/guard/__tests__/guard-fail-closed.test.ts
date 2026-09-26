/**
 * P1-1 fail-closed：guard 链异常必须 block（fail-closed 而非 fail-open）
 *
 * 场景：畸形 plan（缺 waves）曾使 wave-guards 抛 TypeError，
 * guard.ts 的 catch 返回无 block:true 的失败结果，
 * combined-plugin-factory 只判 block → 整条 guard 链 fail-open。
 * 修复后：guard 钩子对任何内部异常一律返回 block:true。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createGuardHook } from '../../guard.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', `guard-fail-closed-${name}`);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

describe('P1-1 fail-closed：guard 钩子异常一律 block', () => {
  const dir = tempDir('malformed-plan');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('畸形 plan（缺 waves）→ guard 返回 block:true 而非静默通过', async () => {
    await ensureDir(dir + '/.flow-engine/sflow');
    await writeFile(
      dir + '/.flow-engine/sflow/execution-plan.json',
      JSON.stringify({ mode: 'sdd', source: 'default', revision: 1, hash: 'sha256:abc' }, null, 2),
    );

    const hook = createGuardHook();
    const result = await hook.execute({ changeDir: dir, data: {} } as any);

    // fail-closed：异常不得穿透为无 block 的失败
    expect(result.block).toBe(true);
    expect(result.success).toBe(false);
  });
});
