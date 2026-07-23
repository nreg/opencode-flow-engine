/**
 * Shared types, constants, and helper functions for sFlow/IFlow plugin factories.
 * Extracted from index.ts to enable entry point separation.
 */

import type { PluginInput, ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';
import { sleep as crossSleep } from '@opencode-flow-engine/shared';

// ─── Client type ──────────────────────────────────────────────────────────────

export type SFlowClient = PluginInput['client'];

// ─── Background task types ────────────────────────────────────────────────────

export interface BackgroundTaskEntry {
  sessionID: string;
  subagentType: string;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export type BackgroundTaskRegistry = Map<string, BackgroundTaskEntry>;

// ─── Agent model map type ─────────────────────────────────────────────────────

export type AgentModelMap = Record<string, string>;

// ─── Constants ────────────────────────────────────────────────────────────────

/** sFlow native tool names (used in tool.execute.after for post-processing) */
export const SFLOW_TOOLS = new Set([
  'workflow_router', 'iflow_router', 'contract_validator', 'artifact_inspector',
  'validate_spec', 'validate_proposal', 'validate_delta_spec', 'validate_tasks',
  'validate_contract', 'validate_design', 'validate_implementation',
  'detect_sync_conflicts', 'record_decision_point',
  'call_flow_agent', 'flowagent_output', 'flowagent_cancel',
  'record_execution_plan', 'record_review_receipt',
]);

/** IFlow workflow states */
export const IFLOW_STATES = new Set([
  'discussing', 'researching', 'planning', 'executing', 'verifying', 'shipping',
]);

/** Agent color mapping */
export const AGENT_COLORS: Record<string, string> = {
  sFlow: '#f8cd93',
  iFlow: '#FFB6C1',
  'test-engineer': '#7CB342',
  'review-engineer': '#42A5F5',
  'flow-intel': '#AB47BC',
  'flow-architect': '#FF7043',
  'flow-evolve': '#26A69A',
  'flow-health': '#EF5350',
  'flow-restyle': '#7E57C2',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Promise-based sleep (cross-runtime compatible) */
export const sleep = crossSleep;

/** Generate a unique task ID for background task registry */
export function generateTaskId(counter: { value: number }): string {
  counter.value++;
  return `sf_${Date.now()}_${counter.value}`;
}

/** Format a tool output response */
export function formatToolOutput(
  title: string,
  success: boolean,
  data: Record<string, unknown>,
): { title: string; output: string } {
  return { title, output: JSON.stringify({ success, ...data }, null, 2) };
}

/** Format a tool error response */
export function formatToolError(msg: string): { title: string; output: string } {
  return formatToolOutput('Error', false, { error: msg });
}

// ─── Plugin detection helpers ─────────────────────────────────────────────────

/**
 * Detect oh-my-openagent from cfg.plugin list.
 * Called during config hook to set the hasOmoPlugin flag for agent-tools.
 */
export function detectOmoPlugin(
  pluginConfig: (string | [string, Record<string, unknown>])[] | undefined,
): boolean {
  if (!pluginConfig) return false;
  return pluginConfig.some(p => {
    const name = Array.isArray(p) ? p[0] : p;
    return name === 'oh-my-openagent'
      || name === 'oh-my-opencode'
      || name.startsWith('oh-my-openagent')
      || name.startsWith('oh-my-opencode')
      || name === 'omo';
  });
}

/**
 * Detect agnesmore provider from cfg.provider or cfg.plugin.
 * Called during config hook to set the hasAgnesProvider flag for agent-tools.
 */
export async function detectAgnesProvider(cfg: {
  provider?: Record<string, unknown>;
  plugin?: (string | [string, Record<string, unknown>])[];
}): Promise<boolean> {
  if (cfg.provider && 'agnesmore' in cfg.provider) return true;
  if (cfg.plugin) {
    const hasPlugin = cfg.plugin.some(p => {
      const name = Array.isArray(p) ? p[0] : p;
      return name === 'agnesmore';
    });
    if (hasPlugin) return true;
  }
  try {
    const { existsSync } = await import('node:fs');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    return existsSync(join(homedir(), '.agnesmore', 'auth.json'));
  } catch {
    return false;
  }
}
