/**
 * Wave 3 / Task 3.5 — 工厂层采样参数接线测试（R-5，SP-14..SP-18）
 *
 * 覆盖 4 处 cfg.agent[name] 接线点：
 *   F1 sflow-plugin-factory.ts        → SP-14
 *   F2 combined-plugin-factory.ts     → SP-15
 *   F3 iflow-plugin-factory.ts（专属） → SP-16
 *   F4 iflow-plugin-factory.ts（共享） → SP-17
 *   SP-18 旧配置回归（零回归锚）
 *
 * 隔离要点：server() 首行即 loadCascadedSFlowConfig()，因此必须先写配置文件
 * → 设 FLOW_ENGINE_USER_CONFIG_FILE → clearConfigCache() → 再调 server()。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { PluginInput } from '@opencode-ai/plugin';
import { clearConfigCache } from '../agents/agent-builder.js';

const TEMP_DIR = process.env.TEMP || '/tmp';
const CONFIG_FILE = join(TEMP_DIR, 'opencode-flow-engine-plugin-factory-sampling-test.json');

/** 最小 PluginInput：只需 client/directory 被工厂 server() 读取 */
function makePluginInput(directory: string): PluginInput {
  return {
    // provider.list() 抛错 → model-availability 状态机置 'failed' → 静默跳过校验
    client: {
      provider: {
        list: async () => {
          throw new Error('test: provider.list not available');
        },
      },
    },
    project: { id: 'test-project' },
    directory,
    worktree: directory,
    experimental_workspace: { register: () => {} },
    serverUrl: new URL('http://localhost:1'),
    $: undefined as never,
  } as unknown as PluginInput;
}

/** 写入隔离配置并清缓存（server() 会立即读配置） */
function useConfig(config: Record<string, unknown>): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  process.env.FLOW_ENGINE_USER_CONFIG_FILE = CONFIG_FILE;
  clearConfigCache();
}

describe('工厂层采样参数接线（Wave 3 · R-5 · SP-14..SP-18）', () => {
  beforeEach(() => {
    useConfig({ agents: {} });
  });

  afterEach(() => {
    try {
      unlinkSync(CONFIG_FILE);
    } catch {
      // 未写文件时忽略
    }
    delete process.env.FLOW_ENGINE_USER_CONFIG_FILE;
    clearConfigCache();
  });

  // ─── SP-14: sflow 工厂透传 ──────────────────────────────────────────────
  it('SP-14: sflow 工厂透传 top_p 与 variant', async () => {
    useConfig({
      agents: { 'spec-writer': { model: 'test-provider/spec-model', top_p: 0.9, variant: 'thinking' } },
    });

    const { createSFlowPluginModule } = await import('../sflow-plugin-factory.js');
    const hooks = await createSFlowPluginModule().server(makePluginInput(TEMP_DIR));

    const cfg: Record<string, unknown> = { agent: {} };
    await hooks.config?.(cfg as never);

    const agent = (cfg.agent as Record<string, Record<string, unknown>>)['spec-writer'];
    expect(agent).toBeDefined();
    expect(agent.top_p).toBe(0.9);
    expect(agent.variant).toBe('thinking');
  });

  // ─── SP-15: combined 工厂透传 ───────────────────────────────────────────
  it('SP-15: combined 工厂透传 top_p 与 variant', async () => {
    useConfig({
      agents: { 'spec-writer': { model: 'test-provider/spec-model', top_p: 0.9, variant: 'thinking' } },
    });

    const { createCombinedPluginModule } = await import('../combined-plugin-factory.js');
    const hooks = await createCombinedPluginModule().server(makePluginInput(TEMP_DIR));

    const cfg: Record<string, unknown> = { agent: {} };
    await hooks.config?.(cfg as never);

    const agent = (cfg.agent as Record<string, Record<string, unknown>>)['spec-writer'];
    expect(agent).toBeDefined();
    expect(agent.top_p).toBe(0.9);
    expect(agent.variant).toBe('thinking');
  });

  // ─── SP-16: iflow 专属智能体透传 ─────────────────────────────────────────
  it('SP-16: iflow 专属智能体透传 top_p 与 variant', async () => {
    useConfig({
      agents: {
        'iflow-plan-executor': { model: 'test-provider/iflow-model', top_p: 0.7, variant: 'max' },
      },
    });

    const { createIFlowPluginModule } = await import('../iflow-plugin-factory.js');
    const hooks = await createIFlowPluginModule().server(makePluginInput(TEMP_DIR));

    const cfg: Record<string, unknown> = { agent: {} };
    await hooks.config?.(cfg as never);

    const agent = (cfg.agent as Record<string, Record<string, unknown>>)['iflow-plan-executor'];
    expect(agent).toBeDefined();
    expect(agent.top_p).toBe(0.7);
    expect(agent.variant).toBe('max');
  });

  // ─── SP-17: 共享智能体 per-agent 配置可达（F4 第二注册循环，字段级合并） ────
  //
  // FU-1 更新（方案 A）：BUILTIN_AGENTS 白名单已扩展 7 个共享智能体
  // （config-loader.ts:254-271），agentOverridesFromConfig 现在会为共享智能体
  // 生成 per-agent override，F4 共享循环（iflow-plugin-factory.ts:361-402）经
  // override?.temperature/top_p/variant 与 createAgent Priority 4
  // config-override（agent-builder.ts:389/454-473）透传全部字段。
  // 原「per-agent 不可达」实证记录已过时，本用例改为钉死可达行为：
  //   ① per-agent model 覆盖 AGENT_PROFILES review 档位（Priority 4 > Priority 5）
  //   ② per-agent temperature/top_p 覆盖档位同名字段（字段级合并）
  //   ③ variant 不再恒 undefined
  //   ④ fallback_models 生效于模型解析链（cfg.agent 键集合不新增键，不泄漏）
  it('SP-17: 共享智能体 per-agent 配置可达（F4 第二注册循环，字段级合并）', async () => {
    useConfig({
      modelProfiles: {
        review: { model: 'test-provider/tier-model', fallback_models: [], top_p: 0.6, temperature: 0.5 },
      },
      agents: {
        'test-engineer': {
          model: 'test-provider/agent-model',
          temperature: 0.2,
          top_p: 0.8,
          variant: 'max',
          fallback_models: ['test-provider/fb-1'],
        },
      },
    });

    const { createIFlowPluginModule } = await import('../iflow-plugin-factory.js');
    const hooks = await createIFlowPluginModule().server(makePluginInput(TEMP_DIR));

    const cfg: Record<string, unknown> = { agent: {} };
    await hooks.config?.(cfg as never);

    const agent = (cfg.agent as Record<string, Record<string, unknown>>)['test-engineer'];
    expect(agent).toBeDefined();
    // F4 独有锚：共享循环 description 固定含 "(shared, cross-workflow)"
    // （iflow-plugin-factory.ts:392），确认走的是第二注册循环
    expect(agent.description).toContain('shared, cross-workflow');
    // ① per-agent model 覆盖 AGENT_PROFILES review 档位（Priority 4 config-override）
    expect(agent.model).toBe('test-provider/agent-model');
    // ② 字段级合并：per-agent temperature/top_p 覆盖档位同名字段
    expect(agent.temperature).toBe(0.2);
    expect(agent.top_p).toBe(0.8);
    // ③ variant 不再恒 undefined
    expect(agent.variant).toBe('max');
    // ④ fallback_models 不作为 cfg.agent 键泄漏（键集合仍为 9 键）
    expect(Object.keys(agent).sort()).toEqual(
      ['color', 'description', 'mode', 'model', 'prompt', 'temperature', 'tools', 'top_p', 'variant'].sort(),
    );
  });

  // ─── SP-18: 旧配置回归 ──────────────────────────────────────────────────
  it('SP-18: 旧配置（无新字段）下两字段为 undefined，既有字段保持原值', async () => {
    useConfig({
      agents: {
        'spec-writer': { model: 'test-provider/spec-model', temperature: 0.4 },
        'iflow-plan-executor': { model: 'test-provider/iflow-model', temperature: 0.5 },
        'test-engineer': { model: 'test-provider/shared-model', temperature: 0.6 },
      },
    });

    const { createSFlowPluginModule } = await import('../sflow-plugin-factory.js');
    const hooks = await createSFlowPluginModule().server(makePluginInput(TEMP_DIR));

    const cfg: Record<string, unknown> = { agent: {} };
    await hooks.config?.(cfg as never);

    const agent = (cfg.agent as Record<string, Record<string, unknown>>)['spec-writer'];
    expect(agent).toBeDefined();
    // 新字段：未配置 → undefined（不写入任何等异形值）
    expect(agent.top_p).toBeUndefined();
    expect(agent.variant).toBeUndefined();
    // 既有字段：保持原值
    expect(agent.model).toBe('test-provider/spec-model');
    expect(agent.temperature).toBe(0.4);
    expect(typeof agent.prompt).toBe('string');
    expect(typeof agent.mode).toBe('string');
    expect(typeof agent.description).toBe('string');
    // 既有键集合未被新字段之外的键污染
    expect(Object.keys(agent).sort()).toEqual(
      ['color', 'description', 'mode', 'model', 'prompt', 'temperature', 'tools', 'top_p', 'variant'].sort(),
    );
  });

  // ─── SP-18 补充：F2/F3/F4 旧配置键集合回归锚（Gate-3 P2-①） ────────────
  //
  // 上方 SP-18 仅实例化 createSFlowPluginModule()（F1 路径）。F2/F3/F4 若误写
  // 默认值（如 variant: override?.variant ?? 'thinking'），旧配置下新字段会出现
  // 非 undefined 值。本参数化锚对三个此前未覆盖的工厂路径逐一断言：
  //   ① top_p / variant 均为 undefined（无默认值泄漏）
  //   ② 注册对象键集合与 F1 同构（9 键；新字段键存在但值为 undefined，
  //      且不被新字段之外的键污染）
  //
  // 可达路径（按各工厂实际注册循环）：
  //   F2 combined-plugin-factory.ts  → getAgentNames() 全量循环
  //   F3 iflow-plugin-factory.ts     → IFLOW_AGENT_NAMES 专属循环
  //   F4 iflow-plugin-factory.ts     → SHARED_AGENT_NAMES 共享循环（第二注册循环）
  const SP18_OLD_CONFIG = {
    agents: {
      'spec-writer': { model: 'test-provider/spec-model', temperature: 0.4 },
      'iflow-plan-executor': { model: 'test-provider/iflow-model', temperature: 0.5 },
      'test-engineer': { model: 'test-provider/shared-model', temperature: 0.6 },
    },
  };

  /** 四个工厂路径的 cfg.agent[name] 注册对象形状一致（9 键） */
  const SP18_EXPECTED_KEYS = [
    'color', 'description', 'mode', 'model', 'prompt', 'temperature', 'tools', 'top_p', 'variant',
  ];

  const SP18_FACTORY_CASES = [
    {
      label: 'F2 combined 工厂',
      agent: 'spec-writer',
      register: async () => {
        const { createCombinedPluginModule } = await import('../combined-plugin-factory.js');
        return createCombinedPluginModule().server(makePluginInput(TEMP_DIR));
      },
    },
    {
      label: 'F3 iflow 专属循环',
      agent: 'iflow-plan-executor',
      register: async () => {
        const { createIFlowPluginModule } = await import('../iflow-plugin-factory.js');
        return createIFlowPluginModule().server(makePluginInput(TEMP_DIR));
      },
    },
    {
      label: 'F4 iflow 共享循环',
      agent: 'test-engineer',
      register: async () => {
        const { createIFlowPluginModule } = await import('../iflow-plugin-factory.js');
        return createIFlowPluginModule().server(makePluginInput(TEMP_DIR));
      },
    },
  ];

  for (const testCase of SP18_FACTORY_CASES) {
    it(`SP-18: 旧配置回归 — ${testCase.label} 新字段 undefined 且键集合无污染`, async () => {
      useConfig(SP18_OLD_CONFIG);

      const hooks = await testCase.register();

      const cfg: Record<string, unknown> = { agent: {} };
      await hooks.config?.(cfg as never);

      const agent = (cfg.agent as Record<string, Record<string, unknown>>)[testCase.agent];
      expect(agent).toBeDefined();
      // 新字段：旧配置（无 top_p/variant）下不得出现任何默认值
      expect(agent.top_p).toBeUndefined();
      expect(agent.variant).toBeUndefined();
      // 键集合锚：与 F1 同构的 9 键；新字段键存在但值为 undefined，
      // 且不被新字段之外的键污染（防误加 fallback_models 等）
      expect(Object.keys(agent).sort()).toEqual([...SP18_EXPECTED_KEYS].sort());
    });
  }
});