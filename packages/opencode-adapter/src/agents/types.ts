/**
 * Agent types for opencode-spec-flow
 * Based on oh-my-openagent's agent system
 */

import type { AgentConfig } from '@opencode-ai/sdk';

/**
 * Agent mode determines UI model selection behavior
 */
export type AgentMode = 'primary' | 'subagent' | 'all';

/**
 * Agent factory function.
 * Mode is managed by AGENT_MODES registry in agent-builder.ts,
 * not as a static property on the function object.
 */
export type AgentFactory = (model: string, options?: { temperature?: number; skillContent?: string }) => AgentConfig;

/**
 * Built-in agent names for sFlow
 */
export type BuiltinAgentName =
  | 'sFlow'              // Main orchestrator (primary)
  | 'need-explorer'      // Requirement clarification (subagent)
  | 'spec-writer'        // Artifact generation (subagent)
  | 'contract-builder'   // Bridge contract (subagent)
  | 'build-executor'     // Execution governor (subagent)
  | 'bug-investigator'   // Debugging (subagent)
  | 'code-reviewer'      // Code review (subagent)
  | 'release-archivist'  // Closure (subagent)
  | 'spec-merger';       // Sync (subagent)

/**
 * Agent override configuration
 */
export type AgentOverrideConfig = Partial<AgentConfig> & {
  category?: string;
  prompt_append?: string;
  skills?: string[];
  tools?: Record<string, boolean>;
  variant?: string;
  fallback_models?: string | (string | { model: string; variant?: string })[];
};

/**
 * Agent overrides map
 */
export type AgentOverrides = Partial<
  Record<BuiltinAgentName, AgentOverrideConfig>
>;
