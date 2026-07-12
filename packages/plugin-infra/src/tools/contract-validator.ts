/**
 * Contract Validator tool - Validate execution contracts
 */

import type { ToolDefinition, ToolContext, ToolResult } from "./types.js";
import { sharedValidator } from "@opencode-flow-engine/core";
import { readFile, isContractStale } from "@opencode-flow-engine/shared";

/**
 * Create the contract validator tool
 */
export function createContractValidatorTool(): ToolDefinition {
  return {
    name: "contract_validator",
    description: "Validate execution contracts against planning artifacts",
    parameters: {
      changeDir: {
        type: "string",
        description: "Path to the change directory",
        required: true,
      },
    },
    execute: async (params, context) => {
      const changeDir = (params as { changeDir?: string }).changeDir || context.directory;

      try {
        const contractContent = await readFile(`${changeDir}/execution-contract.md`);
        if (!contractContent) {
          return {
            title: "Contract Validator",
            output: JSON.stringify({
              validation: { valid: false, issues: [], summary: { errors: 0, warnings: 0, info: 0 } },
              isStale: false,
              recommendations: ["execution-contract.md not found - run contract-builder to create the contract"],
            }),
          };
        }

        const report = sharedValidator.validateExecutionContract(contractContent);
        const isStale = await isContractStale(changeDir);

        const recommendations: string[] = generateRecommendations(report, isStale);

        return {
          title: "Contract Validator",
          output: JSON.stringify({ validation: report, isStale, recommendations }),
        };
      } catch (error) {
        return {
          title: "Contract Validator",
          output: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    },
  };
}

function generateRecommendations(
  report: { valid: boolean; issues: Array<{ level: string; message: string }> },
  isStale: boolean,
): string[] {
  const recommendations: string[] = [];

  if (isStale) {
    recommendations.push("Contract is stale - regenerate with contract-builder");
  }

  if (!report.valid) {
    recommendations.push("Fix validation errors before proceeding");
  }

  report.issues
    .filter((issue) => issue.level === "ERROR")
    .forEach((issue) => {
      recommendations.push(`Fix: ${issue.message}`);
    });

  return recommendations;
}
