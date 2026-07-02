/**
 * Shared types for sFlow
 */

export interface PluginConfig {
  enabled: boolean;
  version: string;
  agents: Record<string, AgentModelEntry>;
  features: Record<string, boolean>;
  hooks: Record<string, boolean>;
}

export interface WorkflowConfig {
  mode: 'full' | 'hotfix' | 'tweak';
  autoTransition: boolean;
  guardEnabled: boolean;
  validationEnabled: boolean;
}

export interface AgentModelEntry {
  model: string;
  temperature?: number;
  maxTokens?: number;
  fallbackModels?: string[];
}
