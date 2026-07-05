import type { FeatureConfig, FeatureResult } from "./types.js";
import { createWorkflowManager } from "./workflow-manager.js";
import { fileExists, readJsonFile, writeJsonFile, atomicWriteJsonFile, ensureDir, readFile, directoryExists, isContractStale as checkContractStale, writeFile } from "@opencode-sflow/shared";

const BOULDER_STATE_FILE = ".sflow/boulder-state.json";

type WorkflowManager = ReturnType<typeof createWorkflowManager>;


// -- Standalone helpers (exported for reuse by session.ts) --

export async function simpleHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ─── LESSONS.md Types ──────────────────────────────────────────────────────

export interface LessonEntry {
  id?: string;
  title: string;
  tags: string[];
  changeId?: string;
  taskId?: string;
  firstSeen: string;
  lastReviewed: string;
  stack?: string;
  status: 'active' | 'superseded' | 'deprecated';
  supersededBy?: string;
  keywords: string[];
  problem: string;
  attempted: string;
  whyFailed: string;
  recommendation: string;
  reevaluateWhen?: string;
}

export interface LessonHit {
  entry: LessonEntry;
  matchedKeywords: string[];
}

// ─── PROGRESS.md Types ─────────────────────────────────────────────────────

export interface ExcludedApproach {
  id: string;
  approach: string;
  reason: string;
  failCount: number;
}

export interface ProgressData {
  changeId?: string;
  taskId?: string;
  pausedAt: string;
  trigger: string;
  completedSteps: string[];
  currentState: string;
  nextStep?: string;
  blockedBy?: string;
  excludedApproaches: ExcludedApproach[];
  pendingAssumptions: string[];
  clues: string[];
}

// ─── LESSONS.md Operations ──────────────────────────────────────────────────

export function parseLessonsMd(content: string): LessonEntry[] {
  const entries: LessonEntry[] = [];
  const blocks = content.split(/\n### /);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const idMatch = block.match(/^L-(\d+)/);
    const primaryMatch = block.match(/^L-\d+\s*(?:·|-|\s*)\s*\[([^\]]*)\]\s*(.+)/);
    const looseMatch = !primaryMatch ? block.match(/^L-\d+\s+(.+?)(?:\n|$)/) : null;
    if (!primaryMatch && !looseMatch) continue;
    const tags = primaryMatch ? (primaryMatch[1] || '').split(',').map((t: string) => t.trim()) : [];
    const title = primaryMatch ? (primaryMatch[2] || '').trim() : ((looseMatch ? looseMatch[1] : '') || '').trim();
    const keywordsMatch = block.match(/\*\*关键词\*\*:\s*(.+)/);
    const problemMatch = block.match(/\*\*问题场景\*\*\n([\s\S]*?)(?=\*\*当时尝试)/);
    const attemptedMatch = block.match(/\*\*当时尝试的方案\*\*\n([\s\S]*?)(?=\*\*为什么不行)/);
    const whyFailedMatch = block.match(/\*\*为什么不行\*\*\n([\s\S]*?)(?=\*\*当前推荐)/);
    const recMatch = block.match(/\*\*当前推荐做法\*\*\n([\s\S]*?)(?=\*\*何时可重新)/);
    const reevalMatch = block.match(/\*\*何时可重新评估\*\*\n([\s\S]*?)$/);
    const statusMatch = block.match(/\*\*状态\*\*:\s*(.+)/);
    const stackMatch = block.match(/\*\*适用栈\*\*:\s*(.+)/);
    const firstSeenMatch = block.match(/\*\*首发\*\*:\s*(.+)/);
    const keywords = keywordsMatch ? (keywordsMatch[1] || '').split(/\s+/).filter(Boolean) : [];
    const id = 'L-' + (idMatch ? (idMatch[1] || String(entries.length + 1)) : String(entries.length + 1));
    entries.push({
      id,
      title,
      tags,
      keywords,
      status: (statusMatch ? (statusMatch[1] || '').trim() as LessonEntry['status'] : undefined) || 'active',
      stack: stackMatch ? (stackMatch[1] || '').trim() : undefined,
      firstSeen: firstSeenMatch ? (firstSeenMatch[1] || '').trim() : new Date().toISOString(),
      lastReviewed: new Date().toISOString(),
      problem: problemMatch ? (problemMatch[1] || '').trim() : '',
      attempted: attemptedMatch ? (attemptedMatch[1] || '').trim() : '',
      whyFailed: whyFailedMatch ? (whyFailedMatch[1] || '').trim() : '',
      recommendation: recMatch ? (recMatch[1] || '').trim() : '',
      reevaluateWhen: reevalMatch ? (reevalMatch[1] || '').trim() : '',
    });
  }
  return entries;
}

export function formatLessonEntry(index: number, entry: LessonEntry): string {
  const lines = [
    '### L-' + String(index).padStart(3, '0') + ' · [' + entry.tags.join(', ') + '] ' + entry.title,
    '',
    '- **首发**: ' + (entry.changeId || '') + ' · ' + (entry.taskId || '') + ' · ' + entry.firstSeen,
    '- **上次复核**: ' + entry.lastReviewed,
    '- **适用栈**: ' + (entry.stack || ''),
    '- **状态**: ' + entry.status + (entry.supersededBy ? ' superseded-by:' + entry.supersededBy : ''),
    '- **关键词**: ' + entry.keywords.join(' '),
    '',
    '**问题场景**',
    entry.problem,
    '',
    '**当时尝试的方案**',
    entry.attempted,
    '',
    '**为什么不行**',
    entry.whyFailed,
    '',
    '**当前推荐做法**',
    entry.recommendation,
    '',
    '**何时可重新评估**',
    entry.reevaluateWhen || '无需重新评估',
  ];
  return lines.join('\n');
}

/**
 * Minimum match ratio for lesson keyword search.
 * At least MIN_MATCH_RATIO of the input keywords must match
 * before an entry is considered a hit, to reduce false positives.
 */
const LESSONS_MIN_MATCH_RATIO = 0.4;

/**
 * Derive the project root directory from a change directory path.
 * A change dir is typically under .sflow/changes/<change-id>.
 * The project root is the first ancestor that does NOT end with a change-like path.
 */
export function findProjectRoot(changeDir: string): string {
  const normalized = changeDir.replace(/\\/g, '/');
  // If under .sflow/changes/, the project root is 3 levels up from the change
  const changesMarker = '/.sflow/changes/';
  const idx = normalized.lastIndexOf(changesMarker);
  if (idx !== -1) {
    return normalized.slice(0, idx);
  }
  // If changeDir itself contains .sflow/, it might be a project root
  if (normalized.includes('/.sflow/')) {
    // Walk up until we find the directory that contains .sflow
    const parts = normalized.split('/');
    for (let i = parts.length; i > 0; i--) {
      const candidate = parts.slice(0, i).join('/');
      if (candidate.endsWith('/.sflow')) return parts.slice(0, i - 1).join('/');
    }
  }
  return changeDir;
}

/**
 * Search lessons in a specific file path.
 * Internal helper — does NOT do project-level fallback.
 */
async function searchLessonsInSingleFile(lessonsPath: string, keywords: string[]): Promise<LessonHit[]> {
  const content = await readFile(lessonsPath);
  if (!content) return [];
  const entries = parseLessonsMd(content);
  const hits: LessonHit[] = [];
  if (keywords.length === 0) return [];
  const lowerKeywords = keywords.map(k => k.toLowerCase());
  for (const entry of entries) {
    if (entry.status !== 'active') continue;
    const matched = lowerKeywords.filter(kw =>
      entry.keywords.some(ek => ek.toLowerCase().includes(kw) || kw.includes(ek.toLowerCase())) ||
      entry.title.toLowerCase().includes(kw) ||
      entry.tags.some(t => t.toLowerCase().includes(kw)),
    );
    // Apply min match ratio to reduce false positives
    const matchRatio = matched.length / lowerKeywords.length;
    if (matched.length > 0 && matchRatio >= LESSONS_MIN_MATCH_RATIO) {
      hits.push({ entry, matchedKeywords: matched });
    }
  }
  return hits;
}

/**
 * Search lessons with project-level fallback.
 * 1. Searches change-level .sflow/lessons.md first
 * 2. Also searches project-level .sflow/lessons.md (for cross-change shared knowledge)
 * Results from both levels are merged, deduplicated by entry ID.
 */
export async function searchLessonsInFile(changeDir: string, keywords: string[]): Promise<LessonHit[]> {
  const hits: LessonHit[] = [];
  const seenIds = new Set<string>();

  // Level 1: change-level lessons
  const changeHits = await searchLessonsInSingleFile(changeDir + '/.sflow/lessons.md', keywords);
  for (const hit of changeHits) {
    if (hit.entry.id && !seenIds.has(hit.entry.id)) {
      seenIds.add(hit.entry.id);
      hits.push(hit);
    }
  }

  // Level 2: project-level lessons (cross-change shared)
  const projectRoot = findProjectRoot(changeDir);
  if (projectRoot !== changeDir) {
    const projectHits = await searchLessonsInSingleFile(projectRoot + '/.sflow/lessons.md', keywords);
    for (const hit of projectHits) {
      if (hit.entry.id && !seenIds.has(hit.entry.id)) {
        seenIds.add(hit.entry.id);
        hits.push(hit);
      }
    }
  }

  return hits;
}

export async function writeProgressFile(changeDir: string, data: ProgressData): Promise<void> {
  const path = changeDir + '/.sflow/progress.md';
  const lines: string[] = [];
  lines.push('# PROGRESS: ' + (data.taskId || 'Unknown'), '');
  if (data.changeId) lines.push('- **Change ID**: ' + data.changeId);
  if (data.taskId) lines.push('- **Task ID**: ' + data.taskId);
  lines.push('- **暂停时间**: ' + data.pausedAt);
  lines.push('- **触发清窗的信号**: ' + data.trigger);
  lines.push('', '---', '', '## 已完成的子步骤', '');
  for (const step of data.completedSteps) {
    lines.push('- [x] ' + step);
  }
  lines.push('', '## 当前正在做（清窗那一刻的状态）', '');
  lines.push(data.currentState);
  if (data.nextStep) lines.push('', '**下一步**: ' + data.nextStep);
  if (data.blockedBy) lines.push('', '**阻塞**: ' + data.blockedBy);
  lines.push('', '## 已排除的方案（反重复关键）', '');
  lines.push('> 接手的 AI 必须读这一段。任何想再尝试这些方案的，必须先解释"本次与上次的差异"。', '');
  lines.push('', '| # | 方案 | 排除理由 | 失败次数 |');
  lines.push('|---|------|----------|----------|');
  for (const ex of data.excludedApproaches) {
    lines.push('| ' + ex.id + ' | ' + ex.approach + ' | ' + ex.reason + ' | ' + ex.failCount + ' |');
  }
  lines.push('', '## 待确认的假设', '');
  for (const a of data.pendingAssumptions) {
    lines.push('- ' + a);
  }
  lines.push('', '## 临时记下的线索 / 文件位置', '');
  for (const c of data.clues) {
    lines.push('- ' + c);
  }
  lines.push('', '---', '', '## 恢复指引（给下一会话的 AI）', '');
  lines.push('下一会话开始时，**第一步**：', '');
  lines.push('1. 读完本文件「已排除的方案」');
  lines.push('2. 检查接下来计划的方案是否撞车');
  lines.push('3. 如果不撞车，从「当前正在做」的下一步起步');
  lines.push('4. 完成本任务后，删除本 PROGRESS.md（产出迁移到 SUMMARY.md）');
  lines.push('', '> PROGRESS.md 是**临时**文件，任务完成后必须清理。');
  await ensureDir(changeDir + '/.sflow');
  await writeFile(path, lines.join('\n'));
}

export async function readProgressFile(changeDir: string): Promise<ProgressData | null> {
  const path = changeDir + '/.sflow/progress.md';
  const content = await readFile(path);
  if (!content) return null;
  const data: ProgressData = {
    pausedAt: '',
    trigger: '',
    completedSteps: [],
    currentState: '',
    excludedApproaches: [],
    pendingAssumptions: [],
    clues: [],
  };
  const taskIdMatch = content.match(/PROGRESS:\s*(\S+)/);
  if (taskIdMatch) data.taskId = taskIdMatch[1] || '';
  const changeIdMatch = content.match(/\*\*Change ID\*\*:\s*(\S+)/);
  if (changeIdMatch) data.changeId = changeIdMatch[1] || '';
  const pauseMatch = content.match(/\*\*暂停时间\*\*:\s*(.+)/);
  if (pauseMatch) data.pausedAt = pauseMatch[1] || '';
  const triggerMatch = content.match(/\*\*触发清窗的信号\*\*:\s*(.+)/);
  if (triggerMatch) data.trigger = triggerMatch[1] || '';
  const stateMatch = content.match(/## 当前正在做[^]*?\n([^#]+)/);
  if (stateMatch) data.currentState = (stateMatch[1] || '').trim();
  const nextMatch = content.match(/\*\*下一步\*\*:\s*(.+)/);
  if (nextMatch) data.nextStep = (nextMatch[1] || '').trim();
  const blockedMatch = content.match(/\*\*阻塞\*\*:\s*(.+)/);
  if (blockedMatch) data.blockedBy = (blockedMatch[1] || '').trim();
  // Parse excluded approaches table — use [^|] to prevent | from breaking column alignment
  const tableMatch = content.match(/\| (\S+) \| ([^|]+?) \| ([^|]+?) \| (\d+) \|/g);
  if (tableMatch) {
    for (const row of tableMatch) {
      const parts = row.match(/\| (\S+) \| (.+?) \| (.+?) \| (\d+) \|/);
      if (parts) {
        data.excludedApproaches.push({ id: parts[1] || '', approach: parts[2] || '', reason: parts[3] || '', failCount: parseInt(parts[4] || '0', 10) });
      }
    }
  }
  // Parse assumptions
  const assumptionsSection = content.match(/## 待确认的假设[^]*?\n((?:- .+\n?)*)/);
  if (assumptionsSection && assumptionsSection[1]) {
    data.pendingAssumptions = assumptionsSection[1].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
  }
  // Parse clues
  const cluesSection = content.match(/## 临时记下的线索[^]*?\n((?:- .+\n?)*)/);
  if (cluesSection && cluesSection[1]) {
    data.clues = cluesSection[1].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
  }
  return data;
}

/**
 * Extract meaningful keywords from an approach string for comparison.
 * Removes stop words and short tokens, returns a set of significant terms.
 */
function extractKeywords(text: string): Set<string> {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'using',
    'this', 'that', 'it', 'its', 'we', 'they', 'use', 'used', 'do', 'does', 'did',
    'not', 'no', 'but', 'or', 'and', 'if', 'then', 'else', 'so']);
  const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !stopWords.has(w));
  return new Set(words);
}

export async function detectProgressAntiRepeat(changeDir: string, plannedApproach: string): Promise<{ blocked: boolean; matched: ExcludedApproach | null; reason?: string }> {
  const progress = await readProgressFile(changeDir);
  if (!progress || progress.excludedApproaches.length === 0) {
    return { blocked: false, matched: null };
  }
  const plannedKeywords = extractKeywords(plannedApproach);
  if (plannedKeywords.size === 0) {
    return { blocked: false, matched: null };
  }
  for (const ex of progress.excludedApproaches) {
    const excludedKeywords = extractKeywords(ex.approach);
    if (excludedKeywords.size === 0) continue;
    // Compute Jaccard-like intersection ratio
    let intersectionCount = 0;
    for (const kw of plannedKeywords) {
      if (excludedKeywords.has(kw)) intersectionCount++;
    }
    const overlapRatio = intersectionCount / Math.min(plannedKeywords.size, excludedKeywords.size);
    if (overlapRatio >= 0.5) {
      return {
        blocked: true,
        matched: ex,
        reason: 'Approach has ' + Math.round(overlapRatio * 100) + '% keyword overlap with excluded approach ' + ex.id + ' ("' + ex.approach + '"). Previous failure reason: ' + ex.reason + '. Must explain difference from previous attempt before retrying.',
      };
    }
  }
  return { blocked: false, matched: null };
}


/**
 * Canonical detectStateMismatch - single source of truth for state/artifact consistency.
 * Used by session.ts and state-manager.restoreState.
 */
export async function detectStateMismatch(changeDir: string, currentState: string): Promise<string> {
  const hp = await fileExists(changeDir + '/proposal.md');
  const hd = await fileExists(changeDir + '/design.md');
  const ht = await fileExists(changeDir + '/tasks.md');
  const hsp = await directoryExists(changeDir + '/specs');
  const hc = await fileExists(changeDir + '/execution-contract.md');
  const hui = await fileExists(changeDir + '/ui-design.md');
  const pc = hp ? await readFile(changeDir + '/proposal.md') : null;
  const tc = ht ? await readFile(changeDir + '/tasks.md') : null;
  const inc = tc ? tc.split('\n').filter((l: string) => l.match(/^-\s*\[\s\]/)).length : 0;
  const allDone = tc ? tc.split('\n').filter((l: string) => l.match(/^-\s*\[.\]+\s/)).length > 0 && inc === 0 : false;
  if (hc && (currentState === 'approved-for-build' || currentState === 'executing')) {
    const sd = await readJsonFile<Record<string, unknown>>(changeDir + '/.sflow/state.json');
    const sh = (sd?.contract_hash as string) || '';
    if (sh) {
      const cc = await readFile(changeDir + '/execution-contract.md');
      const ch = await simpleHash(cc || '');
      if (ch !== sh) return 'bridging';
    }
  }
  if (currentState === 'exploring' && hp && pc && pc.trim().length > 100) return 'specifying';
  if (currentState === 'specifying' && hd && ht && hsp) {
    // Use real-time detectFrontend() instead of cached state.json isFrontend
    // Dynamic import to avoid circular dependency across package boundaries
    const { detectFrontend } = await import('./workflow-manager.js');
    const isFrontend = await detectFrontend(changeDir);
    if (isFrontend && !hui) return 'ui-design';
    return 'bridging';
  }
  if (currentState === 'ui-design' && hui) return 'bridging';
  if (currentState === 'bridging' && hc) return 'approved-for-build';
  if ((currentState === 'approved-for-build' || currentState === 'executing') && allDone) return 'closing';
  if (currentState === 'specifying' && !hp) return 'exploring';
  if (currentState === 'bridging' && (!hd || !ht || !hsp)) return 'specifying';
  if (currentState === 'ui-design' && (!hd || !ht || !hsp)) return 'specifying';
  if (currentState === 'approved-for-build' && !hc) return 'bridging';
  if (currentState === 'executing' && !hc) return 'bridging';
  if (currentState === 'debugging' && !hc) return 'bridging';
  return currentState;
}
export function createStateManager(
  config: FeatureConfig = { enabled: true },
  workflowManager?: WorkflowManager,
) {
  const wf = workflowManager || createWorkflowManager(config);

  return {
    name: "state_manager",
    config,

    getWorkflowManager: () => wf,

    async initialize(): Promise<FeatureResult> {
      if (!config.enabled) {
        return { success: true, data: { message: "State manager disabled" } };
      }
      console.log("State manager initialized");
      return { success: true };
    },

    async restoreState(changeDir: string): Promise<FeatureResult> {
      try {
        const boulderPath = `${changeDir}/${BOULDER_STATE_FILE}`;
        const exists = await fileExists(boulderPath);
        if (!exists) {
          return { success: true, data: { restored: false, reason: "No boulder state found" } };
        }

        const boulderState = await readJsonFile<Record<string, unknown>>(boulderPath);
        if (!boulderState) {
          return { success: true, data: { restored: false, reason: "Empty boulder state" } };
        }

        const currentState = (boulderState.state as string) || "exploring";
        const repairedState = await this.detectStateMismatch(changeDir, currentState);

        if (repairedState !== currentState) {
          console.log(`[SFLOW] Detected state mismatch: state=${currentState} but artifacts indicate ${repairedState}. Auto-repairing.`);
          boulderState.state = repairedState;
          boulderState.repairedFrom = currentState;
          boulderState.repairedAt = new Date().toISOString();
        }

        const statePath = `${changeDir}/.sflow/state.json`;
        await writeJsonFile(statePath, {
          ...boulderState,
          restoredAt: new Date().toISOString(),
          restoredFrom: BOULDER_STATE_FILE,
        });

        return {
          success: true,
          data: {
            restored: true,
            state: repairedState,
            repaired: repairedState !== currentState,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async detectStateMismatch(changeDir: string, currentState: string): Promise<string> {
      // R4-2: Delegate to canonical standalone function
      return detectStateMismatch(changeDir, currentState);
    },

    async persistState(changeDir: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const stateExists = await fileExists(statePath);
        if (!stateExists) {
          return { success: true, data: { persisted: false, reason: "No workflow state to persist" } };
        }

        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: true, data: { persisted: false, reason: "Empty workflow state" } };
        }

        const boulderPath = `${changeDir}/${BOULDER_STATE_FILE}`;
        await writeJsonFile(boulderPath, {
          ...state,
          persistedAt: new Date().toISOString(),
          version: 1,
          artifacts_hash: state.artifacts_hash || "",
          contract_hash: state.contract_hash || "",
          batches_completed: state.batches_completed || 0,
        });

        return {
          success: true,
          data: {
            persisted: true,
            state: state.state,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getState(changeDir: string): Promise<FeatureResult> {
      try {
        return await wf.getState(changeDir);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async updateState(changeDir: string, updates: Record<string, unknown>): Promise<FeatureResult> {
      try {
        return await wf.transitionState(changeDir, (updates.state as string) || "exploring");
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async isContractApproved(changeDir: string): Promise<FeatureResult> {
      try {
        const state = await wf.getState(changeDir);
        if (!state.success) return state;
        return {
          success: true,
          data: { approved: (state.data as Record<string, unknown>)?.contractApproved || false },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async approveContract(changeDir: string): Promise<FeatureResult> {
      try {
        const current = await wf.getState(changeDir);
        if (!current.success) return current;
        const result = await wf.transitionState(changeDir, "approved-for-build");
        if (result.success) {
          await this.persistState(changeDir);
        }
        return {
          success: result.success,
          data: { approved: true, timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async upgradeMode(changeDir: string, newMode: string, reason: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: false, error: "State file not found" };
        }

        const previousMode = state.mode;
        state.mode = newMode;
        state.updatedAt = new Date().toISOString();
        state.upgradedFrom = previousMode;
        state.upgradeReason = reason;
        state.upgradedAt = new Date().toISOString();

        await atomicWriteJsonFile(statePath, state);

        await this.persistState(changeDir);

        return {
          success: true,
          data: {
            upgraded: true,
            from: previousMode,
            to: newMode,
            reason,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async setBuildPause(changeDir: string, pauseType: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: false, error: "State file not found" };
        }
        state.build_pause = pauseType;
        state.buildPauseSetAt = new Date().toISOString();
        state.updatedAt = new Date().toISOString();
        await atomicWriteJsonFile(statePath, state);
        return { success: true, data: { build_pause: pauseType, timestamp: new Date().toISOString() } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async clearBuildPause(changeDir: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: false, error: "State file not found" };
        }
        state.build_pause = null;
        state.buildPauseClearedAt = new Date().toISOString();
        state.updatedAt = new Date().toISOString();
        await atomicWriteJsonFile(statePath, state);
        return { success: true, data: { build_pause: null, timestamp: new Date().toISOString() } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    // ─── LESSONS.md Methods ────────────────────────────────────────────────

    async grepLessons(changeDir: string, keywords: string[]): Promise<FeatureResult> {
      try {
        const hits = await searchLessonsInFile(changeDir, keywords);
        return { success: true, data: { hits } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async addLesson(changeDir: string, entry: LessonEntry): Promise<FeatureResult> {
      try {
        const lessonsPath = changeDir + '/.sflow/lessons.md';
        const existing = await readFile(lessonsPath);
        const entries = existing ? parseLessonsMd(existing) : [];
        const nextIndex = entries.length + 1;
        const formatted = '\n\n' + formatLessonEntry(nextIndex, { ...entry, firstSeen: entry.firstSeen || new Date().toISOString(), lastReviewed: new Date().toISOString() });
        // If file doesn't exist yet, write with header
        if (!existing) {
          const header = '# LESSONS — 跨任务失败知识库\n\n';
          await ensureDir(changeDir + '/.sflow');
          await writeFile(lessonsPath, header + formatted.trim());
        } else {
          await writeFile(lessonsPath, existing.replace(/\n*$/, '') + formatted);
        }
        return { success: true, data: { added: true, id: 'L-' + String(nextIndex).padStart(3, '0'), timestamp: new Date().toISOString() } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    // ─── PROGRESS.md Methods ───────────────────────────────────────────────

    async writeProgress(changeDir: string, data: ProgressData): Promise<FeatureResult> {
      try {
        await writeProgressFile(changeDir, data);
        return { success: true, data: { written: true, taskId: data.taskId, timestamp: new Date().toISOString() } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async readProgress(changeDir: string): Promise<FeatureResult> {
      try {
        const data = await readProgressFile(changeDir);
        return { success: true, data: data || null };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async checkProgressAntiRepeat(changeDir: string, plannedApproach: string): Promise<FeatureResult> {
      try {
        const result = await detectProgressAntiRepeat(changeDir, plannedApproach);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async writeProgressSnapshot(changeDir: string, data: { taskId?: string; currentState: string; nextStep?: string; excludedApproaches: ExcludedApproach[] }): Promise<FeatureResult> {
      try {
        const progressData: ProgressData = {
          taskId: data.taskId,
          pausedAt: new Date().toISOString(),
          trigger: 'Manual snapshot',
          completedSteps: [],
          currentState: data.currentState,
          nextStep: data.nextStep,
          excludedApproaches: data.excludedApproaches,
          pendingAssumptions: [],
          clues: [],
        };
        await writeProgressFile(changeDir, progressData);
        return { success: true, data: { written: true, timestamp: new Date().toISOString() } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async clearProgressSnapshot(changeDir: string): Promise<FeatureResult> {
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(changeDir + '/.sflow/progress.md');
        return { success: true, data: { cleared: true, timestamp: new Date().toISOString() } };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // File not found is not an error
        if (msg.includes('ENOENT')) return { success: true, data: { cleared: true } };
        return { success: false, error: msg };
      }
    },

    
    async updateSubagentProgress(
      changeDir: string,
      checkpoint: {
        planTask: string;
        specTask?: string;
        stage: 'implementing' | 'spec-review' | 'quality-review' | 'checkoff' | 'done' | 'blocked' | 'final-review' | 'final-fix';
        reviewFixRound?: number;
        commitHash?: string;
        changedFiles?: string[];
        redEvidence?: string;
        greenEvidence?: string;
        specCompliance?: 'pending' | 'pass' | 'fail';
        qualityStatus?: 'pending' | 'pass' | 'fail';
        unresolvedFeedback?: string[];
      },
    ): Promise<FeatureResult> {
      try {
        const progressPath = changeDir + '/.sflow/subagent-progress.md';
        const now = new Date().toISOString();
        const lines: string[] = [];
        lines.push('# Subagent Progress Checkpoint', '');
        lines.push('## Current Task');
        lines.push('- **Plan task**: ' + checkpoint.planTask);
        if (checkpoint.specTask) lines.push('- **Mapped spec task**: ' + checkpoint.specTask);
        lines.push('- **Stage**: ' + checkpoint.stage);
        if (checkpoint.reviewFixRound !== undefined) lines.push('- **Review-fix round**: ' + checkpoint.reviewFixRound);
        lines.push('', '## Implementation');
        if (checkpoint.commitHash) lines.push('- **Commit**: ' + checkpoint.commitHash);
        if (checkpoint.changedFiles) lines.push('- **Changed files**: ' + checkpoint.changedFiles.join(', '));
        if (checkpoint.redEvidence) lines.push('- **RED evidence**: ' + checkpoint.redEvidence);
        if (checkpoint.greenEvidence) lines.push('- **GREEN evidence**: ' + checkpoint.greenEvidence);
        lines.push('', '## Review Status');
        lines.push('- **Spec compliance**: ' + (checkpoint.specCompliance || 'pending'));
        lines.push('- **Code quality**: ' + (checkpoint.qualityStatus || 'pending'));
        if (checkpoint.unresolvedFeedback && checkpoint.unresolvedFeedback.length > 0) {
          lines.push('- **Unresolved feedback**: ' + checkpoint.unresolvedFeedback.join('; '));
        }
        lines.push('', '_Updated: ' + now + '_');
        await ensureDir(changeDir + '/.sflow');
        await writeFile(progressPath, lines.join('\n'));
        return { success: true, data: { written: true, stage: checkpoint.stage, timestamp: now } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
async isContractStale(changeDir: string): Promise<FeatureResult> {
      try {
        const stateExists = await fileExists(`${changeDir}/.sflow/state.json`);
        const contractPath = `${changeDir}/execution-contract.md`;
        const contractExists = await fileExists(contractPath);

        if (!stateExists || !contractExists) {
          return { success: true, data: { stale: false } };
        }

        const stale = await checkContractStale(changeDir);
        return { success: true, data: { stale } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
},
  };
}
