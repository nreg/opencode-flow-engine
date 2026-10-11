/**
 * Artifact Validation hook - Validate artifacts on state transitions
 */

import { basename, dirname, join } from 'node:path';
import type { HookHandler, HookContext, HookResult } from './types.js';
import { sharedValidator } from '@opencode-flow-engine/core';
import { readFile, listFiles, fileExists } from '@opencode-flow-engine/shared';
import { applyDeltaToBaselineDetailed } from '../features/spec-publication.js';
import { readArtifactContent, listSpecFiles, readSpecContent } from '../features/state-manager/artifact-paths.js';

/**
 * Create the artifact validation hook
 */
export function createArtifactValidationHook(): HookHandler {
  return {
    name: 'artifact_validation',
    description: 'Validate artifacts when transitioning between states',
    execute: async (context) => {
      const { workDir, data } = context;

      try {
        const newState = data?.newState as string;

        switch (newState) {
          case 'specifying':
            return await validateForSpecifying(workDir);
          case 'bridging':
            return await validateForBridging(workDir);
          case 'approved-for-build':
            return await validateForExecution(workDir);
          case 'closing':
            return await validateForClosing(workDir);
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

async function validateForSpecifying(workDir: string): Promise<HookResult> {
  const proposalContent = await readArtifactContent(workDir, 'proposal.md');
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

async function validateForBridging(workDir: string): Promise<HookResult> {
  const specFiles = await listSpecFiles(workDir);

  if (specFiles.length === 0) {
    return {
      success: false,
      error: 'No spec files found',
      block: true,
      blockReason: 'Cannot enter bridging state without specs',
    };
  }

  // Step 1: Schema validation (delta specs)
  for (const specFile of specFiles) {
    const specContent = await readSpecContent(workDir, specFile);
    if (specContent) {
      // Validate as delta spec (not baseline spec)
      const report = sharedValidator.validateDeltaSpec(specContent, specFile.replace('.md', ''));
      if (!report.valid) {
        return {
          success: false,
          error: `Delta spec validation failed: ${specFile}`,
          block: true,
          blockReason: `Delta spec ${specFile} has ${report.summary.errors} error(s)`,
        };
      }
    }
  }

  // Step 2: Preflight delta specs against baselines (Wave 3: P1)
  const projectRoot = deriveProjectRoot(workDir);
  if (projectRoot) {
    // Only run preflight if workDir follows changes/ convention
    for (const specFile of specFiles) {
      const preflightError = await preflightDeltaSpec(projectRoot, workDir, specFile);
      if (preflightError) {
        return {
          success: false,
          error: preflightError,
          block: true,
          blockReason: `Delta spec ${specFile} conflicts with baseline`,
        };
      }
    }
  }

  return { success: true };
}

async function validateForExecution(workDir: string): Promise<HookResult> {
  const contractContent = await readArtifactContent(workDir, 'execution-contract.md');
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

async function validateForClosing(workDir: string): Promise<HookResult> {
  const tasksContent = await readArtifactContent(workDir, 'tasks.md');
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

// ─── Wave 3: P1 Spec Baseline Preflight ──────────────────────────────────────

/**
 * Derive projectRoot from workDir
 * 
 * spec-superflow convention: workDir is under changes/ directory
 * Example: /project/changes/my-change → /project
 * 
 * If workDir doesn't follow this convention, return null (skip preflight)
 */
function deriveProjectRoot(workDir: string): string | null {
  const parent = dirname(workDir);
  const dirName = basename(parent);
  
  // Check if parent directory is named 'changes'
  if (dirName === 'changes') {
    return dirname(parent);
  }
  
  // Not following changes/ convention, skip preflight
  return null;
}

/**
 * Preflight delta spec against baseline
 * 
 * Calls applyDeltaToBaselineDetailed to detect conflicts between delta spec
 * and baseline spec. Returns null if successful, or error message if conflict detected.
 */
async function preflightDeltaSpec(
  projectRoot: string,
  workDir: string,
  specFile: string
): Promise<string | null> {
  // Extract capability from spec file path
  // specFile is relative to workDir/specs, e.g., "auth.md"
  const capability = specFile.replace('.md', '');
  
  // Read baseline spec
  const baselinePath = join(projectRoot, 'specs', capability, 'spec.md');
  const baselineExists = await fileExists(baselinePath);
  const baselineContent = baselineExists ? (await readFile(baselinePath) || '') : '';
  
  // Read delta spec with dual-path compatibility
  const deltaContent = await readSpecContent(workDir, specFile);
  
  if (!deltaContent) {
    // No delta spec content, skip
    return null;
  }
  
  // If no baseline exists, this is a new capability - skip preflight
  if (!baselineExists) {
    return null;
  }
  
  try {
    // Apply delta to baseline to detect conflicts
    applyDeltaToBaselineDetailed(baselineContent, deltaContent, capability);
    return null; // Success, no conflicts
  } catch (error) {
    // Conflict detected
    const message = error instanceof Error ? error.message : String(error);
    return `(baseline preflight) ${message}`;
  }
}
