/**
 * Config Loader - Load agent configuration from .sflow/config.json
 */
import { readFileSync, existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { BuiltinAgentName, AgentOverrides } from './types.js';

export interface AgentConfigEntry {
  model?: string;
  temperature?: number;
  fallbackModels?: string[];
}

export interface SFlowConfig {
  version?: string;
  mode?: string;
  agents?: Record<string, AgentConfigEntry>;
  features?: Record<string, boolean>;
  hooks?: Record<string, boolean>;
  tools?: Record<string, boolean>;
}

/**
 * User-level config path: ~/.sFlow/config.json
 */
export const USER_CONFIG_FILE = join(homedir(), '.sFlow', 'config.json');

/**
 * Load sFlow config from a specific directory's .sflow/config.json
 */
export async function loadSFlowConfig(projectDir?: string): Promise<SFlowConfig> {
  const dir = projectDir || process.cwd();
  const configPath = join(dir, '.sflow', 'config.json');

  if (!existsSync(configPath)) {
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
 * Load user-level config from ~/.sFlow/config.json
 */
export async function loadUserSFlowConfig(): Promise<SFlowConfig> {
  if (!existsSync(USER_CONFIG_FILE)) {
    return {};
  }

  try {
    const raw = await readFile(USER_CONFIG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    console.warn(`[sflow] Failed to parse user config: ${USER_CONFIG_FILE}`);
    return {};
  }
}

/**
 * Load cascading config: user-level (~/.sFlow/config.json) as base,
 * project-level (.sflow/config.json) as higher-priority override.
 */
export async function loadCascadedSFlowConfig(projectDir?: string): Promise<SFlowConfig> {
  const user = await loadUserSFlowConfig();
  const project = await loadSFlowConfig(projectDir);

  // If no project config, return user config as-is
  if (Object.keys(project).length === 0) return user;

  // Merge: user as base, project overrides on top
  const mergedAgents: Record<string, AgentConfigEntry> = {};

  // Start with all user agents
  for (const [name, cfg] of Object.entries(user.agents || {})) {
    mergedAgents[name] = { ...cfg };
  }
  // Overlay project agents (field-level merge per agent)
  for (const [name, cfg] of Object.entries(project.agents || {})) {
    mergedAgents[name] = { ...(mergedAgents[name] || {}), ...cfg };
  }

  return {
    ...user,
    ...project,
    agents: mergedAgents,
    features: { ...(user.features || {}), ...(project.features || {}) },
    hooks: { ...(user.hooks || {}), ...(project.hooks || {}) },
    tools: { ...(user.tools || {}), ...(project.tools || {}) },
  };
}

/**
 * Known built-in agent names
 */
const BUILTIN_AGENTS: BuiltinAgentName[] = [
  'sflow',
  'need-explorer',
  'spec-writer',
  'contract-builder',
  'build-executor',
  'bug-investigator',
  'code-reviewer',
  'release-archivist',
  'spec-merger',
];

/**
 * Convert SFlowConfig.agents to AgentOverrides format
 * Only includes fields that actually differ from defaults
 */
export function agentOverridesFromConfig(config: SFlowConfig): AgentOverrides {
  const overrides: AgentOverrides = {};

  for (const name of BUILTIN_AGENTS) {
    const entry = config.agents?.[name];
    if (!entry) continue;

    const override: Record<string, unknown> = {};
    if (entry.model) override.model = entry.model;
    if (entry.temperature !== undefined) override.temperature = entry.temperature;
    if (entry.fallbackModels && entry.fallbackModels.length > 0) {
      override.fallback_models = entry.fallbackModels;
    }

    if (Object.keys(override).length > 0) {
      overrides[name] = override;
    }
  }

  return overrides;
}

/**
 * Merge two override configs. Higher-priority wins.
 */
export function mergeOverrides(
  base: AgentOverrides,
  higher: AgentOverrides | undefined
): AgentOverrides {
  if (!higher) return { ...base };
  const merged: AgentOverrides = { ...base };
  for (const [name, cfg] of Object.entries(higher) as [BuiltinAgentName, unknown][]) {
    merged[name] = { ...(base[name] || {}), ...(cfg as Record<string, unknown>) } as any;
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
      sflow: {
        model: 'deepseek-v4-flash',
        temperature: 0.6,
        fallbackModels: ['glm-5.1', 'kimi-k2.6'],
      },
      'need-explorer': {
        model: 'kimi-k2.6',
        temperature: 0.6,
        fallbackModels: ['glm-5.1', 'deepseek-v4-flash'],
      },
      'spec-writer': {
        model: 'glm-5.1',
        temperature: 0.6,
        fallbackModels: ['kimi-k2.6', 'deepseek-v4-flash'],
      },
      'contract-builder': {
        model: 'glm-5',
        temperature: 0.6,
        fallbackModels: ['glm-5.1', 'deepseek-v4-flash'],
      },
      'build-executor': {
        model: 'step-3.7-flash',
        temperature: 0.7,
        fallbackModels: ['deepseek-v4-flash', 'glm-5.1'],
      },
      'bug-investigator': {
        model: 'minimax-m2.7',
        temperature: 0.6,
        fallbackModels: ['deepseek-v4-flash', 'glm-5.1'],
      },
      'code-reviewer': {
        model: 'deepseek-v4-flash',
        temperature: 0.6,
        fallbackModels: ['glm-5.1', 'kimi-k2.6'],
      },
      'release-archivist': {
        model: 'mimo-v2.5-pro',
        temperature: 0.7,
        fallbackModels: ['mimo-v2.5', 'glm-5.1'],
      },
      'spec-merger': {
        model: 'mimo-v2.5',
        temperature: 0.7,
        fallbackModels: ['mimo-v2.5-pro', 'glm-5.1'],
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
  };
}
