/**
 * Agent Builder - Factory pattern for creating agents
 * Based on oh-my-openagent's agent builder pattern
 */

import type { AgentConfig } from '@opencode-ai/sdk';
import type { AgentFactory, AgentMode, BuiltinAgentName, AgentOverrides } from './types.js';
import type { SFlowConfig } from './config-loader.js';
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
} from './index.js';
import {
  loadCascadedSFlowConfig,
  agentOverridesFromConfig,
  mergeOverrides,
} from './config-loader.js';

/**
 * Agent mode registry — explicit mapping instead of static property on function
 * This avoids the unsafe pattern of assigning .mode to a function object
 */
const AGENT_MODES: Record<BuiltinAgentName, AgentMode> = {
  sflow: 'primary',
  'need-explorer': 'subagent',
  'spec-writer': 'subagent',
  'contract-builder': 'subagent',
  'build-executor': 'subagent',
  'bug-investigator': 'subagent',
  'code-reviewer': 'subagent',
  'release-archivist': 'subagent',
  'spec-merger': 'subagent',
};

/**
 * Default model for each agent
 * 国产模型默认配置
 */
const DEFAULT_MODELS: Record<BuiltinAgentName, string> = {
  sflow: 'deepseek-v4-flash',
  'need-explorer': 'kimi-k2.6',
  'spec-writer': 'glm-5.1',
  'contract-builder': 'glm-5',
  'build-executor': 'step-3.7-flash',
  'bug-investigator': 'minimax-m2.7',
  'code-reviewer': 'deepseek-v4-flash',
  'release-archivist': 'mimo-v2.5-pro',
  'spec-merger': 'mimo-v2.5',
};

/**
 * Default fallback models for each agent
 * When the primary model is unavailable, try these in order
 */
const DEFAULT_FALLBACKS: Record<BuiltinAgentName, string[]> = {
  sflow: ['glm-5.1', 'kimi-k2.6'],
  'need-explorer': ['glm-5.1', 'deepseek-v4-flash'],
  'spec-writer': ['kimi-k2.6', 'deepseek-v4-flash'],
  'contract-builder': ['glm-5.1', 'deepseek-v4-flash'],
  'build-executor': ['deepseek-v4-flash', 'glm-5.1'],
  'bug-investigator': ['deepseek-v4-flash', 'glm-5.1'],
  'code-reviewer': ['glm-5.1', 'kimi-k2.6'],
  'release-archivist': ['mimo-v2.5', 'glm-5.1'],
  'spec-merger': ['mimo-v2.5-pro', 'glm-5.1'],
};

/**
 * Agent registry with factory functions
 */
const AGENT_REGISTRY: Record<BuiltinAgentName, AgentFactory> = {
  sflow: createSFlowAgent,
  'need-explorer': createNeedExplorerAgent,
  'spec-writer': createSpecWriterAgent,
  'contract-builder': createContractBuilderAgent,
  'build-executor': createBuildExecutorAgent,
  'bug-investigator': createBugInvestigatorAgent,
  'code-reviewer': createCodeReviewerAgent,
  'release-archivist': createReleaseArchivistAgent,
  'spec-merger': createSpecMergerAgent,
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
 * Set of known-unavailable models (populated at runtime when a model request fails).
 * External callers can register a model as unavailable via markModelUnavailable().
 */
const UNAVAILABLE_MODELS = new Set<string>();

/**
 * Mark a model as unavailable (e.g. after an API error).
 * Once marked, resolveModelWithFallback will skip it and try fallbacks.
 */
export function markModelUnavailable(model: string): void {
  UNAVAILABLE_MODELS.add(model);
}

/**
 * Clear the unavailable-model set (e.g. for testing or after a refresh).
 */
export function clearUnavailableModels(): void {
  UNAVAILABLE_MODELS.clear();
}

/**
 * Check whether a model is currently considered available.
 */
function isModelAvailable(model: string): boolean {
  return !UNAVAILABLE_MODELS.has(model);
}

/**
 * Resolve model with fallback chain.
 *
 * Priority: override.model > model param > configModel > DEFAULT_MODELS[name]
 * If the resolved model is unavailable, try fallback_models in order:
 *   config fallback_models > DEFAULT_FALLBACKS[name]
 * Returns the first available model, or the last-resort default if all fail.
 */
export function resolveModelWithFallback(
  name: BuiltinAgentName,
  model?: string,
  configOverrides?: AgentOverrides,
  overrides?: AgentOverrides,
): string {
  const programmaticModel = overrides?.[name]?.model;
  const configModel = configOverrides?.[name]?.model;
  const primary = programmaticModel || model || configModel || DEFAULT_MODELS[name];

  if (isModelAvailable(primary)) {
    return primary;
  }

  // Collect fallback list: config fallback_models first, then defaults
  const configFallback = configOverrides?.[name]?.fallback_models;
  const configFallbackList = normalizeFallbackList(configFallback);
  const defaultFallbackList = DEFAULT_FALLBACKS[name] || [];
  const fallbacks = [...configFallbackList, ...defaultFallbackList];

  for (const fbModel of fallbacks) {
    if (isModelAvailable(fbModel)) {
      return fbModel;
    }
  }

  // All fallbacks exhausted — return primary anyway (let the caller handle the error)
  return primary;
}

/**
 * Normalize fallback_models to a flat string array.
 * The type allows string | (string | { model: string; variant?: string })[].
 */
function normalizeFallbackList(
  fb: string | (string | { model: string; variant?: string })[] | undefined,
): string[] {
  if (!fb) return [];
  if (typeof fb === 'string') return [fb];
  return fb.map(item => typeof item === 'string' ? item : item.model);
}

/**
 * Create an agent by name
 * Priority chain: AgentOverrides.model > model param > .sflow/config.json > DEFAULT_MODELS
 * Falls back through fallback_models if the resolved model is unavailable.
 */
export async function createAgent(
  name: BuiltinAgentName,
  model?: string,
  overrides?: AgentOverrides,
  skillContent?: string,
): Promise<AgentConfig> {
  const factory = AGENT_REGISTRY[name];
  if (!factory) {
    throw new Error(`Unknown agent: ${name}`);
  }

  const config = await getCascadedConfig();
  const configOverrides = agentOverridesFromConfig(config);

  // Merge config + programmatic overrides
  const merged = mergeOverrides(configOverrides, overrides || {});
  const agentOverride = merged[name];

  // Resolve model with fallback chain
  const resolvedModel = resolveModelWithFallback(name, model, configOverrides, overrides);

  const agentConfig = factory(resolvedModel);

  // Use skill content if provided (from unified SkillLoader)
  if (skillContent) {
    agentConfig.instructions = skillContent;
  }

  if (agentOverride) {
    return {
      ...agentConfig,
      ...agentOverride,
      model: resolvedModel,
      id: agentConfig.id,
      name: agentConfig.name,
    };
  }

  return agentConfig;
}

/**
 * Create all agents
 */
export async function createAllAgents(
  model?: string,
  overrides?: AgentOverrides,
  skillContents?: Record<string, string>,
): Promise<Record<BuiltinAgentName, AgentConfig>> {
  const agents: Partial<Record<BuiltinAgentName, AgentConfig>> = {};

  const config = await getCascadedConfig();
  const configOverrides = agentOverridesFromConfig(config);

  for (const name of Object.keys(AGENT_REGISTRY) as BuiltinAgentName[]) {
    const factory = AGENT_REGISTRY[name];

    const resolvedModel = resolveModelWithFallback(name, model, configOverrides, overrides);

    const agentConfig = factory(resolvedModel);

    // Use skill content from SkillLoader if available
    const content = skillContents?.[name];
    if (content) {
      agentConfig.instructions = content;
    }

    const merged = mergeOverrides(configOverrides, overrides || {});
    const agentOverride = merged[name];

    if (agentOverride) {
      agents[name] = {
        ...agentConfig,
        ...agentOverride,
        model: resolvedModel,
        id: agentConfig.id,
        name: agentConfig.name,
      };
    } else {
      agents[name] = agentConfig;
    }
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
