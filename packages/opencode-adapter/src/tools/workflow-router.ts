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
 *
 * P5 fix: Each entry includes explicit token lists for scoring,
 * avoiding fragile regex-to-token extraction.
 *
 * P7 fix: Expanded to cover all flow-kit GO.md routing patterns.
 */
const INTENT_MAP: Array<{
  pattern: RegExp;
  agent: string;
  action: string;
  description: string;
  tokens: string[];
}> = [
  { pattern: /审查|review|check\s+code|code\s+review|质量/i, agent: 'code-reviewer', action: 'review', description: 'Code review', tokens: ['审查', 'review', 'code review', '质量'] },
  { pattern: /调试|debug|bug|错误|error|fix|trace|排查/i, agent: 'bug-investigator', action: 'investigate', description: 'Bug investigation', tokens: ['调试', 'debug', 'bug', '错误', 'error', 'trace', '排查'] },
  { pattern: /执行\s*T\d+|跑\s*T\d+|do\s*T\d+|执行任务/i, agent: 'build-executor', action: 'execute', description: 'Task execution (specific)', tokens: ['执行t', '跑t', 'dot', '执行任务'] },
  { pattern: /执行|实现|implement|build|编码|开始/i, agent: 'build-executor', action: 'execute', description: 'Task execution', tokens: ['执行', '实现', 'implement', 'build', '编码'] },
  { pattern: /设计UI|界面ui|ux|视觉|theme|design\s+system|design\s+tokens/i, agent: 'spec-writer', action: 'design-ui', description: 'UI/UX design', tokens: ['设计ui', '界面', '视觉', 'theme', 'design system'] },
  { pattern: /选技术|选栈|选框架|tech\s*stack|用什么开发|迁移评估|技术选型|栈选型/i, agent: 'spec-writer', action: 'tech-stack', description: 'Technology stack selection', tokens: ['选技术', '选栈', '选框架', 'tech stack', '技术选型', '栈选型', '迁移评估'] },
  { pattern: /设计|design/i, agent: 'spec-writer', action: 'design', description: 'Specification design', tokens: ['设计', 'design'] },
  { pattern: /合同|合约|contract|执行合同|execution/i, agent: 'contract-builder', action: 'build', description: 'Contract building', tokens: ['contract', '合约', '执行合同'] },
  { pattern: /需求|探索|explore|分析|调研/i, agent: 'need-explorer', action: 'explore', description: 'Requirements exploration', tokens: ['需求', '探索', 'explore', '分析', '调研'] },
  { pattern: /归档|archive|发布|release|完成|ship|集成|验收/i, agent: 'release-archivist', action: 'archive', description: 'Release archiving', tokens: ['归档', 'archive', '发布', 'release', 'ship', '验收'] },
  { pattern: /拆任务|plan\s*tasks|分解|拆/i, agent: 'spec-writer', action: 'task-split', description: 'Task breakdown', tokens: ['拆任务', 'plan tasks', '分解'] },
  { pattern: /测试|写测试|UAT|test/i, agent: 'build-executor', action: 'test', description: 'Testing', tokens: ['测试', '写测试', 'uat', 'test'] },
  { pattern: /继续|接着上次|恢复|resume/i, agent: 'build-executor', action: 'resume', description: 'Resume interrupted work', tokens: ['继续', '接着上次', '恢复', 'resume'] },
  { pattern: /合并|merge|合并spec|spec.merge/i, agent: 'spec-merger', action: 'merge', description: 'Spec merging', tokens: ['合并', 'merge', '合并spec'] },
  { pattern: /健康检查|health|体检|巡检|技术债/i, agent: 'release-archivist', action: 'health-check', description: 'Health inspection', tokens: ['健康检查', 'health', '体检', '巡检'] },
];

/**
 * P30: NLU enhancement — synonym mapping for better intent recognition.
 * Maps colloquial expressions to canonical intent tokens used by INTENT_MAP.
 * This bridges the gap between how users naturally describe tasks and
 * the formal token lists in INTENT_MAP entries.
 */
const SYNONYM_MAP: Record<string, string> = {
  // --- Code Review synonyms ---
  '看看': 'review',
  '检查': 'review',
  '审核': 'review',
  '过一遍': 'review',
  '审视': 'review',
  'inspect': 'review',
  'examine': 'review',
  'verify': 'review',
  'audit': 'review',
  '检视': 'review',
  '扫一遍': 'review',

  // --- Debug/Fix synonyms ---
  '修复': 'fix',
  '改正': 'fix',
  '修好': 'fix',
  '纠正': 'fix',
  '解决': 'fix',
  '处理': 'fix',
  '排查': 'debug',
  '追踪': 'trace',
  '跟踪': 'trace',
  '定位': 'trace',
  'rectify': 'fix',
  'correct': 'fix',
  'resolve': 'fix',

  // --- Implement/Build synonyms ---
  '写代码': 'implement',
  '撸代码': 'implement',
  '搭建': 'build',
  '动手': 'start',
  '开工': 'start',
  '开干': 'start',
  'build': 'implement',
  'code': 'implement',

  // --- Continue/Resume synonyms ---
  '接着': 'continue',
  '继续搞': 'continue',
  '接着搞': 'continue',
  '继续做': 'continue',
  'proceed': 'continue',
  'resume': 'continue',

  // --- Explore/Requirements synonyms ---
  '调研': 'explore',
  '了解一下': 'explore',
  '分析': 'explore',
  '规划': 'explore',
  'study': 'explore',
  'research': 'explore',

  // --- Test synonyms ---
  '验证': 'test',
  '测一下': 'test',
  '跑一下': 'test',
  '试试': 'test',

  // --- Design synonyms ---
  '画图': 'design',
  '原型': 'design',
  'prototype': 'design',

  // --- Release/Archive synonyms ---
  '上线': 'release',
  '部署': 'release',
  '打包': 'release',
  '交付': 'ship',
  'deploy': 'release',
  'publish': 'release',
};
function expandSynonyms(input: string): string {
  let expanded = input;
  // Sort by length descending to match longer phrases first (e.g. "继续搞" before "继续")
  const entries = Object.entries(SYNONYM_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [synonym, canonical] of entries) {
    // Use word-boundary matching for English, simple replace for Chinese
    if (/^[a-zA-Z]/.test(synonym)) {
      const regex = new RegExp('\\b' + synonym + '\\b', 'gi');
      expanded = expanded.replace(regex, canonical);
    } else {
      // Chinese: replace all occurrences (Chinese text has no word boundaries)
      const regex = new RegExp(synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      expanded = expanded.replace(regex, canonical);
    }
  }
  return expanded;
}

/**
 * P6 fix: "New thing description" regex patterns.
 * When no active change exists and user describes a new feature/thing,
 * route to need-explorer (equivalent to flow-kit's 0-change).
 */
const NEW_THING_PATTERNS = [
  /^(做|想|加|实现|设计|开发|创建|新增|添加)\s+/i,
  /^(want|make|add|implement|design|create|build)\s+/i,
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
 * P6 fix: Check if the input is a "new thing description".
 * Flow-kit GO.md rule: If no active change exists and user describes a new feature,
 * route to need-explorer (equivalent to 0-change) even if the input contains
 * words like "design" or "UI".
 */
function isNewThingDescription(input: string, hasActiveChange: boolean): boolean {
  if (hasActiveChange) return false;
  return NEW_THING_PATTERNS.some(p => p.test(input));
}

/**
 * P5 fix: Match user intent using explicit token lists scoring.
 * Each entry provides explicit tokens directly (no fragile regex-to-token extraction).
 *
 * P30: Uses expandSynonyms() to normalize colloquial input before matching,
 * enabling natural language understanding for phrases like "帮我看看代码质量".
 */
function matchIntent(input: string): { agent: string; action: string; description: string; score: number } | null {
  // P30: Expand synonyms before matching
  const expandedInput = expandSynonyms(input);
  const lowerInput = expandedInput.toLowerCase();
  const candidates: Array<{ agent: string; action: string; description: string; score: number }> = [];

  for (const entry of INTENT_MAP) {
    const lowerTokens = entry.tokens.map(t => t.toLowerCase());

    let matchedTokens = 0;
    for (const token of lowerTokens) {
      if (lowerInput.includes(token)) matchedTokens++;
    }

    // Also test regex pattern against expanded input
    const exactMatch = entry.pattern.test(expandedInput);

    const tokenRatio = lowerTokens.length > 0 ? matchedTokens / lowerTokens.length : 0;
    const score = (exactMatch ? 0.5 : 0) + tokenRatio * 0.5;

    if (score > 0 || exactMatch) {
      candidates.push({ agent: entry.agent, action: entry.action, description: entry.description, score });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const diff = b.score - a.score;
    if (Math.abs(diff) > 0.01) return diff > 0 ? 1 : -1;
    return b.description.length - a.description.length;
  });

  return candidates[0] ?? null;
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
        // P6 fix: Check "new thing description" priority first
        const wfStateForNewThing = await readWorkflowState(changeDir);
        const hasActiveChange = !!(wfStateForNewThing?.state);

        if (isNewThingDescription(userIntent, hasActiveChange)) {
          return {
            title: "Workflow Router",
            output: JSON.stringify({
              success: true,
              data: {
                source: 'new-thing',
                state: 'exploring',
                skill: 'need-explorer',
                action: 'explore',
                description: 'New feature description detected',
                reasons: [
                  `New thing: "${userIntent}"`,
                  'Flow-kit rule: new descriptions route to need-explorer even if containing design/UI keywords',
                ],
                routingDeclaration: {
                  loaded: [],
                  notLoaded: ['specs/', 'design.md', 'tasks.md', 'execution-contract.md'],
                  nextAction: 'Explore requirements with need-explorer',
                },
              },
            }),
          };
        }

        const matched = matchIntent(userIntent);
        if (matched) {
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
                    `Intended routed via: ${userIntent}`,
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
                reasons: ['Intended routed via: ' + userIntent],
                stateGuardBlocked: false,
                taskId,
              },
            }),
          };
        }
      }

      // P9 fix: Check specs content, not just directory existence
      const { listFiles } = await import('@opencode-sflow/shared');

      // Phase 2: Artifact-based state detection (fallback)
      try {
        const specsDirExists = await directoryExists(`${changeDir}/specs`);
        const specsFileCount = specsDirExists ? (await listFiles(`${changeDir}/specs`, '.md')).length : 0;
        const artifacts = {
          proposal: await fileExists(`${changeDir}/proposal.md`),
          specs: specsDirExists && specsFileCount > 0,
          specsFileCount,
          design: await fileExists(`${changeDir}/design.md`),
          tasks: await fileExists(`${changeDir}/tasks.md`),
          contract: await fileExists(`${changeDir}/execution-contract.md`),
          uiDesign: await fileExists(`${changeDir}/ui-design.md`),
        };

        const isFrontend = await detectFrontend(changeDir);

        let state: string;
        let skill: string;
        let reasons: string[] = [];
        const routingDeclaration = { loaded: [] as string[], notLoaded: [] as string[], nextAction: '' };

        if (!artifacts.proposal && !artifacts.specs) {
          state = "exploring";
          skill = "need-explorer";
          reasons.push("No planning artifacts found");
          routingDeclaration.nextAction = "Begin requirements exploration";
        } else if (!artifacts.contract) {
          if (isFrontend && !artifacts.uiDesign && artifacts.design && artifacts.tasks) {
            state = "ui-design";
            skill = "spec-writer";
            reasons.push("Frontend project needs ui-design.md before bridging");
            routingDeclaration.loaded.push('proposal.md', 'specs/', 'design.md', 'tasks.md');
            routingDeclaration.notLoaded.push('ui-design.md');
            routingDeclaration.nextAction = "Generate ui-design.md";
          } else {
            state = "specifying";
            skill = "spec-writer";
            reasons.push(specsFileCount > 0 ? "Specs exist but contract incomplete" : "Planning artifacts exist but contract is missing");
            if (specsFileCount > 0) routingDeclaration.loaded.push(`specs/ (${specsFileCount} files)`);
            routingDeclaration.notLoaded.push('execution-contract.md');
            routingDeclaration.nextAction = "Complete planning artifacts";
          }
        } else if (!(await isContractApproved(changeDir))) {
          state = "bridging";
          skill = "contract-builder";
          reasons.push("Contract exists but not approved");
          routingDeclaration.loaded.push('proposal.md', 'specs/', 'design.md', 'tasks.md', 'execution-contract.md');
          routingDeclaration.nextAction = "Approve execution contract";
        } else {
          state = "executing";
          skill = "build-executor";
          reasons.push("Contract approved, ready for implementation");
          routingDeclaration.loaded.push('proposal.md', 'execution-contract.md');
          routingDeclaration.nextAction = "Begin task execution";
        }

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
              routingDeclaration,
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
