/**
 * Guard 快路径门禁测试（Wave 1 / Task 1.1-1.3）
 *
 * 覆盖 spec: guard-fast-path
 * - FP-R1 quick 模式快路径准入
 * - FP-R2 未知转换明确报错（unknownTransitionFailure，不静默套用 full 主表）
 * - FP-R3 快路径报错携带 Fix: 修复指引（统一函数 formatGuardFixHint）
 * - FP-R4 既有模式（full / hotfix / tweak）回归行为不变
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { checkWorkflowModeTransition, isFastPathAllowed } from '../guard/checks/transition-guards.js';
import { formatGuardFixHint } from '../../features/guard-fix-hint.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', name);
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

async function writeStateFile(dir: string, mode: unknown, state = 'exploring'): Promise<void> {
  await ensureDir(join(dir, '.flow-engine', 'sflow'));
  await writeFile(
    join(dir, '.flow-engine', 'sflow', 'state.json'),
    JSON.stringify({ state, mode }, null, 2)
  );
}

async function transition(mode: unknown, newState: string, currentState = 'exploring') {
  const dir = tempDir(`fast-path-${String(mode || 'empty')}-${currentState}-${newState}`);
  await cleanupDir(dir);
  await ensureDir(dir);
  await writeStateFile(dir, mode, currentState);
  try {
    return await checkWorkflowModeTransition(dir, { newState }, 'sflow');
  } finally {
    await cleanupDir(dir);
  }
}

describe('Guard 快路径门禁 — FP-R1 quick 模式准入', () => {
  const dir = tempDir('fast-path-suite');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('quick 模式 exploring → approved-for-build 放行', async () => {
    const result = await transition('quick', 'approved-for-build');
    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('quick 模式不得走 exploring → bridging（语义不得退化为 hotfix）', async () => {
    const result = await transition('quick', 'bridging');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('hotfix');
  });

  it('quick 模式 exploring → specifying 不受快路径限制', async () => {
    const result = await transition('quick', 'specifying');
    expect(result.success).toBe(true);
  });
});

describe('Guard 快路径门禁 — FP-R4 既有模式回归', () => {
  it('tweak 模式 exploring → approved-for-build 仍放行', async () => {
    const result = await transition('tweak', 'approved-for-build');
    expect(result.success).toBe(true);
    expect(result.block).toBeUndefined();
  });

  it('hotfix 模式 exploring → bridging 仍放行', async () => {
    const result = await transition('hotfix', 'bridging');
    expect(result.success).toBe(true);
  });

  it('hotfix 模式 exploring → approved-for-build 仍阻断（tweak/quick-only）', async () => {
    const result = await transition('hotfix', 'approved-for-build');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('tweak or quick');
    expect(result.blockReason).toContain('hotfix');
  });

  it('full 模式 exploring → specifying 放行，不得误伤', async () => {
    const result = await transition('full', 'specifying');
    expect(result.success).toBe(true);
  });

  it('full 模式 exploring → bridging 仍阻断（full 不得走 hotfix 快路径）', async () => {
    const result = await transition('full', 'bridging');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('非快路径转换（executing → closing）不受影响', async () => {
    const result = await transition('full', 'closing', 'executing');
    expect(result.success).toBe(true);
  });
});

describe('Guard 快路径门禁 — FP-R2 未知转换明确报错', () => {
  it('full 模式走 tweak/quick 快路径被阻断，报错含模式/允许集合/正确路径', async () => {
    const result = await transition('full', 'approved-for-build');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    const reason = result.blockReason || '';
    expect(reason).toContain('"full"');
    expect(reason).toContain('tweak or quick');
    expect(reason).toContain('exploring → specifying → bridging → approved-for-build');
  });

  it('未登记的 mode 值命中快路径表时明确报错，且包含实际读到的 mode（不静默套用 full 主表）', async () => {
    const result = await transition('turbo', 'approved-for-build');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(result.blockReason).toContain('turbo');
  });

  it('空 mode 值命中快路径表时明确报错，不回落放行', async () => {
    const result = await transition('', 'approved-for-build');
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
  });

  it('缺失 mode 字段按 full 处理并被阻断', async () => {
    const dir = tempDir('fast-path-missing-mode');
    await cleanupDir(dir);
    await ensureDir(join(dir, '.flow-engine', 'sflow'));
    await writeFile(
      join(dir, '.flow-engine', 'sflow', 'state.json'),
      JSON.stringify({ state: 'exploring' }, null, 2)
    );
    try {
      const result = await checkWorkflowModeTransition(dir, { newState: 'approved-for-build' }, 'sflow');
      expect(result.success).toBe(false);
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain('"full"');
    } finally {
      await cleanupDir(dir);
    }
  });
});

describe('Guard 快路径门禁 — FP-R3 Fix: 修复指引', () => {
  it('快路径阻断的 blockReason 末行是 Fix: 行', async () => {
    const result = await transition('full', 'approved-for-build');
    const reason = result.blockReason || '';
    const lines = reason.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines[lines.length - 1].startsWith('Fix: ')).toBe(true);
  });

  it('Fix: 行给出可执行入口（workflow_router + contract-builder）', async () => {
    const result = await transition('full', 'approved-for-build');
    expect(result.blockReason).toContain('workflow_router(agent="contract-builder")');
  });

  it('formatGuardFixHint 输出单行、以 Fix: 开头、以句号结尾、含入口', () => {
    const hint = formatGuardFixHint(
      '走 exploring → specifying → bridging → approved-for-build',
      'workflow_router(agent="contract-builder")'
    );
    expect(hint).toMatch(/^Fix: /);
    expect(hint.endsWith('.')).toBe(true);
    expect(hint.split('\n').length).toBe(1);
    expect(hint).toContain('workflow_router(agent="contract-builder")');
  });

  it('formatGuardFixHint 不得出现空泛措辞', () => {
    const hint = formatGuardFixHint(
      '走 exploring → specifying → bridging → approved-for-build',
      'workflow_router(agent="contract-builder")'
    );
    expect(hint).not.toContain('请修复后重试');
  });
});

describe('Guard 快路径门禁 — 编排与契约函数', () => {
  it('非 sflow 工作流不触发快路径门禁', async () => {
    const dir = tempDir('fast-path-iflow');
    await cleanupDir(dir);
    await ensureDir(dir);
    await writeStateFile(dir, 'full');
    try {
      const result = await checkWorkflowModeTransition(dir, { newState: 'approved-for-build' }, 'iflow');
      expect(result.success).toBe(true);
    } finally {
      await cleanupDir(dir);
    }
  });

  it('无 newState 时直接放行', async () => {
    const dir = tempDir('fast-path-no-newstate');
    await cleanupDir(dir);
    await ensureDir(dir);
    await writeStateFile(dir, 'full');
    try {
      const result = await checkWorkflowModeTransition(dir, {}, 'sflow');
      expect(result.success).toBe(true);
    } finally {
      await cleanupDir(dir);
    }
  });

  it('isFastPathAllowed: quick 仅放行 exploring → approved-for-build', () => {
    expect(isFastPathAllowed('exploring', 'approved-for-build', 'quick')).toEqual({
      allowed: true,
      allowedModes: ['tweak', 'quick'],
    });
    expect(isFastPathAllowed('exploring', 'bridging', 'quick')).toEqual({
      allowed: false,
      allowedModes: ['hotfix'],
    });
    expect(isFastPathAllowed('exploring', 'bridging', 'hotfix')).toEqual({
      allowed: true,
      allowedModes: ['hotfix'],
    });
  });

  it('isFastPathAllowed: 非快路径转换不设限', () => {
    expect(isFastPathAllowed('specifying', 'bridging', 'full')).toEqual({
      allowed: true,
      allowedModes: [],
    });
  });
});
