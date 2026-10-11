/**
 * 全局测试 setup（bun test preload）
 *
 * 动机（P1-2）：Logger / PollingLogger 的默认根是机器级运行时目录
 * %USERPROFILE%/.flow-engine/sflow。未显式 initialize 的测试路径（如
 * config-loader.test.ts、以及任何 import 工厂触发模块级 PollingLogger 的
 * 测试）会在全量跑时向**真实用户目录**追加测试条目（审查者实证 ~9.8KB），
 * 既污染用户机器，也让「测试不触碰真实运行时目录」无法被信任。
 *
 * 本 setup 在进程启动时（任何测试文件加载前）：
 * 1. 把 FLOW_ENGINE_LOG_ROOT 导向 tmpdir 下按 PID 隔离的目录，
 *    使 plugin.log / polling.log 全部改写（Logger 与 PollingLogger 共用
 *    runtime-paths 的 resolveLogRoot 解析）；
 * 2. 记录真实日志目录（%USERPROFILE%/.flow-engine/sflow）的字节数/文件数
 *    快照到 globalThis，供 logger-isolation.test.ts 做「零增长」守卫。
 *
 * 注意：本文件不 import 任何插件模块——必须在模块级副作用
 * （如工厂的 `new PollingLogger()`）发生前完成环境注入与快照。
 */

import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';

/** 与 runtime-paths.ts 的 LOG_ROOT_ENV 保持一致（避免 import 插件模块） */
const LOG_ROOT_ENV = 'FLOW_ENGINE_LOG_ROOT';

/** logger-isolation.test.ts 读取的进程启动快照键 */
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

// 1. 日志根隔离：tmpdir 下按 PID 分目录，避免并行 bun test 进程互相干扰
if (!process.env[LOG_ROOT_ENV] || process.env[LOG_ROOT_ENV]!.trim().length === 0) {
  process.env[LOG_ROOT_ENV] = join(tmpdir(), `flow-engine-test-logs-${process.pid}`);
}

// 2. 记录真实日志目录快照（在任何测试文件加载前）
const realLogDir = join(homedir(), '.flow-engine', 'sflow');
const snapshot = await snapshotDir(realLogDir);
(globalThis as Record<string, unknown>)[SNAPSHOT_KEY] = snapshot;
