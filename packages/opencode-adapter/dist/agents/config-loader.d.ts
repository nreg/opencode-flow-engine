import type { AgentOverrides } from './types.js';
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
export declare const USER_CONFIG_FILE: string;
/**
 * Load sFlow config from a specific directory's .sflow/config.json
 */
export declare function loadSFlowConfig(projectDir?: string): SFlowConfig;
/**
 * Load user-level config from ~/.sFlow/config.json
 */
export declare function loadUserSFlowConfig(): SFlowConfig;
/**
 * Load cascading config: user-level (~/.sFlow/config.json) as base,
 * project-level (.sflow/config.json) as higher-priority override.
 */
export declare function loadCascadedSFlowConfig(projectDir?: string): SFlowConfig;
/**
 * Convert SFlowConfig.agents to AgentOverrides format
 * Only includes fields that actually differ from defaults
 */
export declare function agentOverridesFromConfig(config: SFlowConfig): AgentOverrides;
/**
 * Merge two override configs. Higher-priority wins.
 */
export declare function mergeOverrides(base: AgentOverrides, higher: AgentOverrides | undefined): AgentOverrides;
/**
 * Generate a config file template with all agents
 */
export declare function generateConfigTemplate(): SFlowConfig;
//# sourceMappingURL=config-loader.d.ts.map