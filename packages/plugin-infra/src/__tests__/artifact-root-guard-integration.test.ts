/**
 * 工件根写路径守卫 —— 工厂 hook 集成级用例（P0-1 Gate 修复轮）
 *
 * 背景：commit 7e17322 引入的守卫在三工厂 `tool.execute.before` 中只置
 * `_sflow_guard_blocked` / `_iflow_guard_blocked` flag，全仓无消费方——
 * 审查实测向 workDir 外 `.flow-engine` 路径写入成功落盘，守卫形同虚设。
 *
 * 本文件穿过真实工厂 hook（非纯函数单测）验证「真阻断」：
 * - 非法路径（workDir 之外含 .flow-engine 目录层级）→ 钩子抛错，
 *   模拟 OpenCode 的中止语义（钩子抛错即工具调用中止），文件不得落盘；
 * - 合法路径（<workDir>/.flow-engine/ 下）→ 放行，写入正常完成；
 * - 覆盖工具列表维持 write/edit/multiedit/patch/apply_patch；
 * - 非写工具（read/bash）不受该守卫阻断。
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join, dirname } from 'node:path';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

import { createSFlowPluginModule } from '../sflow-plugin-factory.js';
import { createIFlowPluginModule } from '../iflow-plugin-factory.js';
import { createCombinedPluginModule } from '../combined-plugin-factory.js';

/** OpenCode `tool.execute.before` 钩子签名（input/output 仅暴露 args） */
type ToolBeforeHook = (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
) => Promise<void>;

/** 与 model-fallback-fix.test.ts 一致的最小 client mock（provider.list 供启动期模型对账） */
function createMockClient(): unknown {
  return {
    provider: {
      list: async () => ({ data: { all: [{ id: 'p', models: { real: {} } }], connected: ['p'] } }),
    },
  };
}

function getToolBeforeHook(hooks: unknown): ToolBeforeHook {
  const hook = (hooks as Record<string, unknown>)['tool.execute.before'];
  if (typeof hook !== 'function') {
    throw new Error('工厂未注册 tool.execute.before 钩子');
  }
  return hook as ToolBeforeHook;
}

/**
 * 模拟 OpenCode 的工具派发语义：
 * 先跑 `tool.execute.before` 钩子——抛错则工具调用中止（不执行写入）；
 * 放行则执行写入。返回钩子错误（无错误返回 null）。
 */
async function dispatchWrite(
  hooks: unknown,
  tool: string,
  args: Record<string, unknown>,
): Promise<Error | null> {
  const before = getToolBeforeHook(hooks);
  try {
    await before({ tool, sessionID: 'guard-session', callID: `call-${tool}` }, { args });
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
  // 放行则执行写入（真实 write 工具会递归创建父目录）
  await mkdir(dirname(args.filePath as string), { recursive: true });
  await writeFile(args.filePath as string, (args.content as string) ?? '', 'utf-8');
  return null;
}

/**
 * best-effort 释放插件钩子（停止 MCP / taskTracker / 清缓存）。
 * 清理异常（如 Windows 瞬时文件锁 EBUSY）不得判定用例失败。
 */
async function disposeHooks(hooks: unknown): Promise<void> {
  try {
    await (hooks as { dispose?: () => Promise<void> }).dispose?.();
  } catch {
    // 忽略：清理为 best-effort
  }
}

/**
 * best-effort 目录清理：Windows 下刚创建的目录可能被索引器/杀毒软件
 * 瞬时锁定（EBUSY），重试数次后放弃——清理失败不得判定用例失败
 * （tmpdir 最终由操作系统回收）。
 */
async function bestEffortRm(dir: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

describe('P0-1：工件根写路径守卫 —— 工厂 hook 真阻断', () => {
  let workDir: string;
  let projectDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'artifact-root-guard-'));
    workDir = join(root, 'workdir');
    projectDir = join(root, 'projectdir'); // 子项目目录：不允许出现 .flow-engine
    outsideDir = join(root, 'outside'); // workDir 之外的任意目录
    await writeFile(join(root, 'keep'), '', 'utf-8'); // 占位，确保 root 非空
  });

  afterEach(async () => {
    await bestEffortRm(join(workDir, '..'));
  });

  // ─── 三工厂：非法路径必须抛错且不落盘 ───────────────────────────────────────

  const factories: Array<[string, () => Promise<unknown>]> = [
    ['sflow', async () => (await createSFlowPluginModule().server({
      client: createMockClient(),
      directory: workDir,
    } as never)) as unknown],
    ['iflow', async () => (await createIFlowPluginModule().server({
      client: createMockClient(),
      directory: workDir,
    } as never)) as unknown],
    ['combined', async () => (await createCombinedPluginModule().server({
      client: createMockClient(),
      directory: workDir,
    } as never)) as unknown],
  ];

  for (const [name, createHooks] of factories) {
    it(`${name} 工厂：写子项目目录 .flow-engine 被阻断（抛错 + 文件未落盘）`, async () => {
      const hooks = await createHooks();
      try {
        const target = join(projectDir, '.flow-engine', 'sflow', 'state.json');
        const err = await dispatchWrite(hooks, 'write', { filePath: target, content: '{"state":"x"}' });

        expect(err).toBeInstanceOf(Error);
        // 错误信息必须清晰：含阻断原因与正确工件目录指引
        expect(err!.message).toContain('工件目录锁定');
        expect(err!.message).toContain(join(workDir, '.flow-engine', 'sflow'));
        // 关键：文件未落盘
        expect(existsSync(target)).toBe(false);
      } finally {
        await disposeHooks(hooks);
      }
    });

    it(`${name} 工厂：写 workDir 之外任意目录的 .flow-engine 被阻断`, async () => {
      const hooks = await createHooks();
      try {
        const target = join(outsideDir, '.flow-engine', 'sflow', 'proposal.md');
        const err = await dispatchWrite(hooks, 'write', { filePath: target, content: '# proposal' });

        expect(err).toBeInstanceOf(Error);
        expect(existsSync(target)).toBe(false);
      } finally {
        await disposeHooks(hooks);
      }
    });

    it(`${name} 工厂：合法工件写入放行（<workDir>/.flow-engine/ 下落盘成功）`, async () => {
      const hooks = await createHooks();
      try {
        const target = join(workDir, '.flow-engine', 'sflow', 'tasks.md');
        const err = await dispatchWrite(hooks, 'write', { filePath: target, content: '# tasks' });

        expect(err).toBeNull();
        expect(existsSync(target)).toBe(true);
        expect(await readFile(target, 'utf-8')).toBe('# tasks');
      } finally {
        await disposeHooks(hooks);
      }
    });
  }

  // ─── 工具列表覆盖：write/edit/multiedit/patch/apply_patch 全部阻断 ──────────

  it('sflow 工厂：GUARDED_WRITE_TOOLS 五个写工具全部被阻断', async () => {
    const hooks = await createSFlowPluginModule().server({
      client: createMockClient(),
      directory: workDir,
    } as never);
    try {
      for (const tool of ['write', 'edit', 'multiedit', 'patch', 'apply_patch']) {
        const target = join(projectDir, '.flow-engine', 'sflow', `${tool}.md`);
        const err = await dispatchWrite(hooks, tool, {
          filePath: target,
          content: 'x',
          oldString: 'a',
          newString: 'b',
        });
        expect(err).toBeInstanceOf(Error);
        expect(err!.message).toContain('工件目录锁定');
        expect(existsSync(target)).toBe(false);
      }
    } finally {
      await disposeHooks(hooks);
    }
  });

  // ─── 非写工具不受该守卫阻断 ─────────────────────────────────────────────────

  it('sflow 工厂：read 工具读取 workDir 外 .flow-engine 路径不被该守卫阻断', async () => {
    const hooks = await createSFlowPluginModule().server({
      client: createMockClient(),
      directory: workDir,
    } as never);
    try {
      const before = getToolBeforeHook(hooks);
      const output = { args: { filePath: join(projectDir, '.flow-engine', 'sflow', 'state.json') } };
      // read 不是写工具：钩子应放行（不抛错），也不得注入阻断 flag
      await before({ tool: 'read', sessionID: 's', callID: 'c' }, output);
      expect(output.args).toEqual({ filePath: join(projectDir, '.flow-engine', 'sflow', 'state.json') });
    } finally {
      await disposeHooks(hooks);
    }
  });

  it('sflow 工厂：bash 等无文件路径参数的工具不受该守卫阻断', async () => {
    const hooks = await createSFlowPluginModule().server({
      client: createMockClient(),
      directory: workDir,
    } as never);
    try {
      const before = getToolBeforeHook(hooks);
      const output = { args: { command: 'echo hi' } };
      await before({ tool: 'bash', sessionID: 's', callID: 'c' }, output);
      expect(output.args).toEqual({ command: 'echo hi' });
    } finally {
      await disposeHooks(hooks);
    }
  });

  // ─── flag 治理：阻断后不得残留死代码 flag ───────────────────────────────────

  it('sflow 工厂：合法写入后 args 不被注入任何 guard flag（无死代码残留）', async () => {
    const hooks = await createSFlowPluginModule().server({
      client: createMockClient(),
      directory: workDir,
    } as never);
    try {
      const before = getToolBeforeHook(hooks);
      const args = { filePath: join(workDir, '.flow-engine', 'sflow', 'design.md'), content: '# design' };
      const output = { args };
      await before({ tool: 'write', sessionID: 's', callID: 'c' }, output);
      expect(Object.keys(output.args)).toEqual(['filePath', 'content']);
    } finally {
      await disposeHooks(hooks);
    }
  });
});
