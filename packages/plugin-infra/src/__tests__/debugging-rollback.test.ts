/**
 * Wave 4 / Task 4.3 — debugging 回退维度显式化（TDD RED）
 *
 * Spec: guard-diagnostics.md「回退合法性显式记录」
 * - debugging → specifying / bridging 回退 MUST 合法且显式记录原因
 * - 缺原因回退被拒，报错含 Fix 指引
 * - debugging → executing 正常推进仍合法
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isValidTransition } from '@opencode-flow-engine/core';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { createStateTransitionHook } from '../hooks/state-transition.js';

const ROOT = join('C:', 'Users', 'admin', 'AppData', 'Local', 'Temp', 'opencode', 'wave4-rollback');

describe('Task 4.3: debugging 回退合法性', () => {
  it('debugging → specifying / bridging 为合法转换（executing 仍合法）', () => {
    expect(isValidTransition('debugging', 'specifying')).toBe(true);
    expect(isValidTransition('debugging', 'bridging')).toBe(true);
    expect(isValidTransition('debugging', 'executing')).toBe(true);
  });
});

describe('Task 4.3: debugging 回退原因显式记录', () => {
  let hook: ReturnType<typeof createStateTransitionHook>;
  const dir = join(ROOT, 'case');

  beforeEach(async () => {
    try { await rm(dir, { recursive: true, force: true }); } catch {}
    await mkdir(dir + '/.flow-engine/sflow', { recursive: true });
    await writeFile(
      dir + '/.flow-engine/sflow/state.json',
      JSON.stringify({ state: 'debugging', mode: 'full' }),
    );
    // 补齐 preflight gate 所需工件（specifying/bridging/executing 均要求）
    await writeFile(dir + '/proposal.md', '# p');
    await mkdir(dir + '/.flow-engine/sflow/specs', { recursive: true });
    await writeFile(dir + '/.flow-engine/sflow/specs/x.md', '# s');
    await writeFile(dir + '/design.md', '# d');
    await writeFile(dir + '/tasks.md', '# t');
    await writeFile(dir + '/execution-contract.md', '# c');
    hook = createStateTransitionHook();
  });

  afterEach(async () => {
    try { await rm(dir, { recursive: true, force: true }); } catch {}
  });

  it('回退到 specifying 时记录原因，写入 state 转换记录', async () => {
    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: {
        newState: 'specifying',
        rollbackReason: '调试发现 spec 缺失边界条件',
      },
    } as never);
    expect(result.success).toBe(true);
    const state = JSON.parse(await readFile(dir + '/.flow-engine/sflow/state.json', 'utf8'));
    expect(state.state).toBe('specifying');
    const recorded = JSON.stringify(state);
    expect(recorded).toContain('调试发现 spec 缺失边界条件');
    expect(recorded).toContain('debugging');
  });

  it('回退到 bridging 时记录原因', async () => {
    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: {
        newState: 'bridging',
        rollbackReason: '合约实现与设计假设不一致',
      },
    } as never);
    expect(result.success).toBe(true);
    const state = JSON.parse(await readFile(dir + '/.flow-engine/sflow/state.json', 'utf8'));
    expect(state.state).toBe('bridging');
    expect(JSON.stringify(state)).toContain('合约实现与设计假设不一致');
  });

  it('缺原因回退被拒，报错含 Fix 指引', async () => {
    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { newState: 'specifying' },
    } as never);
    expect(result.success).toBe(false);
    expect(result.block).toBe(true);
    expect(String(result.blockReason)).toContain('Fix:');
    // 状态未变更
    const state = JSON.parse(await readFile(dir + '/.flow-engine/sflow/state.json', 'utf8'));
    expect(state.state).toBe('debugging');
  });

  it('debugging → executing 正常推进无需回退原因', async () => {
    const result = await hook.execute({
      changeDir: dir,
      stateFile: '',
      pluginRoot: '',
      action: 'check',
      data: { newState: 'executing' },
    } as never);
    expect(result.success).toBe(true);
    const state = JSON.parse(await readFile(dir + '/.flow-engine/sflow/state.json', 'utf8'));
    expect(state.state).toBe('executing');
  });
});
