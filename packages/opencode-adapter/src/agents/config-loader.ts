/**
 * Config Loader - Load agent configuration from .sflow/config.json
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
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
 * Load sFlow config from .sflow/config.json
 */
export function loadSFlowConfig(projectDir?: string): SFlowConfig {
  const dir = projectDir || process.cwd();
  const configPath = join(dir, '.sflow', 'config.json');

  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    console.warn(`[sflow] Failed to parse ${configPath}`);
    return {};
  }
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
        model: 'claude-opus-4-7',
        temperature: 0.1,
        fallbackModels: ['claude-sonnet-4-7', 'gpt-4o'],
      },
      'need-explorer': {
        model: 'claude-sonnet-4-6',
        temperature: 0.3,
        fallbackModels: ['gpt-4o', 'claude-haiku-3-5'],
      },
      'spec-writer': {
        model: 'claude-sonnet-4-6',
        temperature: 0.2,
        fallbackModels: ['gpt-4o', 'claude-haiku-3-5'],
      },
      'contract-builder': {
        model: 'claude-sonnet-4-6',
        temperature: 0.2,
        fallbackModels: ['gpt-4o'],
      },
      'build-executor': {
        model: 'claude-sonnet-4-6',
        temperature: 0.1,
        fallbackModels: ['gpt-4o', 'gpt-4o-mini'],
      },
      'bug-investigator': {
        model: 'claude-sonnet-4-6',
        temperature: 0.1,
        fallbackModels: ['gpt-4o'],
      },
      'code-reviewer': {
        model: 'claude-opus-4-7',
        temperature: 0.1,
        fallbackModels: ['claude-sonnet-4-7', 'gpt-4o'],
      },
      'release-archivist': {
        model: 'claude-sonnet-4-6',
        temperature: 0.1,
        fallbackModels: ['gpt-4o-mini'],
      },
      'spec-merger': {
        model: 'claude-sonnet-4-6',
        temperature: 0.2,
        fallbackModels: ['gpt-4o'],
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
