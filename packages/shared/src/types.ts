/**
 * Shared types for sFlow
 */

/**
 * Plugin configuration
 */
export interface PluginConfig {
  enabled: boolean;
  version: string;
  agents: Record<string, AgentConfig>;
  features: Record<string, boolean>;
  hooks: Record<string, boolean>;
}

/**
 * Workflow configuration
 */
export interface WorkflowConfig {
  mode: 'full' | 'hotfix' | 'tweak';
  autoTransition: boolean;
  guardEnabled: boolean;
  validationEnabled: boolean;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  fallbackModels?: string[];
}
