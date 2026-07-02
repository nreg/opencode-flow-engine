/**
 * State Transition hook - Manage workflow state transitions
 */

import type { HookHandler, HookContext, HookResult } from './types.js';
import { ensureDir } from '@opencode-sflow/shared';
import { isValidTransition, getValidTransitions } from '@opencode-sflow/core';
import { readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';

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

// Helper functions with atomic write for concurrency safety
const STATE_FILE_PATH = '.sflow/state.json';

async function readStateFile(changeDir: string): Promise<Record<string, unknown> | null> {
  if (!changeDir) return null;
  try {
    const content = await readFile(`${changeDir}/${STATE_FILE_PATH}`, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function atomicWriteStateFile(changeDir: string, state: Record<string, unknown>): Promise<void> {
  const target = `${changeDir}/${STATE_FILE_PATH}`;
  const tmp = `${target}.tmp.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await rename(tmp, target);
}

async function getCurrentState(changeDir: string): Promise<string | null> {
  const state = await readStateFile(changeDir);
  if (state) {
    return (state.state as string) || (state.currentState as string) || 'exploring';
  }
  return null;
}

async function updateState(changeDir: string, newState: string): Promise<void> {
  const now = new Date().toISOString();
  let state: Record<string, unknown> = {};
  const existing = await readStateFile(changeDir);
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
  await atomicWriteStateFile(changeDir, state);
}
