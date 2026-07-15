import type { HookHandler, HookContext, HookResult } from './types.js';
import { isValidTransition, getValidTransitions } from '@opencode-flow-engine/core';
import { fileExists, directoryExists, readJsonFile, readFile } from '@opencode-flow-engine/shared';
import { checkArtifactPreflight, findPreflightState } from '../features/artifact-preflight.js';
import { writeStateFile } from '../features/state-manager.js';
import { recommendExecutionMode } from '../features/execution-plan.js';

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

        // P1 fix: Preflight gate — check target state's required artifacts BEFORE transitioning
        const pf = await checkArtifactPreflight({
          changeDir,
          targetState: newState,
          fileExists,
          directoryExists,
          readJson: readJsonFile,
        });
        if (!pf.passed) {
          const route = findPreflightState(pf.missing);
          return {
            success: false,
            error: `Preflight gate: missing artifacts for state "${newState}": ${pf.missing.join(', ')}`,
            block: true,
            blockReason: '[SFLOW] Preflight gate: missing ' + pf.missing.join(', ') + '. Route to "' + route + '" first.',
          };
        }

        // DP-4: Auto-recommend execution mode on bridging→approved-for-build
        const extra: Record<string, unknown> = {};
        if (currentState === 'bridging' && newState === 'approved-for-build') {
          try {
            const tasksMdContent = await readFile(`${changeDir}/tasks.md`);
            if (tasksMdContent) {
              const dp4Result = recommendExecutionMode(tasksMdContent);
              extra.dp_4_result = dp4Result;
            }
          } catch {
          }
        }

        await updateState(changeDir, newState, Object.keys(extra).length > 0 ? extra : undefined);

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

async function updateState(changeDir: string, newState: string, extra?: Record<string, unknown>): Promise<void> {
  await writeStateFile(changeDir, newState, extra);
}

