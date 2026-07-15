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
 * - Default maxWaitMs: 300s (5 minutes). Sub-agent tasks (build-executor, etc.)
 *   can take minutes to complete, especially with TDD cycles.
 * - Returns immediately when the session status is "idle".
 * - Returns immediately when message count exceeds the initial count
 *   (distinguishes the user's prompt from the assistant's response).
 * - For isNew sessions: initial count is 1 (the prompt just sent),
 *   so returns when count >= 2 (at least 1 assistant response).
 * - status() failures fall back to messages(); repeated dual-failure triggers
 *   session-disappearance handling via readSessionLastMessage.
 * - isNew sessions have a max-polls safety cap (600) to avoid infinite loop
 *   when status never flips to idle.
 */
export async function pollSessionCompletion(
  client: { session: SFlowClientSession },
  sessionID: string,
  options: { maxWaitMs?: number; pollIntervalMs?: number; isNew?: boolean } = {},
): Promise<string | null> {
  const MAX_WAIT = options.maxWaitMs ?? 300_000;
  const POLL_INTERVAL = options.pollIntervalMs ?? 500;
  const startTime = Date.now();
  let consecutiveFailures = 0;
  const isNew = options.isNew ?? false;
  const MAX_POLLS_FOR_NEW = 600;

  // Capture the initial message count so we can distinguish
  // the user's prompt from the subagent's response.
  let initialMsgCount = 0;
  try {
    const mr = await client.session.messages({ path: { id: sessionID } });
    const msgs = mr.data as Array<unknown> | undefined;
    initialMsgCount = Array.isArray(msgs) ? msgs.length : 0;
  } catch { /* ignore */ }
  // For isNew sessions, the prompt was just sent, so initialMsgCount = 1.
  // We need at least 1 assistant response → require count >= 2.
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
        // Read last text from any message (skips user prompt by count check)
        for (const msg of msgs) {
          if (msg.parts) {
            for (const part of msg.parts) {
              if (part.type === "text" && part.text) {
                lastMessage = part.text;
              }
            }
          }
        }
        // Fast path: return immediately when assistant has responded
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

    // ── isNew safety cap: avoid infinite loop when status never flips to idle ──
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
