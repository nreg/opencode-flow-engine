import type { HookHandler, HookContext, HookResult } from './types.js';

export function createSessionStartHook(): HookHandler {
  return {
    name: 'session_start',
    description: 'Called when a workflow session starts',
    execute: async (context: HookContext): Promise<HookResult> => {
      return { success: true, data: { message: 'Session started' } };
    },
  };
}

export function createSessionEndHook(): HookHandler {
  return {
    name: 'session_end',
    description: 'Called when a workflow session ends',
    execute: async (context: HookContext): Promise<HookResult> => {
      return { success: true, data: { message: 'Session ended' } };
    },
  };
}
