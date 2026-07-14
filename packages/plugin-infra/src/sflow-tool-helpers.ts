import { sharedValidator } from '@opencode-flow-engine/core';
import { readFile as sflowReadFile, isContractStale } from '@opencode-flow-engine/shared';
import { readJsonFile } from '@opencode-flow-engine/shared';
import { getStateFilePath } from './features/state-manager.js';

export async function getCurrentWorkflowState(changeDir: string): Promise<string | null> {
  const state = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  return state?.state ?? null;
}

export async function executeContractValidator(changeDir: string) {
  const contractContent = await sflowReadFile(`${changeDir}/execution-contract.md`);
  if (!contractContent) {
    return {
      validation: { valid: false, issues: [], summary: { errors: 0, warnings: 0, info: 0 } },
      isStale: false,
      recommendations: ['execution-contract.md not found — run contract-builder to create the contract'],
    };
  }

  const report = sharedValidator.validateExecutionContract(contractContent);
  const isStale = await isContractStale(changeDir);

  const recommendations: string[] = [];
  if (isStale) recommendations.push('Contract is stale — regenerate with contract-builder');
  if (!report.valid) recommendations.push('Fix validation errors before proceeding');
  report.issues.filter(i => i.level === 'ERROR').forEach(i => recommendations.push(`Fix: ${i.message}`));

  return { validation: report, isStale, recommendations };
}

export async function executeArtifactInspector(changeDir: string) {
  const results: Record<string, unknown> = {};

  const proposalContent = await sflowReadFile(`${changeDir}/proposal.md`);
  if (proposalContent) {
    results.proposal = sharedValidator.validateChangeContent('proposal', proposalContent);
  } else {
    results.proposal = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  const specsDir = `${changeDir}/specs`;
  const { readdir } = await import('fs/promises');
  try {
    const specEntries = await readdir(specsDir, { withFileTypes: true });
    const specFiles = specEntries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name);
    results.specs = {};
    for (const specFile of specFiles) {
      const specContent = await sflowReadFile(`${specsDir}/${specFile}`);
      if (specContent) {
        (results.specs as Record<string, unknown>)[specFile] = sharedValidator.validateSpecContent(
          specFile.replace('.md', ''),
          specContent,
        );
      }
    }
  } catch {
    results.specs = {};
  }

  const designContent = await sflowReadFile(`${changeDir}/design.md`);
  if (designContent) {
    results.design = sharedValidator.validateDesign(designContent);
  } else {
    results.design = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  const tasksContent = await sflowReadFile(`${changeDir}/tasks.md`);
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
