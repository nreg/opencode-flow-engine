/**
 * Guard hook - Guard state transitions and block invalid operations
 */

import type { HookHandler, HookContext, HookResult } from './types.js';

/**
 * Create the guard hook
 */
export function createGuardHook(): HookHandler {
  return {
    name: 'guard',
    description: 'Guard state transitions and block invalid operations',
    execute: async (context) => {
      const { changeDir, action, data } = context;

      try {
        // Check for various guard conditions
        const guards = [
          await checkArtifactExistence(changeDir),
          await checkContractStaleness(changeDir),
          await checkTaskCompletion(changeDir),
          await checkDebuggingState(changeDir),
        ];

        // Find any blocking guards
        const blockingGuards = guards.filter(g => g.block);
        if (blockingGuards.length > 0) {
          return {
            success: false,
            error: 'Guard conditions not met',
            block: true,
            blockReason: blockingGuards.map(g => g.blockReason).join('; '),
          };
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

// Guard functions
async function checkArtifactExistence(changeDir: string): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const dirExists = await fileExists(changeDir);
  if (!dirExists) return { success: true };

  const requiredArtifacts = ['proposal.md', 'specs', 'design.md', 'tasks.md'];
  const missingArtifacts: string[] = [];

  for (const artifact of requiredArtifacts) {
    const exists = await fileExists(`${changeDir}/${artifact}`);
    if (!exists) {
      missingArtifacts.push(artifact);
    }
  }

  if (missingArtifacts.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `Missing required artifacts: ${missingArtifacts.join(', ')}`,
    };
  }

  return { success: true };
}

async function checkContractStaleness(changeDir: string): Promise<HookResult> {
  // TODO: Implement contract staleness check
  // Compare proposal scope vs contract intent lock
  return { success: true };
}

async function checkTaskCompletion(changeDir: string): Promise<HookResult> {
  // TODO: Implement task completion check
  // Check if all tasks are marked complete
  return { success: true };
}

async function checkDebuggingState(changeDir: string): Promise<HookResult> {
  // TODO: Implement debugging state check
  // Check if we're in debugging state and need to complete debugging first
  return { success: true };
}

// Helper functions
async function fileExists(path: string): Promise<boolean> {
  try {
    const file = Bun.file(path);
    return await file.exists();
  } catch {
    return false;
  }
}
