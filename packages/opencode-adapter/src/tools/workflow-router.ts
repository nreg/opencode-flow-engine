/**
 * Workflow Router tool - State detection and routing
 */

import type { ToolDefinition, ToolContext, ToolResult } from "./types.js";
import { fileExists, directoryExists, readJsonFile, isContractStale } from "@opencode-sflow/shared";

/**
 * Intent-to-agent mapping table.
 * Maps natural language keywords to the appropriate sFlow agent.
 * Inspired by flow-kit GO.md's intent auto-routing.
 */
const INTENT_MAP: Array<{ pattern: RegExp; agent: string; action: string; description: string }> = [
  { pattern: /审查|review|check\s+code|code\s+review|质量/i, agent: 'code-reviewer', action: 'review', description: 'Code review' },
  { pattern: /调试|debug|bug|错误|error|fix|trace|排查/i, agent: 'bug-investigator', action: 'investigate', description: 'Bug investigation' },
  { pattern: /执行|实现|implement|build|编码|开始|T\d{2}/i, agent: 'build-executor', action: 'execute', description: 'Task execution' },
  { pattern: /设计|设计UI|界面|ui|ux|页面/i, agent: 'spec-writer', action: 'design', description: 'UI/UX design' },
  { pattern: /合同|合约|contract|执行合同|execution/i, agent: 'contract-builder', action: 'build', description: 'Contract building' },
  { pattern: /需求|探索|explore|分析|调研/i, agent: 'need-explorer', action: 'explore', description: 'Requirements exploration' },
  { pattern: /归档|archive|发布|release|完成/i, agent: 'release-archivist', action: 'archive', description: 'Release archiving' },
  { pattern: /合并|merge|合并spec|spec.merge/i, agent: 'spec-merger', action: 'merge', description: 'Spec merging' },
];

/**
 * Match user intent to an agent.
 * Returns null if no clear intent match is found (fall back to artifact-based routing).
 */
function matchIntent(input: string): { agent: string; action: string; description: string } | null {
  for (const entry of INTENT_MAP) {
    if (entry.pattern.test(input)) {
      return { agent: entry.agent, action: entry.action, description: entry.description };
    }
  }
  return null;
}

/**
 * Create the workflow router tool
 */
export function createWorkflowRouterTool(): ToolDefinition {
  return {
    name: "workflow_router",
    description: "Detect current workflow state and route to appropriate agent. Supports natural language intent detection.",
    parameters: {
      changeDir: {
        type: "string",
        description: "Path to the change directory",
        required: true,
      },
      intent: {
        type: "string",
        description: "Optional natural language intent (e.g. '审查代码', '执行 T03', '调试bug')",
        required: false,
      },
    },
    execute: async (params, context) => {
      const p = params as { changeDir?: string; intent?: string };
      const changeDir = p.changeDir || context.directory;
      const userIntent = p.intent || '';

      // Phase 1: Intent-based routing (if user gave a clear intent)
      if (userIntent) {
        const matched = matchIntent(userIntent);
        if (matched) {
          return {
            title: "Workflow Router",
            output: JSON.stringify({
              success: true,
              data: {
                source: 'intent',
                state: 'intent-routed',
                skill: matched.agent,
                action: matched.action,
                description: matched.description,
                reasons: ['Intented routed via: ' + userIntent],
              },
            }),
          };
        }
      }

      // Phase 2: Artifact-based state detection (fallback)
      try {
        const artifacts = {
          proposal: await fileExists(`${changeDir}/proposal.md`),
          specs: await directoryExists(`${changeDir}/specs`),
          design: await fileExists(`${changeDir}/design.md`),
          tasks: await fileExists(`${changeDir}/tasks.md`),
          contract: await fileExists(`${changeDir}/execution-contract.md`),
          uiDesign: await fileExists(`${changeDir}/ui-design.md`),
          state: await fileExists(`${changeDir}/.sflow/state.json`),
        };

        // Check for frontend status from state.json
        let isFrontend = false;
        if (artifacts.state) {
          const stateData = await readJsonFile<{ isFrontend?: boolean }>(`${changeDir}/.sflow/state.json`);
          isFrontend = stateData?.isFrontend === true;
        }

        // Determine workflow state
        let state: string;
        let skill: string;
        let reasons: string[] = [];

        if (!artifacts.proposal && !artifacts.specs) {
          state = "exploring";
          skill = "need-explorer";
          reasons.push("No planning artifacts found");
        } else if (!artifacts.contract) {
          // Check if frontend project needs ui-design phase
          if (isFrontend && !artifacts.uiDesign && artifacts.design && artifacts.tasks) {
            state = "ui-design";
            skill = "spec-writer";
            reasons.push("Frontend project needs ui-design.md before bridging");
          } else {
            state = "specifying";
            skill = "spec-writer";
            reasons.push("Planning artifacts exist but contract is missing");
          }
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
              source: 'artifacts',
              state,
              skill,
              reasons,
              artifacts,
              isFrontend,
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
