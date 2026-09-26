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
  DEFAULT_PROFILE_MODELS,
} from './config-loader.js';

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
 * Default model for each agent
 * 国产模型默认配置
 */
const DEFAULT_MODELS: Record<BuiltinAgentName, string> = {
  // SFlow — all built-in models use provider/ prefix (actual user config overrides)
  sFlow: 'provider/deepseek-v4-flash',
  'need-explorer': 'provider/kimi-k2.6',
  'spec-writer': 'provider/glm-5.1',
  'contract-builder': 'provider/glm-5.1',
  'build-executor': 'provider/glm-5.1',
  'bug-investigator': 'provider/minimax-m2.7',
  'code-reviewer': 'provider/deepseek-v4-flash',
  'release-archivist': 'provider/mimo-v2.5-pro',
  'spec-merger': 'provider/mimo-v2.5',
  'ui-director': 'provider/glm-5.1',
  'ui-implementer': 'provider/glm-5.1',
  // IFlow
  iFlow: 'provider/deepseek-v4-flash',
  'iflow-discuss-planner': 'provider/kimi-k2.6',
  'iflow-plan-executor': 'provider/step-3.7-flash',
  'iflow-verifier': 'provider/minimax-m2.7',
  'iflow-researcher': 'provider/glm-5.1',
  'iflow-shipper': 'provider/mimo-v2.5-pro',
  // Shared
  'test-engineer': 'provider/deepseek-v4-flash',
  'review-engineer': 'provider/deepseek-v4-flash',
  // Horizontal commands
  'flow-intel': 'provider/glm-5.1',
  'flow-architect': 'provider/glm-5.1',
  'flow-evolve': 'provider/glm-5.1',
  'flow-health': 'provider/glm-5.1',
  'flow-restyle': 'provider/glm-5.1',
};

/**
 * Default fallback models for each agent
 * When the primary model is unavailable, try these in order
 */
const DEFAULT_FALLBACKS: Record<BuiltinAgentName, string[]> = {
  // SFlow — all built-in fallbacks use provider/ prefix
  sFlow: ['provider/glm-5.1', 'provider/kimi-k2.6'],
  'need-explorer': ['provider/glm-5.1', 'provider/deepseek-v4-flash'],
  'spec-writer': ['provider/kimi-k2.6', 'provider/deepseek-v4-flash'],
  'contract-builder': ['provider/glm-5.1', 'provider/deepseek-v4-flash'],
  'build-executor': ['provider/glm-5.1', 'provider/kimi-k2.6'],
  'bug-investigator': ['provider/deepseek-v4-flash', 'provider/glm-5.1'],
  'code-reviewer': ['provider/glm-5.1', 'provider/kimi-k2.6'],
  'release-archivist': ['provider/mimo-v2.5', 'provider/glm-5.1'],
  'spec-merger': ['provider/mimo-v2.5-pro', 'provider/glm-5.1'],
  'ui-director': ['provider/kimi-k2.6', 'provider/deepseek-v4-flash'],
  'ui-implementer': ['provider/kimi-k2.6', 'provider/deepseek-v4-flash'],
  // IFlow
  iFlow: ['provider/glm-5.1', 'provider/kimi-k2.6'],
  'iflow-discuss-planner': ['provider/glm-5.1', 'provider/deepseek-v4-flash'],
  'iflow-plan-executor': ['provider/deepseek-v4-flash', 'provider/glm-5.1'],
  'iflow-verifier': ['provider/deepseek-v4-flash', 'provider/glm-5.1'],
  'iflow-researcher': ['provider/kimi-k2.6', 'provider/deepseek-v4-flash'],
  'iflow-shipper': ['provider/mimo-v2.5', 'provider/glm-5.1'],
  // Shared
  'test-engineer': ['provider/glm-5.1', 'provider/kimi-k2.6'],
  'review-engineer': ['provider/glm-5.1', 'provider/kimi-k2.6'],
  // Horizontal commands
  'flow-intel': ['provider/kimi-k2.6', 'provider/deepseek-v4-flash'],
  'flow-architect': ['provider/kimi-k2.6', 'provider/deepseek-v4-flash'],
  'flow-evolve': ['provider/kimi-k2.6', 'provider/deepseek-v4-flash'],
  'flow-health': ['provider/kimi-k2.6', 'provider/deepseek-v4-flash'],
  'flow-restyle': ['provider/kimi-k2.6', 'provider/deepseek-v4-flash'],
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
  let expireAt = now + (opts?.ttlMs ?? TRANSIENT_COOLDOWN_TTL_MS);
  if (opts?.resetAt !== undefined && opts.resetAt !== null) {
    if (opts.resetAt <= now) {
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
    expireAt = Math.max(now + MIN_QUOTA_COOLDOWN_TTL_MS, opts.resetAt);
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
  | 'system-default';

/**
 * Model resolution result with provenance tracking
 */
export interface ModelResolutionResult {
  model: string;
  provenance: ModelProvenance;
  fallbackAttempted?: string[];
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
 * Build fallback chain in R9 order: per-agent → user tier → default tier → DEFAULT_FALLBACKS
 */
function buildFallbackChain(
  configFallbackList: string[],
  userTierFallbacks: string[],
  defaultTierFallbacks: string[],
  defaultFallbackList: string[],
): string[] {
  return [...configFallbackList, ...userTierFallbacks, ...defaultTierFallbacks, ...defaultFallbackList];
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
 * 3. modelType explicit parameter → use tier model resolution
 * 4. configModel (configOverrides?.[name]?.model) → 'config-override' (skip tier resolution)
 * 5. AGENT_PROFILES[name] static binding → tier model → 'profile'
 * 6. Fallback chain (per-agent → tier → DEFAULT_PROFILE_MODELS → DEFAULT_FALLBACKS)
 * 7. DEFAULT_MODELS[name] → 'system-default'
 *
 * Provenance is tracked to help diagnose model selection issues.
 */
export function resolveModelWithFallback(
  name: BuiltinAgentName,
  model?: string,
  configOverrides?: AgentOverrides,
  overrides?: AgentOverrides,
  profileOptions?: ProfileResolutionOptions,
  modelType?: string,
): ModelResolutionResult {
  const programmaticModel = overrides?.[name]?.model;
  const configModel = configOverrides?.[name]?.model;

  // P1-3: override/param/system-default branches must respect the blacklist —
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
  // When modelType is specified, it overrides per-agent config and AGENT_PROFILES
  if (modelType && VALID_MODEL_TIERS.has(modelType as ModelTier)) {
    const tier = modelType as ModelTier;
    const tierConfig = profileOptions?.modelProfiles?.[tier] ?? DEFAULT_PROFILE_MODELS[tier];
    if (tierConfig?.model) {
      if (isModelAvailable(tierConfig.model)) {
        return { model: tierConfig.model, provenance: 'profile' };
      }
      // Build complete fallback chain for modelType tier
      const userTierFallbacks = tierConfig.fallback_models || [];
      const defaultTierFallbacks = DEFAULT_PROFILE_MODELS[tier]?.fallback_models || [];
      const configFallbackList = normalizeFallbackList(configOverrides?.[name]?.fallback_models);
      const defaultFallbackList = DEFAULT_FALLBACKS[name] || [];

      const fallbacks = buildFallbackChain(configFallbackList, userTierFallbacks, defaultTierFallbacks, defaultFallbackList);
      const result = tryFallbackChain(tierConfig.model, fallbacks);
      
      if (result) {
        return { model: result.model, provenance: 'provider-fallback', fallbackAttempted: result.attempted };
      }
      // All fallbacks exhausted, return system default
      const systemDefault = DEFAULT_MODELS[name];
      return {
        model: systemDefault,
        provenance: 'system-default',
        fallbackAttempted: [tierConfig.model, ...fallbacks],
      };
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

  // Priority 5: AGENT_PROFILES static binding → tier resolution
  let primaryModel: string | undefined;
  const agentProfile = AGENT_PROFILES[name];
  // sflow/iflow enable tier resolution; none/absent skip (backward compatible)
  if ((profileOptions?.activeWorkflow === 'sflow' || profileOptions?.activeWorkflow === 'iflow') && agentProfile) {
    const tierConfig = profileOptions?.modelProfiles?.[agentProfile] ?? DEFAULT_PROFILE_MODELS[agentProfile];
    if (tierConfig?.model) {
      if (isModelAvailable(tierConfig.model)) {
        return { model: tierConfig.model, provenance: 'profile' };
      }
      primaryModel = tierConfig.model; // Remember for fallback chain
    }
  }

  // Priority 6: Fallback chain
  // Build fallback chain in order: per-agent → user tier → default tier → DEFAULT_FALLBACKS
  const configFallback = configOverrides?.[name]?.fallback_models;
  const configFallbackList = normalizeFallbackList(configFallback);

  // Add tier-level fallbacks (if agent has a profile)
  let tierFallbackList: string[] = [];
  if (agentProfile) {
    const userTierFallbacks = profileOptions?.modelProfiles?.[agentProfile]?.fallback_models || [];
    const defaultTierFallbacks = DEFAULT_PROFILE_MODELS[agentProfile]?.fallback_models || [];
    tierFallbackList = [...userTierFallbacks, ...defaultTierFallbacks];
  }

  const defaultFallbackList = DEFAULT_FALLBACKS[name] || [];
  const fallbacks = buildFallbackChain(configFallbackList, tierFallbackList, [], defaultFallbackList);

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

  // Priority 7: System default (P1-3: blacklist-aware "last resort" branch)
  const systemDefault = DEFAULT_MODELS[name];
  if (isModelAvailable(systemDefault)) {
    return {
      model: systemDefault,
      provenance: 'system-default',
      fallbackAttempted: attempted.length > 0 ? attempted : undefined,
    };
  }
  // System default itself blacklisted — try the full fallback chain one last time
  const lastChain = buildAgentFallbackChain(name, configOverrides, profileOptions?.modelProfiles);
  const lastResult = tryFallbackChain(systemDefault, lastChain);
  if (lastResult) {
    return { model: lastResult.model, provenance: 'provider-fallback', fallbackAttempted: lastResult.attempted };
  }
  return {
    model: systemDefault,
    provenance: 'system-default',
    fallbackAttempted: attempted.length > 0 ? attempted : undefined,
  };
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
  let agentConfig = factory(resolved.model, { temperature: resolvedTemperature, skillContent, config });

  if (agentOverride) {
    return {
      ...agentConfig,
      ...agentOverride,
      model: resolved.model,
      id: agentConfig.id,
      name: agentConfig.name,
    };
  }

  agentConfig = applySkillContent(agentConfig, skillContent);

  return agentConfig;
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
    const agentConfig = factory(resolved.model, { temperature: resolvedTemperature, skillContent: content, config });

    if (agentOverride) {
      agents[name] = {
        ...agentConfig,
        ...agentOverride,
        model: resolved.model,
        id: agentConfig.id,
        name: agentConfig.name,
      };
    } else {
      agents[name] = agentConfig;
    }

    agents[name] = applySkillContent(agents[name], content);
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
 * Get default model for agent
 */
export function getDefaultModel(name: BuiltinAgentName): string {
  return DEFAULT_MODELS[name];
}

/**
 * Get all default models
 */
export function getAllDefaultModels(): Record<BuiltinAgentName, string> {
  return { ...DEFAULT_MODELS };
}

/**
 * Get default fallbacks for agent
 */
export function getDefaultFallbacks(name: BuiltinAgentName): string[] {
  return DEFAULT_FALLBACKS[name] ? [...DEFAULT_FALLBACKS[name]] : [];
}

/**
 * Get all default fallbacks
 */
export function getAllDefaultFallbacks(): Record<BuiltinAgentName, string[]> {
  return { ...DEFAULT_FALLBACKS };
}

/**
 * Get an alternative model for cross-model spot-check / fallback.
 *
 * P1-1: reads BOTH the user-configured fallback chain (extraFallbacks, built from
 * configOverrides/modelProfiles via buildAgentFallbackChain) AND DEFAULT_FALLBACKS.
 * Returns the first model that differs from `currentModel` and passes
 * isModelAvailable (blacklist check). Returns null when no alternative exists.
 *
 * Primary use-cases: review-engineer spot-check and runWithModelFallback
 * model switching (P0-4).
 */
export function getAlternativeModel(
  currentModel: string,
  agentName: string,
  extraFallbacks?: string[],
): string | null {
  // User-configured chain first (per docs/模型路由体系.md §四), then DEFAULT_FALLBACKS
  const chain = dedupeModels([...(extraFallbacks ?? []), ...(DEFAULT_FALLBACKS[agentName as BuiltinAgentName] ?? [])]);
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
 * per-agent config fallbacks → user tier fallbacks → default tier fallbacks → DEFAULT_FALLBACKS.
 *
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
  const defaultTierFallbacks = profile
    ? DEFAULT_PROFILE_MODELS[profile]?.fallback_models || []
    : [];
  const defaultFallbackList = DEFAULT_FALLBACKS[name] || [];
  return dedupeModels(
    buildFallbackChain(configFallbackList, userTierFallbacks, defaultTierFallbacks, defaultFallbackList),
  );
}
