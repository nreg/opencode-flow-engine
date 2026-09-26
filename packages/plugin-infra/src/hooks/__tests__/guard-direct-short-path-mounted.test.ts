/**
 * Guard 编排挂载端到端测试：checkDirectShortPath（Wave 2 / Task 2.5）
 *
 * 覆盖 spec: workflow-policy / Direct 短路径检查接入编排
 * - 通过 `createGuardHook()` 端到端证明该项**真的参与编排**（而非只测孤立函数，见 lessons L-002）
 * - quick 缺 direct 收据 → 编排阻断
 * - quick 持有效收据 → 放行
 * - 非快路径（full 常规转换）不误伤
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { createGuardHook } from '../guard.js';
import type { HookContext } from '../types.js';
import { saveWorkflowRecommendation, acceptWorkflowRecommendation } from '../../features/workflow-recommendation.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '__test_workdir__', `guard-direct-short-path-${name}`);
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {}
}

/** 写入 state.json（state / mode / workflow 三字段齐全，与真实链路一致）。 */
async function writeState(dir: string, state: Record<string, unknown>): Promise<void> {
  await ensureDir(join(dir, '.flow-engine', 'sflow'));
  await writeFile(
    join(dir, '.flow-engine', 'sflow', 'state.json'),
    JSON.stringify(state, null, 2),
  );
}

/** 生成一份有效的 quick direct 收据。 */
async function seedQuickDirectReceipt(dir: string): Promise<void> {
  await saveWorkflowRecommendation(dir, {
    task_count: 1,
    file_count: 1,
    config_doc_only: 'no',
    schema_api_change: 'no',
    new_module: 'no',
    behavioral_constraint_change: 'no',
    cross_module_change: 'no',
    uncertainty: 'low',
    request_kind: 'standard',
  });
  await acceptWorkflowRecommendation(dir, { source: 'direct-request', verificationStrategy: 'tdd' });
}

function guardContext(changeDir: string, newState: string): HookContext {
  return {
    changeDir,
    stateFile: join(changeDir, '.flow-engine', 'sflow', 'state.json'),
    pluginRoot: join(changeDir),
    action: 'state_transition',
    data: { newState },
  };
}

describe('guard 编排 — checkDirectShortPath 已挂载', () => {
  it('quick 模式缺少 direct 收据时，编排端到端阻断该快路径转换', async () => {
    const dir = tempDir('quick-missing-receipt');
    await cleanupDir(dir);
    await ensureDir(dir);
    await writeState(dir, { state: 'exploring', mode: 'quick', workflow: 'quick' });

    try {
      const result = await createGuardHook().execute(guardContext(dir, 'approved-for-build'));

      expect(result.success).toBe(false);
      expect(result.block).toBe(true);
      // 阻断来自 direct-short-path 这一维度（证明它真的在编排里被执行）
      expect(result.blockReason ?? '').toContain('direct-short-path');
      // 裁决结论可解释：指出缺失项并给出可执行入口
      expect(result.blockReason ?? '').toContain('Fix:');
    } finally {
      await cleanupDir(dir);
    }
  });

  it('quick 模式持有有效 direct 收据时正常放行', async () => {
    const dir = tempDir('quick-with-receipt');
    await cleanupDir(dir);
    await ensureDir(dir);
    await writeState(dir, { state: 'exploring', mode: 'quick', workflow: 'quick' });
    await seedQuickDirectReceipt(dir);

    try {
      const result = await createGuardHook().execute(guardContext(dir, 'approved-for-build'));

      expect(result.success).toBe(true);
      expect(result.block).toBeUndefined();
    } finally {
      await cleanupDir(dir);
    }
  });

  it('非快路径（full 常规转换）不误伤', async () => {
    const dir = tempDir('full-no-false-positive');
    await cleanupDir(dir);
    await ensureDir(dir);
    await writeState(dir, { state: 'exploring', mode: 'full', workflow: 'full' });

    try {
      const result = await createGuardHook().execute(guardContext(dir, 'specifying'));

      expect(result.success).toBe(true);
      expect(result.block).toBeUndefined();
      expect(result.blockReason).toBeUndefined();
    } finally {
      await cleanupDir(dir);
    }
  });

  it('tweak 模式无 direct 收据概念，不得被 direct 收据要求误伤', async () => {
    const dir = tempDir('tweak-no-receipt');
    await cleanupDir(dir);
    await ensureDir(dir);
    await writeState(dir, { state: 'exploring', mode: 'tweak', workflow: 'tweak' });

    try {
      const result = await createGuardHook().execute(guardContext(dir, 'approved-for-build'));

      expect(result.success).toBe(true);
      expect(result.block).toBeUndefined();
    } finally {
      await cleanupDir(dir);
    }
  });
});
