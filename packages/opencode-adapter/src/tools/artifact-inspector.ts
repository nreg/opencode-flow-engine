/**
 * Artifact Inspector tool - Inspect planning artifacts
 */

import type { ToolDefinition, ToolContext, ToolResult } from './types.js';
import { Validator } from '@opencode-sflow/core';
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
        changeDir: string;
        artifactType?: string;
      };
      const validator = new Validator();

      try {
        const results: Record<string, unknown> = {};

        // Inspect proposal
        if (!artifactType || artifactType === 'proposal') {
          const proposalContent = await readFile(`${changeDir}/proposal.md`);
          if (proposalContent) {
            results.proposal = validator.validateProposal(proposalContent);
          } else {
            results.proposal = { valid: false, error: 'File not found' };
          }
        }

        // Inspect specs
        if (!artifactType || artifactType === 'specs') {
          const specsDir = `${changeDir}/specs`;
          const specFiles = await listFiles(specsDir);
          results.specs = {};

          for (const specFile of specFiles) {
            const specContent = await readFile(`${specsDir}/${specFile}`);
            if (specContent) {
              (results.specs as Record<string, unknown>)[specFile] = validator.validateSpec(
                specContent,
                specFile.replace('.md', '')
              );
            }
          }
        }

        // Inspect design
        if (!artifactType || artifactType === 'design') {
          const designContent = await readFile(`${changeDir}/design.md`);
          if (designContent) {
            results.design = { valid: true, message: 'Design file exists' };
          } else {
            results.design = { valid: false, error: 'File not found' };
          }
        }

        // Inspect tasks
        if (!artifactType || artifactType === 'tasks') {
          const tasksContent = await readFile(`${changeDir}/tasks.md`);
          if (tasksContent) {
            results.tasks = validator.validateTasks(tasksContent);
          } else {
            results.tasks = { valid: false, error: 'File not found' };
          }
        }

        // Generate summary
        const summary = generateInspectionSummary(results);

        return {
          success: true,
          data: {
            results,
            summary,
            recommendations: generateInspectionRecommendations(results),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          suggestions: ['Check file permissions', 'Verify directory structure'],
        };
      }
    },
  };
}

function generateInspectionSummary(results: Record<string, unknown>): string {
  const issues: string[] = [];

  // Check proposal
  const proposal = results.proposal as { valid: boolean; issues?: Array<{ message: string }> } | undefined;
  if (proposal && !proposal.valid) {
    issues.push(`Proposal: ${proposal.issues?.length || 0} issues`);
  }

  // Check specs
  const specs = results.specs as Record<string, { valid: boolean; issues?: Array<{ message: string }> }> | undefined;
  if (specs) {
    const specIssues = Object.values(specs).filter(s => !s.valid).length;
    if (specIssues > 0) {
      issues.push(`Specs: ${specIssues} files with issues`);
    }
  }

  // Check tasks
  const tasks = results.tasks as { valid: boolean; issues?: Array<{ message: string }> } | undefined;
  if (tasks && !tasks.valid) {
    issues.push(`Tasks: ${tasks.issues?.length || 0} issues`);
  }

  if (issues.length === 0) {
    return 'All artifacts are valid';
  }

  return `Found issues: ${issues.join(', ')}`;
}

function generateInspectionRecommendations(results: Record<string, unknown>): string[] {
  const recommendations: string[] = [];

  // Check proposal
  const proposal = results.proposal as { valid: boolean; issues?: Array<{ level: string; message: string }> } | undefined;
  if (proposal && !proposal.valid) {
    recommendations.push('Fix proposal issues before proceeding');
  }

  // Check specs
  const specs = results.specs as Record<string, { valid: boolean }> | undefined;
  if (specs) {
    const specIssues = Object.values(specs).filter(s => !s.valid).length;
    if (specIssues > 0) {
      recommendations.push('Fix spec issues before proceeding');
    }
  }

  // Check tasks
  const tasks = results.tasks as { valid: boolean } | undefined;
  if (tasks && !tasks.valid) {
    recommendations.push('Fix task issues before proceeding');
  }

  return recommendations;
}
