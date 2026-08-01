/**
 * State file writing functions for workflow state management.
 * Extracted from index.ts to maintain pure re-export pattern.
 */

import { ensureDir, readJsonFile, writeJsonFile, stateFileMutex } from "@opencode-flow-engine/shared";

/**
 * Shared writeStateFile — unified state.json writer.
 * Used by both state-transition hook and workflow-manager.
 * Replaces duplicate inline implementations.
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
    state.state = newState;
    state.updatedAt = now;

    // AFK: automatically deactivate on terminal states
    if (newState === 'closing' || newState === 'abandoned') {
      state.afk = false;
      state.afkTier = 0;
    }

    if (extra) Object.assign(state, extra);

    // AFK consistency: afk=false → afkTier=0
    if (state.afk === false && state.afkTier !== 0) {
      state.afkTier = 0;
    }

    // DP-4: append decision point entry when dp_4_result is provided
    if (extra && extra.dp_4_result && typeof extra.dp_4_result === 'object') {
      const dp4 = extra.dp_4_result as Record<string, unknown>;
      const decisionPoints = Array.isArray(state.decisionPoints)
        ? (state.decisionPoints as Array<Record<string, unknown>>)
        : [];
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
      state.decisionPoints = decisionPoints;
    }

    await writeJsonFile(statePath, state);
  });
}
