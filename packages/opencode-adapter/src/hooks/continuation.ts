import type { HookHandler, HookContext, HookResult } from './types.js';
import { readJsonFile, fileExists, directoryExists } from '@opencode-sflow/shared';

const TERMINAL_STATES = new Set(['closing', 'abandoned']);
const DEFAULT_NEXT_SKILL: Record<string, string> = {
  exploring: 'need-explorer',
  specifying: 'spec-writer',
  bridging: 'contract-builder',
  'approved-for-build': 'build-executor',
  executing: 'build-executor',
  debugging: 'bug-investigator',
  closing: 'release-archivist',
};

export function createContinuationHook(): HookHandler {
  return {
    name: 'continuation',
    description: 'Check if workflow should auto-continue to next state and report routing info',
    execute: async (context: HookContext): Promise<HookResult> => {
      const { changeDir } = context;

      const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/.sflow/state.json`);

      if (!stateData?.state) {
        return {
          success: true,
          data: { shouldContinue: false, reason: 'No workflow state found', next: 'manual', skill: 'need-explorer', hint: 'Start a new workflow or resume an existing change.' },
        };
      }

      const currentState = stateData.state;

      if (TERMINAL_STATES.has(currentState)) {
        return {
          success: true,
          data: { shouldContinue: false, reason: `Workflow is in terminal state: ${currentState}`, next: 'done', skill: null, hint: null },
        };
      }

      const skill = DEFAULT_NEXT_SKILL[currentState] || 'need-explorer';

      return {
        success: true,
        data: {
          shouldContinue: true,
          reason: `Workflow state ${currentState} is active`,
          next: 'auto',
          skill,
          hint: null,
        },
      };
    },
  };
}
