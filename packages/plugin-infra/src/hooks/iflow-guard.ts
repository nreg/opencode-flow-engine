/**
 * IFlow Guard Rules - Scope reduction, deviation compliance, artifact completeness, cyclic transitions
 * These guards are only active when .iflow/ directory exists.
 * Each guard returns a HookResult, and they are integrated into the main guard.ts
 * via conditional check for .iflow/ directory existence.
 */

import type { HookResult } from "./types.js";
import { fileExists, directoryExists, readFile, readJsonFile } from "@opencode-flow-engine/shared";

const IFLOW_STATES = ['discussing', 'researching', 'planning', 'executing', 'verifying', 'shipping'] as const;
type IFlowState = typeof IFLOW_STATES[number];

/**
 * Valid cyclic transitions
 */
const VALID_TRANSITIONS: Record<IFlowState, IFlowState[]> = {
  discussing: ['researching'],
  researching: ['planning', 'discussing'],  // can go back to discuss if research reveals issues
  planning: ['executing', 'researching'],   // can go back to research if plan reveals unknowns
  executing: ['verifying', 'planning'],     // can go back to planning if execution blocked
  verifying: ['shipping', 'executing'],     // can go back to execute if verification fails
  shipping: ['discussing'],                 // always return to discussing for next cycle
};

/**
 * Required artifacts for each state transition
 */
const REQUIRED_ARTIFACTS: Record<IFlowState, string[]> = {
  discussing: [],
  researching: [],
  planning: ['CONTEXT.md'],
  executing: ['PLAN.md'],
  verifying: ['PLAN.md', 'SUMMARY.md'],
  shipping: ['PLAN.md', 'SUMMARY.md', 'VERIFICATION.md'],
};

/**
 * Check if .iflow/ directory exists
 */
export async function iflowDirectoryExists(changeDir: string): Promise<boolean> {
  return directoryExists(`${changeDir}/.iflow`);
}

/**
 * Check all IFlow guards
 */
export async function checkIFlowGuards(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  const guards = [
    await checkScopeReductionGuard(changeDir, data),
    await checkNyquistRuleGuard(changeDir, data),
    await checkArtifactCompletenessGuard(changeDir, data),
    await checkCyclicTransitionGuard(changeDir, data),
    await checkDeviationComplianceGuard(changeDir, data),
  ];

  const allWarnings: string[] = [];
  for (const g of guards) {
    if (g.warnings?.length) {
      allWarnings.push(...g.warnings);
    }
  }

  const blockingGuards = guards.filter(g => g.block);
  if (blockingGuards.length > 0) {
    return {
      success: false,
      error: 'IFlow guard conditions not met',
      block: true,
      blockReason: blockingGuards.map(g => g.blockReason).join('; '),
      warnings: allWarnings.length > 0 ? allWarnings : undefined,
    };
  }

  return {
    success: true,
    warnings: allWarnings.length > 0 ? allWarnings : undefined,
  };
}

/**
 * Scope Reduction Prohibition Guard
 * Blocks removal of stated requirements from PLAN.md without user approval
 */
async function checkScopeReductionGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!data) return { success: true };

  const toolName = (data.toolName as string) || '';
  if (!toolName) {
    console.warn('[IFlow Guard] checkScopeReductionGuard called without toolName — skipping');
    return { success: true };
  }
  if (toolName !== 'write' && toolName !== 'edit') return { success: true };

  const filePath = (data.filePath as string) || '';
  if (!filePath) {
    console.warn('[IFlow Guard] checkScopeReductionGuard called without filePath — skipping');
    return { success: true };
  }
  if (!filePath.includes('PLAN.md')) return { success: true };

  // Read current PLAN.md if it exists
  const planContent = await readFile(`${changeDir}/.iflow/PLAN.md`);
  if (!planContent) return { success: true };

  // Read CONTEXT.md for original requirements
  const contextContent = await readFile(`${changeDir}/.iflow/CONTEXT.md`);
  if (!contextContent) return { success: true };

  // Check for scope reduction language patterns
  const reductionPatterns = [
    /v1|simplified\s*version|placeholder|basic\s*version|minimal\s*implementation/i,
    /future\s*enhancement|will\s*be\s*wired\s*later|skip\s*for\s*now/i,
    /static\s*for\s*now|hardcoded\s*for\s*now/i,
  ];

  // Extract requirements from CONTEXT.md (lines under ## Goals or ## Constraints)
  const contextLines = contextContent.split('\n');
  const requirements: string[] = [];
  let inGoalSection = false;
  for (const line of contextLines) {
    if (line.startsWith('## ')) {
      inGoalSection = line.includes('Goal') || line.includes('Constraint') || line.includes('Requirement');
      continue;
    }
    if (inGoalSection && line.trim().startsWith('-')) {
      requirements.push(line.trim());
    }
  }

  // Check if PLAN.md has reduction language
  for (const pattern of reductionPatterns) {
    const match = planContent.match(pattern);
    if (match) {
      return {
        success: false,
        block: true,
        blockReason: `[IFLOW] Scope reduction detected: "${match[0]}" in PLAN.md. Requirement reduction without user approval is prohibited.`,
      };
    }
  }

  // === Requirement Coverage Tracking (P3 enhancement) ===
  // Extract requirements from CONTEXT.md and check if PLAN.md covers them
  const reqItems = extractRequirementsFromContext(contextContent);
  const taskDescs = extractTaskDescriptions(planContent);
  const uncoveredReqs: string[] = [];

  if (reqItems.length > 0 && taskDescs.length > 0) {
    for (const req of reqItems) {
      const reqClean = req.replace(/^[-*\s]+/, '').toLowerCase();
      // Extract key terms from requirement
      const keyTerms = reqClean.split(/\s+/).filter(w => {
        // Chinese words: min 2 chars, English words: min 4 chars
        const isChinese = /[\u4e00-\u9fff]/.test(w);
        if (isChinese) return w.length > 1 && !['需要', '一个', '进行', '这个', '那个'].includes(w);
        return w.length > 3 && !['with', 'that', 'this', 'from', 'have', 'will', 'should', 'shall', 'must'].includes(w);
      });
      // Check if any task description covers these key terms
      const isCovered = taskDescs.some(desc => {
        const descLower = desc.toLowerCase();
        const matchCount = keyTerms.filter(term => descLower.includes(term)).length;
        return matchCount >= Math.ceil(keyTerms.length * 0.4); // 40% key term overlap = covered
      });
      if (!isCovered) {
        uncoveredReqs.push(req);
      }
    }
  }

  const warnings: string[] = [];
  if (uncoveredReqs.length > 0) {
    warnings.push(`[IFLOW] Requirement coverage: ${uncoveredReqs.length} requirement(s) from CONTEXT.md not found in PLAN.md tasks:`);
    for (const ur of uncoveredReqs) {
      warnings.push(`  - ${ur}`);
    }
  }

  return { success: true, warnings: warnings.length > 0 ? warnings : undefined };
}

/**
 * Artifact Completeness Guard
 * Blocks state transitions when required .iflow/ artifacts are missing.
 * When targetState is not provided, auto-detects from .iflow/state.json (for tool-level guard calls).
 */
async function checkArtifactCompletenessGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  let targetState = data?.targetState as string | undefined;

  // Auto-detect state from state.json when no targetState provided
  if (!targetState) {
    const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/.iflow/state.json`);
    targetState = stateData?.state;
  }

  if (!targetState) return { success: true };
  if (!IFLOW_STATES.includes(targetState as IFlowState)) return { success: true };

  const required = REQUIRED_ARTIFACTS[targetState as IFlowState];
  if (!required || required.length === 0) return { success: true };

  const missing: string[] = [];
  for (const artifact of required) {
    const exists = await fileExists(`${changeDir}/.iflow/${artifact}`);
    if (!exists) missing.push(artifact);
  }

  if (missing.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `[IFLOW] Missing required artifacts for "${targetState}": ${missing.join(', ')}. Complete these before transitioning.`,
    };
  }

  return { success: true };
}

/**
 * Cyclic Transition Validation Guard
 * Blocks invalid state jumps (e.g., executing → shipping without verifying).
 * Silently skips when no currentState/targetState provided (called from tool.execute.before context).
 */
async function checkCyclicTransitionGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  const currentState = data?.currentState as string | undefined;
  const targetState = data?.targetState as string | undefined;

  if (!currentState || !targetState) return { success: true };
  if (!IFLOW_STATES.includes(currentState as IFlowState) || !IFLOW_STATES.includes(targetState as IFlowState)) {
    return { success: true };
  }

  const allowed = VALID_TRANSITIONS[currentState as IFlowState];
  if (!allowed) {
    return {
      success: false,
      block: true,
      blockReason: `[IFLOW] Invalid transition: "${currentState}" is not a valid IFlow state.`,
    };
  }

  if (!allowed.includes(targetState as IFlowState)) {
    const validTargets = allowed.join(', ');
    return {
      success: false,
      block: true,
      blockReason: `[IFLOW] Invalid transition: "${currentState}" → "${targetState}". Valid targets: ${validTargets}`,
    };
  }

  return { success: true };
}

// ─── Helper: Extract requirements from CONTEXT.md ────────────────────────────

/**
 * Parse CONTEXT.md and extract requirement items from Goals/Constraints/Requirements sections.
 */
function extractRequirementsFromContext(content: string): string[] {
  const lines = content.split('\n');
  const requirements: string[] = [];
  let inTargetSection = false;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      inTargetSection = line.includes('Goal') || line.includes('Constraint') || line.includes('Requirement');
      continue;
    }
    if (inTargetSection && line.trim().startsWith('-')) {
      requirements.push(line.trim());
    }
  }
  return requirements;
}

/**
 * Parse PLAN.md and extract task descriptions.
 */
function extractTaskDescriptions(planContent: string): string[] {
  const lines = planContent.split('\n');
  const tasks: string[] = [];
  let inTask = false;
  let inActionsBlock = false;
  for (const line of lines) {
    if (line.startsWith('### Task ')) {
      inTask = true;
      inActionsBlock = false;
      // Extract task title after "### Task N: "
      const titleMatch = line.match(/###\s+Task\s+\d+:\s*(.+)/);
      if (titleMatch?.[1]) tasks.push(titleMatch[1]);
      continue;
    }
    if (inTask && line.startsWith('- **Actions**')) {
      inActionsBlock = true;
      continue;
    }
    if (inActionsBlock) {
      // Collect numbered action items (e.g. "  1. Do something")
      const actionMatch = line.match(/^\s+\d+\.\s+(.+)/);
      if (actionMatch?.[1]) {
        tasks.push(actionMatch[1]);
        continue;
      }
      // Actions block ends when line is not an indented numbered item
      // and is not blank — it's a new section like - **Verification**
      if (line.trim().length > 0 && !/^\s+\d+\./.test(line)) {
        inActionsBlock = false;
      }
    }
    if (inTask && line.startsWith('- **')) {
      // Still in task, collect verification line
      const verifyMatch = line.match(/- \*\*Verification\*\*:\s*(.+)/);
      if (verifyMatch?.[1]) tasks.push(verifyMatch[1]);
    }
    // End of task detection: next ### or end of section
    if (line.startsWith('### ') && !line.startsWith('### Task ')) {
      inTask = false;
      inActionsBlock = false;
    }
  }
  return tasks;
}

// ─── P2: Nyquist Rule Guard ──────────────────────────────────────────────────

/**
 * Nyquist Rule Guard — 每个 PLAN.md 中的任务必须有 `<automated>` 验证命令。
 * 读取 .iflow/PLAN.md，检查每个任务的 Verification 字段是否包含自动化验证命令。
 */
async function checkNyquistRuleGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  const planContent = await readFile(`${changeDir}/.iflow/PLAN.md`);
  if (!planContent) return { success: true };

  const warnings: string[] = [];
  const lines = planContent.split('\n');
  let currentTask = '';
  let inTaskBlock = false;
  let hasAutomated = false;

  for (const line of lines) {
    const taskMatch = line.match(/###\s+Task\s+(\d+):\s*(.+)/);
    if (taskMatch) {
      if (inTaskBlock && !hasAutomated) {
        warnings.push(`Task "${currentTask}" missing <automated> verification command`);
      }
      currentTask = taskMatch[2] || '';
      inTaskBlock = true;
      hasAutomated = false;
      continue;
    }

    if (inTaskBlock) {
      if (line.includes('<automated>')) {
        hasAutomated = true;
      }
      if (line.startsWith('### ') && !line.startsWith('### Task ')) {
        if (!hasAutomated) {
          warnings.push(`Task "${currentTask}" missing <automated> verification command`);
        }
        inTaskBlock = false;
      }
    }
  }

  if (inTaskBlock && !hasAutomated && currentTask) {
    warnings.push(`Task "${currentTask}" missing <automated> verification command`);
  }

  if (warnings.length > 0) {
    const currentState = data?.currentState as string | undefined;
    if (currentState === 'executing') {
      return {
        success: false,
        block: true,
        blockReason: `[IFLOW] Nyquist Rule violation in executing state: ${warnings.length} task(s) missing automated verification. Each task must have an <automated> command in its Verification field.`,
        warnings,
      };
    }

    return {
      success: true,
      warnings: ['[IFLOW] ' + warnings.join('; ')],
    };
  }

  return { success: true };
}

// ─── P4: Deviation Compliance Guard ─────────────────────────────────────────

/**
 * Deviation Compliance Guard — 检查 executor 的 SUMMARY.md 是否记录了偏差处理。
 * 读取 .iflow/SUMMARY.md，检查是否有 `## Deviations` 段落且标注了 Rule 编号。
 */
async function checkDeviationComplianceGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  const summaryContent = await readFile(`${changeDir}/.iflow/SUMMARY.md`);
  if (!summaryContent) return { success: true };

  const hasDeviationsSection = /^##\s+Deviations/m.test(summaryContent);
  if (!hasDeviationsSection) {
    return {
      success: true,
      warnings: ['[IFLOW] SUMMARY.md exists but missing "## Deviations" section — executor should document any deviations encountered.'],
    };
  }

  // Check each deviation entry has a Rule number
  const devLines = summaryContent.split('\n').filter(l => /^-/.test(l.trim()) && l.includes('Rule'));
  if (devLines.length === 0) {
    return {
      success: true,
      warnings: ['[IFLOW] SUMMARY.md has "## Deviations" section but entries don\'t reference Rule numbers (e.g., "Rule 1", "Rule 2").'],
    };
  }

  // Content validation: check each deviation entry has Problem, Action, Result sub-fields
  const warnings: string[] = [];
  const sections = summaryContent.split(/^## /m);
  const deviationsSection = sections.find(s => s.startsWith('Deviations'));
  if (deviationsSection) {
    const deviationEntries = deviationsSection.split(/\n(?=- \*\*Rule)/).filter(s => s.trim().startsWith('- **Rule'));
    for (const entry of deviationEntries) {
      const ruleMatch = entry.match(/\*\*Rule\s*(\d+)\*\*/i);
      const ruleNum = ruleMatch ? ruleMatch[1] : 'unknown';
      const missingFields: string[] = [];

      if (!/\*\*Problem\*\*/i.test(entry) && !/\*\*问题\*\*/i.test(entry)) {
        missingFields.push('Problem');
      }
      if (!/\*\*Action\*\*/i.test(entry) && !/\*\*行动\*\*/i.test(entry) && !/\*\*操作\*\*/i.test(entry)) {
        missingFields.push('Action');
      }
      if (!/\*\*Result\*\*/i.test(entry) && !/\*\*结果\*\*/i.test(entry)) {
        missingFields.push('Result');
      }

      if (missingFields.length > 0) {
        warnings.push(`[IFLOW] Deviation Rule ${ruleNum} is missing sub-fields: ${missingFields.join(', ')}. Each deviation should have Problem, Action, and Result.`);
      }
    }
  }

  if (warnings.length > 0) {
    return { success: true, warnings };
  }

  return { success: true };
}