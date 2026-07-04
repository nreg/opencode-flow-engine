import type { HookHandler, HookContext, HookResult } from './types.js';
import { readJsonFile, fileExists, writeJsonFile, ensureDir, directoryExists, readFile } from '@opencode-sflow/shared';

/**
 * Session start hook — recovers workflow state from boulder state on session start.
 *
 * C14 fix: After recovering state, runs detectStateMismatch to auto-repair
 * state ↔ artifact inconsistencies (same logic as state-manager.restoreState).
 */

/** Simple forward-compatible mismatch detection (C14 — unified with state-manager) */
async function detectStateMismatch(changeDir: string, currentState: string): Promise<string> {
  const hasProposal = await fileExists(`${changeDir}/proposal.md`);
  const hasDesign = await fileExists(`${changeDir}/design.md`);
  const hasTasks = await fileExists(`${changeDir}/tasks.md`);
  const hasSpecs = await directoryExists(`${changeDir}/specs`);
  const hasContract = await fileExists(`${changeDir}/execution-contract.md`);

  const tasksContent = hasTasks ? await readFile(`${changeDir}/tasks.md`) : null;
  const incompleteTasks = tasksContent
    ? tasksContent.split("\n").filter((line) => line.match(/^-\s*\[\s\]/)).length
    : 0;
  const taskLines = tasksContent
    ? tasksContent.split("\n").filter((line) => line.match(/^-\s*\[.\]\s+/))
    : [];
  const allTasksChecked = taskLines.length > 0 && incompleteTasks === 0;

  // Backward repair: artifacts suggest earlier state
  if (currentState === "specifying" && !hasProposal) return "exploring";
  if (currentState === "bridging" && (!hasDesign || !hasTasks || !hasSpecs)) return "specifying";
  if (currentState === "approved-for-build" && !hasContract) return "bridging";
  if (currentState === "executing" && !hasContract) return "bridging";
  if (currentState === "debugging" && !hasContract) return "bridging";

  // Forward repair: artifacts suggest later state
  if (currentState === "exploring" && hasProposal) return "specifying";
  if (currentState === "specifying" && hasDesign && hasTasks && hasSpecs) return "bridging";
  if (currentState === "bridging" && hasContract) return "approved-for-build";
  if ((currentState === "approved-for-build" || currentState === "executing") && allTasksChecked) return "closing";

  return currentState;
}

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