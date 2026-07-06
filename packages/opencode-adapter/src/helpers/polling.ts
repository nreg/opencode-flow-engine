/**
 * Shared session polling utilities for sFlow subagent communication.
 */
import { sleep } from "@opencode-sflow/shared";

export interface SFlowClientSession {
  status(): Promise<{ data: unknown }>;
  messages(args: { path: { id: string } }): Promise<{ data: unknown }>;
}

export async function pollSessionCompletion(
  client: { session: SFlowClientSession },
  sessionID: string,
  options: { maxWaitMs?: number; pollIntervalMs?: number; isNew?: boolean } = {},
): Promise<string | null> {
  const MAX_WAIT = options.maxWaitMs ?? 300_000;
  const POLL_INTERVAL = options.pollIntervalMs ?? 500;
  const startTime = Date.now();
  let lastMsgCount = 0;
  let stablePolls = 0;
  const STABLE_REQUIRED = 3;
  let sawActiveStatus = false;
  const isNew = options.isNew ?? false;

  while (Date.now() - startTime < MAX_WAIT) {
    await sleep(POLL_INTERVAL);
    let isIdle = false;
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
      // status() may fail; fall through
    }
    if (isIdle) return readSessionLastMessage(client, sessionID);
    if (isNew && !sawActiveStatus) {
      if (isIdle) sawActiveStatus = true;
      continue;
    }
    let currentMsgCount = 0;
    try {
      const mr = await client.session.messages({ path: { id: sessionID } });
      const msgs = mr.data as Array<unknown> | undefined;
      currentMsgCount = Array.isArray(msgs) ? msgs.length : 0;
    } catch { break; }
    if (currentMsgCount > 0 && currentMsgCount === lastMsgCount) {
      stablePolls++;
      if (stablePolls >= STABLE_REQUIRED) break;
    } else { stablePolls = 0; lastMsgCount = currentMsgCount; }
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