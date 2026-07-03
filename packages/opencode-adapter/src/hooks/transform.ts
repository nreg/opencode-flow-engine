import type { HookHandler, HookContext, HookResult } from './types.js';
import { readJsonFile } from '@opencode-sflow/shared';

const STATE_SUMMARIES: Record<string, string> = {
  exploring: 'Exploring requirements — gathering and clarifying needs',
  specifying: 'Specifying — writing proposals and specs',
  bridging: 'Bridging — building execution contract from specs',
  'approved-for-build': 'Approved for build — contract approved, ready for implementation',
  executing: 'Executing — implementing tasks with TDD',
  debugging: 'Debugging — investigating and fixing bugs',
  closing: 'Closing — verifying and archiving',
  abandoned: 'Abandoned — workflow was abandoned',
};

export function createPreProcessHook(): HookHandler {
  return {
    name: 'pre_process',
    description: 'Transform user messages before agent processing',
    execute: async (context: HookContext): Promise<HookResult> => {
      const { changeDir, data } = context;

      const currentState = (data?.currentState as string) ??
        (await readJsonFile<{ state?: string }>(`${changeDir}/.sflow/state.json`))?.state;

      if (!currentState) {
        return { success: true, data: { transformed: false } };
      }

      const summary = STATE_SUMMARIES[currentState] ?? `Unknown state: ${currentState}`;
      const contextLines = [
        `[sFlow Workflow] State: ${currentState}`,
        summary,
        'Follow state-specific rules and only produce artifacts appropriate for this phase.',
      ];

      return {
        success: true,
        data: {
          transformed: true,
          context: contextLines.join('\n'),
        },
      };
    },
  };
}

export function createPostProcessHook(): HookHandler {
  return {
    name: 'post_process',
    description: 'Transform agent responses before returning to user',
    execute: async (context: HookContext): Promise<HookResult> => {
      const { changeDir, data } = context;

      const outputText = data?.output as string | undefined;
      if (!outputText) {
        return { success: true, data: { transformed: false } };
      }

      const stateMatch = outputText.match(/"state"\s*:\s*"(\w[\w-]*)"/);
      if (!stateMatch) {
        return { success: true, data: { transformed: false } };
      }

      const detectedState = stateMatch[1];
      const currentState = (await readJsonFile<{ state?: string }>(`${changeDir}/.sflow/state.json`))?.state;

      if (detectedState !== currentState) {
        return {
          success: true,
          data: {
            transformed: true,
            stateTransitionSignal: { from: currentState, to: detectedState },
          },
        };
      }

      return { success: true, data: { transformed: false } };
    },
  };
}
