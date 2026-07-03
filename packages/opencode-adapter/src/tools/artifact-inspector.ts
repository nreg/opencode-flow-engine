/**
 * Artifact Inspector tool - Inspect planning artifacts
 */

import type { ToolDefinition, ToolContext, ToolResult } from './types.js';
import { sharedValidator } from '@opencode-sflow/core';
import { readFile, listFiles } from '@opencode-sflow/shared';

/**
 * Create the artifact inspector tool
 */
export function createArtifactInspectorTool(): ToolDefinition {
  return {
    name: 'artifact_inspector',
    description: 'Inspect planning artifacts for completeness and consistency',
    parameters: {
      changeDir: {
        type: 'string',
        description: 'Path to the change directory',
        required: true,
      },
      artifactType: {
        type: 'string',
        description: 'Type of artifact to inspect (proposal, specs, design, tasks)',
        required: false,
      },
    },
    execute: async (params, context) => {
      const { changeDir, artifactType } = params as {
        changeDir?: string;
        artifactType?: string;
      };
      const resolvedDir = changeDir || context.directory;

      try {
        const results: Record<string, unknown> = {};

        // Inspect proposal (also validates as change content)
        if (!artifactType || artifactType === 'proposal') {
          const proposalContent = await readFile(`${resolvedDir}/proposal.md`);
          if (proposalContent) {
            results.proposal = sharedValidator.validateChangeContent('proposal', proposalContent);
          } else {
            results.proposal = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
          }
        }

        // Inspect specs (block-level validation)
        if (!artifactType || artifactType === 'specs') {
          const specsDir = `${resolvedDir}/specs`;
          const specFiles = await listFiles(specsDir, '.md');
          results.specs = {};

          for (const specFile of specFiles) {
            const specContent = await readFile(`${specsDir}/${specFile}`);
            if (specContent) {
              (results.specs as Record<string, unknown>)[specFile] = sharedValidator.validateSpecContent(
                specFile.replace('.md', ''),
                specContent,
              );
            }
          }
        }

        // Inspect design
        if (!artifactType || artifactType === 'design') {
          const designContent = await readFile(`${resolvedDir}/design.md`);
          if (designContent) {
            results.design = sharedValidator.validateDesign(designContent);
          } else {
            results.design = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
          }
        }

        // Inspect tasks
        if (!artifactType || artifactType === 'tasks') {
          const tasksContent = await readFile(`${resolvedDir}/tasks.md`);
          if (tasksContent) {
            results.tasks = sharedValidator.validateTasks(tasksContent);
          } else {
            results.tasks = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
          }
        }

        const summary = generateInspectionSummary(results);
        const recommendations = generateInspectionRecommendations(results);

        return {
          title: 'Artifact Inspector',
          output: JSON.stringify({
            results,
            summary,
            recommendations,
          }),
        };
      } catch (error) {
        return {
          title: 'Artifact Inspector',
          output: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    },
  };
}

function generateInspectionSummary(results: Record<string, unknown>): string {
  const issues: string[] = [];

  const proposal = results.proposal as { valid: boolean; summary?: { errors: number } } | undefined;
  if (proposal && !proposal.valid) {
    issues.push(`Proposal: ${proposal.summary?.errors || 0} error(s)`);
  }

  const specs = results.specs as Record<string, { valid: boolean; summary?: { errors: number } }> | undefined;
  if (specs) {
    const specErrors = Object.values(specs).filter(s => !s.valid).length;
    if (specErrors > 0) {
      issues.push(`Specs: ${specErrors} file(s) with errors`);
    }
  }

  const tasks = results.tasks as { valid: boolean; summary?: { errors: number } } | undefined;
  if (tasks && !tasks.valid) {
    issues.push(`Tasks: ${tasks.summary?.errors || 0} error(s)`);
  }

  if (issues.length === 0) {
    return 'All artifacts are valid';
  }

  return `Found issues: ${issues.join(', ')}`;
}

function generateInspectionRecommendations(results: Record<string, unknown>): string[] {
  const recommendations: string[] = [];

  const proposal = results.proposal as { valid: boolean } | undefined;
  if (proposal && !proposal.valid) {
    recommendations.push('Fix proposal issues before proceeding');
  }

  const specs = results.specs as Record<string, { valid: boolean }> | undefined;
  if (specs) {
    const specErrors = Object.values(specs).filter(s => !s.valid).length;
    if (specErrors > 0) {
      recommendations.push('Fix spec issues before proceeding');
    }
  }

  const tasks = results.tasks as { valid: boolean } | undefined;
  if (tasks && !tasks.valid) {
    recommendations.push('Fix task issues before proceeding');
  }

  return recommendations;
}
