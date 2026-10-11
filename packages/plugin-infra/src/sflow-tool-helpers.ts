import { sharedValidator } from '@opencode-flow-engine/core';
import { isContractStale } from '@opencode-flow-engine/shared';
import { readJsonFile } from '@opencode-flow-engine/shared';
import { getStateFilePath } from './features/state-manager.js';
import { readArtifactContent, listSpecFiles, readSpecContent } from './features/state-manager/artifact-paths.js';

export async function getCurrentWorkflowState(workDir: string): Promise<string | null> {
  const state = await readJsonFile<{ state?: string }>(`${workDir}/${getStateFilePath('sflow')}`);
  return state?.state ?? null;
}

export async function executeContractValidator(workDir: string) {
  const contractContent = await readArtifactContent(workDir, 'execution-contract.md');
  if (!contractContent) {
    return {
      validation: { valid: false, issues: [], summary: { errors: 0, warnings: 0, info: 0 } },
      isStale: false,
      recommendations: ['execution-contract.md not found — run contract-builder to create the contract'],
    };
  }

  const report = sharedValidator.validateExecutionContract(contractContent);
  const isStale = await isContractStale(workDir);

  const recommendations: string[] = [];
  if (isStale) recommendations.push('Contract is stale — regenerate with contract-builder');
  if (!report.valid) recommendations.push('Fix validation errors before proceeding');
  report.issues.filter(i => i.level === 'ERROR').forEach(i => recommendations.push(`Fix: ${i.message}`));

  return { validation: report, isStale, recommendations };
}

export async function executeArtifactInspector(workDir: string) {
  const results: Record<string, unknown> = {};

  const proposalContent = await readArtifactContent(workDir, 'proposal.md');
  if (proposalContent) {
    results.proposal = sharedValidator.validateChangeContent('proposal', proposalContent);
  } else {
    results.proposal = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  const specFiles = await listSpecFiles(workDir);
  results.specs = {};
  for (const specFile of specFiles) {
    const specContent = await readSpecContent(workDir, specFile);
    if (specContent) {
      (results.specs as Record<string, unknown>)[specFile] = sharedValidator.validateSpecContent(
        specFile.replace('.md', ''),
        specContent,
      );
    }
  }

  const designContent = await readArtifactContent(workDir, 'design.md');
  if (designContent) {
    results.design = sharedValidator.validateDesign(designContent);
  } else {
    results.design = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  const tasksContent = await readArtifactContent(workDir, 'tasks.md');
  if (tasksContent) {
    results.tasks = sharedValidator.validateTasks(tasksContent);
  } else {
    results.tasks = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  const issues: string[] = [];
  const proposal = results.proposal as { valid: boolean; summary?: { errors: number } } | undefined;
  if (proposal && !proposal.valid) issues.push(`Proposal: ${proposal.summary?.errors || 0} error(s)`);
  const specs = results.specs as Record<string, { valid: boolean }> | undefined;
  if (specs) {
    const specErrors = Object.values(specs).filter(s => !s.valid).length;
    if (specErrors > 0) issues.push(`Specs: ${specErrors} file(s) with errors`);
  }
  const tasks = results.tasks as { valid: boolean; summary?: { errors: number } } | undefined;
  if (tasks && !tasks.valid) issues.push(`Tasks: ${tasks.summary?.errors || 0} error(s)`);

  const summary = issues.length === 0 ? 'All artifacts are valid' : `Found issues: ${issues.join(', ')}`;

  const recommendations: string[] = [];
  if (proposal && !proposal.valid) recommendations.push('Fix proposal issues before proceeding');
  if (specs && Object.values(specs).some(s => !s.valid)) recommendations.push('Fix spec issues before proceeding');
  if (tasks && !tasks.valid) recommendations.push('Fix task issues before proceeding');

  return { results, summary, recommendations };
}
