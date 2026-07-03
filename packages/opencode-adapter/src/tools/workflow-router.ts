/**
 * Workflow Router tool - State detection and routing
 */

import type { ToolDefinition, ToolContext, ToolResult } from "./types.js";
import { fileExists, directoryExists, readJsonFile, isContractStale } from "@opencode-sflow/shared";

/**
 * Create the workflow router tool
 */
export function createWorkflowRouterTool(): ToolDefinition {
  return {
    name: "workflow_router",
    description: "Detect current workflow state and route to appropriate skill",
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
        // Check for planning artifacts
        const artifacts = {
          proposal: await fileExists(`${changeDir}/proposal.md`),
          specs: await directoryExists(`${changeDir}/specs`),
          design: await fileExists(`${changeDir}/design.md`),
          tasks: await fileExists(`${changeDir}/tasks.md`),
          contract: await fileExists(`${changeDir}/execution-contract.md`),
          state: await fileExists(`${changeDir}/.sflow/state.json`),
        };

        // Determine workflow state
        let state: string;
        let skill: string;
        let reasons: string[] = [];

        if (!artifacts.proposal && !artifacts.specs) {
          state = "exploring";
          skill = "need-explorer";
          reasons.push("No planning artifacts found");
        } else if (!artifacts.contract) {
          state = "specifying";
          skill = "spec-writer";
          reasons.push("Planning artifacts exist but contract is missing");
        } else if (!(await isContractApproved(changeDir))) {
          state = "bridging";
          skill = "contract-builder";
          reasons.push("Contract exists but not approved");
        } else {
          state = "executing";
          skill = "build-executor";
          reasons.push("Contract approved, ready for implementation");
        }

        // Check for stale contract using unified staleness check
        if (artifacts.contract) {
          const stale = await isContractStale(changeDir);
          if (stale) {
            state = "bridging";
            skill = "contract-builder";
            reasons.push("Contract is stale, needs regeneration");
          }
        }

        return {
          title: "Workflow Router",
          output: JSON.stringify({
            success: true,
            data: {
              state,
              skill,
              reasons,
              artifacts,
            },
          }),
        };
      } catch (error) {
        return {
          title: "Workflow Router",
          output: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
            suggestions: ["Check if the change directory exists", "Verify file permissions"],
          }),
        };
      }
    },
  };
}

async function isContractApproved(changeDir: string): Promise<boolean> {
  const state = await readJsonFile<{ state?: string; contractApproved?: boolean }>(
    `${changeDir}/.sflow/state.json`,
  );
  if (state?.contractApproved === true) return true;
  if (
    state?.state === "approved-for-build" ||
    state?.state === "executing" ||
    state?.state === "closing"
  )
    return true;
  return false;
}
