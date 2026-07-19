/**
 * Agent Builder - Factory pattern for creating agents
 * Based on oh-my-openagent's agent builder pattern
 */

import type { AgentConfig } from '@opencode-ai/sdk';
import type { AgentFactory, AgentMode, BuiltinAgentName, AgentOverrides } from './types.js';
import type { SFlowConfig, ModelProfileConfig } from './config-loader.js';
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
  loadCascadedSFlowConfig,
  agentOverridesFromConfig,
  mergeOverrides,
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
};

/**
 * Default model for each agent
 * 国产模型默认配置
 */
const DEFAULT_MODELS: Record<BuiltinAgentName, string> = {
  // SFlow
  sFlow: 'deepseek-v4-flash',
  'need-explorer': 'kimi-k2.6',
  'spec-writer': 'glm-5.1',
  'contract-builder': 'glm-5',
  'build-executor': 'glm-5.1',
  'bug-investigator': 'minimax-m2.7',
  'code-reviewer': 'deepseek-v4-flash',
  'release-archivist': 'mimo-v2.5-pro',
  'spec-merger': 'mimo-v2.5',
  'ui-director': 'glm-5.1',
  'ui-implementer': 'glm-5.1',
  // IFlow
  iFlow: 'deepseek-v4-flash',
  'iflow-discuss-planner': 'kimi-k2.6',
  'iflow-plan-executor': 'step-3.7-flash',
  'iflow-verifier': 'minimax-m2.7',
  'iflow-researcher': 'glm-5.1',
  'iflow-shipper': 'mimo-v2.5-pro',
};

/**
 * Default fallback models for each agent
 * When the primary model is unavailable, try these in order
 */
const DEFAULT_FALLBACKS: Record<BuiltinAgentName, string[]> = {
  // SFlow
  sFlow: ['glm-5.1', 'kimi-k2.6'],
  'need-explorer': ['glm-5.1', 'deepseek-v4-flash'],
  'spec-writer': ['kimi-k2.6', 'deepseek-v4-flash'],
  'contract-builder': ['glm-5.1', 'deepseek-v4-flash'],
  'build-executor': ['glm-5', 'kimi-k2.6'],
  'bug-investigator': ['deepseek-v4-flash', 'glm-5.1'],
  'code-reviewer': ['glm-5.1', 'kimi-k2.6'],
  'release-archivist': ['mimo-v2.5', 'glm-5.1'],
  'spec-merger': ['mimo-v2.5-pro', 'glm-5.1'],
  'ui-director': ['kimi-k2.6', 'deepseek-v4-flash'],
  'ui-implementer': ['kimi-k2.6', 'deepseek-v4-flash'],
  // IFlow
  iFlow: ['glm-5.1', 'kimi-k2.6'],
  'iflow-discuss-planner': ['glm-5.1', 'deepseek-v4-flash'],
  'iflow-plan-executor': ['deepseek-v4-flash', 'glm-5.1'],
  'iflow-verifier': ['deepseek-v4-flash', 'glm-5.1'],
  'iflow-researcher': ['kimi-k2.6', 'deepseek-v4-flash'],
  'iflow-shipper': ['mimo-v2.5', 'glm-5.1'],
};

/**
 * Agent profile mappings — maps each agent to its default model profile.
 * Used by resolveModelWithFallback to resolve model via modelProfiles config.
 */
export type AGENT_PROFILES_TYPE = Record<string, 'mechanical' | 'standard' | 'strong' | 'review'>;

export const AGENT_PROFILES: AGENT_PROFILES_TYPE = {
  // SFlow
  sFlow: 'standard',
  'need-explorer': 'standard',
  'spec-writer': 'strong',
  'contract-builder': 'strong',
  'build-executor': 'strong',
  'bug-investigator': 'strong',
  'code-reviewer': 'review',
  'release-archivist': 'mechanical',
  'spec-merger': 'standard',
  'ui-director': 'strong',
  'ui-implementer': 'standard',
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
 * Resolve model with fallback chain and provenance tracking.
 *
 * Priority: override.model > model param > configModel > profile > fallback > DEFAULT_MODELS[name]
 * Provenance is tracked to help diagnose model selection issues.
 */
export function resolveModelWithFallback(
  name: BuiltinAgentName,
  model?: string,
  configOverrides?: AgentOverrides,
  overrides?: AgentOverrides,
  profileOptions?: ProfileResolutionOptions,
): ModelResolutionResult {
  const programmaticModel = overrides?.[name]?.model;
  const configModel = configOverrides?.[name]?.model;

  if (programmaticModel) {
    return { model: programmaticModel, provenance: 'override' };
  }

  if (model) {
    return { model, provenance: 'override' };
  }

  if (configModel) {
    if (isModelAvailable(configModel)) {
      return { model: configModel, provenance: 'config-override' };
    }
  }

  // Profile resolution step: only when activeWorkflow is sflow
  if (profileOptions?.activeWorkflow === 'sflow' && profileOptions?.modelProfiles) {
    const agentProfile = AGENT_PROFILES[name];
    if (agentProfile && profileOptions.modelProfiles[agentProfile]) {
      const profileModel = profileOptions.modelProfiles[agentProfile]!;
      if (isModelAvailable(profileModel)) {
        return { model: profileModel, provenance: 'profile' };
      }
    }
  }

  const configFallback = configOverrides?.[name]?.fallback_models;
  const configFallbackList = normalizeFallbackList(configFallback);
  const defaultFallbackList = DEFAULT_FALLBACKS[name] || [];
  const fallbacks = [...configFallbackList, ...defaultFallbackList];

  const attempted: string[] = [];
  for (const fbModel of fallbacks) {
    attempted.push(fbModel);
    if (isModelAvailable(fbModel)) {
      return { model: fbModel, provenance: 'provider-fallback', fallbackAttempted: attempted };
    }
  }

  const systemDefault = DEFAULT_MODELS[name];
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
      activeWorkflow: 'sflow',
    });

  // Resolve temperature: override > config > factory default
  const resolvedTemperature = agentOverride?.temperature ?? configOverrides?.[name]?.temperature ?? undefined;
  let agentConfig = factory(resolved.model, { temperature: resolvedTemperature, skillContent });

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
): Promise<Record<BuiltinAgentName, AgentConfig>> {
  const agents: Partial<Record<BuiltinAgentName, AgentConfig>> = {};

  const config = await getCascadedConfig();
  const configOverrides = agentOverridesFromConfig(config);

  for (const name of Object.keys(AGENT_REGISTRY) as BuiltinAgentName[]) {
    const factory = AGENT_REGISTRY[name];

const resolved = resolveModelWithFallback(name, model, configOverrides, overrides, {
    modelProfiles: config.modelProfiles,
    activeWorkflow: 'sflow',
  });

    const content = skillContents?.[name];

    const merged = mergeOverrides(configOverrides, overrides || {});
    const agentOverride = merged[name];
    const resolvedTemperature = agentOverride?.temperature ?? configOverrides?.[name]?.temperature ?? undefined;
    const agentConfig = factory(resolved.model, { temperature: resolvedTemperature, skillContent: content });

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
