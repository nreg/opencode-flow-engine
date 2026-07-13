/**
 * IFlow Router tool - State detection and routing for IFlow workflow
 * Detects IFlow state from .iflow/ directory artifacts
 */

import type { ToolDefinition, ToolContext, ToolResult } from "./types.js";
import { fileExists, directoryExists, readJsonFile, ensureDir, writeJsonFile } from "@opencode-flow-engine/shared";

/**
 * IFlow workflow states in cyclic order
 */
const IFLOW_STATES = [
  'discussing',
  'researching',
  'planning',
  'executing',
  'verifying',
  'shipping',
] as const;

type IFlowState = typeof IFLOW_STATES[number];

/**
 * Map from IFlow state to allowed subagents
 */
const IFLOW_STATE_AGENTS: Record<IFlowState, string[]> = {
  discussing: ['iflow-discuss-planner'],
  researching: ['iflow-researcher'],
  planning: ['iflow-discuss-planner'],
  executing: ['iflow-plan-executor'],
  verifying: ['iflow-verifier'],
  shipping: ['iflow-shipper'],
};

/**
 * IFlow-specific intent patterns
 */
const IFLOW_INTENT_PATTERNS: Array<{
  pattern: RegExp;
  state: IFlowState;
  description: string;
}> = [
  { pattern: /讨论|需求|clarify|discuss|理解|分析需求/i, state: 'discussing', description: 'Requirements discussion' },
  { pattern: /研究|调研|research|调查|研究技术|方案评估/i, state: 'researching', description: 'Technical research' },
  { pattern: /规划|计划|plan|拆任务|分解|task/i, state: 'planning', description: 'Task planning' },
  { pattern: /执行|实现|implement|编码|build|开发|写代码/i, state: 'executing', description: 'Implementation' },
  { pattern: /验证|verify|测试|检查|审核|review|质量/i, state: 'verifying', description: 'Verification' },
  { pattern: /发布|ship|上线|部署|pr|merge|归档/i, state: 'shipping', description: 'Ship/release' },
  { pattern: /下一轮|下一轮|继续|iterate|cycle|next/i, state: 'discussing', description: 'Next iteration' },
  { pattern: /开始|start|新功能|new|feature|init/i, state: 'discussing', description: 'Start new feature' },
];

/**
 * Detect IFlow state from .iflow/ directory artifacts
 */
async function detectIFlowState(changeDir: string): Promise<{
  state: IFlowState;
  iteration: number;
  artifacts: Record<string, boolean>;
  reasons: string[];
}> {
  const iflowDir = `${changeDir}/.iflow`;
  const dirExists = await directoryExists(iflowDir);

  let result: {
    state: IFlowState;
    iteration: number;
    artifacts: Record<string, boolean>;
    reasons: string[];
  };
  let skipWrite = false;

  if (!dirExists) {
    result = {
      state: 'discussing',
      iteration: 0,
      artifacts: {},
      reasons: ['No .iflow/ directory found — starting fresh'],
    };
  } else {
    // Check for state file
    const stateData = await readJsonFile<{ state?: string; iteration?: number }>(`${iflowDir}/state.json`);
    if (stateData?.state && IFLOW_STATES.includes(stateData.state as IFlowState)) {
      result = {
        state: stateData.state as IFlowState,
        iteration: stateData.iteration ?? 1,
        artifacts: { stateFile: true },
        reasons: [`Restored from state.json: ${stateData.state}`],
      };
      skipWrite = true; // Already have persisted state, no unnecessary overwrite
    } else {
      // Artifact-based detection
      const hasContext = await fileExists(`${iflowDir}/CONTEXT.md`);
      const hasPlan = await fileExists(`${iflowDir}/PLAN.md`);
      const hasSummary = await fileExists(`${iflowDir}/SUMMARY.md`);
      const hasUat = await fileExists(`${iflowDir}/UAT.md`);

      const artifacts = {
        CONTEXT: hasContext,
        PLAN: hasPlan,
        SUMMARY: hasSummary,
        UAT: hasUat,
      };

      // Determine state from artifacts
      if (hasUat) {
        result = { state: 'shipping', iteration: 1, artifacts, reasons: ['UAT.md found — ready to ship'] };
      } else if (hasSummary) {
        result = { state: 'verifying', iteration: 1, artifacts, reasons: ['SUMMARY.md found — ready to verify'] };
      } else if (hasPlan) {
        result = { state: 'planning', iteration: 1, artifacts, reasons: ['PLAN.md found — ready to execute'] };
      } else if (hasContext) {
        result = { state: 'researching', iteration: 1, artifacts, reasons: ['CONTEXT.md found — ready to plan'] };
      } else {
        result = {
          state: 'discussing',
          iteration: 1,
          artifacts,
          reasons: ['.iflow/ directory exists but no artifacts found — start discussing'],
        };
      }
    }
  }

  // Persist detected state to .iflow/state.json
  if (!skipWrite) {
    await ensureDir(iflowDir);
    await writeJsonFile(`${iflowDir}/state.json`, {
      state: result.state,
      iteration: result.iteration,
      updatedAt: new Date().toISOString(),
    });
  }

  return result;
}

/**
 * Match IFlow intent from user input
 */
function matchIFlowIntent(input: string): { state: IFlowState; description: string } | null {
  const lowerInput = input.toLowerCase();
  for (const entry of IFLOW_INTENT_PATTERNS) {
    if (entry.pattern.test(lowerInput)) {
      return { state: entry.state, description: entry.description };
    }
  }
  return null;
}

/**
 * Create the IFlow router tool
 */
export function createIFlowRouterTool(): ToolDefinition {
  return {
    name: "iflow_router",
    description: "Detect current IFlow state from .iflow/ directory artifacts and route to the appropriate agent. Supports IFlow-specific intent patterns.",
    parameters: {
      changeDir: {
        type: "string",
        description: "Path to the change directory",
        required: true,
      },
      intent: {
        type: "string",
        description: "Optional natural language intent for routing",
        required: false,
      },
    },
    execute: async (params, context) => {
      const p = params as { changeDir?: string; intent?: string };
      const changeDir = p.changeDir || context.directory || '';
      const userIntent = p.intent || '';

      try {
        // Phase 1: Intent-based routing
        if (userIntent) {
          const matched = matchIFlowIntent(userIntent);
          if (matched) {
            const detection = await detectIFlowState(changeDir);
            const allowedAgents = IFLOW_STATE_AGENTS[matched.state] || [];
            return {
              title: 'IFlow Router',
              output: JSON.stringify({
                success: true,
                data: {
                  source: 'intent',
                  state: matched.state,
                  skill: allowedAgents[0] || null,
                  action: matched.description,
                  reasons: [`Intended routed via: ${userIntent}`],
                  artifacts: detection.artifacts,
                  iteration: detection.iteration,
                },
              }),
            };
          }
        }

        // Phase 2: Artifact-based state detection
        const detection = await detectIFlowState(changeDir);
        const allowedAgents = IFLOW_STATE_AGENTS[detection.state] || [];

        return {
          title: 'IFlow Router',
          output: JSON.stringify({
            success: true,
            data: {
              source: 'artifacts',
              state: detection.state,
              skill: allowedAgents[0] || 'iflow-discuss-planner',
              reasons: detection.reasons,
              artifacts: detection.artifacts,
              iteration: detection.iteration,
              nextAction: getNextAction(detection.state),
            },
          }),
        };
      } catch (error) {
        return {
          title: 'IFlow Router',
          output: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        };
      }
    },
  };
}

function getNextAction(state: IFlowState): string {
  const actions: Record<IFlowState, string> = {
    discussing: 'Begin requirements discussion with iflow-discuss-planner',
    researching: 'Research technical approach with iflow-researcher',
    planning: 'Create execution plan with iflow-discuss-planner',
    executing: 'Execute plan with iflow-plan-executor',
    verifying: 'Verify results with iflow-verifier',
    shipping: 'Ship with iflow-shipper',
  };
  return actions[state];
}