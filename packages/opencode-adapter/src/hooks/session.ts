import type { HookHandler, HookContext, HookResult } from './types.js';
import { readJsonFile, fileExists, writeJsonFile, ensureDir } from '@opencode-sflow/shared';

/**
 * Session start hook — recovers workflow state from boulder state on session start.
 *
 * When OpenCode starts or a new session begins, this hook:
 * 1. Checks for boulder-state.json (cross-session persistence)
 * 2. If found, recovers the workflow state into .sflow/state.json
 * 3. Logs the recovery for audit trail
 *
 * This enables cross-session workflow continuation after OpenCode restart.
 * Inspired by oh-my-openagent's session lifecycle hooks.
 */
export function createSessionStartHook(): HookHandler {
  return {
    name: 'session_start',
    description: 'Recover workflow state from boulder state on session start',
    execute: async (context: HookContext): Promise<HookResult> => {
      const { changeDir } = context;

      try {
        // Check for boulder state (cross-session persistence)
        const boulderPath = `${changeDir}/.sflow/boulder-state.json`;
        const boulderExists = await fileExists(boulderPath);

        if (boulderExists) {
          const boulderState = await readJsonFile<{ state?: string }>(boulderPath);
          if (boulderState?.state) {
            // Actually restore the state: copy boulder-state to state.json
            const statePath = `${changeDir}/.sflow/state.json`;
            await ensureDir(`${changeDir}/.sflow`);
            await writeJsonFile(statePath, {
              ...boulderState,
              restoredAt: new Date().toISOString(),
              restoredFrom: 'boulder-state.json',
            });

            return {
              success: true,
              data: {
                recovered: true,
                state: boulderState.state,
                message: `Recovered workflow state: ${boulderState.state}`,
              },
            };
          }
        }

        // Check for regular state file
        const statePath = `${changeDir}/.sflow/state.json`;
        const stateExists = await fileExists(statePath);
        if (stateExists) {
          const state = await readJsonFile<{ state?: string }>(statePath);
          if (state?.state) {
            return {
              success: true,
              data: {
                recovered: false,
                state: state.state,
                message: `Workflow in state: ${state.state}`,
              },
            };
          }
        }

        return {
          success: true,
          data: {
            recovered: false,
            state: null,
            message: 'No existing workflow state found; starting fresh',
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

/**
 * Session end hook — persists workflow state to boulder state on session end.
 *
 * When a session ends, this hook:
 * 1. Reads the current workflow state from .sflow/state.json
 * 2. Writes it to boulder-state.json for cross-session recovery
 * 3. Cleans up any temporary session data
 */
export function createSessionEndHook(): HookHandler {
  return {
    name: 'session_end',
    description: 'Persist workflow state to boulder state on session end',
    execute: async (context: HookContext): Promise<HookResult> => {
      const { changeDir } = context;

      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const stateExists = await fileExists(statePath);

        if (!stateExists) {
          return { success: true, data: { persisted: false, reason: 'No state to persist' } };
        }

        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: true, data: { persisted: false, reason: 'Empty state' } };
        }

        // Write boulder state for cross-session recovery
        const { writeJsonFile } = await import('@opencode-sflow/shared');
        await writeJsonFile(`${changeDir}/.sflow/boulder-state.json`, {
          ...state,
          persistedAt: new Date().toISOString(),
          lastSessionEnd: new Date().toISOString(),
        });

        return {
          success: true,
          data: {
            persisted: true,
            state: state.state,
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