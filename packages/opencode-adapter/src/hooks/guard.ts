/**
 * Guard hook - Guard state transitions and block invalid operations
 */

import type { HookHandler, HookContext, HookResult } from './types.js';
import { fileExists, readFile, readJsonFile } from '@opencode-sflow/shared';

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
  if (!changeDir) return { success: true };

  const contractPath = `${changeDir}/execution-contract.md`;
  const proposalPath = `${changeDir}/proposal.md`;

  const contractExists = await fileExists(contractPath);
  const proposalExists = await fileExists(proposalPath);

  if (!contractExists || !proposalExists) return { success: true };

  try {
    const contractModTime = Bun.file(contractPath).lastModified;
    const proposalModTime = Bun.file(proposalPath).lastModified;

    if (proposalModTime > contractModTime) {
      return {
        success: false,
        block: true,
        blockReason: 'Contract is stale: proposal.md was modified after execution-contract.md was created',
      };
    }
  } catch {
    return { success: true };
  }
  return { success: true };
}

async function checkTaskCompletion(changeDir: string): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const tasksContent = await readFile(`${changeDir}/tasks.md`);
  if (!tasksContent) return { success: true };

  const taskLines = tasksContent.split('\n').filter(line => line.match(/^-\s*\[.\]\s+/));
  if (taskLines.length === 0) return { success: true };

  const incompleteTasks = taskLines.filter(line => line.match(/^-\s*\[\s\]/));
  if (incompleteTasks.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `${incompleteTasks.length} task(s) are incomplete. Complete all tasks before closing.`,
    };
  }
  return { success: true };
}

async function checkDebuggingState(changeDir: string): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/.sflow/state.json`);
  if (stateData?.state === 'debugging') {
    return {
      success: false,
      block: true,
      blockReason: 'Workflow is in debugging state. Fix the bug and transition back to executing before continuing.',
    };
  }
  return { success: true };
}
