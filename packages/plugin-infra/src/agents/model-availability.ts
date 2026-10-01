/**
 * Model Availability — 启动期与 provider 实际可用模型列表对账（P1-4，短期 warning 版）。
 *
 * 设计约束（见 design.md ADR-5）：
 * - 只接收 duck-typed client（含 provider.list()），不 import 具体 SDK 类型，保持 agents 层不反向依赖 tools。
 * - 冷缓存（all 为空）或查询失败时不误报：状态置 'cold' / 'failed'，所有校验与标注静默跳过。
 * - 解析结果标注写入独立字段 unverifiedModels，绝不写入 fallbackAttempted（避免破坏既有 toEqual 断言）。
 * - 本模块只 warn + 标注，不改变解析结果（不跳过无效模型、不提前降级、不阻止注册）。
 */

import { Logger } from '../utils/logger.js';
import type { SFlowConfig } from './config-loader.js';

/** duck-typed client：仅依赖 provider.list()，不 import 具体 SDK client 类型 */
export interface ProviderListClient {
  provider: {
    list(opts?: { query?: { directory?: string } }): Promise<{ data?: unknown }>;
  };
}

export type AvailabilityState = 'cold' | 'ready' | 'failed';

export interface ModelAvailabilitySnapshot {
  state: AvailabilityState;
  knownModels: Set<string>;
  connectedProviders: Set<string>;
}

// ─── 模块级状态（进程级单例，启动期刷新一次） ───────────────────────────────

let availabilityState: AvailabilityState = 'cold';
let knownModels: Set<string> = new Set();
let connectedProviders: Set<string> = new Set();
// 状态说明（cold/failed）只 warn 一次，避免重复刷屏；进入 ready 后重置以便后续失败可再次提示
let statusWarnEmitted = false;

// ─── provider.list 超时保护 ──────────────────────────────────────────────────
// provider.list() 是 HTTP API 调用：OpenCode 服务器尚未就绪时可能长时间挂起，
// 不设超时会阻塞插件 server 函数返回，导致宿主启动卡死。超时按 'failed' 处理。
const PROVIDER_LIST_TIMEOUT_MS = 3_000;

/** 给 promise 附加超时；无论先 settle 的是哪一方，都清理定时器避免泄漏 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function snapshot(): ModelAvailabilitySnapshot {
  return {
    state: availabilityState,
    knownModels,
    connectedProviders,
  };
}

function warnStatusOnce(): void {
  if (statusWarnEmitted) return;
  if (availabilityState === 'cold') {
    void Logger.warn(
      '[model-availability] provider 可用模型列表为空（cold），跳过启动期配置模型校验',
    );
  } else if (availabilityState === 'failed') {
    void Logger.warn(
      '[model-availability] 获取 provider 可用模型列表失败（failed），跳过启动期配置模型校验',
    );
  }
  statusWarnEmitted = true;
}

/**
 * 拉取 provider 可用模型集合并刷新状态机。
 * MUST NOT 抛出：任何异常（网络/解析/超时）都被捕获、置 'failed' 并 warn。
 */
export async function refreshAvailableModels(
  client: ProviderListClient,
): Promise<ModelAvailabilitySnapshot> {
  try {
    const raw = await withTimeout(
      client.provider.list(),
      PROVIDER_LIST_TIMEOUT_MS,
      'provider.list',
    );
    const data =
      raw && typeof raw === 'object' && 'data' in raw
        ? (raw as { data?: unknown }).data
        : undefined;

    if (!data || typeof data !== 'object' || !Array.isArray((data as { all?: unknown }).all)) {
      availabilityState = 'cold';
      warnStatusOnce();
      return snapshot();
    }

    const all = (data as { all: unknown[] }).all;
    const connected = Array.isArray((data as { connected?: unknown }).connected)
      ? (data as { connected: string[] }).connected
      : [];

    const known = new Set<string>();
    let modelCount = 0;
    for (const p of all) {
      if (!p || typeof p !== 'object' || !(p as { id?: unknown }).id) continue;
      const models = (p as { models?: Record<string, unknown> }).models;
      if (!models || typeof models !== 'object') continue;
      const providerId = String((p as { id: unknown }).id);
      for (const modelId of Object.keys(models)) {
        known.add(`${providerId}/${modelId}`);
        modelCount += 1;
      }
    }

    if (modelCount === 0) {
      availabilityState = 'cold';
      warnStatusOnce();
    } else {
      knownModels = known;
      connectedProviders = new Set(connected);
      availabilityState = 'ready';
      // 进入 ready：允许后续若失败再提示一次
      statusWarnEmitted = false;
    }
    return snapshot();
  } catch {
    availabilityState = 'failed';
    warnStatusOnce();
    return snapshot();
  }
}

/** 缓存状态机：'cold'（未刷新/空）| 'ready'（至少一个 provider 且模型集合非空）| 'failed'（查询异常） */
export function getAvailabilityState(): AvailabilityState {
  return availabilityState;
}

/**
 * 'ready' 时返回模型是否已知；其余状态返回 undefined（不下判断，调用方应静默跳过）。
 */
export function isModelKnown(model: string): boolean | undefined {
  if (availabilityState !== 'ready') return undefined;
  return knownModels.has(model);
}

/** validateConfiguredModels 的返回结构（命名导出，供 description 降级提示接线复用） */
export interface ModelValidation {
  unknown: string[];
  unconnected: string[];
}

/**
 * W6/D1（方案 B）：启动对账完成后，若某 agent 的用户配置链上所有模型都在对账中
 * 被判为 unknown / unconnected（全链不可用），生成追加到 description 末尾的降级提示。
 *
 * 约束（对齐 design.md ADR-5 / 方案 B）：
 * - 只在 state='ready' 时生效；cold/failed（对账不可信）返回 null，不加提示。
 * - 提示文案为静态事实陈述（"启动对账：配置的模型 X、Y 当前未在 provider 可用列表中确认。"），
 *   不推荐替代模型、不引入硬编码链/默认模型、不做任何正则匹配（C-5/C-6）。
 * - 链为空（用户未配置任何模型）时返回 null——对账没有可陈述的事实。
 *
 * @param chain 调用方算好的用户配置链（主模型 + 各级 fallback，已去重）
 * @param validation validateConfiguredModels 的返回值
 * @returns 提示文案；无需提示时返回 null
 */
export function buildChainUnavailableNotice(
  chain: string[],
  validation: ModelValidation,
): string | null {
  // 对账不可信（cold/failed）时不加提示
  if (availabilityState !== 'ready') return null;
  // 用户未配置任何模型 → 无对账事实可陈述
  if (chain.length === 0) return null;

  const unavailable = new Set<string>([...validation.unknown, ...validation.unconnected]);
  // 部分可用 → 不加提示（只有全链不可用才陈述事实）
  if (!chain.every((m) => unavailable.has(m))) return null;

  return `启动对账：配置的模型 ${chain.join('、')} 当前未在 provider 可用列表中确认。`;
}

/** 本地 fallback_models 规范化（与 agent-builder#normalizeFallbackList 等价，仅读 model 字段） */
function normalizeFallbackList(fb: string | (string | { model: string })[] | undefined): string[] {
  if (!fb) return [];
  if (typeof fb === 'string') return [fb];
  return fb.map((item) => (typeof item === 'string' ? item : item.model));
}

/** 从 SFlowConfig 收集所有配置出现的模型串（agents 段 + modelProfiles 各 tier） */
function collectConfiguredModels(config: SFlowConfig): string[] {
  const models: string[] = [];

  if (config.agents && typeof config.agents === 'object') {
    for (const entry of Object.values(config.agents)) {
      if (!entry) continue;
      if (entry.model) models.push(entry.model);
      const fbs = normalizeFallbackList(
        (entry as { fallback_models?: string | (string | { model: string })[] }).fallback_models ??
          (entry as { fallbackModels?: string | (string | { model: string })[] }).fallbackModels,
      );
      models.push(...fbs);
    }
  }

  if (config.modelProfiles && typeof config.modelProfiles === 'object') {
    for (const tier of Object.values(config.modelProfiles)) {
      if (!tier) continue;
      if (tier.model) models.push(tier.model);
      if (Array.isArray(tier.fallback_models)) models.push(...tier.fallback_models);
    }
  }

  return models;
}

/**
 * 遍历配置中的模型串，对未知模型 / 未连接 provider 各打一次 Logger.warn（按模型串去重），
 * 并返回 unknown / unconnected 两个去重列表。
 * 内部先 refresh 一次（冷缓存/失败时不误报，直接返回空数组）。
 */
export async function validateConfiguredModels(
  client: ProviderListClient,
  config: SFlowConfig,
): Promise<{ unknown: string[]; unconnected: string[] }> {
  await refreshAvailableModels(client);

  // 冷缓存 / 失败：静默跳过判断（不 warn 具体模型、不误报）
  if (availabilityState !== 'ready') {
    return { unknown: [], unconnected: [] };
  }

  const candidates = collectConfiguredModels(config);
  const unknown: string[] = [];
  const unconnected: string[] = [];
  const seen = new Set<string>();

  for (const m of candidates) {
    if (seen.has(m)) continue;
    seen.add(m);

    // 判定顺序：先未知模型，再未连接 provider（同一模型串最多归入一类）
    if (!knownModels.has(m)) {
      unknown.push(m);
      void Logger.warn(`[model-availability] 配置的模型不在 provider 可用列表中: ${m}`);
      continue;
    }

    const slashIdx = m.indexOf('/');
    const providerId = slashIdx >= 0 ? m.slice(0, slashIdx) : '';
    if (providerId && !connectedProviders.has(providerId)) {
      unconnected.push(m);
      void Logger.warn(`[model-availability] 配置的模型所属 provider 未连接: ${m}`);
    }
  }

  return { unknown, unconnected };
}

/** 供测试重置（不影响生产单例语义，仅测试用） */
export function resetModelAvailability(): void {
  availabilityState = 'cold';
  knownModels = new Set();
  connectedProviders = new Set();
  statusWarnEmitted = false;
}
