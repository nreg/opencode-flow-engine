/**
 * Knowledge-related guard checks.
 * Extracted from guard.ts for maintainability.
 */

import type { HookResult } from "../../types.js";
import { fileExists, readJsonFile, readFile } from "@opencode-flow-engine/shared";
import { readProgressFile, searchLessonsInFile, getStateFilePath } from "../../../features/state-manager.js";
import { checkIFlowLessonsGuard, checkIFlowProgressAntiRepeatGuard } from "../iflow-shared-guards.js";

/**
 * P21: LESSONS.md Knowledge Base Guard — warns when starting a task
 * that matches an active lesson entry.
 *
 * Inspired by flow-kit R1.8: "每个 DEV 任务进入实现前必扫 LESSONS.md"
 * Only warns (does not block) — the AI must declare differences in the execution plan.
 */
export async function checkLessonsGuard(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  if (activeWorkflow === 'iflow') {
    return checkIFlowLessonsGuard(changeDir, data);
  }

  const agent = (data.agent as string) || '';
  // P14: Extend to bug-investigator in debugging state
  const isDebuggingAgent = agent.includes('bug-investigator');
  const isBuildExecutor = agent.includes('build-executor');
  if (!isBuildExecutor && !isDebuggingAgent) return { success: true };

  // Read state to determine if we're in debugging
  let currentState = '';
  try {
    const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
    currentState = stateData?.state || '';
  } catch { /* ignore */ }
  const isDebuggingState = currentState === 'debugging';

  // Read subagent-progress.md once for keyword extraction
  const sp = await readFile(changeDir + '/.flow-engine/sflow/subagent-progress.md').catch(() => null);

  // For build-executor: check stage in subagent-progress.md
  // For bug-investigator in debugging: skip stage check, just extract keywords
  if (isBuildExecutor && !isDebuggingState) {
    if (!sp) return { success: true };

    // Extract current stage from subagent-progress.md
    const stageMatch = sp.match(/\*\*Stage\*\*:\s*(\w+)/i);
    const stage = stageMatch?.[1] || '';

    // Only warn when entering implementing stage (not during review/fix)
    if (stage !== 'implementing') return { success: true };
  }

  // Extract task keywords from the plan task
  if (!sp) return { success: true };
  const planMatch = sp.match(/\*\*Plan task\*\*:\s*(.+)/i);
  const planTask = planMatch?.[1] || '';
  if (!planTask) return { success: true };

  // Extract keywords: file paths + action nouns
  const fileKeywords = planTask.match(/`([^`]+)`/g)?.map(s => s.replace(/`/g, '')) || [];
  const actionKeywords = planTask.split(/\s+/).filter((w: string) => w.length >= 4 && !['the', 'and', 'for', 'with', 'this', 'that', 'from'].includes(w.toLowerCase()));
  const keywords = [...new Set([...fileKeywords, ...actionKeywords])];

  if (keywords.length === 0) return { success: true };

  // Grep LESSONS.md
  const hits = await searchLessonsInFile(changeDir, keywords);

  if (hits.length > 0) {
    const hitList = hits.map(h => 'L-' + (h.entry.id || '???') + ': "' + h.entry.title + '" (matched: ' + h.matchedKeywords.join(', ') + ')').join('; ');
    return {
      success: true,
      warnings: ['[SFLOW] LESSONS guard: task matches ' + hits.length + ' active lesson(s): ' + hitList + '. Must declare difference in execution plan before proceeding.'],
    };
  }

  return { success: true };
}

/**
 * PROGRESS.md Anti-Repeat Guard — blocks approaches already excluded in PROGRESS.md.
 * Reads .flow-engine/sflow/progress.md and checks if the current operation (inferred from tool/agent/filePath)
 * matches any previously excluded approach.
 */
export async function checkProgressAntiRepeatGuard(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  if (activeWorkflow === 'iflow') {
    return checkIFlowProgressAntiRepeatGuard(changeDir, data);
  }

  const progress = await readProgressFile(changeDir);
  if (!progress || progress.excludedApproaches.length === 0) {
    return { success: true };
  }

  const filePath = (data.filePath as string) || '';
  const toolName = (data.toolName as string) || '';
  const agent = (data.agent as string) || '';

  if (!filePath && !toolName) return { success: true };

  const fileKeywords = filePath.replace(/\\/g, '/').split(/[/.]/).filter(k => k.length >= 3 && !['src', 'test', 'spec', 'index'].includes(k));
  const agentKeywords = agent ? agent.split(/[-_\s]+/).filter(k => k.length >= 3) : [];

  // P34: Also read current task description from subagent-progress.md for better keyword inference
  let taskKeywords: string[] = [];
  const sp = await readFile(changeDir + '/.flow-engine/sflow/subagent-progress.md').catch(() => null);
  if (sp) {
    const planMatch = sp.match(/\*\*Plan task\*\*:\s*(.+)/i);
    if (planMatch?.[1]) {
      const taskDesc = planMatch[1];
      // Extract file paths (backtick-wrapped) from task description
      const fileRefs = (taskDesc.match(/\x60([^\x60]+)\x60/g) || []).map(function(s) { return s.replace(/\x60/g, ''); });
      // Extract action words (4+ chars, non-stop words)
      const actionWords = taskDesc.split(/\s+/).filter((w: string) =>
        w.length >= 4 && !['the', 'and', 'for', 'with', 'this', 'that', 'from', '需要', '一个', '进行', '使用'].includes(w.toLowerCase())
      );
      taskKeywords = [...new Set([...fileRefs, ...actionWords])];
    }
  }

  const combinedKeywords = [...new Set([...fileKeywords, ...agentKeywords, ...taskKeywords])];

  if (combinedKeywords.length === 0) return { success: true };

  const { detectProgressAntiRepeat } = await import('../../../features/state-manager.js');
  const result = await detectProgressAntiRepeat(changeDir, combinedKeywords.join(' '));

  if (result.blocked && result.matched) {
    return {
      success: false, block: true,
      blockReason: `[SFLOW] PROGRESS anti-repeat: current operation matches excluded approach ${result.matched.id} ("${result.matched.approach}"). ${result.reason}`,
    };
  }

  return { success: true };
}
