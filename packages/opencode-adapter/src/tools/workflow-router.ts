/**
 * Workflow Router tool - State detection and routing
 */

import type { ToolDefinition, ToolContext, ToolResult } from "./types.js";
import { fileExists, directoryExists, readJsonFile, isContractStale } from "@opencode-sflow/shared";
import { detectFrontend } from "../features/workflow-manager.js";

/**
 * Map from workflow state to allowed agents.
 * Intent routing must respect this — routing to an agent not allowed in current state
 * is a no-op that wastes a round trip.
 */
const STATE_ALLOWED_AGENTS: Record<string, string[]> = {
  exploring: ['need-explorer'],
  specifying: ['spec-writer', 'spec-merger'],
  'ui-design': ['spec-writer'],
  bridging: ['contract-builder', 'spec-merger'],
  'approved-for-build': ['contract-builder', 'build-executor', 'code-reviewer', 'spec-merger'],
  executing: ['build-executor', 'code-reviewer', 'bug-investigator'],
  debugging: ['bug-investigator', 'build-executor'],
  closing: ['release-archivist'],
};

/**
 * Intent-to-agent mapping table.
 * Maps natural language keywords to the appropriate sFlow agent.
 * Inspired by flow-kit GO.md's intent auto-routing.
 */
const INTENT_MAP: Array<{ pattern: RegExp; agent: string; action: string; description: string }> = [
  { pattern: /审查|review|check\s+code|code\s+review|质量/i, agent: 'code-reviewer', action: 'review', description: 'Code review' },
  { pattern: /调试|debug|bug|错误|error|fix|trace|排查/i, agent: 'bug-investigator', action: 'investigate', description: 'Bug investigation' },
  { pattern: /执行|实现|implement|build|编码|开始/i, agent: 'build-executor', action: 'execute', description: 'Task execution' },
  { pattern: /设计|设计UI|界面|ui|ux|页面/i, agent: 'spec-writer', action: 'design', description: 'UI/UX design' },
  { pattern: /合同|合约|contract|执行合同|execution/i, agent: 'contract-builder', action: 'build', description: 'Contract building' },
  { pattern: /需求|探索|explore|分析|调研/i, agent: 'need-explorer', action: 'explore', description: 'Requirements exploration' },
  { pattern: /归档|archive|发布|release|完成/i, agent: 'release-archivist', action: 'archive', description: 'Release archiving' },
  { pattern: /合并|merge|合并spec|spec.merge/i, agent: 'spec-merger', action: 'merge', description: 'Spec merging' },
];

/**
 * Extract task ID from intent string (e.g. "T03", "T-03").
 */
function extractTaskId(input: string): string | null {
  const m = input.match(/\b(T\d{2,})\b/i);
  if (!m || !m[1]) return null;
  return m[1].toUpperCase();
}

/**
 * Match user intent to an agent using scoring instead of first-match.
 * Each INTENT_MAP pattern is decomposed into tokens; the entry with the highest
 * token overlap score wins. This prevents order-dependent routing (e.g. "check build"
 * scoring higher for build-executor than code-reviewer).
 *
 * Returns null if no clear intent match is found (fall back to artifact-based routing).
 */
function matchIntent(input: string): { agent: string; action: string; description: string; score: number } | null {
  const lowerInput = input.toLowerCase();
  const candidates: Array<{ agent: string; action: string; description: string; score: number }> = [];

  for (const entry of INTENT_MAP) {
    // Extract meaningful keywords from the pattern (strip regex operators)
    const patternSource = entry.pattern.source.toLowerCase();
    // Split by regex alternation and word-boundary operators to enumerate tokens.
    // patternSource is the raw regex string (e.g. "审查|review|check\\s+code|...")
    // Use \b (word boundary) to strip, not \\b (literal backslash-b)
    const tokens = [...new Set(
      patternSource
        .replace(/\^|\b|\(\?:|\)|\\s\*|\$\||\[/g, ' ')
        .split(/[|\\()?*+^$.\]]+/)
        .map(t => t.trim().replace(/\\/g, ''))
        .filter(t => t.length >= 2 && !/^\d+$/.test(t))
    )];

    // Count what fraction of tokens match the input
    let matchedTokens = 0;
    for (const token of tokens) {
      if (lowerInput.includes(token)) matchedTokens++;
    }

    // Also count direct pattern match (bonus for exact regex matches)
    const exactMatch = entry.pattern.test(input);

    // Score = matched token ratio + exact match bonus
    const tokenRatio = tokens.length > 0 ? matchedTokens / tokens.length : 0;
    const score = (exactMatch ? 0.5 : 0) + tokenRatio * 0.5;

    if (score > 0 || exactMatch) {
      candidates.push({ agent: entry.agent, action: entry.action, description: entry.description, score });
    }
  }

  if (candidates.length === 0) return null;

  // Sort by score descending; ties broken by longest description (most specific)
  candidates.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 0.01) return diff > 0 ? 1 : -1;
    return b.description.length - a.description.length;
  });

  const best = candidates[0] as { agent: string; action: string; description: string; score: number } | undefined;
  return best ?? null;
}

/**
 * Read the current workflow state from .sflow/state.json
 */
async function readWorkflowState(changeDir: string): Promise<{ state: string; mode: string } | null> {
  const sd = await readJsonFile<{ state?: string; mode?: string }>(`${changeDir}/.sflow/state.json`);
  if (!sd?.state) return null;
  return { state: sd.state, mode: sd.mode || 'full' };
}

/**
 * Auto-discover the active change directory by scanning .sflow/changes/.
 * Returns the first change directory found, or the given directory if nothing found.
 */
async function findActiveChangeDir(changeDir: string, fsDirectory: string): Promise<string> {
  // If an explicit changeDir was provided, use it directly
  if (changeDir) return changeDir;

  // Scan .sflow/changes/ for active change directories
  const changesRoot = fsDirectory + '/.sflow/changes';
  const changesDir = await directoryExists(changesRoot).catch(() => false);
  if (changesDir) {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(changesRoot).catch(() => [] as string[]);
    // Filter to directories that contain a state.json or proposal.md
    for (const entry of entries) {
      const candidate = changesRoot + '/' + entry;
      const hasState = await fileExists(candidate + '/.sflow/state.json').catch(() => false);
      const hasProposal = await fileExists(candidate + '/proposal.md').catch(() => false);
      if (hasState || hasProposal) {
        return candidate;
      }
    }
  }

  // Fallback: check if fsDirectory itself is a change dir
  const selfHasState = await fileExists(fsDirectory + '/.sflow/state.json').catch(() => false);
  if (selfHasState) return fsDirectory;

  return changeDir || fsDirectory;
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
      const changeDir = await findActiveChangeDir(p.changeDir || '', context.directory || '');
      const userIntent = p.intent || '';

      // Phase 1: Intent-based routing (if user gave a clear intent)
      if (userIntent) {
        const matched = matchIntent(userIntent);
        if (matched) {
          // State guard: check if matched agent is allowed in current state
          const wfState = await readWorkflowState(changeDir);
          const currentState = wfState?.state || 'exploring';
          const allowedAgents = STATE_ALLOWED_AGENTS[currentState] || [];
          const taskId = extractTaskId(userIntent);

          if (allowedAgents.length > 0 && !allowedAgents.includes(matched.agent)) {
            return {
              title: "Workflow Router",
              output: JSON.stringify({
                success: true,
                data: {
                  source: 'intent',
                  state: currentState,
                  skill: null,
                  action: matched.action,
                  description: matched.description,
                  reasons: [
                    `Intented routed via: ${userIntent}`,
                    `But ${matched.agent} is not allowed in state "${currentState}". Allowed agents: ${allowedAgents.join(', ')}`,
                  ],
                  stateGuardBlocked: true,
                  taskId,
                },
              }),
            };
          }

          return {
            title: "Workflow Router",
            output: JSON.stringify({
              success: true,
              data: {
                source: 'intent',
                state: currentState,
                skill: matched.agent,
                action: matched.action,
                description: matched.description,
                reasons: ['Intented routed via: ' + userIntent],
                stateGuardBlocked: false,
                taskId,
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
        };

        // Use real-time detectFrontend() instead of stale state.json
        const isFrontend = await detectFrontend(changeDir);

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
