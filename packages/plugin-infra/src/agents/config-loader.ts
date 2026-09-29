/**
 * Config Loader - Load agent configuration from .flow-engine/sflow/config.json
 */
import { access, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { deepMerge } from '@opencode-flow-engine/shared';
import type { BuiltinAgentName, AgentOverrides, AgentOverrideConfig } from './types.js';
import { Logger } from '../utils/logger.js';

export interface AgentConfigEntry {
  model?: string;
  temperature?: number;
  fallbackModels?: string[];
  fallback_models?: string[];
}

export interface ModelProfileConfig {
  lite?: { model: string; fallback_models: string[] };
  quick?: { model: string; fallback_models: string[] };
  standard?: { model: string; fallback_models: string[] };
  deep?: { model: string; fallback_models: string[] };
  ultra?: { model: string; fallback_models: string[] };
  review?: { model: string; fallback_models: string[] };
}

// NOTE: the built-in profile model table was removed (model resolution now follows
// user configuration only). Resolution reads ONLY user configuration (modelProfiles /
// per-agent overrides); there is no built-in default model set.
// See agent-builder.ts resolveModelWithFallback / buildAgentFallbackChain.

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
 * Load sflow config from a specific directory's .flow-engine/sflow/config.json
 */
export async function loadSFlowConfig(projectDir?: string): Promise<SFlowConfig> {
  const dir = projectDir || process.cwd();
  const configPath = join(dir, '.flow-engine/sflow', 'config.json');

  try {
    await access(configPath);
  } catch {
    return {};
  }

  try {
    const raw = await readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    await Logger.warn(`[sflow] Failed to parse ${configPath}`);
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
    await Logger.warn(`[flow-engine] No user-level config found at ${path}. Run 'sflow init --user' to create one.`);
    return {};
  }

  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    await Logger.warn(`[sflow] Failed to parse user config: ${path}`);
    return {};
  }
}

/**
 * Load cascading config: user-level (~/.config/opencode/opencode-flow-engine.json) as base,
 * project-level (.flow-engine/sflow/config.json) as higher-priority override.
 */
export async function loadCascadedSFlowConfig(projectDir?: string): Promise<SFlowConfig> {
  const user = await loadUserSFlowConfig();
  const project = await loadSFlowConfig(projectDir);

  const merged = Object.keys(project).length === 0
    ? user
    : deepMerge(
        user as Record<string, unknown>,
        project as Record<string, unknown>,
      ) as SFlowConfig;

  // Legacy format detection (Spec R2)
  // The 4-tier system (mechanical/standard/strong/review) has been replaced by
  // 6-tier (lite/quick/standard/deep/ultra/review)
  if (merged.modelProfiles) {
    const profiles = merged.modelProfiles as Record<string, unknown>;

    // ① free → lite rename: the "free" tier was globally renamed to "lite".
    // Migrate existing "free" config into "lite" (only when lite is absent and
    // the value is a 6-tier object) so old-config users don't silently lose it.
    if ('free' in profiles) {
      const freeVal = profiles.free;
      await Logger.warn(
        `[sflow] Legacy tier "free" detected in modelProfiles. ` +
        `The "free" tier has been renamed to "lite". Please update your config.`,
      );
      if (!('lite' in profiles) && freeVal && typeof freeVal === 'object') {
        profiles.lite = freeVal;
      }
      // Remove legacy key to prevent usage
      delete profiles.free;
    }

    // Legacy 4-tier detection (mechanical/standard/strong/review)
    const legacyTiers = ['mechanical', 'strong'];
    for (const tier of legacyTiers) {
      if (tier in profiles) {
        await Logger.warn(
          `[sflow] Legacy tier "${tier}" detected in modelProfiles. ` +
          `The 4-tier system (mechanical/standard/strong/review) has been replaced by ` +
          `6-tier (lite/quick/standard/deep/ultra/review). ` +
          `Please update your config. No built-in default for this tier; agent will use OpenCode default model.`,
        );
        // Remove legacy key to prevent usage
        delete profiles[tier];
      }
    }

    // ② string-valued tiers (old 4-tier string format) must be upgraded to the
    // 6-tier object format { model: string; fallback_models: string[] }.
    for (const [tier, value] of Object.entries(profiles)) {
      if (typeof value === 'string') {
        await Logger.warn(
          `[sflow] Legacy string format detected for tier "${tier}" in modelProfiles. ` +
          `Tier configs must be upgraded to the 6-tier object format ` +
          `{ model: string; fallback_models: string[] }. ` +
          `No built-in default for this tier; agent will use OpenCode default model.`,
        );
        // Remove string-valued key to prevent usage
        delete profiles[tier];
      }
    }
  }

  return merged;
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
