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
  // SFlow workflow
  | 'sFlow'              // Main orchestrator (primary)
  | 'need-explorer'      // Requirement clarification (subagent)
  | 'spec-writer'        // Artifact generation (subagent)
  | 'contract-builder'   // Bridge contract (subagent)
  | 'build-executor'     // Execution governor (subagent)
  | 'bug-investigator'   // Debugging (subagent)
  | 'code-reviewer'      // Code review (subagent)
  | 'release-archivist'  // Closure (subagent)
  | 'spec-merger'        // Sync (subagent)
  | 'ui-director'        // UI aesthetic decision-making (subagent)
  | 'ui-implementer'     // Frontend UI implementation (subagent)
  // IFlow workflow
  | 'iFlow'              // Main orchestrator (primary)
  | 'iflow-discuss-planner'   // Discussion + planning (subagent)
  | 'iflow-plan-executor'     // Execution governor (subagent)
  | 'iflow-verifier'          // Adversarial verification (subagent)
  | 'iflow-researcher'        // Research (subagent)
  | 'iflow-shipper'           // Ship/release (subagent)
  // Shared agents (cross-workflow, standalone, not bound to any workflow state)
  | 'test-engineer'       // Independent comprehensive testing (subagent)
  | 'review-engineer'     // Independent comprehensive review (subagent)
  // Horizontal commands (cross-workflow, standalone)
  | 'flow-intel'          // I-intel-scan: 入场扫描，生成 CONTEXT.md (subagent)
  | 'flow-evolve'         // A-evolve: 架构增量同步，patch CONTEXT.md + ARCHITECTURE.md (subagent)
  | 'flow-architect'      // A-architect: 架构文档，生成 ARCHITECTURE.md (subagent)
  | 'flow-health'         // M-health: 健康巡检，生成健康报告 + 技术债扫描 (subagent)
  | 'flow-restyle';       // L-restyle: 一键换调性，换视觉风格 (subagent)

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
