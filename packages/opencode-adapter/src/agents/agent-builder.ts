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
import { getSkillContentWithoutFrontmatter } from '../features/skill-loader.js';
import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve package root by looking for package.json
 */
function resolvePackageRoot(): string {
  let current = resolve(__dirname, '..');
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    current = resolve(current, '..');
  }
  return resolve(__dirname, '..', '..', '..', '..');
}

const PACKAGE_ROOT = resolvePackageRoot();

/**
 * Load skill content from skills/<name>/SKILL.md if it exists.
 * Returns the content without frontmatter, or null if unavailable.
 */
function loadSkillInstructions(name: string): string | null {
  const skillFile = join(PACKAGE_ROOT, 'skills', name, 'SKILL.md');
  try {
    if (existsSync(skillFile)) {
      const content = readFileSync(skillFile, 'utf-8');
      return getSkillContentWithoutFrontmatter(content);
    }
  } catch {
    // Silently fall back to hardcoded instructions
  }
  return null;
}

/**
 * Cached config to avoid redundant file I/O
 */
let _cascadedConfigCache: SFlowConfig | null = null;

async function getCascadedConfig() {
  if (!_cascadedConfigCache) {
    _cascadedConfigCache = await loadCascadedSFlowConfig();
  }
  return _cascadedConfigCache;
}

export function clearConfigCache(): void {
  _cascadedConfigCache = null;
}

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
 * Default model for each agent
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
 * Create an agent by name
 * Priority chain: AgentOverrides.model > model param > .sflow/config.json > DEFAULT_MODELS
 */
export async function createAgent(
  name: BuiltinAgentName,
  model?: string,
  overrides?: AgentOverrides
): Promise<AgentConfig> {
  const factory = AGENT_REGISTRY[name];
  if (!factory) {
    throw new Error(`Unknown agent: ${name}`);
  }

  const config = await getCascadedConfig();
  const configOverrides = agentOverridesFromConfig(config);

  // Merge config + programmatic overrides for non-model fields
  const merged = mergeOverrides(configOverrides, overrides || {});
  const agentOverride = merged[name];

  // Model priority: AgentOverrides > model param > config file > default
  const programmaticModel = overrides?.[name]?.model;
  const configModel = configOverrides[name]?.model;
  const resolvedModel = programmaticModel || model || configModel || DEFAULT_MODELS[name];

  const agentConfig = factory(resolvedModel);

  // Load SKILL.md content as instructions if available
  const skillContent = loadSkillInstructions(name);
  if (skillContent) {
    agentConfig.instructions = skillContent;
  }

  if (agentOverride) {
    return {
      ...agentConfig,
      ...agentOverride,
      model: resolvedModel, // preserve correct priority: overrides > param > config > default
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
  overrides?: AgentOverrides
): Promise<Record<BuiltinAgentName, AgentConfig>> {
  const agents: Record<string, AgentConfig> = {};

  const config = await getCascadedConfig();
  const configOverrides = agentOverridesFromConfig(config);

  for (const name of Object.keys(AGENT_REGISTRY) as BuiltinAgentName[]) {
    const factory = AGENT_REGISTRY[name];

    const programmaticModel = overrides?.[name]?.model;
    const configModel = configOverrides[name]?.model;
    const resolvedModel = programmaticModel || model || configModel || DEFAULT_MODELS[name];

    const agentConfig = factory(resolvedModel);

    // Load SKILL.md content as instructions if available
    const skillContent = loadSkillInstructions(name);
    if (skillContent) {
      agentConfig.instructions = skillContent;
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
 * Get agent mode
 */
export function getAgentMode(name: BuiltinAgentName): AgentMode {
  const factory = AGENT_REGISTRY[name];
  return factory?.mode || 'subagent';
}

/**
 * Get primary agents (mode === 'primary')
 */
export function getPrimaryAgents(): BuiltinAgentName[] {
  return getAgentNames().filter(name => getAgentMode(name) === 'primary');
}

/**
 * Get subagent agents (mode === 'subagent')
 */
export function getSubagentAgents(): BuiltinAgentName[] {
  return getAgentNames().filter(name => getAgentMode(name) === 'subagent');
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
