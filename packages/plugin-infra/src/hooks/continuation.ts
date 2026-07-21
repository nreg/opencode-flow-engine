import type { HookHandler, HookContext, HookResult } from './types.js';
import { readJsonFile, fileExists } from '@opencode-flow-engine/shared';

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

      const stateData = await readJsonFile<{ state?: string; mode?: string; build_pause?: string | null; isolation?: string; build_mode?: string }>(`${changeDir}/.flow-engine/sflow/state.json`);

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

      // C15: Stale pause detection with 3 sub-states (inspired by comet SKILL.md Resume rules)
      const buildPause = stateData.build_pause;
      if (currentState === 'executing' && buildPause && buildPause !== null) {
        const isolation = stateData.isolation;
        const buildMode = stateData.build_mode;
        const contractExists = await fileExists(`${changeDir}/execution-contract.md`);

        // Sub-state 1: Corrupted pause — build_pause set but contract file missing
        if (!contractExists) {
          return {
            success: true,
            data: {
              shouldContinue: false,
              reason: `Detected corrupted pause (build_pause=${buildPause} but execution-contract.md is missing). Route back to contract-builder to regenerate the contract.`,
              stale_pause_cleared: false,
              phase_advanced: false,
              auto_invoke: false,
              pause_state: 'corrupted',
              next: 'manual',
              skill: 'contract-builder',
              hint: 'Contract file missing while build was paused. Regenerate before resuming.',
            },
          };
        }

        // Sub-state 2: Normal pause — build_pause set but isolation/build_mode not yet configured
        if (!isolation || !buildMode) {
          return {
            success: true,
            data: {
              shouldContinue: false,
              reason: `Build paused (build_pause=${buildPause}). Isolation or build_mode not yet configured. Route to build-executor to complete setup.`,
              stale_pause_cleared: false,
              phase_advanced: false,
              auto_invoke: false,
              pause_state: 'normal',
              next: 'manual',
              skill: 'build-executor',
              hint: 'Build is paused at plan-ready stage. Complete isolation/build_mode configuration before resuming.',
            },
          };
        }

        // Sub-state 3: Stale pause — build_pause set but isolation/build_mode already configured
        return {
          success: true,
          data: {
            shouldContinue: true,
            reason: `Detected stale pause (build_pause=${buildPause} but isolation/build_mode already set). Auto-clearing and continuing.`,
            stale_pause_cleared: true,
            phase_advanced: true,
            auto_invoke: true,
            pause_state: 'stale',
            next: 'auto',
            skill,
            hint: null,
          },
        };
      }

      // States that require user approval or explicit delegation — never auto-continue.
      // The orchestrator must stop and wait for the user to say "go" before dispatching.
      const MANUAL_STATES = new Set(['approved-for-build', 'executing']);
      if (MANUAL_STATES.has(currentState)) {
        return {
          success: true,
          data: {
            shouldContinue: false,
            reason: `Workflow is at ${currentState} — waiting for user action`,
            phase_advanced: false,
            auto_invoke: false,
            next: 'manual',
            skill,
            hint: currentState === 'approved-for-build'
              ? `Contract ready for review. Ask the user to approve before proceeding.`
              : `State is ${currentState}. Ask the user whether to dispatch build-executor for implementation.`,
          },
        };
      }

      // Read auto_transition config from .flow-engine/sflow/config.json (change-level) or default to true
      let autoTransition = true;
      const configPath = `${changeDir}/.flow-engine/sflow/config.json`;
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
