/**
 * P1-2：plugin.log 测试隔离守卫
 *
 * 背景：`logger.ts` 的静态默认根即 %USERPROFILE%/.flow-engine/sflow，未调用
 * `Logger.initialize` 的测试路径（如 config-loader.test.ts）在全量跑时会向
 * 真实用户目录追加大量测试条目（审查者实证 ~9.8KB）。
 *
 * 本文件是「跑测试不触碰真实 %USERPROFILE%/.flow-engine」的守卫：
 * - 全局测试 setup（bunfig.toml preload = scripts/test-setup.ts）必须把
 *   FLOW_ENGINE_LOG_ROOT 导向 tmpdir；
 * - preload 在进程启动时记录真实日志目录快照，本用例比对零增长
 *   （可捕获同一进程内任何先行的污染）；
 * - 未经 initialize 的 Logger / 默认构造的 PollingLogger 写入都必须落在
 *   覆盖根，而非真实用户目录。
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { readdir, stat, readFile } from 'node:fs/promises';

import { Logger } from './logger.js';
import { PollingLogger } from '../features/polling-logger.js';
import { LOG_ROOT_ENV, DEFAULT_LOG_DIR, resolveLogRoot } from '../helpers/runtime-paths.js';

/** 真实用户日志目录（测试绝不应触碰） */
const REAL_LOG_DIR = DEFAULT_LOG_DIR;

/** preload 通过 globalThis 传递的进程启动快照键 */
const SNAPSHOT_KEY = '__flowEngineTestRealLogSnapshot';

interface DirSnapshot {
  exists: boolean;
  bytes: number;
  files: number;
}

async function snapshotDir(dir: string): Promise<DirSnapshot> {
  if (!existsSync(dir)) return { exists: false, bytes: 0, files: 0 };
  const entries = await readdir(dir, { withFileTypes: true });
  let bytes = 0;
  let files = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += (await stat(join(dir, entry.name))).size;
  }
  return { exists: true, bytes, files };
}

function getProcessStartSnapshot(): DirSnapshot | undefined {
  return (globalThis as Record<string, unknown>)[SNAPSHOT_KEY] as DirSnapshot | undefined;
}

describe('P1-2：跑测试不触碰真实 %USERPROFILE%/.flow-engine（日志隔离守卫）', () => {
  it('全局测试 setup 必须把 FLOW_ENGINE_LOG_ROOT 导向 tmpdir（隔离生效前置条件）', () => {
    const root = process.env[LOG_ROOT_ENV];
    expect(root).toBeTruthy();
    // 覆盖根必须在 tmpdir 下，且不是真实用户日志目录
    expect(resolveLogRoot()).not.toBe(REAL_LOG_DIR);
    expect(resolveLogRoot().startsWith(tmpdir())).toBe(true);
  });

  it('真实日志目录相对进程启动零增长（字节数/文件数前后比对）', async () => {
    const initial = getProcessStartSnapshot();
    // preload 未记录快照 = 全局 setup 被移除，直接失败
    expect(initial).toBeDefined();

    const current = await snapshotDir(REAL_LOG_DIR);
    expect(current).toEqual(initial);
  });

  it('未经 initialize 的 Logger 写入落在覆盖根，真实用户目录零增长', async () => {
    const root = process.env[LOG_ROOT_ENV] as string;
    const before = await snapshotDir(REAL_LOG_DIR);

    Logger.reset(); // 模拟 config-loader.test.ts 等未 initialize 的路径
    const probe = `[P1-2 isolation probe] ${Date.now()}`;
    await Logger.warn(probe);
    await Logger.log(probe);
    await Logger.error(probe);

    const after = await snapshotDir(REAL_LOG_DIR);
    expect(after).toEqual(before);

    const content = await readFile(join(root, 'plugin.log'), 'utf-8');
    expect(content).toContain(probe);
  });

  it('PollingLogger 默认构造（无显式路径）也落在覆盖根，真实用户目录零增长', async () => {
    const root = process.env[LOG_ROOT_ENV] as string;
    const before = await snapshotDir(REAL_LOG_DIR);

    const probe = `[P1-2 polling probe] ${Date.now()}`;
    const logger = new PollingLogger();
    await logger.log('isolation-session', probe);

    const after = await snapshotDir(REAL_LOG_DIR);
    expect(after).toEqual(before);

    const content = await readFile(join(root, 'polling.log'), 'utf-8');
    expect(content).toContain(probe);
  });
});
