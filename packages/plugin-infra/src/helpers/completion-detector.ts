/**
 * CompletionDetector — P3: Completion Enforcement & System Reminder
 *
 * Provides completion signal detection for subagent output and
 * retry configuration for the completion enforcement mechanism.
 *
 * Detection rules (ordered):
 * 1. [TASK_COMPLETE] marker → true
 * 2. JSON code fence (```json ... ```) → true
 * 3. Bare JSON object ({...}) → true
 * 4. Empty / null output → false
 *
 * Reuses extractJsonBlock from P2 for JSON-related detection.
 */

import { extractJsonBlock } from './output-extractor.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** System reminder message format for injection into session */
export interface ReminderMessage {
  type: 'system';
  parts: Array<{
    type: 'text';
    text: string;
  }>;
}

/** Completion enforcement configuration */
export interface CompletionEnforcementConfig {
  /** Maximum number of retries after initial attempt */
  maxRetries: number;
  /** Delay in ms before each retry attempt (indexed by retry number) */
  retryDelays: number[];
  /** Warning message when max retries are exhausted */
  warningMessage: string;
  /** Agent types exempt from completion enforcement (their output is never retried) */
  agentExemptList?: string[];
}

/** Agents that are known to NOT output [TASK_COMPLETE] — their output is accepted as-is */
export const DEFAULT_COMPLETION_EXEMPT_AGENTS: string[] = [
  'build-executor',
  'bug-investigator',
  'code-reviewer',
  'release-archivist',
  'ui-implementer',
  'test-engineer',
  'review-engineer',
];

/** Result of the completion retry process */
export interface CompletionRetryResult {
  /** The final output text (may be from a retry attempt) */
  output: string;
  /** Warning message if max retries were exhausted without completion signal */
  warning?: string;
}

/** Function type for injecting a reminder into the session */
export type InjectReminderFn = () => Promise<void>;

/** Function type for polling subagent output */
export type PollOutputFn = () => Promise<string | null>;

// ─── Constants ──────────────────────────────────────────────────────────────

/** Completion enforcement configuration */
export const COMPLETION_ENFORCEMENT_CONFIG: CompletionEnforcementConfig = {
  maxRetries: 2,
  retryDelays: [1000, 2000], // 1s → 2s
  warningMessage: 'Subagent output may be incomplete - no completion signal detected after 3 attempts',
  agentExemptList: DEFAULT_COMPLETION_EXEMPT_AGENTS,
};

/** System reminder message injected when subagent output lacks completion signal */
export const REMINDER_MESSAGE: ReminderMessage = {
  type: 'system',
  parts: [{
    type: 'text',
    text: '你的任务尚未完成。请提供完整的任务结果，并在输出末尾包含 [TASK_COMPLETE] 标记或结构化 JSON 输出。',
  }],
};

// ─── Detection Function ─────────────────────────────────────────────────────

/**
 * Check whether subagent output contains a completion signal.
 *
 * Completion signals include:
 * 1. [TASK_COMPLETE] marker
 * 2. JSON code fence (```json ... ```)
 * 3. Bare JSON object ({...})
 *
 * Empty or null output is treated as incomplete (returns false).
 *
 * @param output - The raw output text from the subagent
 * @returns true if a completion signal is detected, false otherwise
 */
export function hasCompletionSignal(output: string): boolean {
  // Empty / null check
  if (!output || typeof output !== 'string' || output.trim().length === 0) {
    return false;
  }

  // 1. Detect [TASK_COMPLETE] marker
  if (output.includes('[TASK_COMPLETE]')) {
    return true;
  }

  // 2 & 3. Detect JSON code fence or bare JSON object
  // Reuse extractJsonBlock from P2 — if it can extract valid JSON, that's a completion signal
  if (extractJsonBlock(output) !== null) {
    return true;
  }

  return false;
}

// ─── Retry Logic ────────────────────────────────────────────────────────────

/**
 * Perform completion enforcement retry logic.
 *
 * If the initial output contains a completion signal, returns immediately.
 * If the agent type is in the exempt list, returns immediately (agent known not to output TASK_COMPLETE).
 * Otherwise, injects a system reminder and re-polls up to maxRetries times
 * with increasing backoff delays.
 *
 * This is a pure logic function that takes dependency-injected functions
 * for reminder injection and output polling, making it fully testable
 * without real session/client dependencies.
 *
 * @param initialOutput - The initial output from the subagent
 * @param injectReminder - Function to inject a system reminder into the session
 * @param pollOutput - Function to poll for the subagent's latest output
 * @param config - Optional override for completion enforcement config (for testing)
 * @param agentType - Optional agent type; if in config.agentExemptList, skips retry
 * @returns CompletionRetryResult with final output and optional warning
 */
export async function performCompletionRetry(
  initialOutput: string,
  injectReminder: InjectReminderFn,
  pollOutput: PollOutputFn,
  config: CompletionEnforcementConfig = COMPLETION_ENFORCEMENT_CONFIG,
  agentType?: string,
): Promise<CompletionRetryResult> {
  let currentOutput = initialOutput;

  // If already has completion signal, return immediately
  if (hasCompletionSignal(currentOutput)) {
    return { output: currentOutput };
  }

  // If agent is exempt from completion enforcement, skip retry
  if (agentType && config.agentExemptList?.includes(agentType)) {
    return { output: currentOutput };
  }

  // Retry loop
  for (let retry = 0; retry < config.maxRetries; retry++) {
    // Inject system reminder
    try {
      await injectReminder();
    } catch {
      // reminder injection failure should not block retry
    }

    // Wait for backoff delay
    const delay = config.retryDelays[retry] ?? 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Re-poll for output
    const newOutput = await pollOutput();
    if (newOutput && typeof newOutput === 'string') {
      currentOutput = newOutput;
    }

    // Check if completion signal appeared
    if (hasCompletionSignal(currentOutput)) {
      return { output: currentOutput };
    }
  }

  // Max retries exhausted — return with warning
  return {
    output: currentOutput,
    warning: config.warningMessage,
  };
}
