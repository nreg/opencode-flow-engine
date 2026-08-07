/**
 * State file writing functions for workflow state management.
 * Extracted from index.ts to maintain pure re-export pattern.
 */

import { ensureDir, readJsonFile, atomicWriteJsonFile, stateFileMutex } from "@opencode-flow-engine/shared";
import type { DecisionPoint } from '@opencode-flow-engine/core';
import { isValidTransition, getValidTransitions } from '@opencode-flow-engine/core';

/**
 * Apply AFK auto-deactivation on terminal states.
 * Single responsibility: handles AFK deactivation logic.
 */
function applyAfkDeactivation(state: Record<string, unknown>, newState: string): void {
  if (newState === 'closing' || newState === 'abandoned') {
    state.afk = false;
    state.afkTier = 0;
  }
}

/**
 * Apply AFK consistency check.
 * Single responsibility: ensures afk=false → afkTier=0.
 */
function applyAfkConsistency(state: Record<string, unknown>): void {
  if (state.afk === false && state.afkTier !== 0) {
    state.afkTier = 0;
  }
}

/**
 * Upsert decision point: find existing by id → update or push.
 * Single responsibility: handles the common append/update logic.
 *
 * Defensive checks:
 * - Skip if dp is null/undefined or not an object
 * - Skip if dp.id is missing or not a string
 *
 * Returns true if upsert was performed, false if skipped.
 */
function upsertDecisionPoint(
  dps: Array<Record<string, unknown>>,
  dp: Record<string, unknown>,
  now: string
): boolean {
  if (!dp || typeof dp !== 'object') return false;
  if (typeof dp.id !== 'string') return false;

  const existingIndex = dps.findIndex(d => d.id === dp.id);
  if (existingIndex >= 0) {
    dps[existingIndex] = { ...dp, timestamp: now };
  } else {
    dps.push({ ...dp, timestamp: now });
  }
  return true;
}

/**
 * Append or update decision point entry.
 * Single responsibility: handles both DP-4 (via dp_4_result) and generic decisionPoint.
 *
 * Unified logic:
 * - dp_4_result is converted to DecisionPoint format and merged
 * - decisionPoint is appended/updated directly
 * - Both can coexist in the same call
 *
 * Pure implementation: works on a fresh copy, no reference side effects.
 *
 * P1-1 fix: Preserve non-array decisionPoints with warning instead of silently discarding.
 */
function appendDecisionPoint(
  state: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
  now: string
): void {
  // P1-1: Check if decisionPoints exists but is not an array
  // This check must happen before any decision point processing
  // Note: null is treated as missing (not malformed)
  if ('decisionPoints' in state && 
      state.decisionPoints !== null && 
      !Array.isArray(state.decisionPoints)) {
    console.warn(
      `state.decisionPoints is not an array (got ${typeof state.decisionPoints}), ` +
      `preserving original value and skipping decision point update`
    );
    return;
  }

  // Treat null as missing (convert to empty array)
  if (state.decisionPoints === null) {
    state.decisionPoints = [];
  }

  if (!extra) return;

  // Work on a fresh copy — no reference side effects
  const dps: Array<Record<string, unknown>> = Array.isArray(state.decisionPoints)
    ? [...(state.decisionPoints as Array<Record<string, unknown>>)]
    : [];

  let changed = false;

  // Handle dp_4_result: convert to DecisionPoint format
  if (extra.dp_4_result && typeof extra.dp_4_result === 'object') {
    const dp4 = extra.dp_4_result as Record<string, unknown>;
    if (upsertDecisionPoint(dps, {
      id: 'dp-4',
      mode: dp4.mode,
      rationale: dp4.rationale,
    } as Record<string, unknown>, now)) {
      changed = true;
    }
  }

  // Handle generic decisionPoint — same upsert path
  if (extra.decisionPoint && typeof extra.decisionPoint === 'object') {
    if (upsertDecisionPoint(dps, extra.decisionPoint as Record<string, unknown>, now)) {
      changed = true;
    }
  }

  // Only write back when something actually changed
  if (changed) {
    state.decisionPoints = dps;
  }
}

/**
 * Shared writeStateFile — unified state.json writer.
 * Used by both state-transition hook and workflow-manager.
 * Replaces duplicate inline implementations.
 * 
 * Refactored to follow Single Responsibility Principle:
 * - Main function: read → apply changes → write
 * - Helper functions: AFK deactivation, AFK consistency, DP appending
 * 
 * Uses atomicWriteJsonFile for crash safety.
 * 
 * P0 fix: TOCTOU race condition — atomic state transition validation.
 * 
 * @param changeDir - Project directory path
 * @param newState - Target state to transition to
 * @param extra - Additional fields to merge into state
 * @param options - Optional validation options
 * @param options.validateTransitionFrom - Expected current state for atomic check
 * @returns { success: boolean, error?: string } - Result of the write operation
 */
export async function writeStateFile(
  changeDir: string,
  newState: string,
  extra?: Record<string, unknown>,
  options?: { validateTransitionFrom?: string }
): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString();
  const statePath = changeDir + '/.flow-engine/sflow/state.json';
  await ensureDir(changeDir + '/.flow-engine/sflow');
  
  return stateFileMutex.runExclusive(async () => {
    const existing = await readJsonFile<Record<string, unknown>>(statePath);
    const isNewFile = !existing;
    
    const state: Record<string, unknown> = existing ?? {
      state: 'exploring',
      mode: 'full',
      afk: false,
      afkTier: 0,
      artifacts_hash: '',
      contract_hash: '',
      batches_completed: 0,
      dp_0_confirmed: false,
      contractApproved: false,
      verificationStatus: 'pending',
      createdAt: now,
    };

    // Get actual current state
    const actualCurrent = (state.state as string) || 'exploring';

    // P0: Atomic state transition validation within mutex
    // Skip validation for new files (initial state setup)
    if (!isNewFile) {
      if (options?.validateTransitionFrom) {
        // Check if state changed concurrently
        if (actualCurrent !== options.validateTransitionFrom) {
          return {
            success: false,
            error: `State changed concurrently: expected "${options.validateTransitionFrom}" but found "${actualCurrent}"`,
          };
        }
      }

      // Validate state transition (allow staying in same state)
      if (actualCurrent !== newState && !isValidTransition(actualCurrent, newState)) {
        const valid = getValidTransitions(actualCurrent);
        return {
          success: false,
          error: `Invalid state transition from "${actualCurrent}" to "${newState}". Valid transitions: ${valid.join(', ')}`,
        };
      }
    }

    // Apply state update
    state.state = newState;
    state.updatedAt = now;

    // Apply extra fields (excluding decisionPoints/decisionPoint)
    // These fields are managed exclusively by appendDecisionPoint via upsert logic.
    // Object.assign would overwrite existing decision points or pollute the top-level state.
    if (extra) {
      const { decisionPoints: _ignoredDPs, decisionPoint: _ignoredDP, ...safeExtra } = extra;
      Object.assign(state, safeExtra);
    }

    // Apply AFK deactivation on terminal states
    applyAfkDeactivation(state, newState);

    // Apply AFK consistency check
    applyAfkConsistency(state);

    // Apply decision point appending (unified DP-4 and generic DP)
    appendDecisionPoint(state, extra, now);

    await atomicWriteJsonFile(statePath, state);
    
    return { success: true };
  });
}
