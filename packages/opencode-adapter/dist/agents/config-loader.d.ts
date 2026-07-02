import type { AgentOverrides } from './types.js';
export interface AgentConfigEntry {
    model?: string;
    temperature?: number;
    fallbackModels?: string[];
    fallback_models?: string[];
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
 * User-level config path: ~/.sflow/config.json
 */
export declare const USER_CONFIG_FILE: string;
/**
 * Load sFlow config from a specific directory's .sflow/config.json
 */
export declare function loadSFlowConfig(projectDir?: string): Promise<SFlowConfig>;
/**
 * Load user-level config from ~/.sflow/config.json
 */
export declare function loadUserSFlowConfig(): Promise<SFlowConfig>;
/**
 * Load cascading config: user-level (~/.sflow/config.json) as base,
 * project-level (.sflow/config.json) as higher-priority override.
 */
export declare function loadCascadedSFlowConfig(projectDir?: string): Promise<SFlowConfig>;
/**
 * Convert SFlowConfig.agents to AgentOverrides format
 */
export declare function agentOverridesFromConfig(config: SFlowConfig): AgentOverrides;
/**
 * Merge two override configs. Higher-priority wins.
 * Uses proper typing instead of `as any`.
 */
export declare function mergeOverrides(base: AgentOverrides, higher: AgentOverrides | undefined): AgentOverrides;
/**
 * Generate a config file template with all agents
 */
export declare function generateConfigTemplate(): SFlowConfig;
