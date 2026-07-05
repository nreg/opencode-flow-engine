/**
 * Chinese text segmentation using nodejieba
 * Provides intelligent word segmentation for better keyword extraction
 */

import * as nodejieba from 'nodejieba';

/**
 * Chinese stop words - common words that should be filtered out
 */
const CHINESE_STOP_WORDS = new Set([
  // 结构词
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这',
  // 逻辑词
  '因为', '所以', '但是', '如果', '虽然', '而且', '或者', '以及', '不是', '而是', '还是', '比如', '例如', '如', '等', '等等',
  // 程度词
  '非常', '特别', '更加', '最', '更', '太', '有点', '稍微', '比较', '相当',
  // 时间词
  '现在', '当时', '之后', '之前', '以后', '以前', '这时', '那时', '此时', '同时',
  // 方位词
  '里面', '外面', '上面', '下面', '前面', '后面', '左边', '右边', '中间', '这里', '那里',
  // 代词
  '什么', '怎么', '怎样', '哪里', '哪个', '哪些', '多少', '几', '谁', '哪个',
  // 助词
  '之', '得', '地', '着', '过', '吗', '呢', '吧', '啊', '呀', '哦',
  // 介词
  '从', '向', '往', '对', '对于', '关于', '通过', '经过', '沿着', '按照',
  // 连词
  '跟', '同', '与', '及', '并且', '不仅', '不但', '既然', '即使', '哪怕',
  // 其他常见无意义词
  '方案', '做法', '尝试', '问题', '解决', '使用', '通过', '可以', '需要', '进行', '应该', '必须', '可能', '能够', '无法', '一下', '一些', '一种', '一样',
]);

/**
 * English stop words - already defined in state-manager.ts but duplicated here for completeness
 */
const ENGLISH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'using',
  'this', 'that', 'it', 'its', 'we', 'they', 'use', 'used', 'do', 'does', 'did',
  'not', 'no', 'but', 'or', 'and', 'if', 'then', 'else', 'so', 'can', 'will', 'would',
]);

/**
 * Segment Chinese text into words using jieba.
 * Returns an array of meaningful words (stop words filtered).
 */
export function segmentChinese(text: string): string[] {
  // Use jieba cut mode (precise segmentation)
  const segments = nodejieba.cut(text);
  
  // Filter out stop words and short tokens
  return segments.filter(word => {
    const trimmed = word.trim();
    // Skip empty
    if (!trimmed) return false;
    // Skip single characters (usually not meaningful keywords)
    if (trimmed.length < 2) return false;
    // Skip Chinese stop words
    if (CHINESE_STOP_WORDS.has(trimmed)) return false;
    // Skip English stop words
    if (ENGLISH_STOP_WORDS.has(trimmed.toLowerCase())) return false;
    // Skip pure numbers
    if (/^\d+$/.test(trimmed)) return false;
    // Skip pure punctuation
    if (/^[^\u4e00-\u9fff\w]+$/.test(trimmed)) return false;
    return true;
  });
}

/**
 * Extract keywords from mixed Chinese-English text.
 * Combines jieba segmentation for Chinese and whitespace tokenization for English.
 */
export function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  
  // Extract Chinese segments
  const chineseParts = text.match(/[\u4e00-\u9fff]+/g) || [];
  for (const part of chineseParts) {
    keywords.push(...segmentChinese(part));
  }
  
  // Extract English tokens
  const englishParts = text.replace(/[\u4e00-\u9fff]+/g, ' ').split(/\s+/);
  for (const token of englishParts) {
    const trimmed = token.trim();
    // Skip short tokens and stop words
    if (trimmed.length >= 3 && !ENGLISH_STOP_WORDS.has(trimmed.toLowerCase())) {
      keywords.push(trimmed.toLowerCase());
    }
  }
  
  // Deduplicate
  return [...new Set(keywords)];
}

/**
 * Calculate keyword overlap ratio between two keyword sets.
 * Returns a value between 0 and 1.
 */
export function calculateOverlapRatio(keywords1: string[], keywords2: string[]): number {
  if (keywords1.length === 0 || keywords2.length === 0) return 0;
  
  const set1 = new Set(keywords1.map(k => k.toLowerCase()));
  const set2 = new Set(keywords2.map(k => k.toLowerCase()));
  
  let intersection = 0;
  for (const k of set1) {
    if (set2.has(k)) intersection++;
  }
  
  // Use Jaccard similarity: |A ∩ B| / |A ∪ B|
  const union = set1.size + set2.size - intersection;
  return intersection / union;
}

/**
 * Dynamic threshold calculation based on keyword count.
 * More keywords = lower threshold (more lenient)
 * Fewer keywords = higher threshold (more strict)
 */
export function calculateDynamicThreshold(keywordCount: number, baseThreshold: number = 0.5): number {
  if (keywordCount <= 2) {
    // Very few keywords: be strict
    return Math.min(baseThreshold + 0.2, 0.9);
  } else if (keywordCount <= 5) {
    // Moderate keywords: use base threshold
    return baseThreshold;
  } else if (keywordCount <= 10) {
    // Many keywords: be slightly lenient
    return Math.max(baseThreshold - 0.1, 0.3);
  } else {
    // Very many keywords: be more lenient
    return Math.max(baseThreshold - 0.2, 0.25);
  }
}
