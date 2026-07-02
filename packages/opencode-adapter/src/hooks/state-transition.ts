/**
 * State Transition hook - Manage workflow state transitions
 */

import type { HookHandler, HookContext, HookResult } from './types.js';
import { readJsonFile, writeJsonFile, ensureDir } from '@opencode-sflow/shared';
import { isValidTransition, getValidTransitions } from '@opencode-sflow/core';

/**
 * Create the state transition hook
 */
export function createStateTransitionHook(): HookHandler {
  return {
    name: 'state_transition',
    description: 'Manage workflow state transitions and validate transitions',
    execute: async (context) => {
      const { changeDir, action, data } = context;

      try {
        // Get current state
        const currentState = await getCurrentState(changeDir);
        const newState = data?.newState as string;

        if (!newState) {
          return { success: true, data: { currentState: await getCurrentState(changeDir) } };
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

// Helper functions
const STATE_FILE_PATH = '.sflow/state.json';

async function getCurrentState(changeDir: string): Promise<string | null> {
  if (!changeDir) return null;
  const state = await readJsonFile<Record<string, unknown>>(`${changeDir}/${STATE_FILE_PATH}`);
  if (state) {
    return (state.state as string) || (state.currentState as string) || 'exploring';
  }
  return null;
}

async function updateState(changeDir: string, newState: string): Promise<void> {
  const stateFilePath = `${changeDir}/${STATE_FILE_PATH}`;
  const now = new Date().toISOString();
  let state: Record<string, unknown> = {};
  const existing = await readJsonFile<Record<string, unknown>>(stateFilePath);
  if (existing) {
    state = existing;
  } else {
    state = { mode: 'full', createdAt: now, timestamps: { createdAt: now, updatedAt: now } };
    await ensureDir(`${changeDir}/.sflow`);
  }
  state.state = newState;
  state.updatedAt = now;
  if (!state.timestamps) state.timestamps = {};
  (state.timestamps as Record<string, string>).lastTransition = now;
  (state.timestamps as Record<string, string>).updatedAt = now;
  await writeJsonFile(stateFilePath, state);
}
