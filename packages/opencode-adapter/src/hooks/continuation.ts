import type { HookHandler, HookContext, HookResult } from './types.js';
import { readJsonFile } from '@opencode-sflow/shared';

const TERMINAL_STATES = new Set(['closing', 'abandoned']);

export function createContinuationHook(): HookHandler {
  return {
    name: 'continuation',
    description: 'Check if workflow should auto-continue to next state',
    execute: async (context: HookContext): Promise<HookResult> => {
      const { changeDir } = context;

      const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/.sflow/state.json`);

      if (!stateData?.state) {
        return {
          success: true,
          data: { shouldContinue: false, reason: 'No workflow state found' },
        };
      }

      if (TERMINAL_STATES.has(stateData.state)) {
        return {
          success: true,
          data: { shouldContinue: false, reason: `Workflow is in terminal state: ${stateData.state}` },
        };
      }

      return {
        success: true,
        data: { shouldContinue: true, reason: `Workflow state ${stateData.state} is active` },
      };
    },
  };
}
