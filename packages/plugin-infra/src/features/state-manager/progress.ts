import { readFile, writeFile, ensureDir, extractKeywords as jiebaExtractKeywords, calculateDynamicThreshold, calculateOverlapRatio } from "@opencode-flow-engine/shared";

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

// ─── PROGRESS.md Operations ────────────────────────────────────────────────

export async function writeProgressFile(changeDir: string, data: ProgressData): Promise<void> {
  const path = changeDir + '/.flow-engine/sflow/progress.md';
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
  await ensureDir(changeDir + '/.flow-engine/sflow');
  await writeFile(path, lines.join('\n'));
}

export async function readProgressFile(changeDir: string): Promise<ProgressData | null> {
  const path = changeDir + '/.flow-engine/sflow/progress.md';
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
  // P11 fix: More robust "current state" parsing — stop at next ## or --- section
  const stateMatch = content.match(/## 当前正在做[\s\S]*?\n([\s\S]*?)(?=\n##|\n---|\n$)/);
  if (stateMatch) data.currentState = (stateMatch[1] || '').trim();
  const nextMatch = content.match(/\*\*下一步\*\*:\s*(.+)/);
  if (nextMatch) data.nextStep = (nextMatch[1] || '').trim();
  const blockedMatch = content.match(/\*\*阻塞\*\*:\s*(.+)/);
  if (blockedMatch) data.blockedBy = (blockedMatch[1] || '').trim();
  // P7: Robust table parsing — handles blockquote between header and table,
  // rows without leading `|`, and returns empty result with warning if no rows found
  const tableSection = content.match(/## 已排除的方案[\s\S]*?((?:\|.*\|\n?)+)/);
  if (tableSection && tableSection[1]) {
    // Deduplicate rows: collect unique (id, approach, reason) combinations
    const seenRows = new Set<string>();
    const rows = tableSection[1].trim().split('\n');
    for (const row of rows) {
      const trimmed = row.trim();
      // Skip non-table lines, separator rows, and rows without content
      if (!trimmed.startsWith('|') || /^\|[-\s|]+\|$/.test(trimmed)) continue;
      // Normalize: strip leading/trailing `|` before splitting
      const normalized = trimmed.replace(/^\|+/, '').replace(/\|+$/, '');
      const cols = normalized.split('|').map(c => c.trim()).filter(c => c !== '');
      const id = cols[0] || '';
      const approach = cols[1] || '';
      const reason = cols[2] || '';
      const failCount = parseInt(cols[3] || '0', 10) || 0;
      if (id && approach && !seenRows.has(id + ':' + approach)) {
        seenRows.add(id + ':' + approach);
        data.excludedApproaches.push({ id, approach, reason, failCount });
      }
    }
  }
  // P10: Parse "待确认的假设" — use lookahead for next ## section boundary to
  // prevent matching `- ` lines from previous sections (e.g., the table block)
  const assumptionsSection = content.match(/## 待确认的假设\n([\s\S]*?)(?=\n## |\n---|\n$)/);
  if (assumptionsSection && assumptionsSection[1]) {
    data.pendingAssumptions = assumptionsSection[1].split('\n')
      .filter(l => l.trimStart().startsWith('- '))
      .map(l => l.trimStart().replace(/^- /, ''));
  }
  // Parse clues
  const cluesSection = content.match(/## 临时记下的线索[^]*?\n((?:- .+\n?)*)/);
  if (cluesSection && cluesSection[1]) {
    data.clues = cluesSection[1].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
  }
  return data;
}

/**
 * P13 fix: Minimum keyword overlap ratio for anti-repeat blocking.
 * Extracted as a named constant for configurability.
 */
export const PROGRESS_ANTI_REPEAT_THRESHOLD = 0.5;

/**
 * P10 fix: Extract meaningful keywords from text for comparison.
 * Supports both English (whitespace tokenization) and Chinese (character n-grams).
 */
function extractKeywords(text: string): Set<string> {
  // P31: Use jieba-based keyword extraction for better accuracy
  // Falls back to the original n-gram approach if jieba fails
  try {
    const keywords = jiebaExtractKeywords(text);
    return new Set(keywords);
  } catch {
    // Fallback to original n-gram approach
    const lower = text.toLowerCase();
    const keywords = new Set<string>();
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'using',
      'this', 'that', 'it', 'its', 'we', 'they', 'use', 'used', 'do', 'does', 'did',
      'not', 'no', 'but', 'or', 'and', 'if', 'then', 'else', 'so']);
    const englishTokens = lower.replace(/[^\w\s]/g, ' ').split(/\s+/);
    for (const t of englishTokens) {
      if (t.length >= 3 && !stopWords.has(t)) keywords.add(t);
    }
    // P8: Reduce Chinese n-gram false positives — only 2-char bigrams for long segments,
    // full segment for short segments, and deduplicate via frequency map
    const chineseChars = lower.match(/[\u4e00-\u9fff]+/g);
    if (chineseChars) {
      const ngramFreq = new Map<string, number>();
      for (const segment of chineseChars) {
        // Short segment (≤4 chars): use the whole segment
        if (segment.length <= 4) {
          keywords.add(segment);
        } else {
          // Long segment: only 2-char overlapping bigrams, count frequency
          for (let i = 0; i <= segment.length - 2; i++) {
            const bigram = segment.slice(i, i + 2);
            ngramFreq.set(bigram, (ngramFreq.get(bigram) || 0) + 1);
          }
          // Also add the full segment if it's a meaningful phrase
          keywords.add(segment);
        }
      }
      // Only include bigrams that appear ≥ 2 times across all segments
      for (const [bigram, freq] of ngramFreq) {
        if (freq >= 2) keywords.add(bigram);
      }
    }
    return keywords;
  }
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
    // P32: Use dynamic threshold based on keyword count
    const totalKeywords = plannedKeywords.size + excludedKeywords.size;
    const threshold = calculateDynamicThreshold(totalKeywords, PROGRESS_ANTI_REPEAT_THRESHOLD);
    // P32: Use calculateOverlapRatio for more accurate overlap detection
    const overlapRatio = calculateOverlapRatio(Array.from(plannedKeywords), Array.from(excludedKeywords));
    if (overlapRatio >= threshold) {
      return {
        blocked: true,
        matched: ex,
        reason: 'Approach has ' + Math.round(overlapRatio * 100) + '% keyword overlap with excluded approach ' + ex.id + ' ("' + ex.approach + '"). Previous failure reason: ' + ex.reason + '. Dynamic threshold: ' + threshold.toFixed(2) + '. Must explain difference from previous attempt before retrying.',
      };
    }
  }
  return { blocked: false, matched: null };
}

/**
 * P33: Clear PROGRESS.md after task completion.
 * Deletes the progress file and optionally moves task summary to SUMMARY.md.
 */
export async function clearProgressFile(changeDir: string): Promise<void> {
  const progressPath = changeDir + '/.flow-engine/sflow/progress.md';
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(progressPath);
  } catch {
    // File doesn't exist, ignore
  }
  // Also clear subagent-progress.md to avoid stale state
  const subagentProgressPath = changeDir + '/.flow-engine/sflow/subagent-progress.md';
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(subagentProgressPath);
  } catch {
    // File doesn't exist, ignore
  }
}
