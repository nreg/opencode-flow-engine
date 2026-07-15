/**
 * Shared session polling utilities for sFlow subagent communication.
 */
import { sleep } from "@opencode-flow-engine/shared";

export interface SFlowClientSession {
  status(): Promise<{ data: unknown }>;
  messages(args: { path: { id: string } }): Promise<{ data: unknown }>;
}

/**
 * Polls a subagent session until the subagent responds.
 *
 * Behavior contract:
 * - No timeout: sync mode means "wait until done". For long-running tasks
 *   (e.g., build-executor TDD cycles), polling must continue indefinitely.
 * - Returns immediately when the session status is "idle" (subagent done).
 * - Returns immediately when message count exceeds the initial count.
 * - For isNew sessions: initial count is 1 (the prompt just sent),
 *   so returns when count >= 2 (at least 1 assistant response).
 * - Session disappearance: if both status() and messages() fail twice in a row,
 *   assumes the session died and returns the last known message.
 * - isNew sessions have a safety cap (36_000 polls × 500ms = 5h) to prevent
 *   infinite loops in pathological cases.
 *
 * Callers can pass maxWaitMs to override the no-timeout default for cases
 * where a bounded wait is preferred (e.g., flowagent_output polling).
 */
export async function pollSessionCompletion(
  client: { session: SFlowClientSession },
  sessionID: string,
  options: { maxWaitMs?: number; pollIntervalMs?: number; isNew?: boolean } = {},
): Promise<string | null> {
  const MAX_WAIT = options.maxWaitMs ?? Infinity;
  const POLL_INTERVAL = options.pollIntervalMs ?? 2000;
  const startTime = Date.now();
  let consecutiveFailures = 0;
  const isNew = options.isNew ?? false;
  const MAX_POLLS_FOR_NEW = 36_000;

  // Capture the initial message count so we can distinguish
  // the user's prompt from the subagent's response.
  let initialMsgCount = 0;
  try {
    const mr = await client.session.messages({ path: { id: sessionID } });
    const msgs = mr.data as Array<unknown> | undefined;
    initialMsgCount = Array.isArray(msgs) ? msgs.length : 0;
  } catch { /* ignore */ }
  const minDetectCount = isNew ? Math.max(initialMsgCount + 1, 2) : initialMsgCount + 1;

  let lastMessage: string | null = null;
  let pollCount = 0;

  while (Date.now() - startTime < MAX_WAIT) {
    await sleep(POLL_INTERVAL);
    pollCount++;

    // ── Status check: session idle → return immediately ──
    let isIdle = false;
    let statusFailed = false;
    try {
      const statusResult = await client.session.status();
      const rawData = statusResult.data;
      if (Array.isArray(rawData)) {
        const found = (rawData as Array<{ id: string; type: string }>).find(s => s.id === sessionID);
        if (found) isIdle = found.type === "idle";
      } else if (rawData && typeof rawData === "object") {
        const obj = rawData as Record<string, { type: string }>;
        isIdle = obj[sessionID]?.type === "idle";
      }
    } catch {
      statusFailed = true;
    }
    if (isIdle) {
      return readSessionLastMessage(client, sessionID);
    }

    // ── Messages check: return immediately when assistant responds ──
    let messagesFailed = false;
    let currentMsgCount = 0;
    try {
      const mr = await client.session.messages({ path: { id: sessionID } });
      const msgs = mr.data as Array<{ parts: Array<{ type: string; text?: string }> }> | undefined;
      if (Array.isArray(msgs)) {
        currentMsgCount = msgs.length;
        for (const msg of msgs) {
          if (msg.parts) {
            for (const part of msg.parts) {
              if (part.type === "text" && part.text) {
                lastMessage = part.text;
              }
            }
          }
        }
        if (currentMsgCount >= minDetectCount) {
          return lastMessage;
        }
      }
    } catch {
      messagesFailed = true;
    }

    // ── Session disappearance: both status and messages failed ──
    if (statusFailed && messagesFailed) {
      consecutiveFailures++;
      if (consecutiveFailures >= 2) {
        return readSessionLastMessage(client, sessionID);
      }
    } else {
      consecutiveFailures = 0;
    }

    // ── isNew safety cap: 5h ceiling for pathological cases ──
    if (isNew && pollCount >= MAX_POLLS_FOR_NEW) {
      return readSessionLastMessage(client, sessionID);
    }
  }

  return readSessionLastMessage(client, sessionID);
}

export async function readSessionLastMessage(
  client: { session: SFlowClientSession },
  sessionID: string,
): Promise<string | null> {
  try {
    const mr = await client.session.messages({ path: { id: sessionID } });
    const messages = mr.data as Array<{ parts: Array<{ type: string; text?: string }> }> | undefined;
    let lastOutput: string | null = null;
    if (messages) {
      for (const msg of messages) {
        if (msg.parts) {
          for (const part of msg.parts) {
            if (part.type === "text" && part.text) lastOutput = part.text;
          }
        }
      }
    }
    return lastOutput;
  } catch { return null; }
}
