/**
 * P1-1：plugin.log 生产链路接线用例
 *
 * 背景：`Logger.initialize(dir)` 旧实现向调用方目录拼 `.flow-engine/sflow`，
 * 三工厂生产调用 `Logger.initialize(workDir)` → plugin.log 仍写
 * workDir/.flow-engine/sflow/，而 polling.log 已迁 %USERPROFILE%/.flow-engine/sflow/，
 * 两个日志根分裂。
 *
 * 本文件验证生产接线（穿过工厂 server()，非纯函数）：
 * - 三工厂 server() 不再把 Logger 根重定向到 workDir；
 * - 默认日志根 = %USERPROFILE%/.flow-engine/sflow（与 polling-logger 同源）；
 * - FLOW_ENGINE_LOG_ROOT 覆盖生效，且写入不落入 workDir/.flow-engine。
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { existsSync } from 'node:fs';

import { createSFlowPluginModule } from '../sflow-plugin-factory.js';
import { createIFlowPluginModule } from '../iflow-plugin-factory.js';
import { createCombinedPluginModule } from '../combined-plugin-factory.js';
import { Logger } from '../utils/logger.js';

function createMockClient(): unknown {
  return {
    provider: {
      list: async () => ({ data: { all: [{ id: 'p', models: { real: {} } }], connected: ['p'] } }),
    },
  };
}

type HooksWithDispose = { dispose?: () => Promise<void> };

/** best-effort 释放插件钩子：清理异常（如 Windows EBUSY）不得判定用例失败 */
async function disposeHooks(hooks: unknown): Promise<void> {
  try {
    await (hooks as HooksWithDispose).dispose?.();
  } catch {
    // 忽略：清理为 best-effort
  }
}

describe('P1-1：plugin.log 生产链路接线', () => {
  let workDir: string;
  let testLogRoot: string;
  /** 进程启动时全局 setup 设置的隔离根：afterEach 必须恢复而非删除，
   *  否则同一进程内后续测试文件失去隔离、写回真实用户目录（P1-2） */
  const savedLogRoot = process.env.FLOW_ENGINE_LOG_ROOT;

  afterEach(async () => {
    // 恢复环境，避免污染同一进程内的其它测试文件
    if (savedLogRoot === undefined) {
      delete process.env.FLOW_ENGINE_LOG_ROOT;
    } else {
      process.env.FLOW_ENGINE_LOG_ROOT = savedLogRoot;
    }
    Logger.reset();
    await rm(join(workDir, '..'), { recursive: true, force: true }).catch(() => {});
    await rm(testLogRoot, { recursive: true, force: true }).catch(() => {});
  });

  function setup(): void {
    const root = join(tmpdir(), `logger-wiring-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    workDir = join(root, 'workdir');
    testLogRoot = join(root, 'logroot');
  }

  it('默认日志根位于 %USERPROFILE%/.flow-engine/sflow（与 polling-logger 同源，与 cwd 无关）', () => {
    setup();
    const saved = process.env.FLOW_ENGINE_LOG_ROOT;
    delete process.env.FLOW_ENGINE_LOG_ROOT;
    try {
      Logger.reset();
      expect(Logger.getLogFilePath()).toBe(join(homedir(), '.flow-engine', 'sflow', 'plugin.log'));
    } finally {
      if (saved !== undefined) process.env.FLOW_ENGINE_LOG_ROOT = saved;
      Logger.reset();
    }
  });

  it('三工厂 server() 后 Logger 根不被重定向到 workDir（覆盖根优先）', async () => {
    setup();
    process.env.FLOW_ENGINE_LOG_ROOT = testLogRoot;
    Logger.reset();

    const factories = [
      () => createSFlowPluginModule().server({ client: createMockClient(), directory: workDir } as never),
      () => createIFlowPluginModule().server({ client: createMockClient(), directory: workDir } as never),
      () => createCombinedPluginModule().server({ client: createMockClient(), directory: workDir } as never),
    ];

    for (const create of factories) {
      Logger.reset();
      const hooks = (await create()) as HooksWithDispose;
      try {
        // 工厂不得把日志根改到 workDir（旧实现：join(workDir, '.flow-engine', 'sflow')）
        expect(Logger.getLogFilePath()).toBe(join(testLogRoot, 'plugin.log'));
        expect(Logger.getLogFilePath().startsWith(workDir)).toBe(false);
      } finally {
        await disposeHooks(hooks);
      }
    }
  });

  it('生产写入实证：Logger 写入落在覆盖根，workDir/.flow-engine 不被创建', async () => {
    setup();
    process.env.FLOW_ENGINE_LOG_ROOT = testLogRoot;
    Logger.reset();

    const hooks = (await createSFlowPluginModule().server({
      client: createMockClient(),
      directory: workDir,
    } as never)) as HooksWithDispose;
    try {
      await Logger.warn('[P1-1 wiring] production log probe');

      const content = await readFile(join(testLogRoot, 'plugin.log'), 'utf-8');
      expect(content).toContain('[P1-1 wiring] production log probe');
      // 关键：workDir 下不得出现 .flow-engine（旧实现会写 workDir/.flow-engine/sflow/plugin.log）
      expect(existsSync(join(workDir, '.flow-engine'))).toBe(false);
    } finally {
      await disposeHooks(hooks);
    }
  });
});
