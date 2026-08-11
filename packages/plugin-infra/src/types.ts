/**
 * Shared types, constants, and helper functions for sFlow/IFlow plugin factories.
 * Extracted from index.ts to enable entry point separation.
 */

import type { PluginInput } from '@opencode-ai/plugin';
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
  /** P2: output_mode passed from call_flow_agent, used by flowagent_output for structured extraction */
  output_mode?: 'last_message' | 'structured';
  /** P3: warning message when completion enforcement retries are exhausted */
  warning?: string;
  /** R1.4: flag to prevent double slot release (watcher vs pollAndComplete race) */
  slotReleased?: boolean;
  /** R1: changeDir for notification and subagent-store updates */
  changeDir?: string;
  /** P1-5: resolved model used for this task (for tracing and retry consistency) */
  resolvedModel?: string;
  /** P1-5: original model_type parameter (for tracing) */
  modelType?: string;
  /** P1-3: error count for watcher retry logic (internal use) */
  _errorCount?: number;
  /** P1-1: processing flag to prevent race condition between watcher and pollAndComplete */
  _processing?: boolean;
}

export type BackgroundTaskRegistry = Map<string, BackgroundTaskEntry>;

// ─── Agent model map type ─────────────────────────────────────────────────────

export type AgentModelMap = Record<string, string>;

// ─── Constants ────────────────────────────────────────────────────────────────

/** sFlow native tool names (used in tool.execute.after for post-processing) */
export const SFLOW_TOOLS = new Set([
  'workflow_router',
  'iflow_router',
  'contract_validator',
  'artifact_inspector',
  'validate_spec',
  'validate_proposal',
  'validate_delta_spec',
  'validate_tasks',
  'validate_contract',
  'validate_design',
  'validate_implementation',
  'detect_sync_conflicts',
  'record_decision_point',
  'call_flow_agent',
  'flowagent_output',
  'flowagent_cancel',
  'record_execution_plan',
  'record_review_receipt',
]);

/** IFlow workflow states */
export const IFLOW_STATES = new Set([
  'discussing',
  'researching',
  'planning',
  'executing',
  'verifying',
  'shipping',
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

/** Probe mode pending marker (F2: watcher 1s timeout bug fix) */
export const PROBE_PENDING = { __PROBE__: 'pending' } as const;
export type ProbePending = typeof PROBE_PENDING;

/** Generate a unique task ID for background task registry */
export function generateTaskId(counter: { value: number }): string {
  counter.value++;
  return `sf_${Date.now()}_${counter.value}`;
}

// ─── Polling options (Batch 2: event-driven polling) ────────────────────────────

/**
 * Options for event-driven session polling.
 * - eventDriven: Enable event bus for faster completion detection (default: true)
 * - fallbackThreshold: Fall back to pure polling if event not received within this duration (default: 25000ms)
 * - directory: Target directory for filtering (optional, currently unused in event bus mode)
 */
export interface PollingOptions {
  /** Enable event-driven polling via event bus (default: true) */
  eventDriven?: boolean;
  /** Fallback to pure polling if event not received within this duration (default: 25000ms) */
  fallbackThreshold?: number;
  /** Target directory for filtering (optional, currently unused in event bus mode) */
  directory?: string;
}

// ─── Event subscription types (Batch 2: AsyncGenerator interface) ───────────────

/**
 * Event union type from SDK
 * 
 * P0-1: Inlined from @opencode-ai/sdk because direct import from '@opencode-ai/sdk'
 * caused module resolution issues in test environment. Structure matches SDK exactly.
 * 
 * This is a bare object with type and properties fields - NO payload wrapper.
 * @see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:602 (union type)
 * @see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:413-418 (EventSessionIdle example)
 */
export type Event = {
  type: string;
  properties?: Record<string, unknown>;
};

/**
 * EventSessionIdle structure
 * 
 * P0-1: Bare object structure (no payload wrapper).
 * @see node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:413-418
 */
export interface EventSessionIdle {
  type: 'session.idle';
  properties: {
    sessionID: string;
  };
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

// ─── Event Bus types (Batch 1: R1 事件总线机制) ────────────────────────────────

/**
 * Event bus listener function type
 * Called when an event is dispatched to a registered session
 */
export type EventBusListener = (event: Event) => void;

/**
 * Event bus interface for session completion detection
  *
  * R1: Lightweight event bus using Map<sessionID, resolver> pattern.
  * No message queue, no EventEmitter, no RxJS dependencies.
  *
  * Lifecycle:
  * 1. register: Poller启动时注册sessionID → 完成回调
  * 2. dispatch: Hooks.event收到session.idle事件时，按sessionID查找并调用resolver
  * 3. unregister: Poller完成/超时后移除注册（防泄漏）
  *
  * 幂等性说明：
  * - register: 不是幂等操作。重复注册同一 sessionID 会覆盖旧监听器并触发警告。
  * - dispatch: 幂等性语义为"单次 dispatch 只调用一次监听器"，而非去重。
  *             同一 sessionID 的监听器每次 dispatch 都会触发。
  */
export interface EventBus {
  /**
   * Register a listener for a session
   * @param sessionID - Session identifier
   * @param onComplete - Callback when session.idle event is received
   */
  register(sessionID: string, onComplete: EventBusListener): void;

  /**
   * Dispatch an event to a registered session
   * @param sessionID - Session identifier
   * @param event - Event to dispatch
   * @returns true if a listener was found and called, false otherwise
   */
  dispatch(sessionID: string, event: Event): boolean;

  /**
   * Unregister a session listener
   * @param sessionID - Session identifier
   */
  unregister(sessionID: string): void;
}

// ─── Plugin detection helpers ─────────────────────────────────────────────────

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
    const hasPlugin = cfg.plugin.some((p) => {
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
