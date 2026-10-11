/**
 * P2-1：包级测试隔离守卫（bunfig preload 包级覆盖）
 *
 * 背景：Bun 的 bunfig.toml 只从 cwd 加载、无父目录遍历（官方实证）；
 * 仓库根 bunfig.toml 的 preload（scripts/test-setup.ts，把
 * FLOW_ENGINE_LOG_ROOT 导向 tmpdir）在 `cd packages/plugin-infra && bun test`
 * 时不生效——而该包 package.json 自带 `"test": "bun test"`，从包目录跑测试
 * 会直接向真实 %USERPROFILE%/.flow-engine/sflow 写日志（审查实证 +198 字节），
 * 且 logger-isolation.test.ts 的 4 个隔离守卫用例全部失败。
 *
 * 本文件是「包目录跑测试也隔离」的守卫：
 * - 静态契约：packages/plugin-infra/bunfig.toml 必须存在，且其
 *   [test] preload 必须指向仓库根 scripts/test-setup.ts（相对路径按
 *   bunfig 所在目录解析，实证基准 = bunfig 目录 = 包目录）；
 * - 行为契约：以包目录为 cwd 子进程跑 logger-isolation.test.ts 必须全绿
 *   （preload 生效 → FLOW_ENGINE_LOG_ROOT 已导向 tmpdir → 隔离守卫通过）。
 */

import { describe, it, expect } from 'bun:test';
import { join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** 测试文件位于 <pkg>/src/__tests__/，包根 = 上两级 */
const PACKAGE_ROOT = resolve(import.meta.dir, '../..');
/** 仓库根 = 包目录上两级（packages/<pkg> → packages → repo root） */
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');
const BUNFIG_PATH = join(PACKAGE_ROOT, 'bunfig.toml');
const ROOT_TEST_SETUP = join(REPO_ROOT, 'scripts', 'test-setup.ts');

describe('P2-1：包级测试隔离（bunfig preload 包级覆盖）', () => {
  it('静态契约：packages/plugin-infra/bunfig.toml 存在且 preload 指向仓库根 scripts/test-setup.ts', () => {
    expect(existsSync(BUNFIG_PATH)).toBe(true);

    const content = readFileSync(BUNFIG_PATH, 'utf-8');
    const m = content.match(/preload\s*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();

    const entries = (m?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter((s) => s.length > 0);
    expect(entries.length).toBeGreaterThan(0);

    // 每条 preload 相对路径按 bunfig 所在目录（= 包目录）解析后必须真实存在
    const resolved = entries.map((e) => resolve(PACKAGE_ROOT, e));
    for (const p of resolved) {
      expect(existsSync(p)).toBe(true);
    }
    // 必须覆盖仓库根的全局测试 setup（日志隔离的唯一定义处）
    expect(resolved).toContain(ROOT_TEST_SETUP);
  });

  it('行为契约：以包目录为 cwd 跑日志隔离测试必须全绿（preload 在包目录生效）', () => {
    const result = spawnSync(
      process.execPath,
      ['test', 'src/utils/logger-isolation.test.ts'],
      { cwd: PACKAGE_ROOT, encoding: 'utf-8', timeout: 120_000 },
    );
    // 子进程退出码 0 = 4 个隔离守卫用例全部通过（preload 已生效）；
    // 非 0 = bunfig 包级覆盖缺失，包目录跑测试时隔离失效
    expect(result.status).toBe(0);
  }, 180_000);
});
