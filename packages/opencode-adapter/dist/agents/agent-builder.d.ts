/**
 * Agent Builder - Factory pattern for creating agents
 * Based on oh-my-openagent's agent builder pattern
 */
import type { AgentConfig } from '@opencode-ai/sdk';
import type { AgentFactory, AgentMode, BuiltinAgentName, AgentOverrides } from './types.js';
/**
 * Create an agent by name
 * Priority chain: AgentOverrides.model > model param > .sflow/config.json > DEFAULT_MODELS
 */
export declare function createAgent(name: BuiltinAgentName, model?: string, overrides?: AgentOverrides): AgentConfig;
/**
 * Create all agents
 */
export declare function createAllAgents(model?: string, overrides?: AgentOverrides): Record<BuiltinAgentName, AgentConfig>;
/**
 * Get agent by name
 */
export declare function getAgent(name: BuiltinAgentName): AgentFactory | undefined;
/**
 * Get all agent names
 */
export declare function getAgentNames(): BuiltinAgentName[];
/**
 * Get agent mode
 */
export declare function getAgentMode(name: BuiltinAgentName): AgentMode;
/**
 * Get primary agents (mode === 'primary')
 */
export declare function getPrimaryAgents(): BuiltinAgentName[];
/**
 * Get subagent agents (mode === 'subagent')
 */
export declare function getSubagentAgents(): BuiltinAgentName[];
/**
 * Check if agent exists
 */
export declare function agentExists(name: string): name is BuiltinAgentName;
/**
 * Get default model for agent
 */
export declare function getDefaultModel(name: BuiltinAgentName): string;
/**
 * Get all default models
 */
export declare function getAllDefaultModels(): Record<BuiltinAgentName, string>;
//# sourceMappingURL=agent-builder.d.ts.map