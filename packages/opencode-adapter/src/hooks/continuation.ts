import type { HookHandler, HookContext, HookResult } from './types.js';

export function createContinuationHook(): HookHandler {
  return {
    name: 'continuation',
    description: 'Check if workflow should auto-continue to next state',
    execute: async (context: HookContext): Promise<HookResult> => {
      return {
        success: true,
        data: { shouldContinue: false, reason: 'No continuation requested' },
      };
    },
  };
}
