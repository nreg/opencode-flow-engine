/**
 * Agent Builder - Factory pattern for creating agents
 * Based on oh-my-openagent's agent builder pattern
 */

import type { AgentConfig } from '@opencode-ai/sdk';
import type { AgentFactory, AgentMode, BuiltinAgentName, AgentOverrides } from './types.js';
import type { SFlowConfig, ModelProfileConfig } from './config-loader.js';

/**
 * Model tier names (6-tier system)
 */
export type ModelTier = 'lite' | 'quick' | 'standard' | 'deep' | 'ultra' | 'review';

/**
 * Valid model tier set for validation
 */
export const VALID_MODEL_TIERS: Set<ModelTier> = new Set(['lite', 'quick', 'standard', 'deep', 'ultra', 'review']);
import {
  createSFlowAgent,
  createNeedExplorerAgent,
  createSpecWriterAgent,
  createContractBuilderAgent,
  createBuildExecutorAgent,
  createBugInvestigatorAgent,
  createCodeReviewerAgent,
  createReleaseArchivistAgent,
  createSpecMergerAgent,
  createUiDirectorAgent,
  createUiImplementerAgent,
} from '../../../../workflows/sflow/index.js';
import {
  createIFlowAgent,
  createIFlowDiscussPlannerAgent,
  createIFlowPlanExecutorAgent,
  createIFlowVerifierAgent,
  createIFlowResearcherAgent,
  createIFlowShipperAgent,
} from '../../../../workflows/iflow/index.js';
import {
  createTestEngineerAgent,
  createReviewEngineerAgent,
  createFlowArchitectAgent,
  createFlowEvolveAgent,
  createFlowIntelAgent,
  createFlowHealthAgent,
  createFlowRestyleAgent,
} from '../../../../workflows/shared/index.js';
import {
  loadCascadedSFlowConfig,
  agentOverridesFromConfig,
  mergeOverrides,
} from './config-loader.js';
import { Logger } from '../utils/logger.js';
import { getAvailabilityState, isModelKnown, buildChainUnavailableNotice, type ModelValidation } from './model-availability.js';

/**
 * Agent mode registry — explicit mapping instead of static property on function
 * This avoids the unsafe pattern of assigning .mode to a function object
 */
const AGENT_MODES: Record<BuiltinAgentName, AgentMode> = {
  // SFlow
  sFlow: 'primary',
  'need-explorer': 'subagent',
  'spec-writer': 'subagent',
  'contract-builder': 'subagent',
  'build-executor': 'subagent',
  'bug-investigator': 'subagent',
  'code-reviewer': 'subagent',
  'release-archivist': 'subagent',
  'spec-merger': 'subagent',
  'ui-director': 'subagent',
  'ui-implementer': 'subagent',
  // IFlow
  iFlow: 'primary',
  'iflow-discuss-planner': 'subagent',
  'iflow-plan-executor': 'subagent',
  'iflow-verifier': 'subagent',
  'iflow-researcher': 'subagent',
  'iflow-shipper': 'subagent',
  // Shared (cross-workflow, standalone)
  'test-engineer': 'subagent',
  'review-engineer': 'subagent',
  // Horizontal commands (cross-workflow, standalone)
  'flow-intel': 'subagent',
  'flow-architect': 'subagent',
  'flow-evolve': 'subagent',
  'flow-health': 'subagent',
  'flow-restyle': 'subagent',
};

/**
 * Agent profile mappings — maps each agent to its default model profile.
 * Used by resolveModelWithFallback to resolve model via modelProfiles config.
 * 
 * 6-tier system: lite, quick, standard, deep, ultra, review
 * - lite, ultra: dynamic routing targets, no static binding
 * - quick, standard, deep, review: static agent bindings
 * - sFlow, iFlow: primary agents, NOT in AGENT_PROFILES (bypass tier resolution)
 */
export type AGENT_PROFILES_TYPE = Record<string, ModelTier>;

export const AGENT_PROFILES: AGENT_PROFILES_TYPE = {
  // quick tier - mechanical execution, archive, explore
  'release-archivist': 'quick',
  'iflow-shipper': 'quick', // IFlow workflow agent
  
  // standard tier - regular subtasks
  'need-explorer': 'standard',
  'ui-director': 'standard',
  'spec-merger': 'standard',
  'flow-intel': 'standard',
  'flow-evolve': 'standard',
  'iflow-discuss-planner': 'standard', // IFlow workflow agent
  'iflow-researcher': 'standard', // IFlow workflow agent
  
  // deep tier - code execution, complex tasks
  'spec-writer': 'deep',
  'contract-builder': 'deep',
  'build-executor': 'deep',
  'bug-investigator': 'deep',
  'ui-implementer': 'deep',
  'flow-architect': 'deep',
  'flow-restyle': 'deep',
  'iflow-plan-executor': 'deep', // IFlow workflow agent
  
  // review tier - review tasks
  'code-reviewer': 'review',
  'test-engineer': 'review',
  'review-engineer': 'review',
  'flow-health': 'review',
  'iflow-verifier': 'review', // IFlow workflow agent
};

/**
 * Agent registry with factory functions
 */
const AGENT_REGISTRY: Record<BuiltinAgentName, AgentFactory> = {
  // SFlow
  sFlow: createSFlowAgent,
  'need-explorer': createNeedExplorerAgent,
  'spec-writer': createSpecWriterAgent,
  'contract-builder': createContractBuilderAgent,
  'build-executor': createBuildExecutorAgent,
  'bug-investigator': createBugInvestigatorAgent,
  'code-reviewer': createCodeReviewerAgent,
  'release-archivist': createReleaseArchivistAgent,
  'spec-merger': createSpecMergerAgent,
  'ui-director': createUiDirectorAgent,
  'ui-implementer': createUiImplementerAgent,
  // IFlow
  iFlow: createIFlowAgent,
  'iflow-discuss-planner': createIFlowDiscussPlannerAgent,
  'iflow-plan-executor': createIFlowPlanExecutorAgent,
  'iflow-verifier': createIFlowVerifierAgent,
  'iflow-researcher': createIFlowResearcherAgent,
  'iflow-shipper': createIFlowShipperAgent,
  // Shared (cross-workflow, standalone)
  'test-engineer': createTestEngineerAgent,
  'review-engineer': createReviewEngineerAgent,
  // Horizontal commands (cross-workflow, standalone)
  'flow-intel': createFlowIntelAgent,
  'flow-architect': createFlowArchitectAgent,
  'flow-evolve': createFlowEvolveAgent,
  'flow-health': createFlowHealthAgent,
  'flow-restyle': createFlowRestyleAgent,
};

/**
 * Cached config to avoid redundant file I/O
 */
let _cascadedConfigCache: SFlowConfig | null = null;
let _cascadedConfigTimestamp = 0;
const CONFIG_CACHE_TTL_MS = 30_000; // 30 seconds

async function getCascadedConfig() {
  const now = Date.now();
  if (_cascadedConfigCache && now - _cascadedConfigTimestamp < CONFIG_CACHE_TTL_MS) {
    return _cascadedConfigCache;
  }
  _cascadedConfigCache = await loadCascadedSFlowConfig();
  _cascadedConfigTimestamp = now;
  return _cascadedConfigCache;
}

export function clearConfigCache(): void {
  _cascadedConfigCache = null;
  _cascadedConfigTimestamp = 0;
}

/**
 * Known-unavailable models with TTL (populated at runtime when a model request fails).
 * Key: model string, Value: expireAt epoch ms (TTL-based, see markModelUnavailable).
 * External callers can register a model as unavailable via markModelUnavailable().
 *
 * P0-2/P1-4: TTL-based blacklist — transient errors get a short cooldown;
 * quota/rate-limit errors (with reset time) get a long cooldown until the reset time.
 */
const UNAVAILABLE_MODELS = new Map<string, number>();

/** Default cooldown TTL for transient model failures (5 minutes) */
export const TRANSIENT_COOLDOWN_TTL_MS = 5 * 60_000;
/** Minimum long-cooldown TTL for quota/rate-limit failures (30 minutes) */
export const MIN_QUOTA_COOLDOWN_TTL_MS = 30 * 60_000;
/** Maximum long-cooldown TTL cap (7 days) — guards against absurd reset times */
export const MAX_QUOTA_COOLDOWN_TTL_MS = 7 * 24 * 3600_000;

/**
 * Mark a model as unavailable (e.g. after an API error).
 *
 * Once marked, resolveModelWithFallback / isModelAvailable will skip it and
 * try fallbacks until the cooldown TTL expires.
 *
 * P0-2: quota/rate-limit failures pass the parsed `resetAt` (epoch ms) so the
 * model stays blacklisted until the reset time (long cooldown), instead of a
 * fixed short TTL. Transient failures use the default short TTL.
 *
 * NEW-P0-A: 单调合并语义 —— 同一模型多次 markModelUnavailable 时取更长的
 * expireAt（max），短冷却不会覆盖已写入的长冷却（配额错误 → 重置时间）。
 */
export function markModelUnavailable(
  model: string,
  opts?: { resetAt?: number | null; ttlMs?: number },
): void {
  const now = Date.now();
  // NP-1: resetAt 非有限值（NaN 等）不得进入黑名单链路——
  // Math.max(NaN, x) = NaN、Date.now() >= NaN = false 会使模型进程内永久拉黑，
  // 且后续正确的 mark（max 合并）也无法救回。退化为默认 TTL。
  const resetAt =
    opts?.resetAt !== undefined && opts?.resetAt !== null && Number.isFinite(opts.resetAt)
      ? opts.resetAt
      : undefined;
  let expireAt = now + (opts?.ttlMs ?? TRANSIENT_COOLDOWN_TTL_MS);
  if (resetAt !== undefined) {
    if (resetAt <= now) {
      // R3-P2-2: delete 语义保守化 —— 陈旧/误判（如裸 UTC 落本地时区解释）解析出的
      // 过去时刻 resetAt 不得抹掉在效的长冷却（单调合并语义不被绕过）。
      // 仅当无在效条目（或条目已过期）时才删除。
      const existing = UNAVAILABLE_MODELS.get(model);
      if (existing !== undefined && existing > now) {
        return;
      }
      // Reset time already passed and no active cooldown — model is available
      UNAVAILABLE_MODELS.delete(model);
      return;
    }
    // Long cooldown: at least MIN_QUOTA_COOLDOWN, until the reset time, capped at MAX
    expireAt = Math.max(now + MIN_QUOTA_COOLDOWN_TTL_MS, resetAt);
    expireAt = Math.min(expireAt, now + MAX_QUOTA_COOLDOWN_TTL_MS);
  }
  // NEW-P0-A: 单调合并 —— 已记录的更长 TTL 不被后续短 TTL 覆盖
  const existing = UNAVAILABLE_MODELS.get(model) ?? 0;
  UNAVAILABLE_MODELS.set(model, Math.max(existing, expireAt));
}

/**
 * Clear the unavailable-model set (e.g. for testing or after a refresh).
 */
export function clearUnavailableModels(): void {
  UNAVAILABLE_MODELS.clear();
}

/**
 * Check whether a model is currently considered available.
 * Lazily removes entries whose TTL has expired (P1-4: 黑名单按 TTL 过期).
 */
export function isModelAvailable(model: string): boolean {
  const expireAt = UNAVAILABLE_MODELS.get(model);
  if (expireAt === undefined) return true;
  if (Date.now() >= expireAt) {
    UNAVAILABLE_MODELS.delete(model);
    return true;
  }
  return false;
}

/**
 * Normalize fallback_models to a flat string array.
 */
function normalizeFallbackList(
  fb: string | (string | { model: string; variant?: string })[] | undefined,
): string[] {
  if (!fb) return [];
  if (typeof fb === 'string') return [fb];
  return fb.map(item => typeof item === 'string' ? item : item.model);
}

/**
 * Model resolution provenance — traces how a model was selected.
 */
export type ModelProvenance =
  | 'override'
  | 'config-override'
  | 'profile'
  | 'provider-fallback'
  | 'unconfigured';

/**
 * Model resolution result with provenance tracking
 */
export interface ModelResolutionResult {
  model: string | undefined;
  provenance: ModelProvenance;
  fallbackAttempted?: string[];
  /**
   * P1-4：启动期与 provider 可用列表对账后，若最终 model 不在已知列表中且状态为 ready，
   * 标注该模型。独立字段，不复用 fallbackAttempted（后者语义为"已尝试的降级链"，
   * model-profiles.test.ts 对其有 toEqual 断言）。
   * 本轮只 warn + 标注，不改变解析结果。
   */
  unverifiedModels?: string[];
}

/**
 * Options for profile-based model resolution.
 * Passed to resolveModelWithFallback when modelProfiles config is available.
 */
export interface ProfileResolutionOptions {
  modelProfiles?: ModelProfileConfig;
  activeWorkflow?: 'iflow' | 'sflow' | 'none';
}

/**
 * Build fallback chain: per-agent config fallbacks → user tier fallbacks.
 * No built-in/default fallbacks are appended (Wave 2: only user-configured models).
 */
function buildFallbackChain(
  configFallbackList: string[],
  userTierFallbacks: string[],
): string[] {
  return [...configFallbackList, ...userTierFallbacks];
}

/**
 * Try fallback chain and return first available model.
 */
function tryFallbackChain(
  primaryModel: string,
  fallbacks: string[],
): { model: string; attempted: string[] } | null {
  const attempted: string[] = [primaryModel];
  for (const fbModel of fallbacks) {
    attempted.push(fbModel);
    if (isModelAvailable(fbModel)) {
      return { model: fbModel, attempted };
    }
  }
  return null;
}

/**
 * Resolve model with fallback chain and provenance tracking.
 *
 * Priority chain (from highest to lowest):
 * 1. Programmatic override (overrides?.[name]?.model) → 'override'
 * 2. model parameter → 'override'
 * 3. modelType explicit parameter → use tier model resolution (user-configured only)
 * 4. configModel (configOverrides?.[name]?.model) → 'config-override' (skip tier resolution)
 * 5. AGENT_PROFILES[name] static binding → user tier model → 'profile'
 * 6. Fallback chain (per-agent config → user tier fallbacks)
 * 7. Chain tail → { model: undefined, provenance: 'unconfigured' }
 *
 * NOTE (Wave 2): resolution reads ONLY user configuration (modelProfiles / per-agent
 * overrides). There is no built-in default model or default fallback list — when no
 * user model is configured, resolution degrades gracefully to 'unconfigured'.
 *
 * Provenance is tracked to help diagnose model selection issues.
 */
function resolveModelWithFallbackCore(
  name: BuiltinAgentName,
  model?: string,
  configOverrides?: AgentOverrides,
  overrides?: AgentOverrides,
  profileOptions?: ProfileResolutionOptions,
  modelType?: string,
): ModelResolutionResult {
  const programmaticModel = overrides?.[name]?.model;
  const configModel = configOverrides?.[name]?.model;

  // P1-3: override/param branches must respect the blacklist —
  // unavailable models fall through to the next priorities instead of being
  // returned blindly (otherwise every dispatch keeps using the failed model).

  // Priority 1: Programmatic override
  if (programmaticModel && isModelAvailable(programmaticModel)) {
    return { model: programmaticModel, provenance: 'override' };
  }

  // Priority 2: model parameter
  if (model && isModelAvailable(model)) {
    return { model, provenance: 'override' };
  }

  // Priority 3: modelType parameter (highest priority tier signal)
  // When modelType is specified, it overrides per-agent config and AGENT_PROFILES.
  // Resolution reads ONLY user-configured modelProfiles[tier] (no built-in default).
  if (modelType && VALID_MODEL_TIERS.has(modelType as ModelTier)) {
    const tier = modelType as ModelTier;
    const tierConfig = profileOptions?.modelProfiles?.[tier];
    if (tierConfig?.model) {
      if (isModelAvailable(tierConfig.model)) {
        return { model: tierConfig.model, provenance: 'profile' };
      }
      // Build fallback chain from the user-configured tier fallback list + per-agent config
      const userTierFallbacks = tierConfig.fallback_models || [];
      const configFallbackList = normalizeFallbackList(configOverrides?.[name]?.fallback_models);

      const fallbacks = buildFallbackChain(configFallbackList, userTierFallbacks);
      const result = tryFallbackChain(tierConfig.model, fallbacks);

      if (result) {
        return { model: result.model, provenance: 'provider-fallback', fallbackAttempted: result.attempted };
      }
      // Tier model + its fallbacks exhausted → fall through to lower priorities
    }
  }

  // Priority 4: configModel (per-agent override, used when no modelType specified)
  if (configModel) {
    if (isModelAvailable(configModel)) {
      return { model: configModel, provenance: 'config-override' };
    }
    // configModel unavailable, try per-agent fallbacks first
    const configFallbackList = normalizeFallbackList(configOverrides?.[name]?.fallback_models);
    const attempted: string[] = [configModel];
    for (const fbModel of configFallbackList) {
      attempted.push(fbModel);
      if (isModelAvailable(fbModel)) {
        return { model: fbModel, provenance: 'provider-fallback', fallbackAttempted: attempted };
      }
    }
    // per-agent fallbacks exhausted, continue to tier resolution
  }

  // Priority 5: AGENT_PROFILES static binding → user tier model resolution
  let primaryModel: string | undefined;
  const agentProfile = AGENT_PROFILES[name];
  // sflow/iflow enable tier resolution; none/absent skip (backward compatible)
  //
  // [P2-2 作用域声明] 该门控的作用域是「档位解析」——即是否读取 modelProfiles[tier].model 作为
  // 档位主模型。它**不**门控下方 P6 对 modelProfiles[tier].fallback_models 的收集：tier 级
  // fallback_models 是用户显式配置的 fallback 链，不是内置档位兜底，因此即使 activeWorkflow 为
  // 'none'/缺省（档位解析被跳过），P6 仍会返回该 fallback 模型，provenance 为 'provider-fallback'。
  // 该行为为有意保留，由 model-profiles.test.ts 的 gating 组用例钉死，修改前请先确认该用例意图。
  if ((profileOptions?.activeWorkflow === 'sflow' || profileOptions?.activeWorkflow === 'iflow') && agentProfile) {
    const tierConfig = profileOptions?.modelProfiles?.[agentProfile];
    if (tierConfig?.model) {
      if (isModelAvailable(tierConfig.model)) {
        return { model: tierConfig.model, provenance: 'profile' };
      }
      primaryModel = tierConfig.model; // Remember for fallback chain
    }
  }

  // Priority 6: Fallback chain (per-agent config → user tier fallbacks; no built-in defaults)
  const configFallback = configOverrides?.[name]?.fallback_models;
  const configFallbackList = normalizeFallbackList(configFallback);

  // Add tier-level fallbacks (if agent has a profile) from user-configured modelProfiles only
  //
  // [P2-2 作用域声明] 此处**不受** activeWorkflow 门控影响：P5 的 gate 只决定档位主模型是否被读取，
  // fallback 链一旦由用户显式配置即无条件生效。故「用户仅配 modelProfiles[tier].fallback_models
  // 而未配 model」+ activeWorkflow='none'/缺省 的组合，会在此走到下面的 fallback 直接尝试分支，
  // 返回该 fallback 模型且 provenance='provider-fallback'（而非 'unconfigured'）。
  // 这是有意保留的行为，非内置兜底：模型来源始终是用户配置。
  let tierFallbackList: string[] = [];
  if (agentProfile) {
    const userTierFallbacks = profileOptions?.modelProfiles?.[agentProfile]?.fallback_models || [];
    tierFallbackList = [...userTierFallbacks];
  }

  const fallbacks = buildFallbackChain(configFallbackList, tierFallbackList);

  let attempted: string[] = [];
  if (primaryModel) {
    const result = tryFallbackChain(primaryModel, fallbacks);
    if (result) {
      return { model: result.model, provenance: 'provider-fallback', fallbackAttempted: result.attempted };
    }
    attempted = [primaryModel, ...fallbacks];
  } else {
    // No primary model, try fallbacks directly
    for (const fbModel of fallbacks) {
      attempted.push(fbModel);
      if (isModelAvailable(fbModel)) {
        return { model: fbModel, provenance: 'provider-fallback', fallbackAttempted: attempted };
      }
    }
  }

  // Priority 7: Chain tail — no user model configured → graceful degradation
  return {
    model: undefined,
    provenance: 'unconfigured',
    fallbackAttempted: attempted.length > 0 ? attempted : undefined,
  };
}

/**
 * 启动期模型配置存在性标注（P1-4）。
 * 仅当 availability 状态为 'ready' 且最终 model 不在已知列表中时，标注 unverifiedModels 并 warn。
 * 不改变解析结果（model / provenance / fallbackAttempted 语义完全不变）。
 * 冷缓存 / 失败状态下静默跳过（不误报）。
 */
function annotateModelAvailability(result: ModelResolutionResult): ModelResolutionResult {
  if (getAvailabilityState() !== 'ready') return result;
  const model = result.model;
  if (model === undefined) return result;
  if (isModelKnown(model) !== false) return result;
  void Logger.warn(`[model-availability] 配置的模型不在 provider 可用列表中: ${model}`);
  return { ...result, unverifiedModels: [model] };
}

/**
 * Resolve model with fallback chain and provenance tracking (P1-4: 薄包装 + 标注).
 *
 * 对外导出签名保持不变——原函数体整体下沉为 resolveModelWithFallbackCore（内部 7 处 return 零改动），
 * 此层仅做 unverifiedModels 标注。详见 annotateModelAvailability。
 */
export function resolveModelWithFallback(
  name: BuiltinAgentName,
  model?: string,
  configOverrides?: AgentOverrides,
  overrides?: AgentOverrides,
  profileOptions?: ProfileResolutionOptions,
  modelType?: string,
): ModelResolutionResult {
  const result = resolveModelWithFallbackCore(
    name,
    model,
    configOverrides,
    overrides,
    profileOptions,
    modelType,
  );
  return annotateModelAvailability(result);
}

/**
 * Append skill content to agent instructions if not already present.
 */
function applySkillContent(agentConfig: AgentConfig, skillContent?: string): AgentConfig {
  if (!skillContent) return agentConfig;
  const instructions: string = String(agentConfig.instructions || agentConfig.prompt || '');
  if (!instructions.includes('Skill-Specific Instructions')) {
    agentConfig.instructions = instructions + '\n\n---\n\n## Skill-Specific Instructions\n\n' + skillContent;
  }
  return agentConfig;
}


export async function createAgent(
  name: BuiltinAgentName,
  model?: string,
  overrides?: AgentOverrides,
  skillContent?: string,
  activeWorkflow?: 'sflow' | 'iflow' | 'none',
): Promise<AgentConfig> {
  const factory = AGENT_REGISTRY[name];
  if (!factory) {
    throw new Error(`Unknown agent: ${name}`);
  }

  const config = await getCascadedConfig();
  const configOverrides = agentOverridesFromConfig(config);

  const merged = mergeOverrides(configOverrides, overrides || {});
  const agentOverride = merged[name];

  const resolved = resolveModelWithFallback(name, model, configOverrides, overrides, {
      modelProfiles: config.modelProfiles,
      activeWorkflow: activeWorkflow ?? 'sflow',
    });

  // Resolve temperature: override > config > factory default
  const resolvedTemperature = agentOverride?.temperature ?? configOverrides?.[name]?.temperature ?? undefined;
  // Wave 2: resolved.model may be undefined (unconfigured). Pass it through to the factory
  // and ensure we do NOT write a `model` field when no model was resolved.
  const agentConfig = factory(resolved.model as string, { temperature: resolvedTemperature, skillContent, config });

  if (agentOverride) {
    const result: AgentConfig = {
      ...agentConfig,
      ...agentOverride,
      id: agentConfig.id,
      name: agentConfig.name,
    };
    if (resolved.model !== undefined) {
      result.model = resolved.model;
    } else if ('model' in result) {
      delete (result as Partial<AgentConfig>).model;
    }
    return result;
  }

  const finalConfig = applySkillContent(agentConfig, skillContent);
  if (resolved.model === undefined && 'model' in finalConfig) {
    delete (finalConfig as Partial<AgentConfig>).model;
  }

  return finalConfig;
}

/**
 * Create all agents
 */
export async function createAllAgents(
  model?: string,
  overrides?: AgentOverrides,
  skillContents?: Record<string, string>,
  activeWorkflow?: 'sflow' | 'iflow' | 'none',
): Promise<Record<BuiltinAgentName, AgentConfig>> {
  const agents: Partial<Record<BuiltinAgentName, AgentConfig>> = {};

  const config = await getCascadedConfig();
  const configOverrides = agentOverridesFromConfig(config);

  for (const name of Object.keys(AGENT_REGISTRY) as BuiltinAgentName[]) {
    const factory = AGENT_REGISTRY[name];

    const resolved = resolveModelWithFallback(name, model, configOverrides, overrides, {
      modelProfiles: config.modelProfiles,
      activeWorkflow: activeWorkflow ?? 'sflow',
    });

    const content = skillContents?.[name];

    const merged = mergeOverrides(configOverrides, overrides || {});
    const agentOverride = merged[name];
    const resolvedTemperature = agentOverride?.temperature ?? configOverrides?.[name]?.temperature ?? undefined;
    const agentConfig = factory(resolved.model as string, { temperature: resolvedTemperature, skillContent: content, config });

    let finalAgent: AgentConfig;
    if (agentOverride) {
      finalAgent = {
        ...agentConfig,
        ...agentOverride,
        id: agentConfig.id,
        name: agentConfig.name,
      };
      if (resolved.model !== undefined) {
        finalAgent.model = resolved.model;
      } else if ('model' in finalAgent) {
        delete (finalAgent as Partial<AgentConfig>).model;
      }
    } else {
      finalAgent = agentConfig;
      if (resolved.model === undefined && 'model' in finalAgent) {
        delete (finalAgent as Partial<AgentConfig>).model;
      }
    }

    agents[name] = applySkillContent(finalAgent, content);
  }

  return agents as Record<BuiltinAgentName, AgentConfig>;
}

/**
 * Get agent by name
 */
export function getAgent(name: BuiltinAgentName): AgentFactory | undefined {
  return AGENT_REGISTRY[name];
}

/**
 * Get all agent names
 */
export function getAgentNames(): BuiltinAgentName[] {
  return Object.keys(AGENT_REGISTRY) as BuiltinAgentName[];
}

/**
 * Get agent mode — reads from explicit registry, not from function static property
 */
export function getAgentMode(name: BuiltinAgentName): AgentMode {
  return AGENT_MODES[name] || 'subagent';
}

/**
 * Get primary agents (mode === 'primary')
 */
export function getPrimaryAgents(): BuiltinAgentName[] {
  return getAgentNames().filter(name => AGENT_MODES[name] === 'primary');
}

/**
 * Get subagent agents (mode === 'subagent')
 */
export function getSubagentAgents(): BuiltinAgentName[] {
  return getAgentNames().filter(name => AGENT_MODES[name] === 'subagent');
}

/**
 * Check if agent exists
 */
export function agentExists(name: string): name is BuiltinAgentName {
  return name in AGENT_REGISTRY;
}

/**
 * Get an alternative model for cross-model spot-check / fallback.
 *
 * Wave 2: reads ONLY the explicitly-provided user-configured fallback chain
 * (`extraFallbacks`, normally built from configOverrides/modelProfiles via
 * buildAgentFallbackChain). There is no built-in default list. Returns the first
 * model that differs from `currentModel` and passes isModelAvailable (blacklist
 * check). Returns null when no alternative exists.
 *
 * Primary use-cases: review-engineer spot-check and runWithModelFallback
 * model switching (P0-4).
 */
export function getAlternativeModel(
  currentModel: string,
  _agentName: string,
  extraFallbacks?: string[],
): string | null {
  const chain = dedupeModels([...(extraFallbacks ?? [])]);
  for (const fb of chain) {
    if (fb !== currentModel && isModelAvailable(fb)) {
      return fb;
    }
  }
  return null;
}

/**
 * Dedupe a model list while preserving order.
 */
function dedupeModels(models: string[]): string[] {
  return [...new Set(models)];
}

/**
 * Build the complete user-configurable fallback chain for an agent
 * (per docs/模型路由体系.md §四 order):
 * per-agent config fallbacks → user tier fallbacks.
 *
 * Wave 2: no built-in default tier fallbacks or default fallback list are appended.
 * Used by getAlternativeModel callers (call-flow-agent) so model switching
 * respects the same fallback sources as resolveModelWithFallback.
 */
export function buildAgentFallbackChain(
  name: BuiltinAgentName,
  configOverrides?: AgentOverrides,
  modelProfiles?: ModelProfileConfig,
): string[] {
  const profile = AGENT_PROFILES[name];
  const configFallbackList = normalizeFallbackList(configOverrides?.[name]?.fallback_models);
  const userTierFallbacks = profile
    ? normalizeFallbackList(modelProfiles?.[profile]?.fallback_models)
    : [];
  return dedupeModels(buildFallbackChain(configFallbackList, userTierFallbacks));
}

/**
 * W6/D1（方案 B）：启动对账完成后，给"用户配置链全不可用"的 agent 在其 description
 * 末尾追加对账事实提示。
 *
 * 用户配置链 = 主模型（per-agent config 或绑定 tier 的主模型）+ 各级 fallback，
 * 与 resolveModelWithFallback 的候选来源完全一致（只读用户配置，不引入硬编码链）。
 * 命中 buildChainUnavailableNotice 时追加提示；否则原样返回 baseDescription。
 *
 * 语义：只陈述事实、不推荐替代模型、不改写模型绑定、不阻断注册（C-5/C-6）。
 *
 * @param baseDescription 工厂侧原有 description（可能为 undefined）
 * @param name agent 名
 * @param config 级联配置（agents 段 + modelProfiles 段，均为用户配置）
 * @param validation validateConfiguredModels 的返回值
 * @returns 追加提示后的 description；无提示时原样返回 baseDescription
 */
export function appendChainUnavailableNotice(
  baseDescription: string | undefined,
  name: BuiltinAgentName,
  config: SFlowConfig,
  validation: ModelValidation,
): string | undefined {
  const configOverrides = agentOverridesFromConfig(config);
  const modelProfiles = config.modelProfiles;

  const chain: string[] = [];
  const profile = AGENT_PROFILES[name];
  // 主模型：per-agent config 优先，其次绑定 tier 的主模型
  const primaryModel = configOverrides[name]?.model ?? (profile ? modelProfiles?.[profile]?.model : undefined);
  if (primaryModel) chain.push(primaryModel);
  // 各级 fallback：复用 buildAgentFallbackChain 的候选来源（去重保序）
  chain.push(...buildAgentFallbackChain(name, configOverrides, modelProfiles));

  const notice = buildChainUnavailableNotice(chain, validation);
  if (!notice) return baseDescription;
  return baseDescription ? `${baseDescription}\n${notice}` : notice;
}
