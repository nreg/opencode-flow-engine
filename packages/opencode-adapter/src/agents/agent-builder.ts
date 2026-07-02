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
 * Create an agent by name
 * Priority chain: AgentOverrides.model > model param > .sflow/config.json > DEFAULT_MODELS
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

  // Model priority: AgentOverrides > model param > config file > default
  const programmaticModel = overrides?.[name]?.model;
  const configModel = configOverrides[name]?.model;
  const resolvedModel = programmaticModel || model || configModel || DEFAULT_MODELS[name];

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

    const programmaticModel = overrides?.[name]?.model;
    const configModel = configOverrides[name]?.model;
    const resolvedModel = programmaticModel || model || configModel || DEFAULT_MODELS[name];

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
