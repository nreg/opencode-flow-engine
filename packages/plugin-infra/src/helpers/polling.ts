/**
 * Shared session polling utilities for sFlow subagent communication.
 */
import { sleep } from '@opencode-flow-engine/shared';
import {
  PROBE_PENDING,
  type ProbePending,
  type PollingOptions,
  type Event,
} from '../types.js';
import { PollingLogger } from '../features/polling-logger.js';
import { getGlobalEventBus } from '../features/event-bus.js';

const logger = new PollingLogger();

/**
 * Logger interface for diagnostic logging
 * Allows tests to inject mock logger
 */
interface DiagnosticLogger {
  log(sessionId: string, message: string, metadata?: Record<string, unknown>): Promise<void>;
}

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
 * - Event-driven mode (eventDriven: true): registers to global event bus for faster detection.
 */
export async function pollSessionCompletion(
  client: {
    session: SFlowClientSession;
  },
  sessionID: string,
  options: { maxWaitMs?: number; pollIntervalMs?: number; isNew?: boolean; probeMode?: boolean; logger?: DiagnosticLogger } & PollingOptions = {},
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
  const fallbackThreshold = options.fallbackThreshold ?? 5_000; // P1-FIX: fallback to pure polling after 5s (event loss → fast fallback)

  // D3: Use injected logger if provided, otherwise use global logger
  const activeLogger = options.logger ?? logger;

  // F1: Entry log
  await activeLogger.log(sessionID, 'start polling', { maxWaitMs: MAX_WAIT, isNew, probeMode, eventDriven, fallbackThreshold });

  // Batch 3: Event bus driven polling
  // R1: Register to global event bus for session.idle event
  // - pollSessionCompletion registers sessionID → wakeUp callback
  // - Hooks.event dispatches session.idle event to event bus
  // - Event bus calls wakeUp, which interrupts polling loop
  let eventReceived = false;
  let wakeUp: (() => void) | null = null;
  let eventBusRegistered = false;

  if (eventDriven) {
    // R1: Register to global event bus
    const eventBus = getGlobalEventBus();
    eventBus.register(sessionID, (event: Event) => {
      // R1: Check if event is session.idle for this session
      if (
        event.type === 'session.idle' &&
        event.properties &&
        'sessionID' in event.properties &&
        event.properties.sessionID === sessionID
      ) {
        eventReceived = true;
        if (wakeUp) wakeUp();
        
        // R1: Log event arrival
        void activeLogger.log(sessionID, 'event received', {
          source: 'event.hook',
          type: event.type,
          eventSessionID: event.properties.sessionID,
          targetSessionID: sessionID,
          matched: true,
        });
      }
    });
    eventBusRegistered = true;
  }

  async function logExit(reason: string, result: string | null | ProbePending): Promise<string | null | ProbePending> {
    const elapsed = Date.now() - startTime;
    await activeLogger.log(sessionID, 'completed', { reason, elapsed: `${elapsed}ms` });
    
    // R1: Unregister from event bus (防泄漏)
    if (eventBusRegistered) {
      const eventBus = getGlobalEventBus();
      eventBus.unregister(sessionID);
      eventBusRegistered = false;
    }
    
    return result;
  }

  // P0-FIX: probeMode 下先检查 status，明确 busy 的会话直接返回 PROBE_PENDING
  //（避免不必要的 messages 调用）。retry 状态必须走主循环的 retry 语义
  //（attempt>=5 判定为 error），不能在此短路。
  // 注意：仅在 probeMode 下预查 status——非 probeMode 增加 status 调用会改变
  // 已有调用序列（顺序计数 mock 测试依赖），且主循环的 status 检查已足够。
  if (probeMode) {
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

      if (statusEntry && statusEntry.type === 'busy') {
        return await logExit('probe_pending', PROBE_PENDING);
      }
    } catch {
      // status 检查失败，继续执行后续逻辑
    }
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

  // P0-FIX: flowagent_output 在子 agent 完成之后才被调用，此时会话已含 assistant 回复，
  // 而事件驱动（事件已丢失）、status 检测（idle 会话已被服务端从状态表删除）、
  // 消息计数检测（minDetectCount = initialMsgCount + 1 对已完成会话永不满足）全部失效。
  // 核心修复：主循环的 messages 检查改为 role-aware（hasAssistantMessage），
  // 并仅在会话状态未命中 busy/retry（即已完成）时才将 assistant 消息视为完成信号——
  // 这样 flowagent_output 在第一次轮询迭代（~200ms）即可命中返回，而同步 retry
  // （注入 reminder 后会话里已有旧 assistant 回复但状态仍 busy）不会被误判提前返回。
  const minDetectCount = isNew ? Math.max(initialMsgCount + 1, 2) : initialMsgCount + 1;

  let lastMessage: string | null = null;
  let pollCount = 0;

  while (Date.now() - startTime < MAX_WAIT) {
    const elapsed = Date.now() - startTime;
    
    // Batch 3: Fallback to pure polling if event not received within threshold
    if (eventBusRegistered && !eventReceived && elapsed > fallbackThreshold) {
      await activeLogger.log(sessionID, 'fallback to polling', {
        reason: 'event not received within threshold',
        elapsed: `${elapsed}ms`,
        threshold: `${fallbackThreshold}ms`,
      });

      // P1-2: Unregister from event bus (no longer needed)
      // Check eventReceived again to avoid race condition (event arrived just before unregister)
      if (!eventReceived) {
        const eventBus = getGlobalEventBus();
        eventBus.unregister(sessionID);
        eventBusRegistered = false;
      }
    }

    // P0-2: Check eventReceived before sleep to detect events that arrived
    // after register but before wakeUp assignment.
    // Scenario 1: event after register, before wakeUp → caught here (no 200ms delay)
    // Scenario 2: event during sleep → wakeUp interrupts sleep
    // Scenario 3: event after unregister → polling fallback catches
    if (eventReceived) {
      const result = await readSessionLastMessage(client, sessionID);
      return await logExit('event_hook', result);
    }

    await new Promise<void>((resolve) => {
      wakeUp = resolve;
      sleep(POLL_INTERVAL).then(resolve);
    });
    wakeUp = null;
    pollCount++;

    // P0-3: If event received, return directly without status confirmation
    if (eventReceived) {
      const result = await readSessionLastMessage(client, sessionID);
      return await logExit('event_hook', result);
    }

    // ⸺⸺ Status check: session idle/retry → handle accordingly ⸺⸺
    let isIdle = false;
    let isRetryError = false;
    let statusFailed = false;
    let statusEntry:
      | { id: string; type: string; attempt?: number; message?: string; next?: number }
      | undefined;
    try {
      const statusResult = await client.session.status();
      const rawData = statusResult.data;

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

    // F2: Probe mode - status 明确 busy/retry 时直接返回 pending；
    // status 未命中（idle 已被服务端删除）时继续走 messages 检查确认。
    if (probeMode && statusEntry !== undefined && !statusFailed) {
      return await logExit('probe_pending', PROBE_PENDING);
    }

    // ⸺⸺ Messages check: return immediately when assistant responds ⸺⸺
    let messagesFailed = false;
    let currentMsgCount = 0;
    try {
      const mr = await client.session.messages({ path: { id: sessionID } });
      const msgs = mr.data as
        | Array<{
            info?: { role?: string };
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
        // P0-FIX: role-aware 消息检测，优先使用 hasAssistantMessage。
        // 守卫：会话状态未命中 busy/retry（即已完成）时，assistant 消息才视为完成信号；
        // 否则（如同步 retry 注入 reminder 后会话里已存在旧的 assistant 回复）继续轮询等待新输出。
        const statusNotBusy =
          statusFailed || !statusEntry || statusEntry.type === 'idle';
        if (currentMsgCount >= minDetectCount || (statusNotBusy && hasAssistantMessage(msgs))) {
          return await logExit('messages', lastMessage);
        }
      }
    } catch {
      messagesFailed = true;
    }

    // F2: Probe mode 且 messages 未判定完成 → 返回 pending marker
    if (probeMode) {
      return await logExit('probe_pending', PROBE_PENDING);
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
 * P0-FIX: 判断消息列表是否已包含 assistant 回复（即子 agent 已响应）。
 * - 真实 SDK 数据带 info.role，以 role==='assistant' 精确判定；
 * - 测试 mock 无 info 字段时 fallback：采用更保守的判定防止误判。
 *
 * P1-加固：fallback 时验证消息结构，防止 user+user 误判：
 * - 若最后一条 info.role 明确是 'user'，直接返回 false；
 * - 若 info.role 缺失，检查最后一条 text 是否与第一条相同（防止重复 user 消息）。
 */
function hasAssistantMessage(
  msgs: Array<{ info?: { role?: string }; parts: Array<{ type: string; text?: string }> }> | undefined,
): boolean {
  if (!Array.isArray(msgs) || msgs.length === 0) return false;
  const last = msgs[msgs.length - 1];

  // 优先使用 info.role 精确判定
  if (last?.info && typeof last.info.role === 'string') {
    return last.info.role === 'assistant';
  }

  // fallback：mock 无 info 时，采用更保守的判定
  // 1. 必须至少 2 条消息
  if (msgs.length < 2) return false;

  // 2. 最后一条必须有 text part
  const lastText = Array.isArray(last?.parts)
    ? last.parts.find((p) => p.type === 'text' && p.text)?.text
    : undefined;
  if (!lastText) return false;

  // 3. 最后一条的 text 不应与第一条完全相同（防止 user+user 误判）
  const firstText = Array.isArray(msgs[0]?.parts)
    ? msgs[0].parts.find((p) => p.type === 'text' && p.text)?.text
    : undefined;

  // 如果第一条和最后一条 text 相同，可能是 user 重复发送，返回 false
  if (firstText && lastText === firstText) return false;

  return true;
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
