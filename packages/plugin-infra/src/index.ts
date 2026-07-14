/**
 * opencode-flow-engine Plugin Entry Point
 *
 * Architecture follows oh-my-openagent's create-plugin-module pattern:
 * - Tools registered via Hooks.tool (Record<string, ToolDefinition>)
 * - Agents registered via config hook (cfg.agent)
 * - MCP servers registered via config hook (cfg.mcp)
 * - No `as any` — all types align with @opencode-ai/plugin
 *
 * This file re-exports from the separated factory modules for backward compatibility.
 * New consumers should import directly from the specific factory:
 *   - sflow-plugin-factory.ts for SFlow-only
 *   - iflow-plugin-factory.ts for IFlow-only
 *   - combined-plugin-factory.ts for both
 */

// ─── Re-export from combined-plugin-factory (backward compat default) ─────────

export { default } from './combined-plugin-factory.js';
export { createSFlowPluginModule } from './sflow-plugin-factory.js';
export { createIFlowPluginModule } from './iflow-plugin-factory.js';
export { createCombinedPluginModule } from './combined-plugin-factory.js';

// ─── Re-export shared types ──────────────────────────────────────────────────

export type { BackgroundTaskEntry, BackgroundTaskRegistry, SFlowClient, AgentModelMap } from './types.js';
export { SFLOW_TOOLS, IFLOW_STATES, AGENT_COLORS, generateTaskId, formatToolOutput, formatToolError, sleep, detectOmoPlugin, detectAgnesProvider } from './types.js';

// ─── Re-export core types ────────────────────────────────────────────────────

export { Validator, isValidStateRecord } from '@opencode-flow-engine/core';
export type {
  Scenario, Requirement, Spec, DeltaOperationType, Rename, Delta, Change,
  WorkflowState, WorkflowMode, WorkflowStateFile, WorkflowStateRecord,
  ValidationReport, ValidationIssue, ConflictReport,
} from '@opencode-flow-engine/core';

// ─── Re-export agent factories ────────────────────────────────────────────────

export {
  createSFlowAgent, createNeedExplorerAgent, createSpecWriterAgent,
  createContractBuilderAgent, createBuildExecutorAgent, createBugInvestigatorAgent,
  createCodeReviewerAgent, createReleaseArchivistAgent, createSpecMergerAgent,
  createUiImplementerAgent,
  createIFlowAgent, createIFlowDiscussPlannerAgent, createIFlowPlanExecutorAgent,
  createIFlowVerifierAgent, createIFlowResearcherAgent, createIFlowShipperAgent,
} from './agents/index.js';
export type {
  ModelProvenance, ModelResolutionResult,
} from './agents/index.js';

// ─── Re-export tool factories ─────────────────────────────────────────────────

export {
  createWorkflowRouterTool, createIFlowRouterTool, createContractValidatorTool, createArtifactInspectorTool,
} from './tools/index.js';

// ─── Re-export hook factories ─────────────────────────────────────────────────

export {
  createStateTransitionHook, createArtifactValidationHook, createGuardHook,
  createSessionStartHook, createSessionEndHook,
  createPreProcessHook, createPostProcessHook, createContinuationHook,
} from './hooks/index.js';

// ─── Re-export feature factories ──────────────────────────────────────────────

export {
  createWorkflowManager, createStateManager,
  BuiltinMcpRegistry, createValidatorTools,
} from './features/index.js';

// ─── Re-export shared utilities ───────────────────────────────────────────────

export { deepMerge, fileExists, readFile, writeFile, listFiles } from '@opencode-flow-engine/shared';

// ─── Plugin constants ─────────────────────────────────────────────────────────

/** 
 * PLUGIN_ID: 'opencode-sflow' for backward compatibility.
 * The project was renamed to opencode-flow-engine (方案 C),
 * but existing users reference the plugin by the old ID in opencode.json.
 */
export const PLUGIN_ID = 'opencode-sflow';
export const PLUGIN_NAME = 'opencode-flow-engine';
export const PLUGIN_VERSION = '1.0.0';
