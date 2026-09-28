/**
 * CompletionDetector — P3: Completion Enforcement & System Reminder
 *
 * Provides completion signal detection for subagent output and
 * retry configuration for the completion enforcement mechanism.
 *
 * Detection strategies (by agent type):
 * 1. STRICT agents (spec-writer, contract-builder):
 *    - [TASK_COMPLETE] marker (case-insensitive) → true
 *    - JSON code fence (```json ... ```) → true
 *    - Bare JSON object ({...}) → true
 *    - Empty / null output → false
 *
 * 2. LOOSE agents (build-executor, code-reviewer, test-engineer, etc.):
 *    - Output contains report keywords (Summary, 完成, Test Results, Batch Status, Files) → true
 *    - Output length >= 200 characters → true
 *    - Empty / very short output → false
 *
 * 3. Other agents: No retry (automatically exempt)
 *
 * Reuses extractJsonBlock from P2 for JSON-related detection.
 */

import { extractJsonBlock } from './output-extractor.js';

// ─── Types ──────────────────────────────────────────────────────────────────

/** System reminder message format for injection into session */
export interface ReminderMessage {
  type: 'system';
  parts: Array<{
    type: 'text';
    text: string;
  }>;
}

/** Completion enforcement configuration */
export interface CompletionEnforcementConfig {
  /** Maximum number of retries after initial attempt */
  maxRetries: number;
  /** Delay in ms before each retry attempt (indexed by retry number) */
  retryDelays: number[];
  /** Warning message when max retries are exhausted */
  warningMessage: string;
  /** Agent types that SHOULD have completion enforcement (opt-in).
   *  Only agents that output [TASK_COMPLETE] (case-insensitive) should be listed here.
   *  All other agents are automatically exempt. */
  enabledAgents?: string[];
}

/** STRICT completion agents — require [TASK_COMPLETE] marker (case-insensitive) or JSON output.
 *  These agents output structured completion signals and must be strictly enforced.
 */
export const STRICT_COMPLETION_AGENTS: string[] = [
  'spec-writer',
  'contract-builder',
];

/** LOOSE completion agents — use substantial output detection.
 *  These agents output human-readable reports and should use loose completion detection:
 *  - Output non-empty and contains report keywords (Summary, 完成, Test Results, etc.)
 *  - OR output length >= 200 characters (substantial content)
 *  - Only retry when output is empty/very short/obviously truncated
 */
export const LOOSE_COMPLETION_AGENTS: string[] = [
  'build-executor',
  'code-reviewer',
  'test-engineer',
  'bug-investigator',
  'release-archivist',
  'spec-merger',
  'ui-implementer',
  // iFlow subagents
  'iflow-discuss-planner',
  'iflow-researcher',
  'iflow-plan-executor',
  'iflow-verifier',
  'iflow-shipper',
];

/** Combined list of all agents with completion enforcement enabled.
 *  STRICT agents use hasCompletionSignal ([TASK_COMPLETE] case-insensitive or JSON).
 *  LOOSE agents use hasSubstantialOutput (report keywords or substantial length).
 *  All other agents are automatically exempt.
 */
export const DEFAULT_COMPLETION_ENABLED_AGENTS: string[] = [
  ...STRICT_COMPLETION_AGENTS,
  ...LOOSE_COMPLETION_AGENTS,
];

// ─── Model Failure Classification（P0-1/P0-2/P0-4 模型故障识别）──────────────

/**
 * Model error patterns — output matching any of these is NOT a success signal.
 * Reused by hasSubstantialOutput (error suppression) and runWithModelFallback (success validation).
 *
 * NEW-P1-C: 仅匹配「行首错误声明」（以 error:/failed:/fail: 等开头），
 * 长报告中的堆栈、测试失败输出（任务层错误）不应等同模型调用失败——
 * 由 matchesModelErrorPatterns 的首行 + 长度守卫约束。
 */
export const MODEL_ERROR_PATTERNS: RegExp[] = [
  /^error:/i,
  /^failed:/i,
  /^Error:/i,
  /^FAIL:/i,
  /^fatal:/i,
  /^exception:/i,
  /"error"\s*:\s*"/i,
];

/** NEW-P1-C: 明确的「无错误」声明不算错误（如 "Error: none found. All checks passed."） */
const MODEL_ERROR_NEGATION_PATTERN =
  /(none found|all (checks? )?(passed|pass|ok)|0 (errors?|failures?)|no errors?)/i;

/** NEW-P1-C: 长度守卫——完整报告/审查文档（天然含 Error: 与堆栈）不是传输层错误 */
const MODEL_ERROR_MAX_TEXT_LENGTH = 500;

/**
 * Quota / rate-limit error patterns（P0-2 长冷却配额识别）。
 * NEW-P1-C: 弱 token（429 / quota / rate limit / 限流）必须伴随错误语境词
 * （exceeded / 超出 / 错误 / 失败等）才算配额错误，避免领域文本误判。
 */
export const QUOTA_ERROR_PATTERNS: RegExp[] = [
  /超出频率限制/,
  /使用量.*超出/,
  /usage.*exceed/i,
  /\b429\b/,
  /rate.?limit/i,
  /RATE_LIMITED/,
  /quota/i,
  /频率限制/,
  /限流/,
];

/** NEW-P1-C: 弱配额 token 的错误语境词（必须与 token 同现）；补英文 used up/reset（真实事故样例语境） */
const QUOTA_CONTEXT_PATTERN = /(exceed|exhaust|used up|reset|too many|error|fail|http|超出|超|错误|失败|耗尽|稍后再试|重置)/i;

/** NEW-P1-C: 长度守卫——报告/审查文档不是配额错误 */
const QUOTA_MAX_TEXT_LENGTH = 500;

/**
 * Check whether output matches model error patterns (P0-1: 错误文本不算成功).
 *
 * NEW-P1-C 收紧：
 * - 仅当文本较短（≤ 500 字符）时才判模型错误——长报告/审查文档是任务层产出；
 * - 仅当首行命中行首错误声明时才算——正文中的 "Error:" 与堆栈不算；
 * - 首行命中「无错误」声明（none found / all passed）时不算。
 */
export function matchesModelErrorPatterns(output: string): boolean {
  if (!output) return false;
  const trimmed = output.trim();
  if (trimmed.length > MODEL_ERROR_MAX_TEXT_LENGTH) return false;
  const firstLine = trimmed.split('\n')[0] ?? '';
  if (MODEL_ERROR_NEGATION_PATTERN.test(firstLine)) return false;
  return MODEL_ERROR_PATTERNS.some((pattern) => pattern.test(firstLine));
}

/**
 * Check whether output matches quota / rate-limit patterns (P0-2).
 *
 * NEW-P1-C 收紧：
 * - 长文本（> 500 字符）不判配额错误；
 * - 弱 token（429 / quota / rate limit / 限流）必须伴随错误语境词才算；
 * - 强 token（超出频率限制 / 使用量.*超出 / usage.*exceed）单独命中即可。
 */
export function matchesQuotaErrorPattern(output: string): boolean {
  if (!output) return false;
  if (output.length > QUOTA_MAX_TEXT_LENGTH) return false;
  const strong = QUOTA_ERROR_PATTERNS.slice(0, 3);
  if (strong.some((pattern) => pattern.test(output))) return true;
  const weak = QUOTA_ERROR_PATTERNS.slice(3);
  return weak.some((token) => token.test(output) && QUOTA_CONTEXT_PATTERN.test(output));
}

/**
 * Parse the quota reset time from an error message.
 *
 * Supported formats:
 * - 「您的使用量已超出频率限制，将在 2026-09-27 12:21:07 UTC+8 重置」
 * - "rate limit exceeded, resets at 2026-09-27T04:21:07Z"
 * - "resets at 2026-09-27 04:21:07"
 * - ISO offset: "resets at 2026-09-27T04:21:07+08:00"
 * - GMT offset: "resets at 2026-09-27 12:21:07 GMT+8"
 * - R3-P1 裸 UTC/GMT（无偏移）: "将在 2026-09-27 12:21:07 UTC 重置"（按 UTC+0 解释）
 *
 * NEW-P3-G: 优先匹配 reset/重置 关键词邻近的时间戳（多日期文本取对时间）；
 * 支持 UTC+n / UTC+HH:MM / GMT±n / ISO ±HH:MM 偏移。
 * 语义明确：无时区标记的时间戳按本地时间解释（不是 UTC）。
 *
 * @returns epoch milliseconds of the reset time, or null when no absolute time found
 */
export function parseQuotaResetTime(output: string): number | null {
  if (!output) return null;
  const datePattern =
    /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|UTC([+-]\d{1,2}(?::?\d{2})?)?|GMT([+-]\d{1,2}(?::?\d{2})?)?|([+-]\d{2}:?\d{2}))?/i;
  // NP-1: 偏移量按「小时 + 分钟/60」解析为有限数值（Number 语义），
  // 杜绝 Number("+08:00") → NaN、Number("+0800") → 800 的静默错值。
  const parseOffset = (raw: string): number => {
    const m = raw.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!m) return 0;
    const sign = m[1] === '-' ? -1 : 1;
    const hours = Number(m[2]);
    const minutes = m[3] ? Number(m[3]) : 0;
    const offset = sign * (hours + minutes / 60);
    return Number.isFinite(offset) ? offset : 0;
  };
  const parseMatch = (match: RegExpMatchArray): number | null => {
    const [, y, mo, d, h, mi, s, zulu, utcOffsetH, gmtOffsetH, isoOffset] = match;
    const year = Number(y);
    const month = Number(mo) - 1;
    const day = Number(d);
    const hour = Number(h);
    const minute = Number(mi);
    const second = s ? Number(s) : 0;
    if (zulu === 'Z') {
      return Date.UTC(year, month, day, hour, minute, second);
    }
    // R3-P1: 裸 UTC / GMT（无偏移后缀）按 UTC+0 解释，不落本地时区
    // （如「将在 2026-09-27 12:21:07 UTC 重置」——此前误按本地时区解释，TZ≠UTC 时解析出错）
    if (utcOffsetH !== undefined) {
      const offset = parseOffset(utcOffsetH);
      // NP-1: 偏移以毫秒施加（Bun 的 Date.UTC 会截断小时参数的小数部分，丢分钟偏移）
      return Date.UTC(year, month, day, hour, minute, second) - Math.round(offset * 3_600_000);
    }
    if (gmtOffsetH !== undefined) {
      const offset = parseOffset(gmtOffsetH);
      return Date.UTC(year, month, day, hour, minute, second) - Math.round(offset * 3_600_000);
    }
    if (/^(UTC|GMT)$/i.test(zulu ?? '')) {
      return Date.UTC(year, month, day, hour, minute, second);
    }
    if (isoOffset !== undefined) {
      const offset = parseOffset(isoOffset);
      return Date.UTC(year, month, day, hour, minute, second) - Math.round(offset * 3_600_000);
    }
    // No timezone: assume local time
    return new Date(year, month, day, hour, minute, second).getTime();
  };

  // NEW-P3-G: 优先取 reset/重置 关键词邻近的时间戳
  const resetAnchor = /(reset|重置)/i;
  const segments = output.split(/(?=reset|重置)/i);
  for (const segment of segments) {
    const isResetSegment = resetAnchor.test(segment);
    const match = segment.match(datePattern);
    if (match) {
      if (isResetSegment || segments.length === 1) {
        const parsed = parseMatch(match);
        // NP-1: 非有限值不得进入 resetAt（NaN 会令 Math.max/比较失效，导致模型永久拉黑）
        return parsed !== null && Number.isFinite(parsed) ? parsed : null;
      }
      // 非重置段的时间戳仅在无重置段匹配时作为兜底
    }
  }
  // 兜底：全文首个时间戳
  const fallbackMatch = output.match(datePattern);
  const fallback = fallbackMatch ? parseMatch(fallbackMatch) : null;
  return fallback !== null && Number.isFinite(fallback) ? fallback : null;
}

/** Quota error classification result (P0-2) */
export interface QuotaErrorInfo {
  kind: 'quota';
  /** Parsed reset time (epoch ms), or null when not parseable */
  resetAt: number | null;
  /** Matched error detail for logging */
  detail: string;
}

/**
 * Classify quota / rate-limit errors (P0-2).
 *
 * Returns QuotaErrorInfo when the text matches quota patterns (429 / rate limit /
 * quota / 频率限制 etc.), with the reset time parsed when present.
 * Returns null for non-quota text.
 */
export function classifyQuotaError(output: string): QuotaErrorInfo | null {
  if (!matchesQuotaErrorPattern(output)) return null;
  return {
    kind: 'quota',
    resetAt: parseQuotaResetTime(output),
    detail: output.slice(0, 200),
  };
}

// ─── Error-code Driven Model Error Classification（错误码驱动分类，主判据）──────

/**
 * 错误码驱动分类结果三档：
 * - 'non-transient'：非瞬态（402/403/401/404 或配额语义文本）→ 立即换模 + 拉黑
 * - 'transient'：瞬态（429/408/409/5xx）→ 立即换模 + 5min 短拉黑
 * - 'none'：非错误 → 返回 null，继续既有逻辑（文本模式 classifyQuotaError /
 *   matchesModelErrorPatterns 降级为二级判据兜底）
 */
export type ModelErrorCodeClass = 'non-transient' | 'transient' | 'none';

export interface ModelErrorCodeInfo {
  kind: ModelErrorCodeClass;
  /** 识别出的 HTTP 状态码（文本嵌入形态或入参 status） */
  status?: number;
  /** 配额重置时间（epoch ms），仅 non-transient 且文本可解析时非空 */
  resetAt: number | null;
}

/** 嵌入状态码形态：`"code":"402"` / `"code":402`（JSON 错误体内嵌，参照真实事故样例） */
const EMBEDDED_CODE_PATTERN = /"code"\s*:\s*"?(401|402|403|404|408|409|429|5\d\d)"?/i;
/** HTTP 前缀形态：`HTTP 402` */
const HTTP_CODE_PATTERN = /\bHTTP\s*\/?[\d.]*\s*(401|402|403|404|408|409|429|5\d\d)\b/i;
/** 括号形态：`(code: 500)` */
const PAREN_CODE_PATTERN = /\(code:\s*(401|402|403|404|408|409|429|5\d\d)\)/i;
/** status 字段形态：`status: 429` / `"status":"503"` */
const STATUS_FIELD_PATTERN = /\bstatus\s*[:=]\s*"?(401|402|403|404|408|409|429|5\d\d)"?/i;
/** 错误 type 字段（无 code 时）：ModelServiceRateLimit / *Quota* 等 → 按非瞬态 403 处理 */
const ERROR_TYPE_PATTERN = /"type"\s*:\s*"[^"]*(RateLimit|Quota|PaymentRequired)[^"]*"/i;
/** 配额语义文本（无状态码时）：used up your quota / exceeded your quota 等（真实事故样例形态） */
const QUOTA_SEMANTIC_PATTERN =
  /((used up|exceeded|exhaust(ed)?)\s+(your\s+)?(free\s+)?quota)|((your\s+)?(free\s+)?quota[^.]{0,60}(used up|exceeded|exhaust(ed)?|is over|has been reached))/i;

/** 配额语义文本长度守卫（与既有文本模式一致）：长报告/审查文档不是传输层错误 */
const QUOTA_SEMANTIC_MAX_TEXT_LENGTH = 500;

/**
 * 错误码驱动的模型错误分类（主判据）。
 *
 * 依据 provider-scaffold 提供商错误码规范：
 * - 瞬态错误（408/409/429/5xx）：isRetryable=true，OpenCode 指数重试（约 3 次）；
 *   重试耗尽仍失败 → 触发 fallback（5min 短拉黑）
 * - 非瞬态错误（配额耗尽/参数/账号级持久错误）：提供商统一归一化为 402
 *   （401/403 保留原状态码）→ isRetryable=false → 立即 fallback（重试无意义，
 *   长冷却拉黑：可解析出重置时间则冷却至重置，否则短 TTL 30min）
 * - 404（model not found）虽属请求形态错误，但同样是模型级错误 → 换模拉黑更合理
 * - 400（SessionBusy 等请求级错误）不分类，交由上层 fatal 分支处理
 *
 * 状态码提取顺序：嵌入 code 字段 → HTTP 前缀 → (code: N) → status 字段 →
 * 错误 type 字段（无 code）→ 入参 status（message 无码时兜底）。
 * 全部未命中时做配额语义文本判断（长度守卫内），均未命中返回 null（none）。
 */
export function classifyModelErrorByCode(text: string, status?: number): ModelErrorCodeInfo | null {
  const raw = text ?? '';
  let code: number | undefined;

  const codeMatch = raw.match(EMBEDDED_CODE_PATTERN);
  const httpMatch = !codeMatch ? raw.match(HTTP_CODE_PATTERN) : null;
  const parenMatch = !codeMatch && !httpMatch ? raw.match(PAREN_CODE_PATTERN) : null;
  const statusMatch =
    !codeMatch && !httpMatch && !parenMatch ? raw.match(STATUS_FIELD_PATTERN) : null;
  const typeMatch = raw.match(ERROR_TYPE_PATTERN);

  if (codeMatch) {
    code = Number(codeMatch[1]);
  } else if (httpMatch) {
    code = Number(httpMatch[1]);
  } else if (parenMatch) {
    code = Number(parenMatch[1]);
  } else if (statusMatch) {
    code = Number(statusMatch[1]);
  } else if (typeMatch) {
    code = 403; // ModelServiceRateLimit / *Quota* type → 非瞬态
  }
  if (code === undefined && status !== undefined) {
    code = status;
  }

  if (code !== undefined) {
    if (code === 401 || code === 402 || code === 403 || code === 404) {
      return { kind: 'non-transient', status: code, resetAt: parseQuotaResetTime(raw) };
    }
    if (code === 429 || code === 408 || code === 409 || (code >= 500 && code < 600)) {
      return { kind: 'transient', status: code, resetAt: null };
    }
    // 400 等请求级错误 → none
    return null;
  }

  // 无状态码：配额语义文本判断（长度守卫内）
  if (raw.length <= QUOTA_SEMANTIC_MAX_TEXT_LENGTH && QUOTA_SEMANTIC_PATTERN.test(raw)) {
    return { kind: 'non-transient', resetAt: parseQuotaResetTime(raw) };
  }
  return null;
}

/** Result of the completion retry process */
export interface CompletionRetryResult {
  /** The final output text (may be from a retry attempt) */
  output: string;
  /** Warning message if max retries were exhausted without completion signal */
  warning?: string;
}

/** Function type for injecting a reminder into the session */
export type InjectReminderFn = () => Promise<void>;

/** Function type for polling subagent output */
export type PollOutputFn = () => Promise<string | null>;

// ─── Constants ──────────────────────────────────────────────────────────────

/** Completion enforcement configuration */
export const COMPLETION_ENFORCEMENT_CONFIG: CompletionEnforcementConfig = {
  maxRetries: 2,
  retryDelays: [1000, 2000], // 1s → 2s
  warningMessage: 'Subagent output may be incomplete - no completion signal detected after 3 attempts',
  enabledAgents: DEFAULT_COMPLETION_ENABLED_AGENTS,
};

/** System reminder message injected when subagent output lacks completion signal.
 *  Note: The reminder instructs subagents to include [TASK_COMPLETE] (canonical form),
 *  but detection is case-insensitive per hasCompletionSignal. */
export const REMINDER_MESSAGE: ReminderMessage = {
  type: 'system',
  parts: [{
    type: 'text',
    text: '你的任务尚未完成。请提供完整的任务结果，并在输出末尾包含 [TASK_COMPLETE] 标记。',
  }],
};

// ─── Detection Function ─────────────────────────────────────────────────────

/**
 * Check whether subagent output contains a completion signal.
 *
 * Completion signals include:
 * 1. [TASK_COMPLETE] marker (case-insensitive: [TASK_COMPLETE], [Task_Complete], [task_complete])
 * 2. JSON code fence (```json ... ```)
 * 3. Bare JSON object ({...})
 *
 * Empty or null output is treated as incomplete (returns false).
 * Bare markers without brackets (e.g. "TASK_COMPLETE") are NOT detected — brackets are required.
 *
 * @param output - The raw output text from the subagent
 * @returns true if a completion signal is detected, false otherwise
 */
export function hasCompletionSignal(output: string): boolean {
  // Empty / null check
  if (!output || typeof output !== 'string' || output.trim().length === 0) {
    return false;
  }

  // 1. Detect [TASK_COMPLETE] marker (case-insensitive: [TASK_COMPLETE], [Task_Complete], [task_complete])
  if (/\[task_complete\]/i.test(output)) {
    return true;
  }

  // 2 & 3. Detect JSON code fence or bare JSON object
  // Reuse extractJsonBlock from P2 — if it can extract valid JSON, that's a completion signal
  if (extractJsonBlock(output) !== null) {
    return true;
  }

  return false;
}

/**
 * Check whether subagent output is substantial (loose completion detection).
 *
 * Used for execution-type agents that output human-readable reports.
 * Returns true if output:
 * 1. Is non-empty and contains report keywords (Summary, 完成, Test Results, Batch Status, Files)
 * 2. OR has substantial length (>= 200 characters)
 *
 * Returns false for empty, whitespace-only, or very short outputs.
 * Also returns false if output contains explicit error patterns (error:, failed:, ❌, FAIL, Error:).
 *
 * @param output - The raw output text from the subagent
 * @returns true if output is substantial, false otherwise
 */
export function hasSubstantialOutput(output: string): boolean {
  // Empty / null check
  if (!output || typeof output !== 'string' || output.trim().length === 0) {
    return false;
  }

  const trimmed = output.trim();

  const errorPatterns = [
    /^error:/im,
    /^failed:/im,
    /^❌/m,
    /^FAIL:/im,
    /^Error:/m,
    /"error"\s*:\s*"/i,
    /Error:\s.*\n\s+at /s,
  ];

  const hasErrorPattern = errorPatterns.some(pattern => pattern.test(trimmed));
  if (hasErrorPattern) {
    return false;
  }

  // Check for report keywords (case-insensitive)
  const reportKeywords = [
    'Summary',
    '完成',
    'Test Results',
    'Batch Status',
    'Files',
  ];

  const hasKeywords = reportKeywords.some(keyword => 
    trimmed.toLowerCase().includes(keyword.toLowerCase())
  );

  if (hasKeywords) {
    return true;
  }

  // Check for substantial length (>= 200 characters)
  const SUBSTANTIAL_LENGTH_THRESHOLD = 200;
  if (trimmed.length >= SUBSTANTIAL_LENGTH_THRESHOLD) {
    return true;
  }

  return false;
}

// ─── Retry Logic ────────────────────────────────────────────────────────────

/**
 * Perform completion enforcement retry logic.
 *
 * Detection strategy by agent type:
 * - STRICT agents (spec-writer, contract-builder): Use hasCompletionSignal ([TASK_COMPLETE] case-insensitive or JSON)
 * - LOOSE agents (build-executor, etc.): Use hasSubstantialOutput (report keywords or substantial length)
 * - Other agents: No retry (automatically exempt)
 *
 * If the initial output passes the detection check, returns immediately.
 * Otherwise, injects a system reminder and re-polls up to maxRetries times
 * with increasing backoff delays.
 *
 * This is a pure logic function that takes dependency-injected functions
 * for reminder injection and output polling, making it fully testable
 * without real session/client dependencies.
 *
 * @param initialOutput - The initial output from the subagent
 * @param injectReminder - Function to inject a system reminder into the session
 * @param pollOutput - Function to poll for the subagent's latest output
 * @param config - Optional override for completion enforcement config (for testing)
 * @param agentType - Optional agent type; determines detection strategy
 * @returns CompletionRetryResult with final output and optional warning
 */
export async function performCompletionRetry(
  initialOutput: string,
  injectReminder: InjectReminderFn,
  pollOutput: PollOutputFn,
  config: CompletionEnforcementConfig = COMPLETION_ENFORCEMENT_CONFIG,
  agentType?: string,
): Promise<CompletionRetryResult> {
  let currentOutput = initialOutput;

  // Determine detection strategy based on agent type
  const isStrictAgent = agentType && STRICT_COMPLETION_AGENTS.includes(agentType);
  const isLooseAgent = agentType && LOOSE_COMPLETION_AGENTS.includes(agentType);

  // If agent is not in any completion group, skip retry
  if (!isStrictAgent && !isLooseAgent) {
    return { output: currentOutput };
  }

  // Check initial output with appropriate detection strategy
  // For LOOSE agents: check hasCompletionSignal first (higher priority), then hasSubstantialOutput
  const hasCompletion = isStrictAgent 
    ? hasCompletionSignal(currentOutput)
    : (hasCompletionSignal(currentOutput) || hasSubstantialOutput(currentOutput));

  if (hasCompletion) {
    return { output: currentOutput };
  }

  // Retry loop
  for (let retry = 0; retry < config.maxRetries; retry++) {
    // Inject system reminder
    try {
      await injectReminder();
    } catch {
      // reminder injection failure should not block retry
    }

    // Wait for backoff delay
    const delay = config.retryDelays[retry] ?? 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Re-poll for output
    const newOutput = await pollOutput();
    if (newOutput && typeof newOutput === 'string') {
      currentOutput = newOutput;
    }

    // Check if completion signal appeared (use appropriate detection strategy)
    // For LOOSE agents: check hasCompletionSignal first, then hasSubstantialOutput
    const hasCompletionNow = isStrictAgent
      ? hasCompletionSignal(currentOutput)
      : (hasCompletionSignal(currentOutput) || hasSubstantialOutput(currentOutput));

    if (hasCompletionNow) {
      return { output: currentOutput };
    }
  }

  // Max retries exhausted — return with warning
  return {
    output: currentOutput,
    warning: config.warningMessage,
  };
}
