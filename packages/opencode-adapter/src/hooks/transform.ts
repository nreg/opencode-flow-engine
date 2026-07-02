import type { HookHandler, HookContext, HookResult } from './types.js';

export function createPreProcessHook(): HookHandler {
  return {
    name: 'pre_process',
    description: 'Transform user messages before agent processing',
    execute: async (context: HookContext): Promise<HookResult> => {
      return { success: true, data: { transformed: false } };
    },
  };
}

export function createPostProcessHook(): HookHandler {
  return {
    name: 'post_process',
    description: 'Transform agent responses before returning to user',
    execute: async (context: HookContext): Promise<HookResult> => {
      return { success: true, data: { transformed: false } };
    },
  };
}
