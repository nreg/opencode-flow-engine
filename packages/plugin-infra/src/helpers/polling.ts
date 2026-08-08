/**
 * Shared session polling utilities for sFlow subagent communication.
 */
import { sleep } from '@opencode-flow-engine/shared';
import { PROBE_PENDING, type ProbePending } from '../types.js';

/** Default max wait time for async/background polling (120s) */
export const DEFAULT_MAX_WAIT_MS = 120_000;

/** Default max wait time for sync polling (30s) */
export const DEFAULT_SYNC_MAX_WAIT_MS = 30_000;

export interface SFlowClientSession {
  status(): Promise<{ data: unknown }>;
  messages(args: { path: { id: string } }): Promise<{ data: unknown }>;
}

/**
 * Polls a subagent session until the subagent responds.
 *
 * Behavior contract:
 * - Default maxWaitMs: 30min (subagent tasks can take minutes to complete).
 * - Returns immediately when the session status is "idle".
 * - Returns immediately when message count exceeds the initial count
 *   (distinguishes the user's prompt from the assistant's response).
 * - For isNew sessions: initial count is 1 (the prompt just sent),
 *   so returns when count >= 2 (at least 1 assistant response).
 * - status() failures fall back to messages(); repeated dual-failure triggers
 *   session-disappearance handling via readSessionLastMessage.
 * - isNew sessions have a max-polls safety cap (60) to avoid infinite loop
 *   when status never flips to idle.
 * - Probe mode (probeMode: true): only checks status, returns PROBE_PENDING if busy/retry,
 *   returns last message if idle, returns null if retry error.
 */
export async function pollSessionCompletion(
  client: { session: SFlowClientSession },
  sessionID: string,
  options: { maxWaitMs?: number; pollIntervalMs?: number; isNew?: boolean; probeMode?: boolean } = {},
): Promise<string | null | ProbePending> {
  const MAX_WAIT = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const POLL_INTERVAL = options.pollIntervalMs ?? 200; // 200ms default (was 500ms, reduced for faster detection)
  const RETRY_WAIT_BUFFER = 2000; // Task 1.5: 2s buffer accounts for clock skew and polling delay when checking retry next field expiration
  const startTime = Date.now();
  let consecutiveFailures = 0;
  const isNew = options.isNew ?? false;
  const probeMode = options.probeMode ?? false;
  const MAX_POLLS_FOR_NEW = 120; // 120 * 200ms = 24s max for new sessions

  // F1: Entry log
  console.log(`[Polling] session=${sessionID} start polling (maxWaitMs=${MAX_WAIT}, isNew=${isNew}, probeMode=${probeMode})`);

  // F1: Exit log helper
  function logExit(reason: string, result: string | null | ProbePending): string | null | ProbePending {
    const elapsed = Date.now() - startTime;
    console.log(`[Polling] session=${sessionID} completed reason=${reason} elapsed=${elapsed}ms`);
    return result;
  }

  // Capture the initial message count so we can distinguish
  // the user's prompt from the subagent's response.
  let initialMsgCount = 0;
  try {
    const mr = await client.session.messages({ path: { id: sessionID } });
    const msgs = mr.data as Array<unknown> | undefined;
    initialMsgCount = Array.isArray(msgs) ? msgs.length : 0;
  } catch {
    /* ignore */
  }
  // For isNew sessions, the prompt was just sent, so initialMsgCount = 1.
  // We need at least 1 assistant response 鈫?require count >= 2.
  const minDetectCount = isNew ? Math.max(initialMsgCount + 1, 2) : initialMsgCount + 1;

  let lastMessage: string | null = null;
  let pollCount = 0;

  while (Date.now() - startTime < MAX_WAIT) {
    await sleep(POLL_INTERVAL);
    pollCount++;

    // ⸺⸺ Status check: session idle/retry → handle accordingly ⸺⸺
    let isIdle = false;
    let isRetryError = false;
    let statusFailed = false;
    try {
      const statusResult = await client.session.status();
      const rawData = statusResult.data;
      let statusEntry:
        | { id: string; type: string; attempt?: number; message?: string; next?: number }
        | undefined;

      if (Array.isArray(rawData)) {
        statusEntry = (
          rawData as Array<{
            id: string;
            type: string;
            attempt?: number;
            message?: string;
            next?: number;
          }>
        ).find((s) => s.id === sessionID);
      } else if (rawData && typeof rawData === 'object') {
        const obj = rawData as Record<
          string,
          { type: string; attempt?: number; message?: string; next?: number }
        >;
        statusEntry = obj[sessionID] ? { id: sessionID, ...obj[sessionID] } : undefined;
      }

      if (statusEntry) {
        isIdle = statusEntry.type === 'idle';

        if (statusEntry.type === 'retry') {
          // ─── Retry 状态机语义说明 ─────────────────────────────────────────────
          // attempt 语义：
          //   - 0 = 首次尝试（尚未重试）
          //   - 1-4 = 第 1-4 次重试
          //   - >= 5 = 第 5 次重试或以后，超过最大重试次数，判定为 error
          //
          // MAX_RETRY_ATTEMPTS = 5 含义：
          //   - 允许 attempt 0-4（首次 + 4 次重试，共 5 次尝试）
          //   - attempt >= 5 时判定为 error（第 5 次重试失败）
          //
          // next 语义：
          //   - 平台返回的下次重试时间戳（毫秒）
          //   - 当 next < now - RETRY_WAIT_BUFFER 时，判定为过期（平台承诺的重试时间已过）
          //   - 过期原因：平台调度失败、任务丢失、或时钟偏差过大
          //
          // RETRY_WAIT_BUFFER = 2000ms 用途：
          //   - 容忍时钟偏差（客户端与平台时钟不同步）
          //   - 容忍轮询延迟（轮询间隔 200ms，可能延迟 1-2 个周期）
          //   - 避免误判：next 刚过期 1-2 秒时，可能只是轮询延迟，不应立即判定为 error
          // ─────────────────────────────────────────────────────────────────────
          const attempt = statusEntry.attempt ?? 0;
          const next = statusEntry.next;
          const MAX_RETRY_ATTEMPTS = 5;

          const now = Date.now();
          const isNextExpired = next !== undefined && next < now - RETRY_WAIT_BUFFER;
          const isAttemptExceeded = attempt >= MAX_RETRY_ATTEMPTS;

          isRetryError = isAttemptExceeded || isNextExpired;
        }
      }
    } catch {
      statusFailed = true;
    }

    if (isIdle) {
      const result = await readSessionLastMessage(client, sessionID);
      return logExit('idle', result);
    }

    // Task 1.2: If retry is determined to be an error, return null
    if (isRetryError) {
      return logExit('retry_error', null);
    }

    // F2: Probe mode - if not idle and not retry error, return pending marker
    if (probeMode) {
      return logExit('probe_pending', PROBE_PENDING);
    }

    // ⸺⸺ Messages check: return immediately when assistant responds ⸺⸺
    let messagesFailed = false;
    let currentMsgCount = 0;
    try {
      const mr = await client.session.messages({ path: { id: sessionID } });
      const msgs = mr.data as
        | Array<{
            parts: Array<{
              type: string;
              text?: string;
              error?: { message: string; code: number };
              time?: number;
            }>;
          }>
        | undefined;
      if (Array.isArray(msgs)) {
        currentMsgCount = msgs.length;
        // Task 1.3: Parse messages including retry parts
        // P0-1: Extract error information from retry parts
        // Process messages in reverse order to get the latest content first
        for (let i = msgs.length - 1; i >= 0; i--) {
          const msg = msgs[i];
          if (!msg) continue;
          if (msg.parts) {
            let hasTextPart = false;
            let retryError: string | null = null;
            
            // Check parts in this message
            for (const part of msg.parts) {
              if (part.type === 'text' && part.text) {
                lastMessage = part.text;
                hasTextPart = true;
                break; // Found text, use it
              } else if (part.type === 'retry' && part.error) {
                const { message, code } = part.error;
                retryError = `Error: ${message} (code: ${code})`;
              }
            }
            
            // If this message has no text but has retry error, use it
            if (!hasTextPart && retryError) {
              lastMessage = retryError;
              break; // Found error in latest message, use it
            }
            
            // If we found text in this message, stop searching
            if (hasTextPart) {
              break;
            }
          }
        }
        if (currentMsgCount >= minDetectCount) {
          return logExit('messages', lastMessage);
        }
      }
    } catch {
      messagesFailed = true;
    }

    // ⸺⸺ Session disappearance: both status and messages failed ⸺⸺
    if (statusFailed && messagesFailed) {
      consecutiveFailures++;
      if (consecutiveFailures >= 2) {
        const result = await readSessionLastMessage(client, sessionID);
        return logExit('failure', result);
      }
    } else {
      consecutiveFailures = 0;
    }

    // ⸺⸺ isNew safety cap: avoid infinite loop when status never flips to idle ⸺⸺
    if (isNew && pollCount >= MAX_POLLS_FOR_NEW) {
      const result = await readSessionLastMessage(client, sessionID);
      return logExit('max_polls', result);
    }
  }

  const result = await readSessionLastMessage(client, sessionID);
  return logExit('timeout', result);
}

export async function readSessionLastMessage(
  client: { session: SFlowClientSession },
  sessionID: string,
): Promise<string | null> {
  try {
    const mr = await client.session.messages({ path: { id: sessionID } });
    const messages = mr.data as
      | Array<{
          parts: Array<{
            type: string;
            text?: string;
            error?: { message: string; code: number };
            time?: number;
          }>;
        }>
      | undefined;
    let lastOutput: string | null = null;
    if (messages) {
      // P0-1: Process messages in reverse order to get the latest content first
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg) continue;
        if (msg.parts) {
          let hasTextPart = false;
          let retryError: string | null = null;

          for (const part of msg.parts) {
            if (part.type === 'text' && part.text) {
              lastOutput = part.text;
              hasTextPart = true;
              break;
            } else if (part.type === 'retry' && part.error) {
              const { message, code } = part.error;
              retryError = `Error: ${message} (code: ${code})`;
            }
          }

          if (!hasTextPart && retryError) {
            lastOutput = retryError;
            break;
          }

          if (hasTextPart) {
            break;
          }
        }
      }
    }
    return lastOutput;
  } catch {
    return null;
  }
}
