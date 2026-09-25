/**
 * Shared CallFlowAgent Tool Factory
 *
 * Creates the call_flow_agent, flowagent_output, and flowagent_cancel tool definitions.
 * Used by iflow-plugin-factory, sflow-plugin-factory, and combined-plugin-factory
 * to avoid duplicating the same session creation/polling/background task logic.
 */

import { z } from 'zod';
import { createNotificationManager } from '../features/notification-manager.js';
import { createSubagentStore } from '../features/subagent-store.js';
import {
  hasCompletionSignal,
  performCompletionRetry,
  REMINDER_MESSAGE,
} from '../helpers/completion-detector.js';
import { extractJsonBlock, getSchemaHint } from '../helpers/output-extractor.js';
import {
  pollSessionCompletion,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_SYNC_MAX_WAIT_MS,
} from '../helpers/polling.js';
import { resolveChangeDir } from '../helpers/resolve-change-dir.js';
import type {
  AgentModelMap,
  BackgroundTaskEntry,
  BackgroundTaskRegistry,
  SFlowClient,
} from '../types.js';
import { formatToolError, generateTaskId, PROBE_PENDING } from '../types.js';
import type { LocalToolDefinition } from '../types/local-tool-definition.js';
import { DEFAULT_PROFILE_MODELS } from '../agents/config-loader.js';
import {
  resolveModelWithFallback,
  getAlternativeModel,
  markModelUnavailable,
  VALID_MODEL_TIERS,
  type ModelTier,
} from '../agents/agent-builder.js';
import type { BuiltinAgentName } from '../agents/types.js';
import { Logger } from '../utils/logger.js';

/** Maximum concurrent subagent sessions of the same type */
const MAX_CONCURRENT_SUBAGENTS = 3;

/**
 * 模型故障转移次数上限（Wave 1 定义，Wave 2 的循环使用）。
 * 语义：首模型 + 最多 2 次换模型 = 最多 3 次 prompt 尝试。
 * 理由：OpenCode 已在同一模型上重试 5 次，插件层叠加过多会显著拉长等待；
 * DEFAULT_FALLBACKS 每个 agent 仅 2 个 fallback，超过 2 次换模型必然退化为重复。
 */
const MAX_MODEL_RETRIES = 2;

/** subagent-store 事件类型：记录一次模型故障转移（D-8） */
const MODEL_FALLBACK_EVENT = 'model_fallback';

/** sendPromptOnce 的返回结构：区分 ok / HTTP status / message（D-1） */
interface PromptSendResult {
  ok: boolean;
  status?: number;
  message?: string;
}

/**
 * Parse model string 'provider/modelID' into SDK v1 format { providerID, modelID }
 * Returns null if the string is not in expected format, with warning logged
 */
function parseModelString(modelString: string): { providerID: string; modelID: string } | null {
  const parts = modelString.split('/');
  if (parts.length !== 2) {
    Logger.warn(
      `[parseModelString] Invalid model format: "${modelString}". Expected "provider/modelID" (exactly one '/' separator)`,
    );
    return null;
  }
  const [providerID, modelID] = parts;
  if (!providerID || !modelID) {
    Logger.warn(
      `[parseModelString] Empty provider or modelID: "${modelString}". Both parts must be non-empty`,
    );
    return null;
  }
  return { providerID, modelID };
}

/** Tracks running subagent count per subagent type */
const runningSubagentCounts = new Map<string, number>();

/** Reset running subagent counts (for testing) */
export function resetRunningSubagentCounts(): void {
  runningSubagentCounts.clear();
}

/**
 * Increment the running count for a subagent type.
 * Returns true if the limit was not exceeded, false otherwise.
 */
function acquireSubagentSlot(subagentType: string): boolean {
  const current = runningSubagentCounts.get(subagentType) ?? 0;
  if (current >= MAX_CONCURRENT_SUBAGENTS) {
    return false;
  }
  runningSubagentCounts.set(subagentType, current + 1);
  return true;
}

/**
 * Decrement the running count for a subagent type.
 */
function releaseSubagentSlot(subagentType: string): void {
  const current = runningSubagentCounts.get(subagentType) ?? 0;
  if (current <= 1) {
    runningSubagentCounts.delete(subagentType);
  } else {
    runningSubagentCounts.set(subagentType, current - 1);
  }
}

/**
 * 发送一次 prompt（D-1 核心）。
 *
 * 关键：以 `{ throwOnError: true }` 调用 `client.session.prompt` 并用 try/catch 包裹。
 * SDK 默认 throwOnError:false 走 result-tuple 返回，`.catch` 永不执行（死代码），
 * 因此故障转移无法触发。启用 throwOnError 后，HTTP 错误会 throw，
 * 错误对象被 hey-api error-interceptor 包装为 `Error(message, { cause: { body, status } })`，
 * 从而能区分 ok / status / message。
 *
 * 本函数**不**做任何拉黑 / 换模型动作（那是 D-2 的触发点，属于 Wave 2 的 Task 3）。
 */
async function sendPromptOnce(
  client: SFlowClient,
  params: {
    sessionID: string;
    agent: string;
    text: string;
    model: { providerID: string; modelID: string };
  },
): Promise<PromptSendResult> {
  try {
    // 注意：hey-api SDK 的 session.prompt(options) 只接受一个 options 对象，
    // throwOnError 必须是 options 的顶层字段（不是第二个参数，否则被忽略 → 死代码复现）。
    await client.session.prompt({
      path: { id: params.sessionID },
      body: {
        agent: params.agent,
        parts: [{ type: 'text', text: params.text }],
        model: params.model,
      },
      throwOnError: true,
    });
    return { ok: true };
  } catch (err) {
    const e = err as Error & { cause?: { status?: number; body?: unknown }; status?: number };
    // 降级顺序读取 HTTP 状态码（hey-api error-interceptor 把 { body, status } 注入 cause）
    const status = e?.cause?.status ?? e?.status ?? undefined;
    const message = e?.message ?? String(err);
    return { ok: false, status, message };
  }
}

/**
 * 构造接管轮次的 prompt 文本（D-5）。
 *
 * 当 attemptIndex > 0 时，在 basePrompt 前置一段接管声明，包含：
 *  - "第 N 次接管轮次"
 *  - 前一个失败模型名
 *  - "不要重复前次已完成的工作，直接从失败处继续 —— 前次模型调用失败未产生有效输出"
 *
 * attemptIndex === 0 时**原样返回** basePrompt（保证既有 65 个测试的 prompt 断言不受影响）。
 */
function buildAttemptPrompt(basePrompt: string, attemptIndex: number, previousModel?: string): string {
  if (attemptIndex === 0) {
    return basePrompt;
  }
  const previous = previousModel ? `前一个失败模型为 ${previousModel}` : '前一个模型未知';
  const header =
    `【第 ${attemptIndex} 次接管轮次】${previous}。` +
    `不要重复前次已完成的工作，直接从失败处继续 —— 前次模型调用失败未产生有效输出。\n\n`;
  return `${header}${basePrompt}`;
}

// ─── Wave 2 (Task 3): 模型故障转移编排器 ───────────────────────────────────────

type AttemptStatus = 'ok' | 'model-failure' | 'context-overflow' | 'fatal';
interface AttemptResult {
  status: AttemptStatus;
  output: string | null;
  detail?: string;
}

/**
 * 读取 session 最后一条 assistant 消息的 error.name，用于 D-6 判定 ContextOverflowError。
 *
 * 注意：polling 层(`polling.ts`)未读取 `info.error` 字段，且 `parts[].error` 是 retry part，
 * 真正的 halt 错误落在 `info.error`（`MessageV2.fromError` 产出）。因此这里只用 `info.error`，
 * 绝不用 `parts[].error` 替代。结构不确定时用宽松读取 + 失败静默返回 undefined，不得抛异常。
 */
async function readLastAssistantErrorName(client: SFlowClient, sessionID: string): Promise<string | undefined> {
  try {
    const res = await (
      client as unknown as {
        session: { messages(args: { path: { id: string } }): Promise<{ data?: unknown }> };
      }
    ).session.messages({ path: { id: sessionID } });
    const data = res.data;
    if (!Array.isArray(data)) return undefined;
    for (let i = data.length - 1; i >= 0; i--) {
      const msg = data[i] as { info?: { role?: string; error?: { name?: string } } };
      if (msg?.info?.role === 'assistant') {
        return msg.info.error?.name;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

interface RunFallbackResult {
  success: boolean;
  output: string | null;
  model: string;
  attemptedModels: string[];
  fallbacks: Array<{ from: string; to: string; reason: string }>;
  failureReason?: 'exhausted' | 'context-overflow' | 'fatal' | 'invalid-model';
  detail?: string;
}

/**
 * 模型故障转移编排器（D-2/D-3/D-4/D-5/D-6/D-7/D-8）。
 *
 * 循环：send → poll。poll 返回 null（OpenCode 已在同一模型重试 5 次后确认失败）即最强"该模型不可用"判据。
 *  - D-3：换模型只用 `getAlternativeModel`（禁用 `resolveModelWithFallback` 的 P1/P2/P7 无黑名单检查分支）
 *  - D-4：三重终止 —— ① 无替代模型 ② 重复模型 ③ `attemptedModels.length > MAX_MODEL_RETRIES`
 *  - D-5：同 session 换 model 重新 prompt，prompt 文本声明"接管轮次"
 *  - D-6：ContextOverflowError 既不拉黑也不换模型
 *  - D-7：前置校验失败（send 不 ok）直接终止，不拉黑不换模型
 *  - D-8：模型故障 → `markModelUnavailable` 拉黑
 *
 * MAX_MODEL_RETRIES = 2 语义：首模型 + 最多 2 次换模型 = 最多 3 次 prompt 调用（非"最多 2 次调用"）。
 */
async function runWithModelFallback(params: {
  client: SFlowClient;
  sessionID: string;
  agentName: string;
  basePrompt: string;
  initialModel: string;
  maxWaitMs: number;
  directory: string;
  poll: (sessionID: string, model: string) => Promise<string | null>;
  onFallback?: (info: { from: string; to: string; attempt: number; reason: string }) => Promise<void> | void;
}): Promise<RunFallbackResult> {
  const { client, sessionID, agentName, basePrompt, initialModel, poll, onFallback } = params;
  let currentModel = initialModel;
  const attemptedModels: string[] = [];
  const fallbacks: Array<{ from: string; to: string; reason: string }> = [];

  // MAX_MODEL_RETRIES = 2 ⇒ 最多 3 次 prompt：首次 + 2 次换模型。
  for (let attempt = 0; ; attempt++) {
    const parsed = parseModelString(currentModel);
    if (!parsed) {
      return {
        success: false,
        failureReason: 'invalid-model',
        attemptedModels,
        fallbacks,
        output: null,
        model: currentModel,
      };
    }
    attemptedModels.push(currentModel);

    const send = await sendPromptOnce(client, {
      sessionID,
      agent: agentName,
      text: buildAttemptPrompt(basePrompt, attempt, attempt > 0 ? attemptedModels[attempt - 1] : undefined),
      model: parsed,
    });
    if (!send.ok) {
      // D-7：前置校验失败（HTTP 400/404：SessionBusy / model not found / agent 不存在）直接终止，
      // 不拉黑、不换模型。
      return {
        success: false,
        failureReason: 'fatal',
        detail: `HTTP ${send.status ?? 'unknown'}`,
        attemptedModels,
        fallbacks,
        model: currentModel,
        output: null,
      };
    }

    const output = await poll(sessionID, currentModel);
    if (output !== null) {
      return { success: true, output, model: currentModel, attemptedModels, fallbacks };
    }

    // D-6：ContextOverflow —— 不拉黑、不换模型，交给 runtime auto-compaction
    const errName = await readLastAssistantErrorName(client, sessionID);
    if (errName === 'ContextOverflowError') {
      return {
        success: false,
        failureReason: 'context-overflow',
        output: null,
        model: currentModel,
        attemptedModels,
        fallbacks,
      };
    }

    // D-2/D-8：模型故障 → 拉黑
    markModelUnavailable(currentModel);

    // 终止条件 ③：换模型次数上限（attemptedModels 已含本次失败，> MAX_MODEL_RETRIES 即停）
    if (attemptedModels.length > MAX_MODEL_RETRIES) {
      return {
        success: false,
        failureReason: 'exhausted',
        detail: 'MAX_MODEL_RETRIES reached',
        output: null,
        model: currentModel,
        attemptedModels,
        fallbacks,
      };
    }

    // 终止条件 ①：无可用替代模型（D-3：必须用 getAlternativeModel，不得用 resolveModelWithFallback）
    const next = getAlternativeModel(currentModel, agentName);
    if (!next) {
      return {
        success: false,
        failureReason: 'exhausted',
        detail: 'no alternative model',
        output: null,
        model: currentModel,
        attemptedModels,
        fallbacks,
      };
    }

    // 终止条件 ②：重复模型检测（防 P7 system-default 退化导致的无限循环）
    if (attemptedModels.includes(next)) {
      return {
        success: false,
        failureReason: 'exhausted',
        detail: `model ${next} already attempted`,
        output: null,
        model: currentModel,
        attemptedModels,
        fallbacks,
      };
    }

    const reason = errName ? `assistant error: ${errName}` : 'poll returned null (retry exhausted)';
    fallbacks.push({ from: currentModel, to: next, reason });
    await onFallback?.({ from: currentModel, to: next, attempt: attempt + 1, reason });
    currentModel = next;
  }
}

// ─── Wave 2 (Task 5): async 模式故障转移 ──────────────────────────────────────

/**
 * 模块级状态容器：记录每个 async task 已尝试的模型（避免重复换模型与跨调用泄漏）。
 * 不新增文件、不改 types.ts 主结构（attemptedModels 字段在 Task 4/5 中按需写入 registry）。
 */
const taskModelAttempts = new Map<string, string[]>();

/**
 * async 模式单次故障转移尝试（D-3/D-4/D-5/D-6/D-7/D-8）。
 *
 * 与 `runWithModelFallback` 不同：async 场景里 prompt 早已发出，只需要在检测到 null 后
 * 换模型重 prompt。三重终止（D-4）与拉黑（D-8）逻辑同 sync。
 *
 * 返回 `{ retried: true, nextModel }`：换模型重 prompt 成功，任务保持 running；
 * 返回 `{ retried: false }`：终止条件命中（无替代模型 / 重复 / 超限 / 前置校验失败），
 *   上层应走既有错误路径。
 */
async function tryAsyncModelFallback(params: {
  client: SFlowClient;
  registry: BackgroundTaskRegistry;
  taskId: string;
  changeDir: string;
}): Promise<{ retried: true; nextModel: string } | { retried: false }> {
  const { client, registry, taskId, changeDir } = params;
  const task = registry.get(taskId);
  if (!task || !task.resolvedModel) return { retried: false };

  const parsed = parseModelString(task.resolvedModel);
  if (!parsed) return { retried: false };

  const attempted = taskModelAttempts.get(taskId) ?? [task.resolvedModel];
  if (!attempted.includes(task.resolvedModel)) attempted.push(task.resolvedModel);

  // D-8：拉黑当前失败模型
  markModelUnavailable(task.resolvedModel);

  // D-3：换模型（禁止 resolveModelWithFallback）
  const next = getAlternativeModel(task.resolvedModel, task.subagentType);
  if (!next) return { retried: false }; // 终止条件 ①

  // D-4：重复模型 / 超限检测
  if (attempted.includes(next)) return { retried: false }; // 终止条件 ②
  if (attempted.length > MAX_MODEL_RETRIES) return { retried: false }; // 终止条件 ③

  const nextParsed = parseModelString(next);
  if (!nextParsed) return { retried: false };

  // D-5：同 session 换模型重 prompt，声明"接管并继续"
  const send = await sendPromptOnce(client, {
    sessionID: task.sessionID,
    agent: task.subagentType,
    text: buildAttemptPrompt(
      '前次模型调用失败，请接管并继续任务。前次模型未产生有效输出，请从当前 session 上下文接管并继续，不要重复已完成的工作。',
      attempted.length,
      task.resolvedModel,
    ),
    model: nextParsed,
  });
  if (!send.ok) return { retried: false }; // D-7：前置校验失败不重试

  // 保持 running、不释放并发槽位（D-4 未命中前绝不宣告失败）
  registry.set(taskId, {
    ...task,
    resolvedModel: next,
    status: 'running',
    attemptedModels: [...attempted, next],
    _errorCount: 0,
  });
  taskModelAttempts.set(taskId, [...attempted, next]);

  // 写 model_fallback 事件（反查 agent_id，找不到则跳过，不阻塞）
  try {
    const store = createSubagentStore({ changeDir });
    const agents = await store.listAgents();
    const matched = agents.find((a) => a.session_id === task.sessionID);
    if (matched) {
      await store.appendEvent(matched.agent_id, {
        timestamp: new Date().toISOString(),
        event_type: MODEL_FALLBACK_EVENT,
        detail: `${task.resolvedModel} -> ${next}`,
      });
    }
  } catch (err) {
    Logger.warn(
      `[CallFlowAgent] async 模型故障转移事件写入失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { retried: true, nextModel: next };
}

// ─── BackgroundTaskWatcher ─────────────────────────────────────────────────────

/**
 * BackgroundTaskWatcher - 自动检测后台任务完成/错误
 *
 * 定期扫描 registry 中 running 状态的 task，委托 Polling Layer 检测完成/错误，
 * 自动更新 registry、释放并发槽位、写通知、更新 subagent-store。
 */
export interface BackgroundTaskWatcher {
  start(): void;
  stop(): void;
}

export interface CreateWatcherOptions {
  client: SFlowClient;
  registry: BackgroundTaskRegistry;
  pollIntervalMs?: number;
}

export function createBackgroundTaskWatcher(options: CreateWatcherOptions): BackgroundTaskWatcher {
  const { client, registry, pollIntervalMs = 200 } = options;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function checkTasks(): Promise<void> {
    const runningTasks = Array.from(registry.entries()).filter(
      ([, task]) => task.status === 'running',
    );

    for (const [taskId, task] of runningTasks) {
      // P1-1: Check processing flag to prevent race with pollAndComplete
      const currentTask = registry.get(taskId);
      if (!currentTask || currentTask.status !== 'running' || currentTask._processing) {
        continue;
      }

      // Set processing flag
      currentTask._processing = true;
      registry.set(taskId, currentTask);

      try {
        // F2: Use probe mode to detect session status without waiting for intermediate output
        const probeResult = await pollSessionCompletion(
          client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
          task.sessionID,
          { maxWaitMs: 1000, probeMode: true, directory: task.changeDir },
        );

        // F2: If still pending, keep running and skip this cycle
        if (probeResult === PROBE_PENDING) {
          currentTask._processing = false;
          registry.set(taskId, currentTask);
          continue;
        }

        if (probeResult === null) {
          // Wave 2 Task 5：尝试模型故障转移（换模型重 prompt），直至成功/耗尽。
          // 设计：保持 running、不释放并发槽位；耗尽后才走原错误路径（D-4 未命中前不宣告失败）。
          let fb = await tryAsyncModelFallback({ client, registry, taskId, changeDir: task.changeDir || '' });
          // 使用 live registry 条目而非 L483 的过期 task 快照，避免覆盖故障转移已写入的 resolvedModel/attemptedModels
          const baseEntry = registry.get(taskId) ?? task;
          let fallbackCompletedOutput: string | null = null;
          let safety = 0;
          while (fb.retried && safety <= MAX_MODEL_RETRIES + 2) {
            safety++;
            const reProbe = await pollSessionCompletion(
              client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
              task.sessionID,
              { maxWaitMs: 300, probeMode: true, directory: task.changeDir, eventDriven: false, pollIntervalMs: 50 },
            );
            if (reProbe === PROBE_PENDING) {
              // 仍在进行中，交由下一轮 tick 处理（仅清除 _processing，不覆盖故障转移已更新的 registry）
              const live = registry.get(taskId);
              if (live) {
                live._processing = false;
                registry.set(taskId, live);
              }
              fb = { retried: false } as { retried: false };
              break;
            }
            if (reProbe !== null) {
              // 换模型后已完成
              fallbackCompletedOutput = reProbe as string;
              fb = { retried: false } as { retried: false };
              break;
            }
            fb = await tryAsyncModelFallback({ client, registry, taskId, changeDir: task.changeDir || '' });
          }

          if (fallbackCompletedOutput !== null) {
            // 故障转移后成功完成：复用到原 completed 路径
            const asyncHasSignal = hasCompletionSignal(fallbackCompletedOutput);
            const now = Date.now();
            const completedEntry: BackgroundTaskEntry = {
              ...baseEntry,
              status: 'completed',
              result: fallbackCompletedOutput,
              completedAt: now,
              slotReleased: baseEntry.slotReleased ?? false,
              _errorCount: 0,
            };
            registry.set(taskId, completedEntry);
            if (!completedEntry.slotReleased) {
              releaseSubagentSlot(task.subagentType);
              completedEntry.slotReleased = true;
              registry.set(taskId, completedEntry);
            }
            try {
              const nm = createNotificationManager({ changeDir: task.changeDir || '' });
              await nm.writeNotification({
                type: 'async_completed',
                subagent: task.subagentType,
                task_id: taskId,
                session_id: task.sessionID,
                summary: fallbackCompletedOutput.slice(0, 200),
                has_completion_signal: asyncHasSignal,
              });
            } catch (err) {
              Logger.warn(`[BackgroundTaskWatcher] 写入完成通知失败: ${err instanceof Error ? err.message : String(err)}`);
            }
            try {
              const store = createSubagentStore({ changeDir: task.changeDir || '' });
              const agents = await store.listAgents();
              const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
              if (matchedAgent) {
                await store.updateOutput(matchedAgent.agent_id, fallbackCompletedOutput);
                await store.appendEvent(matchedAgent.agent_id, {
                  timestamp: new Date().toISOString(),
                  event_type: 'completed',
                  detail: `Async task ${taskId} completed (after model fallback)`,
                });
              }
            } catch (err) {
              Logger.warn(`[BackgroundTaskWatcher] 更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`);
            }
            taskModelAttempts.delete(taskId);
            continue;
          }

          if (fb.retried && safety <= MAX_MODEL_RETRIES + 2) {
            // 安全上限内仍 running：保持任务运行，交给后续 tick（仅清除 _processing，不覆盖故障转移已更新的 registry）
            const live = registry.get(taskId);
            if (live) {
              live._processing = false;
              registry.set(taskId, live);
            }
            continue;
          }

          // 故障转移耗尽（safety 触顶 或 fb.retried === false，且未转 completed）→ 原错误路径
          const now = Date.now();
          const baseEntryForError = registry.get(taskId) ?? task;
          const updated: BackgroundTaskEntry = {
            ...baseEntryForError,
            status: 'error',
            error: 'Task failed after max retries',
            completedAt: now,
            slotReleased: baseEntryForError.slotReleased ?? false,
          };
          registry.set(taskId, updated);

          if (!updated.slotReleased && updated.status !== 'running') {
            releaseSubagentSlot(task.subagentType);
            updated.slotReleased = true;
            registry.set(taskId, updated);
          }

          try {
            const nm = createNotificationManager({ changeDir: task.changeDir || '' });
            await nm.writeNotification({
              type: 'async_error',
              subagent: task.subagentType,
              task_id: taskId,
              session_id: task.sessionID,
              summary: 'Task failed after max retries',
            });
          } catch (err) {
            Logger.warn(`[BackgroundTaskWatcher] 写入错误通知失败: ${err instanceof Error ? err.message : String(err)}`);
          }

          try {
            const store = createSubagentStore({ changeDir: task.changeDir || '' });
            const agents = await store.listAgents();
            const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
            if (matchedAgent) {
              await store.updateOutput(matchedAgent.agent_id, '', { status: 'error' });
              await store.appendEvent(matchedAgent.agent_id, {
                timestamp: new Date().toISOString(),
                event_type: 'error',
                detail: `Async task ${taskId} failed: max retries exceeded`,
              });
            }
          } catch (err) {
            Logger.warn(`[BackgroundTaskWatcher] 更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`);
           }
          taskModelAttempts.delete(taskId);
        } else {
          // probeResult is string (session idle, task completed)
          // Type guard: at this point probeResult is guaranteed to be string
          const output = probeResult as string;
          const asyncHasSignal = hasCompletionSignal(output);
          const now = Date.now();
          const updated: BackgroundTaskEntry = {
            ...task,
            status: 'completed',
            result: output,
            completedAt: now,
            slotReleased: task.slotReleased ?? false,
            _errorCount: 0,
          };
          registry.set(taskId, updated);

          if (!updated.slotReleased && updated.status !== 'running') {
            releaseSubagentSlot(task.subagentType);
            updated.slotReleased = true;
            registry.set(taskId, updated);
          }

          try {
            const nm = createNotificationManager({ changeDir: task.changeDir || '' });
            await nm.writeNotification({
              type: 'async_completed',
              subagent: task.subagentType,
              task_id: taskId,
              session_id: task.sessionID,
              summary: output.slice(0, 200),
              has_completion_signal: asyncHasSignal,
            });
          } catch (err) {
            Logger.warn(`[BackgroundTaskWatcher] 写入完成通知失败: ${err instanceof Error ? err.message : String(err)}`);
          }

          try {
            const store = createSubagentStore({ changeDir: task.changeDir || '' });
            const agents = await store.listAgents();
            const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
            if (matchedAgent) {
              await store.updateOutput(matchedAgent.agent_id, output);
              await store.appendEvent(matchedAgent.agent_id, {
                timestamp: new Date().toISOString(),
                event_type: 'completed',
                detail: `Async task ${taskId} completed`,
              });
            }
          } catch (err) {
            Logger.warn(`[BackgroundTaskWatcher] 更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        Logger.warn(`[BackgroundTaskWatcher] 检查任务失败: ${err instanceof Error ? err.message : String(err)}`);
        const currentTaskForError = registry.get(taskId);
        if (currentTaskForError && currentTaskForError.status === 'running') {
          const now = Date.now();
          const errorCount = currentTaskForError._errorCount ?? 0;

          if (errorCount >= 3) {
            // F-2: Re-fetch latest state before updating to avoid overwriting concurrent changes
            const latestTaskBeforeUpdate = registry.get(taskId);
            if (latestTaskBeforeUpdate && latestTaskBeforeUpdate.status === 'running') {
              const updated: BackgroundTaskEntry = {
                ...latestTaskBeforeUpdate,
                status: 'error',
                error: `Task monitoring failed after ${errorCount + 1} attempts: ${err instanceof Error ? err.message : String(err)}`,
                completedAt: now,
                slotReleased: latestTaskBeforeUpdate.slotReleased ?? false,
              };
              registry.set(taskId, updated);

              if (!updated.slotReleased && updated.status !== 'running') {
                releaseSubagentSlot(updated.subagentType);
                updated.slotReleased = true;
                registry.set(taskId, updated);
              }
            }
          } else {
            // F-2: Re-fetch latest state before updating to avoid overwriting concurrent changes
            const latestTaskBeforeUpdate = registry.get(taskId);
            if (latestTaskBeforeUpdate && latestTaskBeforeUpdate.status === 'running') {
              latestTaskBeforeUpdate._errorCount = errorCount + 1;
              registry.set(taskId, latestTaskBeforeUpdate);
            }
          }
        }
      } finally {
        const latest = registry.get(taskId);
        if (latest && latest._processing) {
          latest._processing = false;
          registry.set(taskId, latest);
        }
      }
    }
  }

  return {
    start() {
      if (intervalId !== null) return;
      intervalId = setInterval(checkTasks, pollIntervalMs);
    },
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}

export interface CallFlowAgentOptions {
  /** SFlow client for session management */
  client: SFlowClient;
  /** Background task registry (shared across tools in the same factory) */
  backgroundTaskRegistry: BackgroundTaskRegistry;
  /** Background task counter (shared across tools in the same factory) */
  backgroundTaskCounter: { value: number };
  /** Agent model map (populated during config hook) */
  agentModelMap: AgentModelMap;
  /** Session label prefix (e.g. "iFlow", "sFlow"). Can be a static string or a function that returns a string. */
  sessionLabelPrefix: string | ((subagentType: string, context: Record<string, unknown>) => string);
  /**
   * Validate that the given subagent_type is allowed.
   * Return an error message string if invalid, or null if valid.
   */
  validateAgent: (
    subagentType: string,
    context: Record<string, unknown>,
  ) => Promise<string | null> | string | null;
  /** Tool description prefix for the call_flow_agent tool */
  workflowName: string;
  /** Model profiles configuration (for tier-based model resolution) */
  modelProfiles?: import('./../agents/config-loader.js').ModelProfileConfig;
  /** Per-agent configuration overrides */
  configOverrides?: import('./../agents/types.js').AgentOverrides;
}

/**
 * Create the three call-flow-agent-related tool definitions:
 * - call_flow_agent: invoke a subagent (sync or async)
 * - flowagent_output: retrieve background task results
 * - flowagent_cancel: cancel a running background task
 */
export function createCallFlowAgentTools(
  options: CallFlowAgentOptions,
): Record<string, LocalToolDefinition> {
  const {
    client,
    backgroundTaskRegistry,
    backgroundTaskCounter,
    agentModelMap,
    sessionLabelPrefix,
    validateAgent,
    workflowName,
    modelProfiles,
    configOverrides,
  } = options;

  // Resolve session label: support both static string and dynamic function
  const resolveSessionLabel = (subagentType: string, context: Record<string, unknown>): string => {
    const prefix =
      typeof sessionLabelPrefix === 'function'
        ? sessionLabelPrefix(subagentType, context)
        : sessionLabelPrefix;
    return `${prefix} → ${subagentType}`;
  };

  const callFlowAgentTool: LocalToolDefinition = {
    description: `Invoke a specialized ${workflowName} subagent. Supports sync (run_in_background=false) and async (run_in_background=true) modes. Async mode returns a task_id; use flowagent_output to retrieve results when complete.`,
    args: {
      description: z.string().describe('Short (3-5 words) description of the task'),
      prompt: z.string().describe('The task for the subagent to perform'),
      subagent_type: z
        .string()
        .describe(
          `The subagent to invoke (e.g. ${workflowName.toLowerCase()}-plan-executor, build-executor)`,
        ),
      run_in_background: z
        .boolean()
        .describe(
          'true=async (returns task_id for flowagent_output), false=sync (waits for completion)',
        ),
      session_id: z
        .string()
        .nullish()
        .describe('Existing session to continue (sync mode only)'),
      agent_id: z
        .string()
        .nullish()
        .describe(
          'Resume a previous subagent by agent_id. When provided, context from the previous run is injected into the prompt.',
        ),
      output_mode: z
        .enum(['last_message', 'structured'])
        .optional()
        .describe(
          'Output mode: last_message (default, return raw text) or structured (extract JSON block from output)',
        ),
      model_type: z
        .string()
        .optional()
        .describe(
          'Model tier to use for this call (lite/quick/standard/deep/ultra/review). Overrides agent static binding.',
        ),
    } as Record<string, unknown>,
    execute: async (args, context) => {
      const changeDir = resolveChangeDir(undefined, context.directory);
      const {
        subagent_type,
        prompt,
        run_in_background,
        session_id,
        description,
        agent_id,
        output_mode,
        model_type,
      } = args;

      // F3: 严格布尔归一化 — zod v3 schema 在宿主侧不生效校验，LLM 可能把
      // run_in_background 输出成字符串 "false"/"true"。字符串 "false" 在 JS 中
      // 为 truthy，会导致同步调用被误判为后台模式（返回 task_id / session_id 报错）。
      // 这里按语义转换为真正的 boolean。
      const isBackground =
        run_in_background === true || run_in_background === 'true'
          ? true
          : run_in_background === false || run_in_background === 'false'
            ? false
            : true;

      // F1: 防御性检查 — LLM 偶发未传 subagent_type 时给出清晰、可操作错误
      if (!subagent_type || typeof subagent_type !== 'string' || subagent_type.trim() === '') {
        return await formatToolError(
          `缺少必需的 subagent_type 参数。请始终显式指定要调用的子 agent 名称（例如 ${workflowName.toLowerCase()}-plan-executor、build-executor）。`,
        );
      }

      // F2: 禁止子 agent 再调用子 agent（仅主 orchestrator 可委派）
      const callerAgent = (context as { agent?: string }).agent;
      if (callerAgent && !['sflow', 'iflow'].includes(callerAgent.toLowerCase())) {
        return await formatToolError(
          `子 agent "${callerAgent}" 不允许调用 call_flow_agent。只有主 orchestrator（sFlow/iFlow）可以委派子 agent。`,
        );
      }

      // Validate agent name
      const validationError = await validateAgent(
        subagent_type as string,
        context as unknown as Record<string, unknown>,
      );
      if (validationError) {
        return await formatToolError(validationError);
      }

      if (model_type && !VALID_MODEL_TIERS.has(model_type as ModelTier)) {
        const validTiers = Array.from(VALID_MODEL_TIERS).join(', ');
        return await formatToolError(
          `Invalid model_type "${model_type}". Valid tiers are: ${validTiers}`,
        );
      }

      // Detect multi-wave packing in build-executor / iflow-plan-executor prompts (constraint violation)
      if (subagent_type === 'build-executor' || subagent_type === 'iflow-plan-executor') {
        const waveExecutionPattern = /(?:Execute|Run|Perform|Dispatch)\s+Wave\s+\d+/gi;
        const waveMatches = (prompt as string).match(waveExecutionPattern);
        const uniqueWaves = waveMatches ? new Set(waveMatches.map(w => w.toLowerCase())).size : 0;
        
        if (uniqueWaves > 1) {
          if (subagent_type === 'build-executor') {
            return await formatToolError(
              `Wave Orchestration Constraint Violation: Detected ${uniqueWaves} waves in single build-executor prompt. ` +
              `Waves MUST be dispatched one at a time with Review Gate checks between them. ` +
              `Please delegate waves sequentially: Wave 1 → Review Gate → Wave 2 → Review Gate → ...`
            );
          } else {
            return await formatToolError(
              `Wave Orchestration Constraint Violation: Detected ${uniqueWaves} waves in single iflow-plan-executor prompt. ` +
              `Waves MUST be dispatched one at a time. ` +
              `Please delegate waves sequentially: Wave 1 → Wave 2 → ...`
            );
          }
        }
      }

      const sessionLabel = resolveSessionLabel(
        subagent_type as string,
        context as unknown as Record<string, unknown>,
      );

      // P1: subagent-store 实例
      const store = createSubagentStore({ changeDir });

      try {
        let sessionID: string;
        let isNew = false;
        let effectivePrompt = prompt as string;

        // 归一化可选参数：null / 空字符串 / 字面量 "null" 均视为"未提供"。
        // 背景：LLM 主编排器有时会把可选参数显式填成 null 或字符串 "null"，
        // 若直接透传会导致无效的 resume（"Agent null not found in subagent-store"）
        // 或复用名为 "null" 的 session。这里统一降级为 undefined。
        const normalizedAgentId =
          typeof agent_id === 'string' && agent_id.trim() !== '' && agent_id !== 'null'
            ? agent_id
            : undefined;
        const normalizedSessionId =
          typeof session_id === 'string' && session_id.trim() !== '' && session_id !== 'null'
            ? session_id
            : undefined;

        let resolvedAgentId = normalizedAgentId;
        
        // Model resolution strategy:
        // - If model_type is specified: use resolveModelWithFallback to respect the full priority chain
        // - Otherwise: use agentModelMap (pre-resolved during config hook)
        let subagentModel: string;
        if (model_type) {
          // Use resolveModelWithFallback for model_type routing
          // This ensures model_type routing respects the full priority chain:
          // 1. configOverrides per-agent override (highest priority)
          // 2. model_type explicit parameter (tier signal)
          // 3. modelProfiles user-configured tier model
          // 4. DEFAULT_PROFILE_MODELS tier model
          // 5. Fallback chain (per-agent → tier → DEFAULT_PROFILE_MODELS → DEFAULT_FALLBACKS)

          // activeWorkflow is intentionally a constant 'sflow' here (no dynamic directory
          // detection): the gate condition (activeWorkflow === 'sflow' || 'iflow') treats
          // both values identically, so the model_type branch (Priority 3) result is
          // unaffected by the actual workflow context. A dynamic detectActiveWorkflow()
          // call would add filesystem I/O with zero behavioral difference.
          const result = resolveModelWithFallback(
            subagent_type as BuiltinAgentName,
            undefined,
            configOverrides,
            undefined,
            { modelProfiles, activeWorkflow: 'sflow' },
            model_type as string | undefined,
          );
          subagentModel = result.model;
        } else {
          // Use pre-resolved model from agentModelMap (populated during config hook)
          const modelFromMap = agentModelMap[subagent_type as string];
          if (!modelFromMap) {
            return await formatToolError(
              `No model configured for subagent "${subagent_type}". Available agents: ${Object.keys(agentModelMap).join(', ')}`,
            );
          }
          subagentModel = modelFromMap;
        }

        // P1: Resume 模式 — 传入 agent_id 时从 subagent-store 恢复上下文
        if (normalizedAgentId) {
          try {
            const resumeResult = await store.resumeAgent(normalizedAgentId, prompt as string);
            effectivePrompt = resumeResult.prompt;
            resolvedAgentId = normalizedAgentId;
          } catch (resumeErr) {
            const msg = resumeErr instanceof Error ? resumeErr.message : String(resumeErr);
            return await formatToolError(msg);
          }
        }

        if (normalizedSessionId) {
          if (isBackground) {
            return await formatToolError(
              'session_id is not supported in background mode. Use run_in_background=false to continue an existing session.',
            );
          }
          sessionID = normalizedSessionId;
        } else {

          const createResult = await (
            client.session.create as (args: {
              body: Record<string, unknown>;
              query?: Record<string, unknown>;
            }) => Promise<{ data?: { id?: string } }>
          )({
            body: {
              parentID: context.sessionID,
              title: sessionLabel,
              agent: subagent_type as string,
            },
            query: { directory: changeDir },
          });
          const id = createResult.data?.id;
          if (!id) {
            return await formatToolError('Failed to create subagent session');
          }
          sessionID = id;
          isNew = true;
        }

        // Wave 1: 注入 Change_Dir 标记
        const changeDirTag = `<Change_Dir>${changeDir}</Change_Dir>`;
        let finalPrompt = `${changeDirTag}\n\n${effectivePrompt}`;

        // P2: structured 模式下注入 schema hint
        if (output_mode === 'structured') {
          const hint = getSchemaHint(subagent_type as string);
          if (hint) {
            finalPrompt = `${finalPrompt}\n\n${hint}`;
          }
        }

        // Parse model string and validate format
        const parsedModel = parseModelString(subagentModel);
        if (!parsedModel) {
          return await formatToolError(
            `Invalid model format: "${subagentModel}". Expected "provider/modelID" (e.g., "provider/glm-5")`,
          );
        }

        // P1: 首次调用（无 session_id）时创建 agent store 记录（Wave 1 Task 2：上移至首次 prompt 之前，
        // 以便后续故障转移事件可在换模型时刻写入 agent store —— 记录不存在则事件无处可写）
        if (isNew && !resolvedAgentId) {
          resolvedAgentId = `agent_${Date.now()}_${subagent_type}`;
          try {
            await store.createAgent({
              agent_id: resolvedAgentId,
              subagent_type: subagent_type as string,
              session_id: sessionID,
              prompt: prompt as string,
            });
          } catch (err) {
            // subagent-store 创建失败不阻塞 agent 执行
            Logger.warn(`[CallFlowAgent] 创建 agent store 失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // ── Background 模式：发送首次 prompt 后立即返回 task_id（故障转移由 watcher/pollAndComplete 异步处理）──
        if (isBackground) {
          // Wave 1 Task 1：以 sendPromptOnce 发送首次 prompt（{ throwOnError: true } + try/catch）
          const firstSend = await sendPromptOnce(client, {
            sessionID,
            agent: subagent_type as string,
            text: finalPrompt,
            model: parsedModel,
          });

          // Wave 1 Task 2 / D-7：前置校验失败不拉黑不换模型，直接返回工具错误
          if (!firstSend.ok) {
            return await formatToolError(
              `Failed to send prompt (HTTP ${firstSend.status ?? 'unknown'}): ${firstSend.message ?? 'no detail'}. ` +
                `前置校验失败（SessionBusy / model not found / agent 不存在）不属于模型故障，未触发模型故障转移。`,
            );
          }

          // Check concurrency limit: max 3 parallel subagents of the same type
          if (!acquireSubagentSlot(subagent_type as string)) {
            return await formatToolError(
              `Concurrency limit reached for subagent "${subagent_type}". Maximum ${MAX_CONCURRENT_SUBAGENTS} parallel instances allowed. Wait for a running task to complete before starting another.`,
            );
          }

          const taskId = generateTaskId(backgroundTaskCounter);
          backgroundTaskRegistry.set(taskId, {
            sessionID,
            subagentType: subagent_type as string,
            status: 'running',
            createdAt: Date.now(),
            output_mode: output_mode as 'last_message' | 'structured' | undefined,
            changeDir,
            resolvedModel: subagentModel,
            modelType: model_type as string | undefined,
          });
          // Wave 2 Task 5：记录已尝试模型，供故障转移终止判定使用
          taskModelAttempts.set(taskId, [subagentModel]);

          // P1: 追加 started 事件
          if (resolvedAgentId) {
            try {
              await store.appendEvent(resolvedAgentId, {
                timestamp: new Date().toISOString(),
                event_type: 'started',
                detail: `Background task ${taskId} started`,
              });
            } catch (err) {
              // 事件追加失败不阻塞
              Logger.warn(`[CallFlowAgent] 追加事件失败: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          return {
            title: sessionLabel,
            output: JSON.stringify(
              {
                success: true,
                task_id: taskId,
                session_id: sessionID,
                status: 'running',
                description,
                agent: subagent_type,
              },
              null,
              2,
            ),
          };
        }

        // ── Sync 模式：runWithModelFallback 编排（prompt + 故障转移循环 + poll）──
        const fallbackResult = await runWithModelFallback({
          client,
          sessionID,
          agentName: subagent_type as string,
          basePrompt: finalPrompt,
          initialModel: subagentModel,
          maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS,
          directory: changeDir,
          poll: async () =>
            (await pollSessionCompletion(
              client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
              sessionID,
              { maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS, directory: changeDir },
            )) as string | null,
          onFallback: async (info) => {
            if (resolvedAgentId) {
              try {
                await store.appendEvent(resolvedAgentId, {
                  timestamp: new Date().toISOString(),
                  event_type: MODEL_FALLBACK_EVENT,
                  detail: `model fallback ${info.from} -> ${info.to} (attempt ${info.attempt}): ${info.reason}`,
                });
              } catch (err) {
                Logger.warn(
                  `[CallFlowAgent] 写入 model_fallback 事件失败: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }
          },
        });

        // 故障转移失败分支分派（D-4/D-6/D-7）
        if (!fallbackResult.success) {
          const syncTaskId = generateTaskId(backgroundTaskCounter);
          if (fallbackResult.failureReason === 'fatal' || fallbackResult.failureReason === 'invalid-model') {
            return await formatToolError(
              `模型调用失败 (${fallbackResult.detail ?? 'unknown'})：前置校验失败或模型格式非法，未触发模型故障转移。`,
            );
          }
          if (fallbackResult.failureReason === 'context-overflow') {
            return {
              title: sessionLabel,
              output: JSON.stringify(
                {
                  success: false,
                  subagent: subagent_type,
                  sessionID,
                  error:
                    'ContextOverflowError: 上下文溢出由 runtime auto-compaction 处理，未拉黑模型、未换模型重试',
                  attempted_models: fallbackResult.attemptedModels,
                },
                null,
                2,
              ),
            };
          }
          // exhausted：复用原 null 输出结构（status:'error' + success:false），补充可观测字段（D-8）
          backgroundTaskRegistry.set(syncTaskId, {
            sessionID,
            subagentType: subagent_type as string,
            status: 'error',
            error: 'Session retry exhausted or polling failed (model fallback exhausted)',
            createdAt: Date.now(),
            completedAt: Date.now(),
            slotReleased: false,
            resolvedModel: fallbackResult.model,
            modelType: model_type as string | undefined,
            fallbackAttempted: fallbackResult.attemptedModels,
          });
          return {
            title: sessionLabel,
            output: JSON.stringify(
              {
                success: false,
                subagent: subagent_type,
                sessionID,
                task_id: syncTaskId,
                error: 'Session retry exhausted or polling failed (model fallback exhausted)',
                attempted_models: fallbackResult.attemptedModels,
                model_fallbacks: fallbackResult.fallbacks,
              },
              null,
              2,
            ),
          };
        }

        // 故障转移成功：继续走原有完成检测流程
        let lastOutput: string = fallbackResult.output ?? '';

        // P3: 同步模式完成检测与重试
        // Type guard: in sync mode (no probeMode), lastOutput is string | null
        const syncOutput = lastOutput as string | null;
        const retryResult = await performCompletionRetry(
          syncOutput || '',
          // injectReminder: 注入 system reminder 到 session
          async () => {
            await (
              client.session.prompt as (args: {
                path: { id: string };
                body: Record<string, unknown>;
              }) => Promise<unknown>
            )({
              path: { id: sessionID },
              body: {
                agent: subagent_type as string,
                parts: REMINDER_MESSAGE.parts,
                model: parseModelString(fallbackResult.model),
              },
            });
          },
          // pollOutput: 重新轮询子 agent 输出
          async () => {
            const result = await pollSessionCompletion(
              client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
              sessionID,
              { maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS, directory: changeDir },
            );
            // Type guard: in sync mode (no probeMode), result is string | null
            return result as string | null;
          },
          undefined,
          subagent_type as string, // 传入 agent 类型，豁免列表中的 agent 跳过重试
        );
        lastOutput = retryResult.output;
        const completionWarning = retryResult.warning;

        const syncTaskId = generateTaskId(backgroundTaskCounter);
        backgroundTaskRegistry.set(syncTaskId, {
          sessionID,
          subagentType: subagent_type as string,
          status: 'completed',
          result: lastOutput,
          createdAt: Date.now(),
          completedAt: Date.now(),
          // Wave 2 Task 4 / D-8：registry 写入最终生效模型与故障转移链，供追踪与重试一致性
          resolvedModel: fallbackResult.model,
          modelType: model_type as string | undefined,
          fallbackAttempted: fallbackResult.attemptedModels,
        });

        // P3: 检测完成信号状态（用于通知）
        const hasSignal = hasCompletionSignal(typeof lastOutput === 'string' ? lastOutput : '');

        // P0: 同步模式完成时写入通知
        try {
          const nm = createNotificationManager({ changeDir });
          await nm.writeNotification({
            type: 'sync_completed',
            subagent: subagent_type as string,
            task_id: syncTaskId,
            session_id: sessionID,
            summary: typeof lastOutput === 'string' ? lastOutput.slice(0, 200) : '(no output)',
            has_completion_signal: hasSignal,
          });
        } catch (err) {
          // 通知写入失败不阻塞 agent 结果返回
          Logger.warn(`[CallFlowAgent] 同步模式写入通知失败: ${err instanceof Error ? err.message : String(err)}`);
        }

        // P1: 同步模式完成时更新 subagent-store
        if (resolvedAgentId) {
          try {
            await store.updateOutput(
              resolvedAgentId,
              typeof lastOutput === 'string' ? lastOutput : '',
            );
            await store.appendEvent(resolvedAgentId, {
              timestamp: new Date().toISOString(),
              event_type: 'completed',
              detail: `Sync task ${syncTaskId} completed`,
            });
          } catch (err) {
            // subagent-store 更新失败不阻塞 agent 结果返回
            Logger.warn(`[CallFlowAgent] 同步模式更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // P2: structured 模式下提取 JSON block
        const structuredOutput =
          output_mode === 'structured'
            ? extractJsonBlock(typeof lastOutput === 'string' ? lastOutput : '')
            : undefined;

        // NH-3: structured 提取失败时传播 warning
        const structuredWarning =
          output_mode === 'structured' && structuredOutput === null
            ? 'structured output extraction failed, fallback to raw text'
            : undefined;

        // NH-3: 合并所有 warnings 为数组（避免字段覆盖）
        const syncWarnings: string[] = [];
        if (completionWarning) syncWarnings.push(completionWarning);
        if (structuredWarning) syncWarnings.push(structuredWarning);

        return {
          title: sessionLabel,
          output: JSON.stringify(
            {
              success: true,
              subagent: subagent_type,
              sessionID,
              task_id: syncTaskId,
              output: lastOutput,
              // Wave 2 Task 4 / D-8：暴露实际生效模型与故障转移链
              model: fallbackResult.model,
              ...(fallbackResult.fallbacks.length > 0 && { model_fallbacks: fallbackResult.fallbacks }),
              ...(structuredOutput !== undefined && { structured_output: structuredOutput }),
              ...(syncWarnings.length > 0 && { warnings: syncWarnings }),
            },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          title: sessionLabel,
          output: JSON.stringify(
            {
              success: false,
              subagent: subagent_type,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        };
      }
    },
  };

  const flowagentOutputTool: LocalToolDefinition = {
    description: `Retrieve results from a background ${workflowName} subagent task (call_flow_agent async mode). Poll with block=true to wait for completion (timeout: 120s); the tool returns immediately with current status when block=false. Call this after dispatching an async task to fetch its result.`,
    args: {
      task_id: z
        .string()
        .describe('The task ID returned by call_flow_agent (run_in_background=true, prefix: sf_)'),
      block: z.boolean().nullish().describe('Wait for completion (default: false)'),
    } as Record<string, unknown>,
    execute: async (args: Record<string, unknown>, _context) => {
      // F2: 禁止子 agent 再调用子 agent（仅主 orchestrator 可委派）
      const callerAgent = (_context as { agent?: string }).agent;
      if (callerAgent && !['sflow', 'iflow'].includes(callerAgent.toLowerCase())) {
        return {
          title: 'FlowAgent Output',
          output: JSON.stringify(
            { success: false, error: `子 agent "${callerAgent}" 不允许调用 flowagent_output。只有主 orchestrator（sFlow/iFlow）可以委派子 agent。` },
            null,
            2,
          ),
        };
      }
      const { task_id, block } = args as { task_id: string; block?: boolean | null };
      // nullish 归一化：仅当显式 block === true 时才等待，其余（undefined/null/false）按默认 false 处理
      const shouldBlock = block === true;
      const changeDir = resolveChangeDir(undefined, _context.directory);

      const pollAndComplete = async (task: BackgroundTaskEntry): Promise<BackgroundTaskEntry> => {
        const currentTask = backgroundTaskRegistry.get(task_id);

        // G1: 显式处理 currentTask 不存在的情况（防止任务"复活"）
        if (!currentTask) {
          return {
            ...task,
            status: 'error',
            error: 'Task not found in registry',
            completedAt: Date.now(),
            slotReleased: task.slotReleased ?? false,
          };
        }

        // G2: 提前返回分支的 _processing 语义显式化
        // _processing=true 表示 watcher/pollAndComplete 正在处理中，本分支不清理该标志（由处理方 finally 负责）
        // status 非 running 表示已完成/已错误，直接返回结果
        if (currentTask.status !== 'running' || currentTask._processing) {
          return currentTask;
        }

        currentTask._processing = true;
        backgroundTaskRegistry.set(task_id, currentTask);

        try {
          let output = await pollSessionCompletion(
            client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
            task.sessionID,
            { maxWaitMs: DEFAULT_MAX_WAIT_MS, directory: changeDir },
          );

          const now = Date.now();

          // Wave 2 Task 5：尝试模型故障转移（换模型重 prompt），循环直至成功/耗尽。
          // 设计：保持 running、不释放并发槽位；耗尽后才走原错误路径（D-4 未命中前不宣告失败）。
          let fb = await tryAsyncModelFallback({ client, registry: backgroundTaskRegistry, taskId: task_id, changeDir });
          let fbSafety = 0;
          while (fb.retried && fbSafety <= MAX_MODEL_RETRIES + 2) {
            fbSafety++;
            const rePoll = await pollSessionCompletion(
              client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
              task.sessionID,
              { maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS, directory: changeDir },
            );
            if (rePoll !== null) {
              output = rePoll as string;
              fb = { retried: false } as { retried: false };
              break;
            }
            fb = await tryAsyncModelFallback({ client, registry: backgroundTaskRegistry, taskId: task_id, changeDir });
          }

          if (fb.retried) {
            // 故障转移进行中仍 running：保持任务运行、不释放槽位，返回 running（交给 watcher 后续探测）
            const runningEntry: BackgroundTaskEntry = {
              ...task,
              status: 'running',
              _errorCount: 0,
            };
            backgroundTaskRegistry.set(task_id, runningEntry);
            return runningEntry;
          }

          // 故障转移后使用最新 registry 快照（含新 resolvedModel），再走成功/错误路径
          const latestEntry = backgroundTaskRegistry.get(task_id);
          if (latestEntry) task = latestEntry;

          let updated: BackgroundTaskEntry;
          if (output === null) {
            updated = {
              ...task,
              status: 'error',
              error: 'Session retry exhausted or polling failed',
              completedAt: now,
              slotReleased: task.slotReleased ?? false,
            };
            backgroundTaskRegistry.set(task_id, updated);

            if (!updated.slotReleased) {
              releaseSubagentSlot(task.subagentType);
              updated.slotReleased = true;
              backgroundTaskRegistry.set(task_id, updated);
            }

            try {
              const nm = createNotificationManager({ changeDir });
              await nm.writeNotification({
                type: 'async_error',
                subagent: task.subagentType,
                task_id,
                session_id: task.sessionID,
                summary: 'Task failed: session retry exhausted or polling failed',
              });
            } catch (err) {
              Logger.warn(`[CallFlowAgent] 异步模式写入错误通知失败: ${err instanceof Error ? err.message : String(err)}`);
            }

            try {
              const asyncStore = createSubagentStore({ changeDir });
              const agents = await asyncStore.listAgents();
              const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
              if (matchedAgent) {
                await asyncStore.updateOutput(matchedAgent.agent_id, '', { status: 'error' });
                await asyncStore.appendEvent(matchedAgent.agent_id, {
                  timestamp: new Date().toISOString(),
                  event_type: 'error',
                  detail: `Async task ${task_id} failed: session retry exhausted or polling failed`,
                });
              }
            } catch (err) {
              Logger.warn(`[CallFlowAgent] 异步模式更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`);
            }

            taskModelAttempts.delete(task_id);
            return updated;
          }

          // Type guard: in pollAndComplete (no probeMode), output is string
          const asyncOutput = output as string;
          const asyncHasSignal = hasCompletionSignal(asyncOutput);
          const finalOutput = asyncOutput || '(no output)';
          updated = {
            ...task,
            status: 'completed',
            result: finalOutput,
            completedAt: now,
            slotReleased: task.slotReleased ?? false,
            _errorCount: 0,
          };
          backgroundTaskRegistry.set(task_id, updated);

          if (!updated.slotReleased) {
            releaseSubagentSlot(task.subagentType);
            updated.slotReleased = true;
            backgroundTaskRegistry.set(task_id, updated);
          }

          try {
            const nm = createNotificationManager({ changeDir });
            await nm.writeNotification({
              type: 'async_completed',
              subagent: task.subagentType,
              task_id,
              session_id: task.sessionID,
              summary: asyncOutput.slice(0, 200),
              has_completion_signal: asyncHasSignal,
            });
          } catch (err) {
            Logger.warn(`[CallFlowAgent] 异步模式写入通知失败: ${err instanceof Error ? err.message : String(err)}`);
          }

          try {
            const asyncStore = createSubagentStore({ changeDir });
            const agents = await asyncStore.listAgents();
            const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
            if (matchedAgent) {
              await asyncStore.updateOutput(
                matchedAgent.agent_id,
                typeof finalOutput === 'string' ? finalOutput : '',
              );
              await asyncStore.appendEvent(matchedAgent.agent_id, {
                timestamp: new Date().toISOString(),
                event_type: 'completed',
                detail: `Async task ${task_id} completed`,
              });
            }
          } catch (err) {
            Logger.warn(`[CallFlowAgent] 异步模式更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`);
          }

          taskModelAttempts.delete(task_id);
          return updated;
        } catch (err) {
          // F-1: Handle pollSessionCompletion exceptions (network errors, etc.)
          Logger.warn(`[CallFlowAgent] pollAndComplete failed: ${err instanceof Error ? err.message : String(err)}`);
          
          const now = Date.now();
          const errorMessage = err instanceof Error ? err.message : String(err);
          
          const updated: BackgroundTaskEntry = {
            ...task,
            status: 'error',
            error: `Polling failed: ${errorMessage}`,
            completedAt: now,
            slotReleased: task.slotReleased ?? false,
          };
          backgroundTaskRegistry.set(task_id, updated);

          if (!updated.slotReleased) {
            releaseSubagentSlot(task.subagentType);
            updated.slotReleased = true;
            backgroundTaskRegistry.set(task_id, updated);
          }

          try {
            const nm = createNotificationManager({ changeDir });
            await nm.writeNotification({
              type: 'async_error',
              subagent: task.subagentType,
              task_id,
              session_id: task.sessionID,
              summary: `Task failed: polling error - ${errorMessage}`,
            });
          } catch (notificationErr) {
            Logger.warn(`[CallFlowAgent] 异步模式写入错误通知失败: ${notificationErr instanceof Error ? notificationErr.message : String(notificationErr)}`);
          }

          try {
            const asyncStore = createSubagentStore({ changeDir });
            const agents = await asyncStore.listAgents();
            const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
            if (matchedAgent) {
              await asyncStore.updateOutput(matchedAgent.agent_id, '', { status: 'error' });
              await asyncStore.appendEvent(matchedAgent.agent_id, {
                timestamp: new Date().toISOString(),
                event_type: 'error',
                detail: `Async task ${task_id} failed: polling error - ${errorMessage}`,
              });
            }
          } catch (storeErr) {
            Logger.warn(`[CallFlowAgent] 异步模式更新 subagent-store 失败: ${storeErr instanceof Error ? storeErr.message : String(storeErr)}`);
          }

          taskModelAttempts.delete(task_id);
          return updated;
        } finally {
          const latest = backgroundTaskRegistry.get(task_id);
          if (latest && latest._processing) {
            latest._processing = false;
            backgroundTaskRegistry.set(task_id, latest);
          }
        }
      };

      const buildResponse = (task: BackgroundTaskEntry) => {
        // P2: structured 模式下提取 JSON block
        const structuredOutput =
          task.output_mode === 'structured'
            ? extractJsonBlock(typeof task.result === 'string' ? task.result : '')
            : undefined;

        // NH-3: structured 提取失败时传播 warning
        const structuredWarning =
          task.output_mode === 'structured' && structuredOutput === null
            ? 'structured output extraction failed, fallback to raw text'
            : undefined;

        // NH-3: 合并所有 warnings 为数组（避免字段覆盖）
        const asyncWarnings: string[] = [];
        if (task.warning) asyncWarnings.push(task.warning);
        if (structuredWarning) asyncWarnings.push(structuredWarning);

        return {
          title: 'FlowAgent Output',
          output: JSON.stringify(
            {
              success: task.status !== 'error',
              task_id,
              status: task.status,
              session_id: task.sessionID,
              result: task.result,
              error: task.error,
              ...(structuredOutput !== undefined && { structured_output: structuredOutput }),
              ...(asyncWarnings.length > 0 && { warnings: asyncWarnings }),
            },
            null,
            2,
          ),
        };
      };

      try {
        const existingTask = backgroundTaskRegistry.get(task_id);
        if (!existingTask) {
          return {
            title: 'FlowAgent Output',
            output: JSON.stringify({ success: false, error: `Task ${task_id} not found` }, null, 2),
          };
        }

        if (!shouldBlock) {
          return buildResponse(existingTask);
        }

        const completed =
          existingTask.status !== 'running' ? existingTask : await pollAndComplete(existingTask);
        return buildResponse(completed);
      } catch (error) {
        return {
          title: 'FlowAgent Output',
          output: JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        };
      }
    },
  };

  const flowagentCancelTool: LocalToolDefinition = {
    description: `Cancel a running ${workflowName} subagent task by task_id (call_flow_agent async mode). Use this when you no longer need the result.`,
    args: {
      taskId: z.string().describe('Task ID to cancel (required, prefix: sf_)'),
    } as Record<string, unknown>,
    execute: async (args: Record<string, unknown>, _context) => {
      // F2: 禁止子 agent 再调用子 agent（仅主 orchestrator 可委派）
      const callerAgent = (_context as { agent?: string }).agent;
      if (callerAgent && !['sflow', 'iflow'].includes(callerAgent.toLowerCase())) {
        return {
          title: 'FlowAgent Cancel',
          output: JSON.stringify(
            { success: false, error: `子 agent "${callerAgent}" 不允许调用 flowagent_cancel。只有主 orchestrator（sFlow/iFlow）可以委派子 agent。` },
            null,
            2,
          ),
        };
      }
      const { taskId } = args as { taskId: string };
      try {
        const task = backgroundTaskRegistry.get(taskId);
        if (!task) {
          return {
            title: 'FlowAgent Cancel',
            output: JSON.stringify({ success: false, error: `Task ${taskId} not found` }, null, 2),
          };
        }
        if (task.status !== 'running') {
          return {
            title: 'FlowAgent Cancel',
            output: JSON.stringify(
              { success: true, message: `Task ${taskId} already in status: ${task.status}` },
              null,
              2,
            ),
          };
        }

        try {
          await client.session.abort({ path: { id: task.sessionID } });
        } catch (err) {
          // session.abort may not be available; mark cancelled anyway
          Logger.warn(`[CallFlowAgent] 取消 session 失败: ${err instanceof Error ? err.message : String(err)}`);
        }

        // P1-A: Check slotReleased to prevent double release
        if (!task.slotReleased) {
          releaseSubagentSlot(task.subagentType);
        }
        backgroundTaskRegistry.delete(taskId);
        taskModelAttempts.delete(taskId);
        return {
          title: 'FlowAgent Cancel',
          output: JSON.stringify(
            { success: true, message: `Task ${taskId} cancelled and removed` },
            null,
            2,
          ),
        };
      } catch (error) {
        return {
          title: 'FlowAgent Cancel',
          output: JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2,
          ),
        };
      }
    },
  };

  const watcher = createBackgroundTaskWatcher({
    client,
    registry: backgroundTaskRegistry,
    pollIntervalMs: 200,
  });
  watcher.start();

  // P0-3: Expose watcher.stop() for resource cleanup (prevents interval leak in tests)
  const tools: Record<string, LocalToolDefinition> & { _stopWatcher?: () => void } = {
    call_flow_agent: callFlowAgentTool,
    flowagent_output: flowagentOutputTool,
    flowagent_cancel: flowagentCancelTool,
  };
  
  // Attach _stopWatcher for test cleanup (not part of LocalToolDefinition, excluded from return type)
  tools._stopWatcher = () => watcher.stop();

  return tools as Record<string, LocalToolDefinition>;
}
