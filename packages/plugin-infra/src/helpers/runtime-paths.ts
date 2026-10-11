/**
 * 机器级运行时目录（Runtime Paths）
 *
 * 动机：notifications / subagent-store 属**机器级运行时产物**，不是项目工件。
 * 原实现用 `join(workDir, '.flow-engine/sflow/<dir>')` 派生落点，而 workDir 在缺少
 * 显式注入时会回落到 process.cwd()，导致子项目的 `.flow-engine` 被无端创建
 * （并被测试清理动作误删）。现统一下沉到 `%USERPROFILE%/.flow-engine/`，
 * 与 cwd / projectDir 完全解耦：
 *
 * %USERPROFILE%/.flow-engine/
 * ├── notifications/     ← 子 agent 完成通知（平铺，无 sflow 层级）
 * └── subagent-store/    ← 子 agent 持久化与恢复（平铺，无 sflow 层级）
 *
 * 测试隔离：设置环境变量 `FLOW_ENGINE_RUNTIME_ROOT` 即可整体改写运行时根，
 * 使测试既不写入真实 %USERPROFILE%，也不依赖 cwd。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 运行时根环境变量名（测试隔离 / 运维覆盖用） */
export const RUNTIME_ROOT_ENV = 'FLOW_ENGINE_RUNTIME_ROOT';

/** 机器级运行时根目录：%USERPROFILE%/.flow-engine */
export const RUNTIME_ROOT: string = join(homedir(), '.flow-engine');

/** 通知目录：%USERPROFILE%/.flow-engine/notifications */
export const NOTIFICATIONS_DIR: string = join(RUNTIME_ROOT, 'notifications');

/** 子 agent store 目录：%USERPROFILE%/.flow-engine/subagent-store */
export const SUBAGENT_STORE_DIR: string = join(RUNTIME_ROOT, 'subagent-store');

/**
 * 解析实际生效的运行时根目录。
 *
 * 优先级：显式 `runtimeRoot` 参数 > `FLOW_ENGINE_RUNTIME_ROOT` 环境变量 > `%USERPROFILE%/.flow-engine`
 *
 * @param runtimeRoot - 显式覆盖（工厂参数），非空才生效
 * @returns 运行时根目录绝对路径
 */
export function resolveRuntimeRoot(runtimeRoot?: string): string {
  if (runtimeRoot && runtimeRoot.trim().length > 0) {
    return runtimeRoot;
  }
  const fromEnv = process.env[RUNTIME_ROOT_ENV];
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return RUNTIME_ROOT;
}