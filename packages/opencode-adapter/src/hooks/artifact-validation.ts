/**
 * Artifact Validation hook - Validate artifacts on state transitions
 */

import type { HookHandler, HookContext, HookResult } from './types.js';
import { sharedValidator } from '@opencode-sflow/core';
import { readFile, listFiles } from '@opencode-sflow/shared';

/**
 * Create the artifact validation hook
 */
export function createArtifactValidationHook(): HookHandler {
  return {
    name: 'artifact_validation',
    description: 'Validate artifacts when transitioning between states',
    execute: async (context) => {
      const { changeDir, data } = context;

      try {
        const newState = data?.newState as string;

        switch (newState) {
          case 'specifying':
            return await validateForSpecifying(changeDir);
          case 'bridging':
            return await validateForBridging(changeDir);
          case 'approved-for-build':
            return await validateForExecution(changeDir);
          case 'closing':
            return await validateForClosing(changeDir);
          default:
            return { success: true };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

async function validateForSpecifying(changeDir: string): Promise<HookResult> {
  const proposalContent = await readFile(`${changeDir}/proposal.md`);
  if (!proposalContent) {
    return {
      success: false,
      error: 'Proposal file not found',
      block: true,
      blockReason: 'Cannot enter specifying state without a proposal',
    };
  }

  const report = sharedValidator.validateChangeContent('proposal', proposalContent);
  if (!report.valid) {
    return {
      success: false,
      error: 'Proposal validation failed',
      block: true,
      blockReason: `Proposal has ${report.summary.errors} error(s)`,
    };
  }

  return { success: true };
}

async function validateForBridging(changeDir: string): Promise<HookResult> {
  const specsDir = `${changeDir}/specs`;
  const specFiles = await listFiles(specsDir, '.md');

  if (specFiles.length === 0) {
    return {
      success: false,
      error: 'No spec files found',
      block: true,
      blockReason: 'Cannot enter bridging state without specs',
    };
  }

  for (const specFile of specFiles) {
    const specContent = await readFile(`${specsDir}/${specFile}`);
    if (specContent) {
      const report = sharedValidator.validateSpecContent(specFile.replace('.md', ''), specContent);
      if (!report.valid) {
        return {
          success: false,
          error: `Spec validation failed: ${specFile}`,
          block: true,
          blockReason: `Spec ${specFile} has ${report.summary.errors} error(s)`,
        };
      }
    }
  }

  return { success: true };
}

async function validateForExecution(changeDir: string): Promise<HookResult> {
  const contractContent = await readFile(`${changeDir}/execution-contract.md`);
  if (!contractContent) {
    return {
      success: false,
      error: 'Execution contract not found',
      block: true,
      blockReason: 'Cannot enter execution state without an execution contract',
    };
  }

  const report = sharedValidator.validateExecutionContract(contractContent);
  if (!report.valid) {
    return {
      success: false,
      error: 'Execution contract validation failed',
      block: true,
      blockReason: `Execution contract has ${report.summary.errors} error(s)`,
    };
  }

  return { success: true };
}

async function validateForClosing(changeDir: string): Promise<HookResult> {
  const tasksContent = await readFile(`${changeDir}/tasks.md`);
  if (!tasksContent) {
    return {
      success: false,
      error: 'Tasks file not found',
      block: true,
      blockReason: 'Cannot enter closing state without tasks',
    };
  }

  const report = sharedValidator.validateTasks(tasksContent);
  if (!report.valid) {
    return {
      success: false,
      error: 'Tasks validation failed',
      block: true,
      blockReason: `Tasks has ${report.summary.errors} error(s)`,
    };
  }

  return { success: true };
}
