/**
 * Config Loader - Load agent configuration from .sflow/config.json
 */
import { access, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { deepMerge } from '@opencode-flow-engine/shared';
import type { BuiltinAgentName, AgentOverrides, AgentOverrideConfig } from './types.js';

export interface AgentConfigEntry {
  model?: string;
  temperature?: number;
  fallbackModels?: string[];
  fallback_models?: string[];
}

export interface ModelProfileConfig {
  mechanical?: string;
  standard?: string;
  strong?: string;
  review?: string;
}

export interface SFlowConfig {
  version?: string;
  mode?: string;
  agents?: Record<string, AgentConfigEntry>;
  features?: Record<string, boolean>;
  hooks?: Record<string, boolean>;
  tools?: Record<string, boolean>;
  modelProfiles?: ModelProfileConfig;
}

/**
 * User-level config path: ~/.config/opencode/opencode-flow-engine.json
 * Follows the same convention as oh-my-openagent which stores its config
 * under ~/.config/opencode/. Override via FLOW_ENGINE_USER_CONFIG_FILE env var.
 */
export const USER_CONFIG_FILE = join(homedir(), '.config', 'opencode', 'opencode-flow-engine.json');

/**
 * Load sflow config from a specific directory's .sflow/config.json
 */
export async function loadSFlowConfig(projectDir?: string): Promise<SFlowConfig> {
  const dir = projectDir || process.cwd();
  const configPath = join(dir, '.sflow', 'config.json');

  try {
    await access(configPath);
  } catch {
    return {};
  }

  try {
    const raw = await readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    console.warn(`[sflow] Failed to parse ${configPath}`);
    return {};
  }
}

/**
 * Load user-level config from ~/.config/opencode/opencode-flow-engine.json
 * (or FLOW_ENGINE_USER_CONFIG_FILE env var override, used in tests).
 */
export async function loadUserSFlowConfig(configPath?: string): Promise<SFlowConfig> {
  const path = configPath || process.env.FLOW_ENGINE_USER_CONFIG_FILE || USER_CONFIG_FILE;

  try {
    await access(path);
  } catch {
    console.warn(`[flow-engine] No user-level config found at ${path}. Run 'sflow init --user' to create one.`);
    return {};
  }

  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    console.warn(`[sflow] Failed to parse user config: ${path}`);
    return {};
  }
}

/**
 * Load cascading config: user-level (~/.config/opencode/opencode-flow-engine.json) as base,
 * project-level (.sflow/config.json) as higher-priority override.
 */
export async function loadCascadedSFlowConfig(projectDir?: string): Promise<SFlowConfig> {
  const user = await loadUserSFlowConfig();
  const project = await loadSFlowConfig(projectDir);

  if (Object.keys(project).length === 0) return user;

  return deepMerge(
    user as Record<string, unknown>,
    project as Record<string, unknown>,
  ) as SFlowConfig;
}

/**
 * Known built-in agent names
 */
const BUILTIN_AGENTS: BuiltinAgentName[] = [
  'sFlow',
  'need-explorer',
  'spec-writer',
  'contract-builder',
  'build-executor',
  'bug-investigator',
  'code-reviewer',
  'release-archivist',
  'spec-merger',
  'iFlow',
  'iflow-discuss-planner',
  'iflow-plan-executor',
  'iflow-verifier',
  'iflow-researcher',
  'iflow-shipper',
];

/**
 * Convert SFlowConfig.agents to AgentOverrides format
 */
export function agentOverridesFromConfig(config: SFlowConfig): AgentOverrides {
  const overrides: AgentOverrides = {};

  // Build case-insensitive lookup: user config may use 'sflow' vs code's 'sFlow'
  const agentsCI = new Map<string, AgentConfigEntry>();
  if (config.agents) {
    for (const [key, val] of Object.entries(config.agents)) {
      agentsCI.set(key.toLowerCase(), val);
    }
  }

  for (const name of BUILTIN_AGENTS) {
    // Try exact match first, then case-insensitive fallback
    const entry = config.agents?.[name] ?? agentsCI.get(name.toLowerCase());
    if (!entry) continue;

    const override: Partial<AgentOverrideConfig> = {};
    if (entry.model) override.model = entry.model;
    if (entry.temperature !== undefined) override.temperature = entry.temperature;
    const fb = entry.fallback_models || entry.fallbackModels;
    if (fb && fb.length > 0) {
      override.fallback_models = fb;
    }

    if (Object.keys(override).length > 0) {
      overrides[name] = override as AgentOverrideConfig;
    }
  }

  return overrides;
}

/**
 * Merge two override configs. Higher-priority wins.
 * Uses proper typing instead of `as any`.
 */
export function mergeOverrides(
  base: AgentOverrides,
  higher: AgentOverrides | undefined,
): AgentOverrides {
  if (!higher) return { ...base };
  const merged: AgentOverrides = { ...base };
  for (const [name, cfg] of Object.entries(higher) as [BuiltinAgentName, AgentOverrideConfig][]) {
    const baseEntry = base[name];
    merged[name] = baseEntry
      ? { ...baseEntry, ...cfg }
      : { ...cfg };
  }
  return merged;
}

/**
 * Generate a config file template with all agents
 */
export function generateConfigTemplate(): SFlowConfig {
  return {
    version: '0.1.0',
    mode: 'full',
    agents: {
      sFlow: {
        model: 'deepseek-v4-flash',
        temperature: 0.6,
        fallback_models: ['glm-5.1', 'kimi-k2.6'],
      },
      'need-explorer': {
        model: 'kimi-k2.6',
        temperature: 0.6,
        fallback_models: ['glm-5.1', 'deepseek-v4-flash'],
      },
      'spec-writer': {
        model: 'glm-5.1',
        temperature: 0.6,
        fallback_models: ['kimi-k2.6', 'deepseek-v4-flash'],
      },
      'contract-builder': {
        model: 'glm-5',
        temperature: 0.6,
        fallback_models: ['glm-5.1', 'deepseek-v4-flash'],
      },
      'build-executor': {
        model: 'step-3.7-flash',
        temperature: 0.7,
        fallback_models: ['deepseek-v4-flash', 'glm-5.1'],
      },
      'bug-investigator': {
        model: 'minimax-m2.7',
        temperature: 0.6,
        fallback_models: ['deepseek-v4-flash', 'glm-5.1'],
      },
      'code-reviewer': {
        model: 'deepseek-v4-flash',
        temperature: 0.6,
        fallback_models: ['glm-5.1', 'kimi-k2.6'],
      },
      'release-archivist': {
        model: 'mimo-v2.5-pro',
        temperature: 0.7,
        fallback_models: ['mimo-v2.5', 'glm-5.1'],
      },
      'spec-merger': {
        model: 'mimo-v2.5',
        temperature: 0.7,
        fallback_models: ['mimo-v2.5-pro', 'glm-5.1'],
      },
      // iFlow agents
      iFlow: {
        model: 'deepseek-v4-flash',
        temperature: 0.6,
        fallback_models: ['glm-5.1', 'kimi-k2.6'],
      },
      'iflow-discuss-planner': {
        model: 'kimi-k2.6',
        temperature: 0.4,
        fallback_models: ['glm-5.1', 'deepseek-v4-flash'],
      },
      'iflow-plan-executor': {
        model: 'step-3.7-flash',
        temperature: 0.5,
        fallback_models: ['deepseek-v4-flash', 'glm-5.1'],
      },
      'iflow-verifier': {
        model: 'minimax-m2.7',
        temperature: 0.3,
        fallback_models: ['deepseek-v4-flash', 'glm-5.1'],
      },
      'iflow-researcher': {
        model: 'glm-5.1',
        temperature: 0.4,
        fallback_models: ['kimi-k2.6', 'deepseek-v4-flash'],
      },
      'iflow-shipper': {
        model: 'mimo-v2.5-pro',
        temperature: 0.4,
        fallback_models: ['mimo-v2.5', 'glm-5.1'],
      },
    },
    features: {
      workflow_manager: true,
      state_manager: true,
    },
    hooks: {
      state_transition: true,
      artifact_validation: true,
      guard: true,
    },
    tools: {
      workflow_router: true,
      contract_validator: true,
      artifact_inspector: true,
    },
    modelProfiles: {
      mechanical: 'fast-cheap-model',
      standard: 'balanced-model',
      strong: 'powerful-model',
      review: 'review-specialized-model',
    },
  };
}
