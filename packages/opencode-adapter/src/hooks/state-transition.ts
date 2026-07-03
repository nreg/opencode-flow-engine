/**
 * State Transition hook - Manage workflow state transitions
 */

import type { HookHandler, HookContext, HookResult } from './types.js';
import { isValidTransition, getValidTransitions } from '@opencode-sflow/core';
import { ensureDir, readJsonFile, writeJsonFile } from '@opencode-sflow/shared';

const STATE_FILE_PATH = '.sflow/state.json';

/**
 * Create the state transition hook
 */
export function createStateTransitionHook(): HookHandler {
  return {
    name: 'state_transition',
    description: 'Manage workflow state transitions and validate transitions',
    execute: async (context) => {
      const { changeDir, data } = context;

      try {
        const currentState = await getCurrentState(changeDir);
        const newState = data?.newState as string;

        if (!newState) {
          return { success: true, data: { currentState } };
        }

        if (!currentState) {
          await updateState(changeDir, newState);
          return {
            success: true,
            data: { from: null, to: newState, timestamp: new Date().toISOString() },
          };
        }

        if (!isValidTransition(currentState, newState)) {
          const valid = getValidTransitions(currentState);
          return {
            success: false,
            error: `Invalid transition from ${currentState} to ${newState}`,
            block: true,
            blockReason: `Cannot transition from ${currentState} to ${newState}. Valid transitions: ${valid.join(', ')}`,
          };
        }

        await updateState(changeDir, newState);

        return {
          success: true,
          data: {
            from: currentState,
            to: newState,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

async function getCurrentState(changeDir: string): Promise<string | null> {
  const state = await readStateFile(changeDir);
  if (state) {
    return (state.state as string) || (state.currentState as string) || 'exploring';
  }
  return null;
}

async function readStateFile(changeDir: string): Promise<Record<string, unknown> | null> {
  if (!changeDir) return null;
  return await readJsonFile(`${changeDir}/${STATE_FILE_PATH}`);
}

async function updateState(changeDir: string, newState: string): Promise<void> {
  const now = new Date().toISOString();
  let state: Record<string, unknown> = {};
  const existing = await readStateFile(changeDir);
  if (existing) {
    state = existing;
  } else {
    state = { state: 'exploring', mode: 'full', artifacts_hash: '', contract_hash: '', batches_completed: 0, dp_0_confirmed: false, contractApproved: false, verificationStatus: 'pending', createdAt: now, updatedAt: now };
    await ensureDir(`${changeDir}/.sflow`);
  }
  state.state = newState;
  state.updatedAt = now;
  
  await writeJsonFile(`${changeDir}/${STATE_FILE_PATH}`, state);
}
