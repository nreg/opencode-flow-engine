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
 * Uses stability-based completion detection (inspired by oh-my-openagent's
 * waitForCompletion): the session is considered complete when the message
 * count stays stable for 3 consecutive polls AND the session is idle.
 *
 * This is more reliable than threshold-based detection (minDetectCount)
 * because the SDK's messages() API may return different formats for child
 * sessions (e.g., only assistant messages, excluding the prompt).
 *
 * Behavior contract:
 * - No timeout by default: sync mode means "wait until done".
 * - Session idle + stable message count → done.
 * - Session disappearance: both status() and messages() fail twice → done.
 * - Callers can pass maxWaitMs for bounded polling (e.g., flowagent_output).
 */
export async function pollSessionCompletion(
  client: { session: SFlowClientSession },
  sessionID: string,
  options: { maxWaitMs?: number; pollIntervalMs?: number } = {},
): Promise<string | null> {
  const MAX_WAIT = options.maxWaitMs ?? Infinity;
  const POLL_INTERVAL = options.pollIntervalMs ?? 2000;
  const startTime = Date.now();
  const STABILITY_REQUIRED = 3;
  let stablePolls = 0;
  let lastMsgCount = 0;
  let sawActiveStatus = false;
  let consecutiveFailures = 0;

  while (Date.now() - startTime < MAX_WAIT) {
    await sleep(POLL_INTERVAL);

    // ── Status check: detect active vs idle ──
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

    if (!isIdle && !statusFailed) {
      // Session is still active: reset stability counters
      sawActiveStatus = true;
      stablePolls = 0;
      lastMsgCount = 0;
      continue;
    }

    // ── Messages check: stability-based completion detection ──
    let messagesFailed = false;
    let currentMsgCount = 0;
    try {
      const mr = await client.session.messages({ path: { id: sessionID } });
      const msgs = mr.data as Array<unknown> | undefined;
      currentMsgCount = Array.isArray(msgs) ? msgs.length : 0;
    } catch {
      messagesFailed = true;
    }

    if (currentMsgCount > 0 && currentMsgCount === lastMsgCount && !statusFailed) {
      stablePolls++;
      if (stablePolls >= STABILITY_REQUIRED) {
        // Session is idle AND message count is stable → done
        return readSessionLastMessage(client, sessionID);
      }
    } else {
      stablePolls = 0;
      lastMsgCount = currentMsgCount;
    }

    // ── Session disappearance: both status and messages failed twice ──
    if (statusFailed && messagesFailed) {
      consecutiveFailures++;
      if (consecutiveFailures >= 2) {
        return readSessionLastMessage(client, sessionID);
      }
    } else {
      consecutiveFailures = 0;
    }
  }

  return readSessionLastMessage(client, sessionID);
}

/**
 * Extract the last assistant/tool message text from a session.
 * Mirrors oh-my-openagent's processMessages approach: filters by role,
 * extracts text from both text and reasoning parts, and includes tool results.
 */
export async function readSessionLastMessage(
  client: { session: SFlowClientSession },
  sessionID: string,
): Promise<string | null> {
  try {
    const mr = await client.session.messages({ path: { id: sessionID } });
    const messages = mr.data as Array<{
      info?: { role?: string };
      parts?: Array<{ type: string; text?: string; content?: string | Array<{ type: string; text?: string }> }>;
    }> | undefined;
    if (!Array.isArray(messages) || messages.length === 0) return null;

    // Filter to assistant and tool messages (skip user prompts)
    const relevantMessages = messages.filter(
      (m) => m.info?.role === "assistant" || m.info?.role === "tool",
    );
    if (relevantMessages.length === 0) return null;

    // Extract text from all parts across all relevant messages
    const extracted: string[] = [];
    for (const msg of relevantMessages) {
      if (!msg.parts) continue;
      for (const part of msg.parts) {
        if ((part.type === "text" || part.type === "reasoning") && part.text) {
          extracted.push(part.text);
        } else if (part.type === "tool_result") {
          const content = part.content;
          if (typeof content === "string" && content) {
            extracted.push(content);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if ((block.type === "text" || block.type === "reasoning") && block.text) {
                extracted.push(block.text);
              }
            }
          }
        }
      }
    }

    return extracted.length > 0 ? extracted.join("\n\n") : null;
  } catch { return null; }
}
