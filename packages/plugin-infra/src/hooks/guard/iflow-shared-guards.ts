/**
 * IFlow-specific guard implementations.
 * These guards apply the same concepts as SFlow guards but read from .flow-engine/iflow/ artifacts
 * instead of .flow-engine/sflow/ artifacts.
 */

import type { HookResult } from "../types.js";
import { fileExists, readFile, readJsonFile, directoryExists } from "@opencode-flow-engine/shared";
import { searchLessonsInFile, findProjectRoot, readProgressFile, detectProgressAntiRepeat } from "../../features/state-manager.js";
import { getHasOmoPlugin } from "../../agents/agent-tools.js";

const IFLOW_STATES = ['discussing', 'researching', 'planning', 'executing', 'verifying', 'shipping'] as const;
type IFlowState = typeof IFLOW_STATES[number];

const SOURCE_CODE_PATTERNS = /\.(ts|js|tsx|jsx|mjs|cjs|mts|cts|py|java|kt|rs|go|rb|php|c|cpp|h|hpp|cs|swift|vue|svelte|css|scss|less)$/i;

const REQUIRED_ARTIFACTS: Record<IFlowState, string[]> = {
  discussing: [],
  researching: [],
  planning: ['CONTEXT.md'],
  executing: ['PLAN.md'],
  verifying: ['PLAN.md', 'SUMMARY.md'],
  shipping: ['PLAN.md', 'SUMMARY.md', 'VERIFICATION.md'],
};

const VALID_TRANSITIONS: Record<IFlowState, IFlowState[]> = {
  discussing: ['researching'],
  researching: ['planning', 'discussing'],
  planning: ['executing', 'researching'],
  executing: ['verifying', 'planning'],
  verifying: ['shipping', 'executing'],
  shipping: ['discussing'],
};

function isSourceCodePath(filePath: string): boolean {
  return SOURCE_CODE_PATTERNS.test(filePath);
}

function isIFlowArtifactPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('.flow-engine/iflow/') || normalized.endsWith('.flow-engine/iflow');
}

/**
 * IFlow artifact + phase consistency guard.
 * Checks that required .flow-engine/iflow/ artifacts exist for the current state
 * and that state transitions follow the cyclic model.
 */
export async function checkIFlowArtifactAndPhaseConsistency(changeDir: string): Promise<HookResult> {
  const iflowDir = `${changeDir}/.flow-engine/iflow`;
  const iflowExists = await directoryExists(iflowDir);
  if (!iflowExists) return { success: true };

  const stateData = await readJsonFile<{ state?: string }>(`${iflowDir}/state.json`);
  const currentState = stateData?.state;
  if (!currentState) return { success: true };

  if (!IFLOW_STATES.includes(currentState as IFlowState)) return { success: true };

  const required = REQUIRED_ARTIFACTS[currentState as IFlowState];
  if (!required || required.length === 0) return { success: true };

  const missing: string[] = [];
  for (const artifact of required) {
    const exists = await fileExists(`${iflowDir}/${artifact}`);
    if (!exists) missing.push(artifact);
  }

  if (missing.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `[IFLOW] Missing required artifacts for "${currentState}": ${missing.join(', ')}. Complete these before proceeding.`,
    };
  }

  return { success: true };
}

/**
 * IFlow file write guard.
 * Blocks writes in terminal states and restricts source code writes
 * based on iFlow state (e.g., discussing/researching should not write source code).
 */
export async function checkIFlowFileWriteGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!data) return { success: true };

  const toolName = data.toolName as string | undefined;
  const modifyingTools = ['write', 'edit', 'rename', 'delete'];
  if (!toolName || !modifyingTools.includes(toolName)) return { success: true };

  const filePath = (data.filePath as string) || '';
  if (!filePath) return { success: true };

  const iflowDir = `${changeDir}/.flow-engine/iflow`;
  const stateData = await readJsonFile<{ state?: string }>(`${iflowDir}/state.json`);
  if (!stateData?.state) return { success: true };

  const currentState = stateData.state as IFlowState;
  const isArtifact = isIFlowArtifactPath(filePath);
  const isSourceCode = !isArtifact && isSourceCodePath(filePath);

  if (isSourceCode) {
    if (currentState === 'discussing' || currentState === 'researching') {
      return {
        success: false, block: true,
        blockReason: `[IFLOW] Write blocked: workflow is in "${currentState}" state. Early phases do not allow source code changes. Complete planning first.`,
      };
    }
  }

  if (currentState === 'shipping') {
    return {
      success: false, block: true,
      blockReason: `[IFLOW] Write blocked: workflow is in terminal state "shipping". No further changes allowed.`,
    };
  }

  return { success: true };
}

/**
 * IFlow LESSONS guard.
 * Reads from .flow-engine/iflow/ directory for LESSONS.md knowledge base.
 * Warns when starting a task that matches an active lesson entry.
 */
export async function checkIFlowLessonsGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!data) return { success: true };

  const agent = (data.agent as string) || '';
  const isBuildExecutor = agent.includes('build-executor') || agent.includes('iflow-plan-executor');
  const isDebuggingAgent = agent.includes('bug-investigator');
  if (!isBuildExecutor && !isDebuggingAgent) return { success: true };

  const iflowDir = `${changeDir}/.flow-engine/iflow`;
  const stateData = await readJsonFile<{ state?: string }>(`${iflowDir}/state.json`);
  const currentState = stateData?.state || '';

  if (currentState !== 'executing' && currentState !== 'verifying') return { success: true };

  const planContent = await readFile(`${iflowDir}/PLAN.md`);
  if (!planContent) return { success: true };

  const taskMatch = planContent.match(/###\s+Task\s+\d+:\s*(.+)/g);
  if (!taskMatch || taskMatch.length === 0) return { success: true };

  const keywords: string[] = [];
  for (const line of taskMatch) {
    const titleMatch = line.match(/###\s+Task\s+\d+:\s*(.+)/);
    if (titleMatch?.[1]) {
      const words = titleMatch[1].split(/\s+/).filter((w: string) => w.length >= 4);
      keywords.push(...words);
    }
  }

  if (keywords.length === 0) return { success: true };

  const iflowLessonsPath = `${iflowDir}/lessons.md`;
  const hasIFlowLessons = await fileExists(iflowLessonsPath);
  const hasSflowLessons = await fileExists(`${changeDir}/.flow-engine/sflow/lessons.md`);

  if (!hasIFlowLessons && !hasSflowLessons) return { success: true };

  const hits = await searchLessonsInFile(changeDir, keywords);

  if (hits.length > 0) {
    const hitList = hits.map(h => 'L-' + (h.entry.id || '???') + ': "' + h.entry.title + '" (matched: ' + h.matchedKeywords.join(', ') + ')').join('; ');
    return {
      success: true,
      warnings: ['[IFLOW] LESSONS guard: task matches ' + hits.length + ' active lesson(s): ' + hitList + '. Must declare difference in execution plan before proceeding.'],
    };
  }

  return { success: true };
}

/**
 * IFlow Progress Anti-Repeat guard.
 * Reads from .flow-engine/iflow/progress.md for excluded approaches.
 */
export async function checkIFlowProgressAntiRepeatGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!data) return { success: true };

  const iflowProgressPath = `${changeDir}/.flow-engine/iflow/progress.md`;
  const hasIFlowProgress = await fileExists(iflowProgressPath);

  if (hasIFlowProgress) {
    const content = await readFile(iflowProgressPath);
    if (!content) return { success: true };

    const tableSection = content.match(/## 已排除的方案[\s\S]*?((?:\|.*\|\n?)+)/);
    if (!tableSection) return { success: true };

    const excludedApproaches: { id: string; approach: string; reason: string }[] = [];
    const rows = tableSection[1].trim().split('\n');
    for (const row of rows) {
      const trimmed = row.trim();
      if (!trimmed.startsWith('|') || /^\|[-\s|]+\|$/.test(trimmed)) continue;
      const normalized = trimmed.replace(/^\|+/, '').replace(/\|+$/, '');
      const cols = normalized.split('|').map(c => c.trim()).filter(c => c !== '');
      if (cols.length >= 3) {
        excludedApproaches.push({ id: cols[0] || '', approach: cols[1] || '', reason: cols[2] || '' });
      }
    }

    if (excludedApproaches.length === 0) return { success: true };

    const filePath = (data.filePath as string) || '';
    const toolName = (data.toolName as string) || '';
    const agent = (data.agent as string) || '';

    const fileKeywords = filePath.replace(/\\/g, '/').split(/[/.]/).filter(k => k.length >= 3 && !['src', 'test', 'spec', 'index'].includes(k));
    const agentKeywords = agent ? agent.split(/[-_\s]+/).filter(k => k.length >= 3) : [];
    const combinedKeywords = [...new Set([...fileKeywords, ...agentKeywords])];

    if (combinedKeywords.length === 0) return { success: true };

    const result = await detectProgressAntiRepeat(changeDir, combinedKeywords.join(' '));

    if (result.blocked && result.matched) {
      return {
        success: false, block: true,
        blockReason: `[IFLOW] PROGRESS anti-repeat: current operation matches excluded approach ${result.matched.id} ("${result.matched.approach}"). ${result.reason}`,
      };
    }
  }

  return { success: true };
}

/**
 * IFlow OMO usage guard.
 * Warns when iFlow uses read/grep in researching phase
 * without first calling call_omo_agent when omo is available.
 */
let _iflowOmoUsedInCurrentResearching = false;

export function markIFlowOmoUsed(): void {
  _iflowOmoUsedInCurrentResearching = true;
}

export function resetIFlowOmoTracking(): void {
  _iflowOmoUsedInCurrentResearching = false;
}

export async function checkIFlowOmoUsageGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!data) return { success: true };

  const toolName = (data.toolName as string) || '';
  if (toolName !== 'read' && toolName !== 'grep') return { success: true };

  const iflowDir = `${changeDir}/.flow-engine/iflow`;
  const stateData = await readJsonFile<{ state?: string }>(`${iflowDir}/state.json`);
  const currentState = stateData?.state || '';
  if (currentState !== 'researching') return { success: true };

  const hasOmo = getHasOmoPlugin();
  if (!hasOmo) return { success: true };

  if (!_iflowOmoUsedInCurrentResearching) {
    return {
      success: true,
      warnings: ['[IFLOW] OMO guard: iFlow used read/grep in researching phase without calling call_omo_agent first. When omo is available, you MUST use call_omo_agent for code exploration.'],
    };
  }

  return { success: true };
}
