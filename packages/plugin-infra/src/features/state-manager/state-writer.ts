/**
 * State file writing functions for workflow state management.
 * Extracted from index.ts to maintain pure re-export pattern.
 */

import { ensureDir, readJsonFile, atomicWriteJsonFile, stateFileMutex } from "@opencode-flow-engine/shared";
import type { DecisionPoint } from '@opencode-flow-engine/core';

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
 * Append or update decision point entry.
 * Single responsibility: handles both DP-4 (via dp_4_result) and generic decisionPoint.
 * 
 * Unified logic:
 * - dp_4_result is converted to DecisionPoint format and merged
 * - decisionPoint is appended/updated directly
 * - Both can coexist in the same call
 */
function appendDecisionPoint(
  state: Record<string, unknown>,
  extra: Record<string, unknown> | undefined,
  now: string
): void {
  if (!extra) return;

  const decisionPoints = Array.isArray(state.decisionPoints)
    ? (state.decisionPoints as Array<Record<string, unknown>>)
    : [];

  // Handle dp_4_result: convert to DecisionPoint format
  if (extra.dp_4_result && typeof extra.dp_4_result === 'object') {
    const dp4 = extra.dp_4_result as Record<string, unknown>;
    const existingDp4 = decisionPoints.find(dp => dp.id === 'dp-4');
    if (existingDp4) {
      existingDp4.mode = dp4.mode;
      existingDp4.rationale = dp4.rationale;
      existingDp4.timestamp = now;
    } else {
      decisionPoints.push({
        id: 'dp-4',
        mode: dp4.mode,
        rationale: dp4.rationale,
        timestamp: now,
      });
    }
  }

  // Handle generic decisionPoint
  if (extra.decisionPoint && typeof extra.decisionPoint === 'object') {
    const newDp = extra.decisionPoint as DecisionPoint;
    const existingIndex = decisionPoints.findIndex(dp => dp.id === newDp.id);
    if (existingIndex >= 0) {
      decisionPoints[existingIndex] = { ...newDp, timestamp: now };
    } else {
      decisionPoints.push({ ...newDp, timestamp: now });
    }
  }

  // Update state if any decision points were processed
  if (extra.dp_4_result || extra.decisionPoint) {
    state.decisionPoints = decisionPoints;
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
 */
export async function writeStateFile(changeDir: string, newState: string, extra?: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();
  const statePath = changeDir + '/.flow-engine/sflow/state.json';
  await ensureDir(changeDir + '/.flow-engine/sflow');
  await stateFileMutex.runExclusive(async () => {
    const existing = await readJsonFile<Record<string, unknown>>(statePath);
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

    // Apply state update
    state.state = newState;
    state.updatedAt = now;

    // Apply extra fields (before AFK/DP logic to allow override)
    if (extra) Object.assign(state, extra);

    // Apply AFK deactivation on terminal states
    applyAfkDeactivation(state, newState);

    // Apply AFK consistency check
    applyAfkConsistency(state);

    // Apply decision point appending (unified DP-4 and generic DP)
    appendDecisionPoint(state, extra, now);

    await atomicWriteJsonFile(statePath, state);
  });
}
