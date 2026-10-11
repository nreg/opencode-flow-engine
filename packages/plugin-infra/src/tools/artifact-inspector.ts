/**
 * Artifact Inspector tool - Inspect planning artifacts
 */

import type { ToolDefinition, ToolContext, ToolResult } from './types.js';
import { sharedValidator } from '@opencode-flow-engine/core';
import { resolveChangeDir } from '../helpers/resolve-change-dir.js';
import { readArtifactContent, listSpecFiles, readSpecContent } from '../features/state-manager/artifact-paths.js';
import { probeMisplacedArtifact, describeMissingArtifact } from '../helpers/misplaced-artifact.js';

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
        description: 'Type of artifact to inspect (proposal, specs, design, tasks, ui-design)',
        required: false,
      },
    },
    execute: async (params, context) => {
      const { changeDir, artifactType } = params as {
        changeDir?: string;
        artifactType?: string;
      };
      const resolvedDir = resolveChangeDir(changeDir, context.directory);

      try {
        const results: Record<string, unknown> = {};

        // Inspect proposal (also validates as change content)
        if (!artifactType || artifactType === 'proposal') {
          const proposalContent = await readArtifactContent(resolvedDir, 'proposal.md');
if (proposalContent) {
            results.proposal = sharedValidator.validateChangeContent('proposal', proposalContent);
          } else {
            results.proposal = await notFoundError(resolvedDir, 'proposal.md');
          }
        }

        // Inspect specs (block-level validation)
        if (!artifactType || artifactType === 'specs') {
          const specFiles = await listSpecFiles(resolvedDir);
          results.specs = {};

          for (const specFile of specFiles) {
            const specContent = await readSpecContent(resolvedDir, specFile);
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
          const designContent = await readArtifactContent(resolvedDir, 'design.md');
if (designContent) {
            results.design = sharedValidator.validateDesign(designContent);
          } else {
            results.design = await notFoundError(resolvedDir, 'design.md');
          }
        }

        // Inspect tasks
        if (!artifactType || artifactType === 'tasks') {
          const tasksContent = await readArtifactContent(resolvedDir, 'tasks.md');
if (tasksContent) {
            results.tasks = sharedValidator.validateTasks(tasksContent);
          } else {
            results.tasks = await notFoundError(resolvedDir, 'tasks.md');
          }
        }

        // Inspect ui-design (frontend projects only)
        if (!artifactType || artifactType === 'ui-design') {
          const uiDesignContent = await readArtifactContent(resolvedDir, 'ui-design.md');
if (uiDesignContent) {
            results['ui-design'] = validateUiDesign(uiDesignContent);
          } else {
            results['ui-design'] = await notFoundError(
              resolvedDir,
              'ui-design.md',
              'File not found (frontend projects only)',
            );
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

/**
 * not-found 校验结果构造器。
 *
 * 工件目录约定为 `<workDir>/.flow-engine/sflow/`；not-found 时探测一层常见错位，
 * 命中即回显子项目目录与迁移指引，未命中则保留原 File not found 语义并附工件目录说明。
 */
async function notFoundError(
  resolvedDir: string,
  artifactFile: string,
  baseMessage = 'File not found',
): Promise<{ valid: boolean; error: string; issues: unknown[]; summary: { errors: number; warnings: number; info: number } }> {
  const misplaced = await probeMisplacedArtifact(resolvedDir, artifactFile);
  return {
    valid: false,
    error: describeMissingArtifact(baseMessage, resolvedDir, misplaced, artifactFile),
    issues: [],
    summary: { errors: 1, warnings: 0, info: 0 },
  };
}

/** not-found 判定（兼容错位提示语中的中文表述，避免被误计为内容错误） */
function isNotFoundError(error: string | undefined): boolean {
  if (!error) return false;
  return error.includes('not found') || error.includes('未在工件目录下找到');
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

  const uiDesign = results['ui-design'] as { valid: boolean; error?: string; summary?: { errors: number } } | undefined;
  if (uiDesign && !uiDesign.valid && !isNotFoundError(uiDesign.error)) {
    issues.push(`UI-Design: ${uiDesign.summary?.errors || 0} error(s)`);
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

  const uiDesign = results['ui-design'] as { valid: boolean; error?: string } | undefined;
  if (uiDesign && !uiDesign.valid && !isNotFoundError(uiDesign.error)) {
    recommendations.push('Fix ui-design.md issues before proceeding');
  }

  const tasks = results.tasks as { valid: boolean } | undefined;
  if (tasks && !tasks.valid) {
    recommendations.push('Fix task issues before proceeding');
  }

  return recommendations;
}

/**
 * Validate ui-design.md content.
 * Checks for required sections: color system, typography, spacing, anti-AI-slop checklist.
 */
function validateUiDesign(content: string): { valid: boolean; issues: Array<{ level: string; message: string }>; summary: { errors: number; warnings: number; info: number } } {
  const issues: Array<{ level: string; message: string }> = [];
  const lower = content.toLowerCase();

  if (!lower.includes('color') || !/(?:primary|color system|色)/.test(lower)) {
    issues.push({ level: 'ERROR', message: 'Missing color system definition (primary, background, text minimum)' });
  }
  if (!lower.includes('typography') && !lower.includes('font')) {
    issues.push({ level: 'ERROR', message: 'Missing typography definition (headings + body minimum)' });
  }
  if (!lower.includes('spacing') && !lower.includes('base unit')) {
    issues.push({ level: 'WARNING', message: 'Missing spacing scale definition' });
  }
  if (!content.includes('- [ ]') && !content.includes('- [x]')) {
    issues.push({ level: 'WARNING', message: 'Missing anti-AI-slop checklist' });
  }

  const errors = issues.filter(i => i.level === 'ERROR').length;
  const warnings = issues.filter(i => i.level === 'WARNING').length;
  return {
    valid: errors === 0,
    issues,
    summary: { errors, warnings, info: 0 },
  };
}
