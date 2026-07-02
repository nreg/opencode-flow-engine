/**
 * Multi-language tokenizer for spec-superflow keyword extraction.
 * Supports English (stemming + stop words) and Chinese (CJK sliding window).
 * Zero external dependencies.
 * Ported from spec-superflow/src/validation/tokenizer.ts
 */

// --- English stop words ---
const ENGLISH_STOP_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
  'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go',
  'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him',
  'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some',
  'could', 'them', 'see', 'other', 'than', 'then', 'now', 'look',
  'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after',
  'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even',
  'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
  'is', 'am', 'are', 'was', 'were', 'been', 'has', 'had', 'did', 'does',
  'based', 'using', 'used',
]);

// --- Chinese stop words ---
const CHINESE_STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人',
  '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去',
  '你', '会', '着', '没有', '看', '好', '自己', '这',
]);

// --- Chinese punctuation ---
const CHINESE_PUNCTUATION = /[，。！？；：、""''（）【】《》]/;

// --- CJK Unicode ranges ---
const CJK_REGEX = /[一-鿿㐀-䶿]+/g;
const CJK_CHAR_REGEX = /[一-鿿㐀-䶿]/g;

/**
 * Lightweight English stemmer.
 * Strips only the most common suffixes (-ing, -er, -ed, -s, -tion)
 * so that natural variations like "limiting" / "limiter" / "limit"
 * collapse to the same stem.
 */
function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= 3) return w;
  const suffixes: Array<[string, number]> = [
    ['ation', 3], ['tion', 3], ['ness', 3], ['ment', 3],
    ['ings', 3], ['ally', 3],
    ['ing', 3], ['ier', 3], ['ied', 3], ['ies', 3],
    ['ted', 3], ['ned', 3], ['red', 3], ['sed', 3], ['led', 3],
    ['ped', 3], ['ded', 3], ['ved', 3], ['wed', 3], ['xed', 3],
    ['zed', 3], ['ced', 3], ['ged', 3], ['ked', 3],
    ['ers', 3], ['ors', 3],
    ['ary', 3], ['ory', 3], ['ity', 3], ['ism', 3], ['ist', 3],
    ['ent', 3], ['ant', 3], ['ous', 3], ['ive', 3], ['ful', 3],
    ['ly', 3], ['ed', 3], ['er', 3], ['es', 3],
    ['al', 3], ['en', 3], ['ty', 3], ['or', 3], ['ar', 3],
    ['ry', 3], ['ic', 3], ['id', 3],
  ];
  for (const [suffix, minRoot] of suffixes) {
    if (w.endsWith(suffix) && w.length - suffix.length >= minRoot) {
      return w.slice(0, -suffix.length);
    }
  }
  if (w.endsWith('s') && w.length > 4) return w.slice(0, -1);
  return w;
}

/**
 * Tokenize English text: lowercase, split on non-alphanumeric,
 * remove stop words, apply stemming, filter short tokens.
 */
function tokenizeEnglish(text: string): Set<string> {
  const tokens = new Set<string>();
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 0);
  for (const word of words) {
    if (ENGLISH_STOP_WORDS.has(word)) continue;
    const stemmed = stem(word);
    if (stemmed.length < 3) continue;
    tokens.add(stemmed);
  }
  return tokens;
}

/**
 * Tokenize Chinese text: extract CJK sequences, produce sliding-window
 * tokens (2-char through 5-char), also extract ASCII words with English stemming.
 */
function tokenizeChinese(text: string): Set<string> {
  const tokens = new Set<string>();
  const segments = text.split(CHINESE_PUNCTUATION);

  for (const segment of segments) {
    const cjkRuns = segment.match(CJK_REGEX);
    if (cjkRuns) {
      for (const run of cjkRuns) {
        if (run.length < 2) continue;
        if (!CHINESE_STOP_WORDS.has(run)) {
          tokens.add(run);
        }
        const maxWindow = Math.min(run.length, 5);
        for (let windowSize = 2; windowSize <= maxWindow; windowSize++) {
          for (let i = 0; i <= run.length - windowSize; i++) {
            const ngram = run.slice(i, i + windowSize);
            if (!CHINESE_STOP_WORDS.has(ngram)) {
              tokens.add(ngram);
            }
          }
        }
      }
    }

    const asciiWords = segment.match(/[a-zA-Z0-9]+/g);
    if (asciiWords) {
      for (const word of asciiWords) {
        const lower = word.toLowerCase();
        if (ENGLISH_STOP_WORDS.has(lower)) continue;
        const stemmed = stem(lower);
        if (stemmed.length < 3) continue;
        tokens.add(stemmed);
      }
    }
  }

  return tokens;
}

/**
 * Auto-detect the language of the given text.
 * Returns 'en', 'zh', or 'mixed'.
 */
export function detectLanguage(text: string): 'en' | 'zh' | 'mixed' {
  const cjkMatches = text.match(CJK_CHAR_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const totalChars = text.replace(/\s/g, '').length;
  const cjkRatio = totalChars > 0 ? cjkCount / totalChars : 0;

  const hasAsciiWords = /[a-zA-Z]{2,}/.test(text);

  if (cjkRatio > 0.3 && hasAsciiWords) return 'mixed';
  if (cjkRatio > 0.3) return 'zh';
  return 'en';
}

/**
 * Main tokenizer entry point.
 * @param text - The text to tokenize.
 * @param language - 'auto' | 'en' | 'zh'. Defaults to 'auto'.
 * @returns Set of token strings.
 */
export function tokenize(text: string, language?: 'auto' | 'en' | 'zh'): Set<string> {
  const lang = language ?? 'auto';

  if (lang === 'en') return tokenizeEnglish(text);
  if (lang === 'zh') return tokenizeChinese(text);

  const detected = detectLanguage(text);
  if (detected === 'en') return tokenizeEnglish(text);
  if (detected === 'zh') return tokenizeChinese(text);

  const enTokens = tokenizeEnglish(text);
  const zhTokens = tokenizeChinese(text);
  return new Set([...enTokens, ...zhTokens]);
}
