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

      const stateData = await readJsonFile<{ state?: string; mode?: string; build_pause?: string | null; isolation?: string; build_mode?: string }>(`${changeDir}/.sflow/state.json`);

      if (!stateData?.state) {
        return {
          success: true,
          data: {
            shouldContinue: false,
            reason: 'No workflow state found',
            phase_advanced: false,
            auto_invoke: false,
            next: 'manual',
            skill: 'need-explorer',
            hint: 'Start a new workflow or resume an existing change.',
          },
        };
      }

      const currentState = stateData.state;

      if (TERMINAL_STATES.has(currentState)) {
        return {
          success: true,
          data: {
            shouldContinue: false,
            reason: `Workflow is in terminal state: ${currentState}`,
            phase_advanced: false,
            auto_invoke: false,
            next: 'done',
            skill: null,
            hint: null,
          },
        };
      }

      const skill = DEFAULT_NEXT_SKILL[currentState] || 'need-explorer';

      // Stale pause detection: build_pause set but isolation/build_mode already configured
      const buildPause = stateData.build_pause;
      if (currentState === 'executing' && buildPause && buildPause !== null) {
        const isolation = stateData.isolation;
        const buildMode = stateData.build_mode;
        if (isolation && buildMode) {
          return {
            success: true,
            data: {
              shouldContinue: true,
              reason: `Detected stale pause (build_pause=${buildPause} but isolation/build_mode already set). Auto-clearing and continuing.`,
              stale_pause_cleared: true,
              phase_advanced: true,
              auto_invoke: true,
              next: 'auto',
              skill,
              hint: null,
            },
          };
        }
      }

      // Read auto_transition config from .sflow/config.json (change-level) or default to true
      let autoTransition = true;
      const configPath = `${changeDir}/.sflow/config.json`;
      const configExists = await fileExists(configPath);
      if (configExists) {
        const config = await readJsonFile<{ auto_transition?: boolean }>(configPath);
        if (config && config.auto_transition === false) {
          autoTransition = false;
        }
      }

      return {
        success: true,
        data: {
          shouldContinue: autoTransition,
          reason: `Workflow state ${currentState} is active`,
          phase_advanced: true,
          auto_invoke: autoTransition,
          next: autoTransition ? 'auto' : 'manual',
          skill,
          hint: autoTransition ? null : `Workflow state is ${currentState}. Run /${skill} to continue.`,
        },
      };
    },
  };
}
