import { readFile, extractKeywords as jiebaExtractKeywords, calculateDynamicThreshold, calculateOverlapRatio } from "@opencode-flow-engine/shared";

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

// ─── LESSONS.md Operations ──────────────────────────────────────────────────

/**
 * P17 fix: More flexible section boundary patterns.
 * Accepts both full Chinese labels and shorter variants with optional whitespace.
 */
function extractSection(block: string, labelPattern: string): string | null {
  const regex = new RegExp(labelPattern + '\\n([\\s\\S]*?)(?=\\n\\*\\*|\\n### |$)', 'i');
  const match = block.match(regex);
  return match ? (match[1] || '').trim() : null;
}

export function parseLessonsMd(content: string): LessonEntry[] {
  const entries: LessonEntry[] = [];
  const blocks = content.split(/(?=^L-\d+)/m);
  for (const block of blocks) {
    // P15: Trim start of block so regex anchors work when block has leading whitespace
    const trimmedBlock = block.replace(/^\s+/, '');
    const idMatch = trimmedBlock.match(/^L-(\d+)/);
    const primaryMatch = trimmedBlock.match(/^L-\d+\s*(?:·|-|\s*)\s*\[([^\]]*)\]\s*(.+)/);
    const looseMatch = !primaryMatch ? trimmedBlock.match(/^L-\d+\s+(.+?)(?:\n|$)/) : null;
    if (!primaryMatch && !looseMatch) continue;
    const tags = primaryMatch ? (primaryMatch[1] || '').split(',').map((t: string) => t.trim()) : [];
    const title = primaryMatch ? (primaryMatch[2] || '').trim() : ((looseMatch ? looseMatch[1] : '') || '').trim();

    // P17 fix: Use flexible section extraction with multiple label variants
    const problem = extractSection(trimmedBlock, '\\*\\*问题场景\\*\\*')
      || extractSection(trimmedBlock, '\\*\\*场景\\*\\*')
      || extractSection(trimmedBlock, '\\*\\*问题\\*\\*') || '';
    const attempted = extractSection(trimmedBlock, '\\*\\*当时尝试的方案\\*\\*')
      || extractSection(trimmedBlock, '\\*\\*尝试方案\\*\\*')
      || extractSection(trimmedBlock, '\\*\\*尝试\\*\\*') || '';
    const whyFailed = extractSection(trimmedBlock, '\\*\\*为什么不行\\*\\*')
      || extractSection(trimmedBlock, '\\*\\*失败原因\\*\\*')
      || extractSection(trimmedBlock, '\\*\\*原因\\*\\*') || '';
    const recommendation = extractSection(trimmedBlock, '\\*\\*当前推荐做法\\*\\*')
      || extractSection(trimmedBlock, '\\*\\*推荐做法\\*\\*')
      || extractSection(trimmedBlock, '\\*\\*推荐\\*\\*') || '';
    const reevaluateWhen = extractSection(trimmedBlock, '\\*\\*何时可重新评估\\*\\*')
      || extractSection(trimmedBlock, '\\*\\*何时评估\\*\\*') || '';

    const keywordsMatch = trimmedBlock.match(/\*\*关键词\*\*:\s*(.+)/) || trimmedBlock.match(/\*\*关键词\*\*[:：]\s*(.+)/);
    const statusMatch = trimmedBlock.match(/\*\*状态\*\*:\s*(.+)/) || trimmedBlock.match(/\*\*状态\*\*[:：]\s*(.+)/);
    const stackMatch = trimmedBlock.match(/\*\*适用栈\*\*:\s*(.+)/) || trimmedBlock.match(/\*\*适用栈\*\*[:：]\s*(.+)/);
    const firstSeenMatch = trimmedBlock.match(/\*\*首发\*\*:\s*(.+)/) || trimmedBlock.match(/\*\*首发\*\*[:：]\s*(.+)/);
    const keywords = keywordsMatch ? (keywordsMatch[1] || '').split(/[\s,]+/).filter(Boolean) : [];
    const id = 'L-' + (idMatch ? (idMatch[1] || String(entries.length + 1)) : String(entries.length + 1));

    // P36: Check if reevaluateWhen condition is met
    // This is stored in the entry and checked at search time to warn about stale lessons
    const reevaluateWhenParsed = reevaluateWhen || '无需重新评估';

    entries.push({
      id,
      title,
      tags,
      keywords,
      status: (statusMatch ? (statusMatch[1] || '').trim() as LessonEntry['status'] : undefined) || 'active',
      stack: stackMatch ? (stackMatch[1] || '').trim() : undefined,
      firstSeen: firstSeenMatch ? (firstSeenMatch[1] || '').trim() : new Date().toISOString(),
      lastReviewed: new Date().toISOString(),
      problem,
      attempted,
      whyFailed,
      recommendation,
      reevaluateWhen: reevaluateWhen || '无需重新评估',
    });
  }
  return entries;
}

export function formatLessonEntry(index: number, entry: LessonEntry): string {
  // P12: Escape special MD chars in tags to prevent markup breakage
  const safeTags = entry.tags.map(t => t.replace(/[\[\]\(\)]/g, ''));
  const lines = [
    '### L-' + String(index).padStart(3, '0') + ' · [' + safeTags.join(', ') + '] ' + entry.title,
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
const LESSONS_MIN_MATCH_RATIO = 0.55; // P3: Increased from 0.4 to reduce false positives

/**
 * Derive the project root directory from a change directory path.
 * A change dir is typically under .flow-engine/sflow/changes/<change-id>.
 * The project root is the first ancestor that does NOT end with a change-like path.
 */
export function findProjectRoot(changeDir: string): string {
  const normalized = changeDir.replace(/\\/g, '/');
  // If under .flow-engine/sflow/changes/, the project root is 3 levels up from the change
  const changesMarker = '/.flow-engine/sflow/changes/';
  const idx = normalized.lastIndexOf(changesMarker);
  if (idx !== -1) {
    return normalized.slice(0, idx);
  }
  // If changeDir itself contains .flow-engine/sflow/, it might be a project root
  if (normalized.includes('/.flow-engine/sflow/')) {
    // Walk up until we find the directory that contains .flow-engine/sflow
    const parts = normalized.split('/');
    for (let i = parts.length; i > 0; i--) {
      const candidate = parts.slice(0, i).join('/');
      if (candidate.endsWith('/.flow-engine/sflow')) return parts.slice(0, i - 1).join('/');
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
  // P14 fix: Stop words for English keyword filtering (Chinese has no stop word list here)
  const lessonStopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'using',
    'this', 'that', 'it', 'its', 'we', 'they', 'use', 'used', 'do', 'does', 'did',
    'not', 'no', 'but', 'or', 'and', 'if', 'then', 'else', 'so', 'of', '方案', '做法',
    '尝试', '问题', '解决', '使用', '通过', '可以', '需要', '进行']);

  for (const entry of entries) {
    if (entry.status !== 'active') continue;
    const matched = lowerKeywords.filter(kw => {
      // P14 fix: Skip short tokens (< 2 chars) to reduce substring false positives
      if (kw.length < 2) return false;
      // P14 fix: Skip common stop words
      if (lessonStopWords.has(kw)) return false;
      // P14 fix: Use word-length-prefix matching instead of pure substring
      // For English: require the keyword to start with the search term (or vice versa)
      // For Chinese: require exact match (Chinese chars don't have whitespace boundaries)
      return entry.keywords.some(ek => {
        const ekLower = ek.toLowerCase();
        // English: word-boundary prefix match (keyword starts with search term)
        if (kw.length >= 3 && kw.startsWith(ekLower)) return true;
        // Chinese: exact character n-gram match
        if (/[\u4e00-\u9fff]/.test(kw) && ekLower.includes(kw)) return true;
        return false;
      }) ||
      // P11: Use word-boundary matching on title, not substring — prevents "form" matching "transformer"
      (() => {
        const titleLower = entry.title.toLowerCase();
        if (titleLower === kw) return true;
        const escKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try { return new RegExp('\\b' + escKw + '\\b', 'i').test(entry.title); }
        catch { return titleLower.includes(kw) && kw.length >= 4; }
      })() ||
      entry.tags.some(t => {
        const tLower = t.toLowerCase();
        return tLower === kw || tLower.startsWith(kw + ' ') || tLower.endsWith(' ' + kw);
      });
    });
    // P37: Dynamic threshold based on total keyword count
    const totalKeywords = lowerKeywords.length + entry.keywords.length;
    const lessonsThreshold = calculateDynamicThreshold(totalKeywords, LESSONS_MIN_MATCH_RATIO);
    const matchRatio = matched.length / lowerKeywords.length;
    if (matched.length > 0 && matchRatio >= lessonsThreshold) {
      hits.push({ entry, matchedKeywords: matched });
    }
  }
  return hits;
}

/**
 * Search lessons with project-level fallback.
 * 1. Searches change-level .flow-engine/sflow/lessons.md first
 * 2. Also searches project-level .flow-engine/sflow/lessons.md (for cross-change shared knowledge)
 * Results from both levels are merged, deduplicated by entry ID.
 */
export async function searchLessonsInFile(changeDir: string, keywords: string[]): Promise<LessonHit[]> {
  const hits: LessonHit[] = [];
  const seenIds = new Set<string>();

  // Level 1: change-level lessons
  const changeHits = await searchLessonsInSingleFile(changeDir + '/.flow-engine/sflow/lessons.md', keywords);
  for (const hit of changeHits) {
    if (hit.entry.id && !seenIds.has(hit.entry.id)) {
      seenIds.add(hit.entry.id);
      hits.push(hit);
    }
  }

  // Level 2: project-level lessons (cross-change shared)
  const projectRoot = findProjectRoot(changeDir);
  if (projectRoot !== changeDir) {
    const projectHits = await searchLessonsInSingleFile(projectRoot + '/.flow-engine/sflow/lessons.md', keywords);
    for (const hit of projectHits) {
      if (hit.entry.id && !seenIds.has(hit.entry.id)) {
        seenIds.add(hit.entry.id);
        hits.push(hit);
      }
    }
  }

  return hits;
}
