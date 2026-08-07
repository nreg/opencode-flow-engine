/**
 * CompletionDetector — P3: Completion Enforcement & System Reminder
 *
 * Provides completion signal detection for subagent output and
 * retry configuration for the completion enforcement mechanism.
 *
 * Detection strategies (by agent type):
 * 1. STRICT agents (spec-writer, contract-builder):
 *    - [TASK_COMPLETE] marker → true
 *    - JSON code fence (```json ... ```) → true
 *    - Bare JSON object ({...}) → true
 *    - Empty / null output → false
 *
 * 2. LOOSE agents (build-executor, code-reviewer, test-engineer, etc.):
 *    - Output contains report keywords (Summary, 完成, Test Results, Batch Status, Files) → true
 *    - Output length >= 200 characters → true
 *    - Empty / very short output → false
 *
 * 3. Other agents: No retry (automatically exempt)
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
  /** Agent types that SHOULD have completion enforcement (opt-in).
   *  Only agents that output [TASK_COMPLETE] should be listed here.
   *  All other agents are automatically exempt. */
  enabledAgents?: string[];
}

/** STRICT completion agents — require [TASK_COMPLETE] marker or JSON output.
 *  These agents output structured completion signals and must be strictly enforced.
 */
export const STRICT_COMPLETION_AGENTS: string[] = [
  'spec-writer',
  'contract-builder',
];

/** LOOSE completion agents — use substantial output detection.
 *  These agents output human-readable reports and should use loose completion detection:
 *  - Output non-empty and contains report keywords (Summary, 完成, Test Results, etc.)
 *  - OR output length >= 200 characters (substantial content)
 *  - Only retry when output is empty/very short/obviously truncated
 */
export const LOOSE_COMPLETION_AGENTS: string[] = [
  'build-executor',
  'code-reviewer',
  'test-engineer',
  'bug-investigator',
  'release-archivist',
  'spec-merger',
  'ui-implementer',
];

/** Combined list of all agents with completion enforcement enabled.
 *  STRICT agents use hasCompletionSignal ([TASK_COMPLETE] or JSON).
 *  LOOSE agents use hasSubstantialOutput (report keywords or substantial length).
 *  All other agents are automatically exempt.
 */
export const DEFAULT_COMPLETION_ENABLED_AGENTS: string[] = [
  ...STRICT_COMPLETION_AGENTS,
  ...LOOSE_COMPLETION_AGENTS,
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
  enabledAgents: DEFAULT_COMPLETION_ENABLED_AGENTS,
};

/** System reminder message injected when subagent output lacks completion signal */
export const REMINDER_MESSAGE: ReminderMessage = {
  type: 'system',
  parts: [{
    type: 'text',
    text: '你的任务尚未完成。请提供完整的任务结果，并在输出末尾包含 [TASK_COMPLETE] 标记。',
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

/**
 * Check whether subagent output is substantial (loose completion detection).
 *
 * Used for execution-type agents that output human-readable reports.
 * Returns true if output:
 * 1. Is non-empty and contains report keywords (Summary, 完成, Test Results, Batch Status, Files)
 * 2. OR has substantial length (>= 200 characters)
 *
 * Returns false for empty, whitespace-only, or very short outputs.
 * Also returns false if output contains explicit error patterns (error:, failed:, ❌, FAIL, Error:).
 *
 * @param output - The raw output text from the subagent
 * @returns true if output is substantial, false otherwise
 */
export function hasSubstantialOutput(output: string): boolean {
  // Empty / null check
  if (!output || typeof output !== 'string' || output.trim().length === 0) {
    return false;
  }

  const trimmed = output.trim();

  const errorPatterns = [
    /^error:/im,
    /^failed:/im,
    /^❌/m,
    /^FAIL:/im,
    /^Error:/m,
    /"error"\s*:\s*"/i,
    /Error:\s.*\n\s+at /s,
  ];

  const hasErrorPattern = errorPatterns.some(pattern => pattern.test(trimmed));
  if (hasErrorPattern) {
    return false;
  }

  // Check for report keywords (case-insensitive)
  const reportKeywords = [
    'Summary',
    '完成',
    'Test Results',
    'Batch Status',
    'Files',
  ];

  const hasKeywords = reportKeywords.some(keyword => 
    trimmed.toLowerCase().includes(keyword.toLowerCase())
  );

  if (hasKeywords) {
    return true;
  }

  // Check for substantial length (>= 200 characters)
  const SUBSTANTIAL_LENGTH_THRESHOLD = 200;
  if (trimmed.length >= SUBSTANTIAL_LENGTH_THRESHOLD) {
    return true;
  }

  return false;
}

// ─── Retry Logic ────────────────────────────────────────────────────────────

/**
 * Perform completion enforcement retry logic.
 *
 * Detection strategy by agent type:
 * - STRICT agents (spec-writer, contract-builder): Use hasCompletionSignal ([TASK_COMPLETE] or JSON)
 * - LOOSE agents (build-executor, etc.): Use hasSubstantialOutput (report keywords or substantial length)
 * - Other agents: No retry (automatically exempt)
 *
 * If the initial output passes the detection check, returns immediately.
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
 * @param agentType - Optional agent type; determines detection strategy
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

  // Determine detection strategy based on agent type
  const isStrictAgent = agentType && STRICT_COMPLETION_AGENTS.includes(agentType);
  const isLooseAgent = agentType && LOOSE_COMPLETION_AGENTS.includes(agentType);

  // If agent is not in any completion group, skip retry
  if (!isStrictAgent && !isLooseAgent) {
    return { output: currentOutput };
  }

  // Check initial output with appropriate detection strategy
  // For LOOSE agents: check hasCompletionSignal first (higher priority), then hasSubstantialOutput
  const hasCompletion = isStrictAgent 
    ? hasCompletionSignal(currentOutput)
    : (hasCompletionSignal(currentOutput) || hasSubstantialOutput(currentOutput));

  if (hasCompletion) {
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

    // Check if completion signal appeared (use appropriate detection strategy)
    // For LOOSE agents: check hasCompletionSignal first, then hasSubstantialOutput
    const hasCompletionNow = isStrictAgent
      ? hasCompletionSignal(currentOutput)
      : (hasCompletionSignal(currentOutput) || hasSubstantialOutput(currentOutput));

    if (hasCompletionNow) {
      return { output: currentOutput };
    }
  }

  // Max retries exhausted — return with warning
  return {
    output: currentOutput,
    warning: config.warningMessage,
  };
}
