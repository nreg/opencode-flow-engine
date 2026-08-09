/**
 * Shared session polling utilities for sFlow subagent communication.
 */
import { sleep } from '@opencode-flow-engine/shared';
import { PROBE_PENDING, type ProbePending, type PollingOptions } from '../types.js';
import { PollingLogger } from '../features/polling-logger.js';

const logger = new PollingLogger();

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
 * - Event-driven mode (eventDriven: true): subscribes to SSE events for faster detection.
 */
export async function pollSessionCompletion(
  client: { session: SFlowClientSession; event?: { subscribe: (args: { query?: { directory?: string } }) => { on: (event: string, handler: (e: unknown) => void) => { unsubscribe: () => void } } } },
  sessionID: string,
  options: { maxWaitMs?: number; pollIntervalMs?: number; isNew?: boolean; probeMode?: boolean } & PollingOptions = {},
): Promise<string | null | ProbePending> {
  const MAX_WAIT = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const POLL_INTERVAL = options.pollIntervalMs ?? 200; // 200ms default (was 500ms, reduced for faster detection)
  const RETRY_WAIT_BUFFER = 2000; // Task 1.5: 2s buffer accounts for clock skew and polling delay when checking retry next field expiration
  const startTime = Date.now();
  let consecutiveFailures = 0;
  const isNew = options.isNew ?? false;
  const probeMode = options.probeMode ?? false;
  const MAX_POLLS_FOR_NEW = 120; // 120 * 200ms = 24s max for new sessions
  const eventDriven = options.eventDriven ?? true; // Batch 2: event-driven by default
  const fallbackThreshold = options.fallbackThreshold ?? 25_000; // Batch 3: fallback to pure polling after 25s (default)

  // F1: Entry log
  await logger.log(sessionID, 'start polling', { maxWaitMs: MAX_WAIT, isNew, probeMode, eventDriven, fallbackThreshold });

  // Batch 2: Event-driven subscription setup
  let eventSubscription: { unsubscribe: () => void } | null = null;
  let eventReceived = false;
  let eventDrivenActive = false; // P0-3: Track whether event subscription is actually active
  let wakeUp: (() => void) | null = null; // F1: Wake-up function for immediate return
  
  // P0-1 & P0-3: Subscribe to events
  // F1: Event arrival sets eventReceived flag AND calls wakeUp() for immediate return
  // P1-1: Check both event object and subscribe method existence
  if (eventDriven && client.event && typeof client.event.subscribe === 'function') {
    try {
      const eventStream = client.event.subscribe({ query: {} });
      const subscription = eventStream.on('data', (event: unknown) => {
        // P0-1: Check if subscription is still active (race condition defense)
        if (eventSubscription !== subscription) return; // Already cleaned up, ignore late event
        const e = event as { type: string; properties?: { sessionID?: string } };
        if (e.type === 'session.idle' && e.properties?.sessionID === sessionID) {
          eventReceived = true;
          // F1: Wake up immediately on event arrival
          if (wakeUp) wakeUp();
        }
      });
      eventSubscription = subscription;
      eventDrivenActive = true; // P0-3: Mark as active only after successful subscription
    } catch (error) {
      // P1-1: Log event subscription failure
      await logger.log(sessionID, 'event subscription failed', {
        error: error instanceof Error ? error.message : String(error),
        fallback: 'pure polling',
      });
      eventDrivenActive = false; // P0-3: Mark as inactive on failure
    }
  }

  // F1: Exit log helper
  async function logExit(reason: string, result: string | null | ProbePending): Promise<string | null | ProbePending> {
    const elapsed = Date.now() - startTime;
    await logger.log(sessionID, 'completed', { reason, elapsed: `${elapsed}ms` });
    // Batch 2: Cleanup event subscription on exit
    if (eventSubscription) {
      eventSubscription.unsubscribe();
      eventSubscription = null; // P0-1: Mark as cleaned immediately
    }
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
    // P0-2: Fallback check at loop START (before sleep) to avoid 200ms delay
    const elapsed = Date.now() - startTime;
    if (eventSubscription && !eventReceived && elapsed > fallbackThreshold) {
      await logger.log(sessionID, 'fallback to polling', {
        reason: 'event not received within threshold',
        elapsed: `${elapsed}ms`,
        threshold: `${fallbackThreshold}ms`,
      });
      eventSubscription.unsubscribe();
      eventSubscription = null; // P0-1: Mark as cleaned immediately
    }

    // F1: Use Promise.race to allow immediate wake-up on event arrival
    // Event arrival calls wakeUp() to interrupt sleep and return immediately
    await new Promise<void>((resolve) => {
      wakeUp = resolve; // Store resolve function for wake-up
      sleep(POLL_INTERVAL).then(resolve);
    });
    wakeUp = null; // Reset after each iteration
    pollCount++;

    // P0-3: If event received, return directly without status confirmation
    if (eventReceived) {
      const result = await readSessionLastMessage(client, sessionID);
      return await logExit('event_idle', result);
    }

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
      return await logExit('idle', result);
    }

    // Task 1.2: If retry is determined to be an error, return null
    if (isRetryError) {
      return await logExit('retry_error', null);
    }

    // F2: Probe mode - if not idle and not retry error, return pending marker
    if (probeMode) {
      return await logExit('probe_pending', PROBE_PENDING);
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
        // F2: Use shared extractLatestMessage function
        lastMessage = extractLatestMessage(msgs);
        if (currentMsgCount >= minDetectCount) {
          return await logExit('messages', lastMessage);
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
        return await logExit('failure', result);
      }
    } else {
      consecutiveFailures = 0;
    }

    // ⸺⸺ isNew safety cap: avoid infinite loop when status never flips to idle ⸺⸺
    if (isNew && pollCount >= MAX_POLLS_FOR_NEW) {
      const result = await readSessionLastMessage(client, sessionID);
      return await logExit('max_polls', result);
    }
  }

  const result = await readSessionLastMessage(client, sessionID);
  return await logExit('timeout', result);
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
    return extractLatestMessage(messages);
  } catch {
    return null;
  }
}

/**
 * F2: Extract the latest message content from an array of messages.
 * Processes messages in reverse order to get the most recent content first.
 * Handles both text parts and retry error parts.
 * 
 * @param messages - Array of message objects with parts
 * @returns The latest text content, error message, or null if no valid content found
 */
export function extractLatestMessage(
  messages:
    | Array<{
        parts: Array<{
          type: string;
          text?: string;
          error?: { message: string; code: number };
          time?: number;
        }>;
      }>
    | undefined,
): string | null {
  if (!messages) return null;
  
  let lastOutput: string | null = null;
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
  return lastOutput;
}
