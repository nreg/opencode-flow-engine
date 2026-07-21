/**
 * IFlow State Transition Hook
 *
 * Manages IFlow state transitions with cyclic validation.
 * Unlike sFlow's linear 9-state model, IFlow uses a 6-state cyclic model:
 *   discussing → researching → planning → executing → verifying → shipping → discussing
 *
 * This hook ensures:
 * - Invalid transitions are blocked (e.g., executing → shipping without verifying)
 * - State is written to .flow-engine/iflow/state.json with previousState tracking
 * - Transition history is preserved for debugging
 */

import type { HookHandler, HookContext, HookResult } from './types.js';
import { readJsonFile, ensureDir, writeJsonFile } from '@opencode-flow-engine/shared';

const IFLOW_STATES = ['discussing', 'researching', 'planning', 'executing', 'verifying', 'shipping'] as const;
type IFlowState = typeof IFLOW_STATES[number];

/**
 * Valid cyclic transitions for IFlow
 * Each state can only transition to its defined successors.
 */
const VALID_TRANSITIONS: Record<IFlowState, IFlowState[]> = {
  discussing: ['researching'],
  researching: ['planning', 'discussing'],  // can go back to discuss if research reveals issues
  planning: ['executing', 'researching'],   // can go back to research if plan reveals unknowns
  executing: ['verifying', 'planning'],     // can go back to planning if execution blocked
  verifying: ['shipping', 'executing'],     // can go back to execute if verification fails
  shipping: ['discussing'],                 // always return to discussing for next cycle
};

/**
 * Create the IFlow state transition hook
 */
export function createIFlowStateTransitionHook(): HookHandler {
  return {
    name: 'iflow_state_transition',
    description: 'Manage IFlow state transitions with cyclic validation',
    execute: async (context: HookContext): Promise<HookResult> => {
      const { changeDir, data } = context;

      try {
        const currentState = await getCurrentIFlowState(changeDir);
        const newState = data?.newState as string | undefined;

        // If no new state requested, just return current state
        if (!newState) {
          return { success: true, data: { currentState } };
        }

        // Validate the transition
        if (currentState) {
          const allowed = VALID_TRANSITIONS[currentState as IFlowState];
          if (allowed && !allowed.includes(newState as IFlowState)) {
            return {
              success: false,
              error: `Invalid IFlow transition from ${currentState} to ${newState}`,
              block: true,
              blockReason: `Cannot transition from ${currentState} to ${newState}. Valid targets: ${allowed.join(', ')}`,
            };
          }
          // If current state is not a recognized IFlow state, allow any transition
          if (!allowed) {
            return {
              success: false,
              error: `Current state "${currentState}" is not a valid IFlow state`,
              block: true,
              blockReason: `Current state "${currentState}" is not recognized as an IFlow state. Valid states: ${IFLOW_STATES.join(', ')}`,
            };
          }
        }

        // Write the state
        await ensureDir(`${changeDir}/.flow-engine/iflow`);
        await writeJsonFile(`${changeDir}/.flow-engine/iflow/state.json`, {
          state: newState,
          previousState: currentState || undefined,
          updatedAt: new Date().toISOString(),
        });

        return {
          success: true,
          data: { from: currentState || null, to: newState, timestamp: new Date().toISOString() },
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
 * Read the current IFlow state from .flow-engine/iflow/state.json
 */
async function getCurrentIFlowState(changeDir: string): Promise<string | null> {
  try {
    const state = await readJsonFile<{ state?: string }>(`${changeDir}/.flow-engine/iflow/state.json`);
    return state?.state || null;
  } catch {
    return null;
  }
}
