import type { HookHandler, HookContext, HookResult } from './types.js';
import { readJsonFile, fileExists, writeJsonFile, ensureDir, directoryExists, readFile } from '@opencode-sflow/shared';
import { detectStateMismatch } from '../features/state-manager.js';

/**
 * Session start hook — recovers workflow state from boulder state on session start.
 *
 * C14+R4-2: Uses canonical detectStateMismatch from state-manager.ts
 * state ↔ artifact inconsistencies (same logic as state-manager.restoreState).
 */


export function createSessionStartHook(): HookHandler {
  return {
    name: 'session_start',
    description: 'Recover workflow state from boulder state on session start (with auto-repair)',
    execute: async (context: HookContext): Promise<HookResult> => {
      const { changeDir } = context;

      try {
        let recoveredState: string | null = null;
        let restoredFrom = 'fresh';

        // Step 1: Recover from boulder state (cross-session persistence)
        const boulderPath = `${changeDir}/.sflow/boulder-state.json`;
        const boulderExists = await fileExists(boulderPath);

        if (boulderExists) {
          const boulderState = await readJsonFile<{ state?: string }>(boulderPath);
          if (boulderState?.state) {
            recoveredState = boulderState.state;
            restoredFrom = 'boulder-state.json';
          }
        }

        // Step 2: Fall back to regular state file
        if (!recoveredState) {
          const statePath = `${changeDir}/.sflow/state.json`;
          const stateExists = await fileExists(statePath);
          if (stateExists) {
            const state = await readJsonFile<{ state?: string }>(statePath);
            if (state?.state) {
              recoveredState = state.state;
              restoredFrom = 'state.json';
            }
          }
        }

        if (!recoveredState) {
          return {
            success: true,
            data: {
              recovered: false,
              state: null,
              message: 'No existing workflow state found; starting fresh',
            },
          };
        }

        // Step 3: C14 — Run detectStateMismatch to auto-repair state vs artifacts
        const repairedState = await detectStateMismatch(changeDir, recoveredState);
        const wasRepaired = repairedState !== recoveredState;

        // Step 4: Write the (possibly repaired) state
        const statePath = `${changeDir}/.sflow/state.json`;
        await ensureDir(`${changeDir}/.sflow`);
        await writeJsonFile(statePath, {
          state: repairedState,
          restoredAt: new Date().toISOString(),
          restoredFrom,
          ...(wasRepaired ? {
            repairedFrom: recoveredState,
            repairedAt: new Date().toISOString(),
          } : {}),
        });

        return {
          success: true,
          data: {
            recovered: true,
            state: repairedState,
            repaired: wasRepaired,
            message: wasRepaired
              ? `Recovered workflow state: ${recoveredState} → auto-repaired to ${repairedState} (artifact mismatch)`
              : `Workflow state: ${repairedState}`,
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