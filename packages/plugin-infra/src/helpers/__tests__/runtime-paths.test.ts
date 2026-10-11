import { describe, it, expect, afterEach } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  RUNTIME_ROOT,
  NOTIFICATIONS_DIR,
  SUBAGENT_STORE_DIR,
  DEFAULT_LOG_DIR,
  LOG_ROOT_ENV,
  resolveRuntimeRoot,
  resolveLogRoot,
} from '../runtime-paths.js';

const ENV_KEY = 'FLOW_ENGINE_RUNTIME_ROOT';

describe('机器级运行时目录（%USERPROFILE%/.flow-engine）', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('RUNTIME_ROOT 必须位于 homedir 下，且与 cwd 无关', () => {
    expect(RUNTIME_ROOT).toBe(join(homedir(), '.flow-engine'));
    expect(RUNTIME_ROOT).not.toBe(join(process.cwd(), '.flow-engine'));
  });

  it('notifications / subagent-store 必须平铺在 RUNTIME_ROOT 下（不再嵌套 sflow）', () => {
    expect(NOTIFICATIONS_DIR).toBe(join(RUNTIME_ROOT, 'notifications'));
    expect(SUBAGENT_STORE_DIR).toBe(join(RUNTIME_ROOT, 'subagent-store'));
    expect(NOTIFICATIONS_DIR.includes(`${'.flow-engine'}/sflow`)).toBe(false);
    expect(SUBAGENT_STORE_DIR.includes(`${'.flow-engine'}/sflow`)).toBe(false);
  });

  it('resolveRuntimeRoot 无环境变量时回落到 homedir', () => {
    delete process.env[ENV_KEY];
    expect(resolveRuntimeRoot()).toBe(RUNTIME_ROOT);
  });

  it('resolveRuntimeRoot 支持 FLOW_ENGINE_RUNTIME_ROOT 覆盖（测试隔离用）', () => {
    const override = join(process.cwd(), '__tmp-runtime-root__');
    process.env[ENV_KEY] = override;
    expect(resolveRuntimeRoot()).toBe(override);
  });

  it('FLOW_ENGINE_RUNTIME_ROOT 为空白时忽略', () => {
    process.env[ENV_KEY] = '   ';
    expect(resolveRuntimeRoot()).toBe(RUNTIME_ROOT);
  });
});

describe('日志根（Logger / PollingLogger 共用）', () => {
  afterEach(() => {
    delete process.env[LOG_ROOT_ENV];
  });

  it('DEFAULT_LOG_DIR = %USERPROFILE%/.flow-engine/sflow，与 RUNTIME_ROOT 同源', () => {
    expect(DEFAULT_LOG_DIR).toBe(join(homedir(), '.flow-engine', 'sflow'));
    expect(DEFAULT_LOG_DIR).toBe(join(RUNTIME_ROOT, 'sflow'));
    expect(DEFAULT_LOG_DIR).not.toBe(join(process.cwd(), '.flow-engine', 'sflow'));
  });

  it('resolveLogRoot 无环境变量时回落到 DEFAULT_LOG_DIR', () => {
    delete process.env[LOG_ROOT_ENV];
    expect(resolveLogRoot()).toBe(DEFAULT_LOG_DIR);
  });

  it('resolveLogRoot 显式参数优先于环境变量', () => {
    process.env[LOG_ROOT_ENV] = '/from-env';
    expect(resolveLogRoot('/explicit')).toBe('/explicit');
  });

  it('resolveLogRoot 支持 FLOW_ENGINE_LOG_ROOT 覆盖（测试隔离用）', () => {
    const override = join(process.cwd(), '__tmp-log-root__');
    process.env[LOG_ROOT_ENV] = override;
    expect(resolveLogRoot()).toBe(override);
  });

  it('FLOW_ENGINE_LOG_ROOT 为空白时忽略', () => {
    process.env[LOG_ROOT_ENV] = '   ';
    expect(resolveLogRoot()).toBe(DEFAULT_LOG_DIR);
  });
});