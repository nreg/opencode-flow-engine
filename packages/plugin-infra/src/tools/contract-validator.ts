/**
 * Contract Validator tool - Validate execution contracts
 */

import type { ToolDefinition, ToolContext, ToolResult } from "./types.js";
import { sharedValidator } from "@opencode-flow-engine/core";
import { readFile, isContractStale } from "@opencode-flow-engine/shared";
import { resolveChangeDir } from "../helpers/resolve-change-dir.js";
import { readArtifactContent } from "../features/state-manager/artifact-paths.js";
import { probeMisplacedArtifact, describeMissingArtifact } from "../helpers/misplaced-artifact.js";

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
      const changeDir = resolveChangeDir((params as { changeDir?: string }).changeDir, context.directory);

      try {
        const contractContent = await readArtifactContent(changeDir, 'execution-contract.md');
        if (!contractContent) {
          // 工件目录约定为 <workDir>/.flow-engine/sflow/；not-found 时探测一层常见错位，
          // 命中即回显子项目目录，避免把「写错位置」误报成「工件未生成」。
          const misplaced = await probeMisplacedArtifact(changeDir, 'execution-contract.md');
          return {
            title: "Contract Validator",
            output: JSON.stringify({
              validation: { valid: false, issues: [], summary: { errors: 0, warnings: 0, info: 0 } },
              isStale: false,
              recommendations: [
                describeMissingArtifact(
                  "execution-contract.md not found - run contract-builder to create the contract",
                  changeDir,
                  misplaced,
                  'execution-contract.md',
                ),
              ],
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
