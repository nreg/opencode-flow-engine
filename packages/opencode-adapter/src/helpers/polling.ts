/**
 * Shared session polling utilities for sFlow subagent communication.
 */
import { sleep } from "@opencode-sflow/shared";

export interface SFlowClientSession {
  status(): Promise<{ data: unknown }>;
  messages(args: { path: { id: string } }): Promise<{ data: unknown }>;
}

/**
 * Polls a subagent session until it completes (becomes idle with messages).
 *
 * Behavior contract (polling-fix spec):
 * - Default maxWaitMs shortened from 300s to 30s.
 * - Non-isNew sessions: return immediately once any message is detected.
 * - isNew sessions: return on first message, or on idle status, with a max-polls
 *   safety cap to avoid the historical infinite-loop when status never flips to idle.
 * - status() failures fall back to messages(); repeated dual-failure triggers
 *   session-disappearance handling via readSessionLastMessage.
 */
export async function pollSessionCompletion(
  client: { session: SFlowClientSession },
  sessionID: string,
  options: { maxWaitMs?: number; pollIntervalMs?: number; isNew?: boolean } = {},
): Promise<string | null> {
  const MAX_WAIT = options.maxWaitMs ?? 30_000;
  const POLL_INTERVAL = options.pollIntervalMs ?? 500;
  const startTime = Date.now();
  let consecutiveFailures = 0;
  const isNew = options.isNew ?? false;
  const MAX_POLLS_FOR_NEW = 60;

  let pollCount = 0;

  while (Date.now() - startTime < MAX_WAIT) {
    await sleep(POLL_INTERVAL);
    pollCount++;

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

    // isNew session: status is idle -> return immediately
    if (isNew && isIdle) {
      return readSessionLastMessage(client, sessionID);
    }

    // Try messages API
    let lastMessage: string | null = null;
    let messagesFailed = false;

    try {
      const mr = await client.session.messages({ path: { id: sessionID } });
      const msgs = mr.data as Array<{ parts: Array<{ type: string; text?: string }> }> | undefined;
      if (Array.isArray(msgs)) {
        for (const msg of msgs) {
          if (msg.parts) {
            for (const part of msg.parts) {
              if (part.type === "text" && part.text) {
                lastMessage = part.text;
              }
            }
          }
        }
        if (msgs.length > 0) {
          // Fast path: any message content detected -> return immediately
          return lastMessage;
        }
      }
    } catch {
      messagesFailed = true;
    }

    // Session disappearance: both status and messages failed in this iteration
    if (statusFailed && messagesFailed) {
      consecutiveFailures++;
      if (consecutiveFailures >= 2) {
        return lastMessage || readSessionLastMessage(client, sessionID);
      }
    } else {
      consecutiveFailures = 0;
    }

    // isNew session safety: avoid the historical infinite loop when status
    // never flips to idle by capping polls and falling back to message read.
    if (isNew && pollCount >= MAX_POLLS_FOR_NEW) {
      return lastMessage || readSessionLastMessage(client, sessionID);
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
