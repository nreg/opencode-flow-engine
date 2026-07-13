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
  rollbackDetected?: boolean;
  previousState?: string;
}> {
  const iflowDir = `${changeDir}/.iflow`;
  const dirExists = await directoryExists(iflowDir);

  let result: {
    state: IFlowState;
    iteration: number;
    artifacts: Record<string, boolean>;
    reasons: string[];
    rollbackDetected?: boolean;
    previousState?: string;
  };
  let skipWrite = false;
  let previousState: string | undefined;

  if (!dirExists) {
    result = {
      state: 'discussing',
      iteration: 0,
      artifacts: {},
      reasons: ['No .iflow/ directory found — starting fresh'],
    };
  } else {
    // Check for state file with previous state tracking
    const stateData = await readJsonFile<{ state?: string; iteration?: number; previousState?: string }>(`${iflowDir}/state.json`);
    previousState = stateData?.previousState;

    if (stateData?.state && IFLOW_STATES.includes(stateData.state as IFlowState)) {
      const hasContext = await fileExists(`${iflowDir}/CONTEXT.md`);
      const hasPlan = await fileExists(`${iflowDir}/PLAN.md`);
      const hasSummary = await fileExists(`${iflowDir}/SUMMARY.md`);
      const hasUat = await fileExists(`${iflowDir}/UAT.md`);
      const hasExecuting = await fileExists(`${iflowDir}/EXECUTING`);
      const artifacts = { CONTEXT: hasContext, PLAN: hasPlan, SUMMARY: hasSummary, UAT: hasUat, EXECUTING: hasExecuting };

      const artifactState = determineArtifactState({ CONTEXT: hasContext, PLAN: hasPlan, SUMMARY: hasSummary, UAT: hasUat, EXECUTING: hasExecuting });
      const currentPersisted = stateData.state as IFlowState;
      const stateOrder = ['discussing', 'researching', 'planning', 'executing', 'verifying', 'shipping'];
      const artifactIdx = stateOrder.indexOf(artifactState);
      const persistedIdx = stateOrder.indexOf(currentPersisted);

      if (artifactIdx >= 0 && persistedIdx >= 0 && artifactIdx < persistedIdx) {
        // Artifacts suggest we're earlier than state.json — this is a rollback
        result = {
          state: artifactState,
          iteration: stateData.iteration ?? 1,
          artifacts,
          reasons: [`Rollback detected: state.json says "${currentPersisted}" but artifacts indicate "${artifactState}". User likely navigated back.`],
          rollbackDetected: true,
          previousState: currentPersisted,
        };
        // Don't skip write — we need to update state.json with the corrected state
      } else {
        result = {
          state: currentPersisted,
          iteration: stateData.iteration ?? 1,
          artifacts: { stateFile: true },
          reasons: [`Restored from state.json: ${currentPersisted}`],
        };
        skipWrite = true;
      }
    } else {
      const hasContext = await fileExists(`${iflowDir}/CONTEXT.md`);
      const hasPlan = await fileExists(`${iflowDir}/PLAN.md`);
      const hasSummary = await fileExists(`${iflowDir}/SUMMARY.md`);
      const hasUat = await fileExists(`${iflowDir}/UAT.md`);
      const hasExecuting = await fileExists(`${iflowDir}/EXECUTING`);

      const artifacts = {
        CONTEXT: hasContext,
        PLAN: hasPlan,
        SUMMARY: hasSummary,
        UAT: hasUat,
        EXECUTING: hasExecuting,
      };

      result = {
        state: determineArtifactState(artifacts),
        iteration: 1,
        artifacts,
        reasons: [getArtifactReason(artifacts)],
      };
    }
  }

  // Persist detected state to .iflow/state.json with previous state tracking
  if (!skipWrite) {
    await ensureDir(iflowDir);
    await writeJsonFile(`${iflowDir}/state.json`, {
      state: result.state,
      previousState: result.previousState || previousState,
      iteration: result.iteration,
      updatedAt: new Date().toISOString(),
    });
  }

  return result;
}

/**
 * Determine the IFlow state from which artifacts exist.
 * Ordered by "most advanced artifact wins" (highest state first).
 */
function determineArtifactState(artifacts: { CONTEXT: boolean; PLAN: boolean; SUMMARY: boolean; UAT: boolean; EXECUTING: boolean }): IFlowState {
  if (artifacts.UAT) return 'shipping';
  if (artifacts.SUMMARY) return 'verifying';
  if (artifacts.EXECUTING) return 'executing';
  if (artifacts.PLAN) return 'planning';
  if (artifacts.CONTEXT) return 'researching';
  return 'discussing';
}

/**
 * Generate a human-readable reason message based on which artifacts exist.
 */
function getArtifactReason(artifacts: { CONTEXT: boolean; PLAN: boolean; SUMMARY: boolean; UAT: boolean; EXECUTING: boolean }): string {
  if (artifacts.UAT) return 'UAT.md found — ready to ship';
  if (artifacts.SUMMARY) return 'SUMMARY.md found — ready to verify';
  if (artifacts.EXECUTING) return 'EXECUTING marker found — in execution phase';
  if (artifacts.PLAN) return 'PLAN.md found — ready to execute';
  if (artifacts.CONTEXT) return 'CONTEXT.md found — ready to plan';
  return '.iflow/ directory exists but no artifacts found — start discussing';
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