/**
 * Contract Validator tool - Validate execution contracts
 */

import type { ToolDefinition, ToolContext, ToolResult } from './types.js';
import { Validator } from '@opencode-sflow/core';

/**
 * Create the contract validator tool
 */
export function createContractValidatorTool(): ToolDefinition {
  return {
    name: 'contract_validator',
    description: 'Validate execution contracts against planning artifacts',
    parameters: {
      changeDir: {
        type: 'string',
        description: 'Path to the change directory',
        required: true,
      },
    },
    execute: async (params, context) => {
      const { changeDir } = params as { changeDir: string };
      const validator = new Validator();

      try {
        const contractContent = await readFile(`${changeDir}/execution-contract.md`);
        if (!contractContent) {
          return {
            success: true,
            data: {
              validation: { valid: false, issues: [] },
              isStale: false,
              recommendations: ['execution-contract.md not found - run contract-builder to create the contract'],
            },
          };
        }

        const report = validator.validateExecutionContract(contractContent);
        const proposalContent = await readFile(`${changeDir}/proposal.md`);
        const isStale = await checkContractStaleness(changeDir, contractContent, proposalContent);

        return {
          success: true,
          data: {
            validation: report,
            isStale,
            recommendations: generateRecommendations(report, isStale),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          suggestions: ['Check file permissions', 'Verify file format'],
        };
      }
    },
  };
}

// Helper functions
async function readFile(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
    return null;
  } catch {
    return null;
  }
}

async function checkContractStaleness(
  changeDir: string,
  contractContent: string,
  proposalContent: string | null
): Promise<boolean> {
  if (!proposalContent) {
    return false;
  }

  // Simple staleness check - compare intent lock with proposal scope
  // TODO: Implement more sophisticated staleness detection
  return false;
}

function generateRecommendations(
  report: { valid: boolean; issues: Array<{ level: string; message: string }> },
  isStale: boolean
): string[] {
  const recommendations: string[] = [];

  if (isStale) {
    recommendations.push('Contract is stale - regenerate with contract-builder');
  }

  if (!report.valid) {
    recommendations.push('Fix validation errors before proceeding');
  }

  report.issues
    .filter(issue => issue.level === 'ERROR')
    .forEach(issue => {
      recommendations.push(`Fix: ${issue.message}`);
    });

  return recommendations;
}
