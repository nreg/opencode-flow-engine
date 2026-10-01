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
  hasRealOutput,
  performCompletionRetry,
  REMINDER_MESSAGE,
  classifyModelErrorByCode,
  shouldClassifyOutput,
} from '../helpers/completion-detector.js';
import {
  canRecoverFromPollError,
  createFallbackState,
  extractLastAssistantText,
  getNextCandidate,
  isExhausted,
  recordAttempt,
  resolveProbeVerdict,
} from '../helpers/fallback-state.js';
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
import { formatToolError, generateTaskId, PROBE_PENDING, type ProbePending } from '../types.js';
import type { LocalToolDefinition } from '../types/local-tool-definition.js';
import {
  resolveModelWithFallback,
  getAlternativeModel,
  markModelUnavailable,
  buildAgentFallbackChain,
  isModelAvailable,
  MIN_QUOTA_COOLDOWN_TTL_MS,
  TRANSIENT_COOLDOWN_TTL_MS,
  VALID_MODEL_TIERS,
  type ModelTier,
} from '../agents/agent-builder.js';
import type { AgentOverrides } from '../agents/types.js';
import type { SFlowConfig } from '../agents/config-loader.js';
import type { BuiltinAgentName } from '../agents/types.js';
import { Logger } from '../utils/logger.js';

/** Maximum concurrent subagent sessions of the same type */
const MAX_CONCURRENT_SUBAGENTS = 3;

/**
 * 模型故障转移次数上限（Wave 1 定义，Wave 2 的循环使用）。
 * 语义：首模型 + 最多 2 次换模型 = 最多 3 次 prompt 尝试。
 * 理由：OpenCode 已在同一模型上重试 5 次，插件层叠加过多会显著拉长等待；
 * 换模次数必须封顶以避免无限换模循环与成本失控。注意：候选 fallback 链长度现由
 * 用户配置决定（已无内置 fallback 列表），因此上限只能由本常量显式固定。
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
 * D-5：fallback 换模型重试**原样重发** basePrompt（直通，不拼接任何前置声明）。
 *
 * 重试是同 session 换 model 重新 prompt，session 本身已携带全部上下文，
 * 因此无需"接管轮次"声明。此函数保留为直通函数，便于集中维护重试发送策略。
 */
function buildAttemptPrompt(
  basePrompt: string,
  _attemptIndex: number,
  _previousModel?: string,
): string {
  return basePrompt;
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
async function readLastAssistantErrorName(
  client: SFlowClient,
  sessionID: string,
): Promise<string | undefined> {
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

/**
 * P2-3 恢复层（omo fetchSyncResult 借鉴）：从 session.messages 提取"最后一条
 * assistant 消息的最终文本"作为可恢复产出候选。
 *
 * 返回 null 表示无可恢复产出（最新 assistant 回合带 error / 无可读 text part /
 * session.messages 读取失败）。提取结果须再由调用方过 hasRealOutput 正向判定，
 * 假产出不采纳、仍走换模路径。
 */
async function readRecoverableOutput(
  client: SFlowClient,
  sessionID: string,
): Promise<string | null> {
  try {
    const res = await (
      client as unknown as {
        session: { messages(args: { path: { id: string } }): Promise<{ data?: unknown }> };
      }
    ).session.messages({ path: { id: sessionID } });
    return extractLastAssistantText(res.data);
  } catch {
    return null;
  }
}

/** P0-1：产出无完成信号时的统一失败说明（原文在 output / result / raw_output 中保留） */
const NO_VALID_OUTPUT_DETAIL =
  'output has no completion signal; treated as failure (raw output preserved)';

/**
 * P1-3：用户/系统取消（Abort）对应的 assistant 错误名白名单。
 *
 * 错误名核实结论（ADR-4，已在依赖中核实）：OpenCode SDK v2
 *（`node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts:221`）中
 * `AssistantMessage.info.error.name` 的合法联合枚举为 8 个字面量：
 * `ProviderAuthError` / `UnknownError` / `MessageOutputLengthError` /
 * `MessageAbortedError` / `StructuredOutputError` / `ContextOverflowError` /
 * `ContentFilterError` / `ApiError`。
 * 与"取消/中止"对应的是 `MessageAbortedError`（注意：此前提及的 `APIError` 实际拼写应为
 * `ApiError`；审查报告提到的 `OutputAbortedError` 在本 SDK 中并不存在，故不纳入）。
 * 下方 D-6 检查所用的 `ContextOverflowError` 即出自此枚举，属合法错误名（非死代码，不可删除）。
 * `AbortError` 作为兼容项保留（OpenCode 包装层/未来版本可能注入标准 AbortError）。
 *
 * 比对方式必须是**精确相等**（禁止 `/abort/i` 之类的包含式匹配与错误文案正则，C-6），
 * 以保证正常模型错误名不会被误判为取消。
 */
export const ABORT_ERROR_NAMES: string[] = ['MessageAbortedError', 'AbortError'];

/** P1-3：取消语义的判定（精确相等，零误伤） */
function isAbortErrorName(errName: string | undefined): boolean {
  return errName !== undefined && ABORT_ERROR_NAMES.includes(errName);
}

interface RunFallbackResult {
  success: boolean;
  output: string | null;
  model: string;
  attemptedModels: string[];
  fallbacks: Array<{ from: string; to: string; reason: string }>;
  failureReason?:
    | 'exhausted'
    | 'context-overflow'
    | 'fatal'
    | 'invalid-model'
    | 'no-valid-output'
    | 'aborted'
    | 'timeout-pending';
  detail?: string;
}

/**
 * 模型故障转移编排器（D-2/D-3/D-4/D-5/D-6/D-7/D-8）。
 *
 * 循环：send → poll。poll 返回 null（OpenCode 已在同一模型重试 5 次后确认失败）即最强"该模型不可用"判据。
 *  - D-3：换模型只用 `getAlternativeModel`（禁用 `resolveModelWithFallback` 的 P1/P2/P7 无黑名单检查分支）
 *  - D-4：三重终止 —— ① 无替代模型 ② 重复模型 ③ `attemptedModels.length > MAX_MODEL_RETRIES`
 *  - D-5：同 session 换 model 重新 prompt，重试**原样重发** basePrompt，上下文由 session 承载
 *  - D-6：ContextOverflowError 既不拉黑也不换模型
 *  - D-7：前置校验失败（send 不 ok）直接终止，不拉黑不换模型
 *  - D-8：模型故障 → `markModelUnavailable` 拉黑
 *
 * MAX_MODEL_RETRIES = 2 语义：首模型 + 最多 2 次换模型 = 最多 3 次 prompt 调用（非"最多 2 次调用"）。
 */
export async function runWithModelFallback(params: {
  client: SFlowClient;
  sessionID: string;
  agentName: string;
  basePrompt: string;
  initialModel: string;
  maxWaitMs: number;
  directory: string;
  /** P1-1: 用户配置 fallback 链（configOverrides/modelProfiles 构建结果） */
  extraFallbacks?: string[];
  /**
   * poll 产出。返回 PROBE_PENDING（polling 层判定「窗口超时但会话仍在 busy/retry」）
   * 时，编排器 MUST 不拉黑、不换模、不重发——慢而健康的模型不因固定窗口超时定罪
   *（R3-fix P1-1，对齐 pollAndComplete re-poll 的 probeMode 语义）。
   */
  poll: (sessionID: string, model: string) => Promise<string | null | ProbePending>;
  onFallback?: (info: {
    from: string;
    to: string;
    attempt: number;
    reason: string;
  }) => Promise<void> | void;
}): Promise<RunFallbackResult> {
  const {
    client,
    sessionID,
    agentName,
    basePrompt,
    initialModel,
    poll,
    onFallback,
    extraFallbacks,
  } = params;
  let currentModel = initialModel;
  const fallbacks: Array<{ from: string; to: string; reason: string }> = [];
  // P0-4/P1-1: 换模时读取用户配置 fallback 链（getNextCandidate 只在用户配置的候选内挑选；
  // 已无内置 fallback 列表，用户未配置时无候选可换）
  const userFallbackChain: string[] = extraFallbacks ?? [];
  // P3-3: 使用共享 FallbackState 状态机追踪 attemptedModels
  const state = createFallbackState(initialModel, userFallbackChain);

  // MAX_MODEL_RETRIES = 2 ⇒ 最多 3 次 prompt：首次 + 2 次换模型。
  for (let attempt = 0; ; attempt++) {
    const parsed = parseModelString(currentModel);
    if (!parsed) {
      return {
        success: false,
        failureReason: 'invalid-model',
        attemptedModels: state.attemptedModels,
        fallbacks,
        output: null,
        model: currentModel,
      };
    }
    // P3-3: state.attemptedModels 已由 createFallbackState 初始化含首模型

    // NEW-P1-D: 记录实际发送文本，回显比对以实际发送的 prompt 为基准（重试原样重发）
    const sentText = buildAttemptPrompt(
      basePrompt,
      attempt,
      attempt > 0 ? state.attemptedModels[attempt - 1] : undefined,
    );
    const send = await sendPromptOnce(client, {
      sessionID,
      agent: agentName,
      text: sentText,
      model: parsed,
    });
    if (!send.ok) {
      // 错误码驱动分类（主判据，依据 provider-scaffold 提供商错误码规范）：
      // - 非瞬态（402/403/401/404 或配额文本）：isRetryable=false → 立即换模 + 长冷却拉黑（重试无意义）
      // - 瞬态（429/408/409/5xx）：换模 + 5min 短拉黑（OpenCode 的 provider 级重试已耗尽才会走到这里）
      // - 400（SessionBusy 等请求级错误）与未识别错误：保持 fatal 终止
      const codeOnSend = classifyModelErrorByCode(send.message ?? '', send.status);
      if (codeOnSend && codeOnSend.kind !== 'none') {
        const transient = codeOnSend.kind === 'transient';
        markModelUnavailable(currentModel, {
          resetAt: transient ? null : codeOnSend.resetAt,
          ttlMs: transient
            ? TRANSIENT_COOLDOWN_TTL_MS
            : codeOnSend.resetAt
              ? undefined
              : MIN_QUOTA_COOLDOWN_TTL_MS,
        });
        const nextOnSend = getNextCandidate(state, isModelAvailable);
        if (nextOnSend && !isExhausted(state, MAX_MODEL_RETRIES)) {
          recordAttempt(state, nextOnSend);
          const reason = `${codeOnSend.kind} model error (HTTP ${codeOnSend.status ?? send.status ?? 'unknown'})`;
          fallbacks.push({ from: currentModel, to: nextOnSend, reason });
          await onFallback?.({ from: currentModel, to: nextOnSend, attempt: attempt + 1, reason });
          currentModel = nextOnSend;
          continue;
        }
        // P1-1：模型错误（有码）但换模不可行（无替代 / 已尝试 / 超上限）→ exhausted，
        // 与"请求级错误"的 fatal 语义分离，排障方向不再被误引向配置问题
        return {
          success: false,
          failureReason: 'exhausted',
          detail: `model error (HTTP ${codeOnSend.status ?? send.status ?? 'unknown'}); fallback chain exhausted or model already attempted`,
          attemptedModels: state.attemptedModels,
          fallbacks,
          model: currentModel,
          output: null,
        };
      }
      // D-7：前置校验失败（HTTP 400：SessionBusy / agent 不存在等请求级错误，或无法换模）直接终止，
      // 不拉黑、不换模型。仅在无错误码（kind === 'none'）时到达。
      return {
        success: false,
        failureReason: 'fatal',
        detail: `HTTP ${send.status ?? 'unknown'}`,
        attemptedModels: state.attemptedModels,
        fallbacks,
        model: currentModel,
        output: null,
      };
    }

    const output = await poll(sessionID, currentModel);
    if (output === PROBE_PENDING) {
      // R3-fix P1-1: poll 窗口超时但会话仍在 busy/retry——模型慢而健康，不拉黑、
      // 不换模、不重发。以 timeout-pending 失败终结，交还编排器
      //（session 仍在运行，编排器可稍后通过 flowagent_output 取结果）。
      return {
        success: false,
        failureReason: 'timeout-pending',
        detail:
          'sync poll window exceeded while session still running; model not blacklisted (session may still be producing)',
        output: null,
        model: currentModel,
        attemptedModels: state.attemptedModels,
        fallbacks,
      };
    }
    if (output !== null) {
      // P0-1: 实质性产出校验——错误码驱动分类（唯一判据）。错误码报错 / 用户 prompt 回显
      // 不算成功，转入 model-failure 分支。无错误码的报错无法分类是可接受的已知限制。
      // PROBE_PENDING 已在上方提前返回；TS 无法经 === 窄除对象字面量类型，此处显式标注为 string
      const pollOutput = output as string;
      // P2-1：收窄 poll 产出分类面——超长产出（如 code-reviewer 报告引用 "HTTP 429" /
      // `"status": 503`）视为正常产出，不做错误码分类，避免假性拉黑换模。
      // send 阶段错误消息不经过此守卫（错误通道判定不受影响）
      const codeOnPoll = shouldClassifyOutput(pollOutput)
        ? classifyModelErrorByCode(pollOutput)
        : null;
      const echoFailure = pollOutput.trim() === sentText.trim();
      if (codeOnPoll || echoFailure) {
        if (codeOnPoll?.kind === 'non-transient') {
          // 非瞬态：长冷却（重置时间 TTL；无重置时间给默认长 TTL 30min）+ 立即换模
          markModelUnavailable(currentModel, {
            resetAt: codeOnPoll.resetAt,
            ttlMs: codeOnPoll.resetAt ? undefined : MIN_QUOTA_COOLDOWN_TTL_MS,
          });
        } else if (codeOnPoll?.kind === 'transient') {
          // 瞬态：5min 短拉黑 + 立即换模
          markModelUnavailable(currentModel, { ttlMs: TRANSIENT_COOLDOWN_TTL_MS });
        }
        // P0-4: 错误识别接入换模——落入下方 model-failure 分支（markModelUnavailable + getAlternativeModel）
      } else if (!hasRealOutput(pollOutput)) {
        // P0-1：无机器可读错误码 + 无完成信号 → 不判成功，按失败返回（原文保留供编排器参考）。
        // 不拉黑、不换模、不重发：产出本身无信号并非模型故障证据。
        return {
          success: false,
          failureReason: 'no-valid-output',
          detail: NO_VALID_OUTPUT_DETAIL,
          output: pollOutput,
          model: currentModel,
          attemptedModels: state.attemptedModels,
          fallbacks,
        };
      } else {
        return {
          success: true,
          output: pollOutput,
          model: currentModel,
          attemptedModels: state.attemptedModels,
          fallbacks,
        };
      }
    }

    // D-6：ContextOverflow —— 不拉黑、不换模型，交给 runtime auto-compaction
    const errName = await readLastAssistantErrorName(client, sessionID);
    if (errName === 'ContextOverflowError') {
      return {
        success: false,
        failureReason: 'context-overflow',
        output: null,
        model: currentModel,
        attemptedModels: state.attemptedModels,
        fallbacks,
      };
    }

    // P1-3：用户/系统取消（Abort）与模型故障严格区分 —— 零降级：
    // 不拉黑（不调用 markModelUnavailable）、不换模（不调用 getAlternativeModel）、
    // 不重发 prompt。用户主动中止的任务若被自动换模重发，既违反用户意图又产生额外成本。
    // W4（P2-3）：abort 路径先于恢复层判定——恢复逻辑必须让位于 abort 零降级语义
    //（canRecoverFromPollError 对 abort 类错误名返回 false，此处已提前 return）。
    if (isAbortErrorName(errName)) {
      return {
        success: false,
        failureReason: 'aborted',
        detail: `assistant error: ${errName}; task aborted, no model fallback triggered`,
        output: null,
        model: currentModel,
        attemptedModels: state.attemptedModels,
        fallbacks,
      };
    }

    // W4（P2-3，omo sync-poll-error-recovery 借鉴）：poll 失败结果恢复层。
    // 背景：poll 返回 null（OpenCode 已重试耗尽）时，session 里可能已有完整的
    // assistant 产出——只是未带完成信号或会话状态未翻转。直接进入换模重发会浪费
    // 一次尝试，且换模复用同一 session 存在假设风险。参考实现先尝试从已完成
    // session 恢复结果（sync-result-fetcher.ts fetchSyncResult），恢复不了才新建
    // session 换模。
    // 触发条件：非 abort 类 poll 失败（canRecoverFromPollError 正向）。
    // 从 session.messages 提取最后一条 assistant 文本，过 hasRealOutput 正向判定
    //（完成信号正向判定约束：恢复产出与正常产出同门控）；通过则直接采用——
    // 不换模、不拉黑。恢复失败（无文本 / 最新回合为 error / 假产出）才走既有换模路径。
    if (canRecoverFromPollError(errName ?? '')) {
      const recovered = await readRecoverableOutput(client, sessionID);
      if (recovered !== null && hasRealOutput(recovered)) {
        return {
          success: true,
          output: recovered,
          model: currentModel,
          attemptedModels: state.attemptedModels,
          fallbacks,
        };
      }
      // 恢复失败：fall through 到下方案模型故障路径（不在此 return）
    }

    // D-2/D-8：模型故障 → 拉黑
    markModelUnavailable(currentModel);

    // 终止条件 ③：换模型次数上限（attemptedModels 已含本次失败，> MAX_MODEL_RETRIES 即停）
    if (isExhausted(state, MAX_MODEL_RETRIES)) {
      return {
        success: false,
        failureReason: 'exhausted',
        detail: 'MAX_MODEL_RETRIES reached',
        output: null,
        model: currentModel,
        attemptedModels: state.attemptedModels,
        fallbacks,
      };
    }

    // 终止条件 ①：无可用替代模型（D-3：必须用 getNextCandidate，不得用 resolveModelWithFallback；
    // P1-1：同时传入用户配置 fallback 链）
    const next = getNextCandidate(state, isModelAvailable);
    if (!next) {
      return {
        success: false,
        failureReason: 'exhausted',
        detail: 'no alternative model',
        output: null,
        model: currentModel,
        attemptedModels: state.attemptedModels,
        fallbacks,
      };
    }

    // 终止条件 ②：重复模型检测已由 getNextCandidate 内置（attemptedModels 过滤）

    const reason = errName ? `assistant error: ${errName}` : 'poll returned null (retry exhausted)';
    recordAttempt(state, next);
    fallbacks.push({ from: currentModel, to: next, reason });
    await onFallback?.({ from: currentModel, to: next, attempt: attempt + 1, reason });
    currentModel = next;
  }
}

// ─── Wave 2 (Task 5): async 模式故障转移 ──────────────────────────────────────

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
  /** P1-1: 用户配置 fallback 链（configOverrides/modelProfiles 构建结果） */
  extraFallbacks?: string[];
  /** NEW-P0-B: 配额错误信息（长冷却 TTL 语义）；kind='error' 时走默认短冷却 */
  quota?: { resetAt: number | null } | null;
}): Promise<{ retried: true; nextModel: string } | { retried: false }> {
  const { client, registry, taskId, changeDir, extraFallbacks, quota } = params;
  const task = registry.get(taskId);
  if (!task || !task.resolvedModel) return { retried: false };

  const parsed = parseModelString(task.resolvedModel);
  if (!parsed) return { retried: false };

  // P3-3: 使用 registry.attemptedModels 作为单源真值，废弃 taskModelAttempts Map
  const chain = extraFallbacks ?? [];
  const state = createFallbackState(task.resolvedModel, chain);
  state.attemptedModels = [...(task.attemptedModels ?? [])];
  if (!state.attemptedModels.includes(task.resolvedModel)) {
    state.attemptedModels.push(task.resolvedModel);
  }
  state.attemptCount = state.attemptedModels.length;

  // D-8：拉黑当前失败模型。
  // NEW-P0-B: 配额错误（有重置时间）→ 长冷却到重置时间；无重置时间 → 默认长 TTL（30min）；
  // 非 5min transient，且不会被后续默认 mark 覆盖（markModelUnavailable 单调取 max）。
  markModelUnavailable(task.resolvedModel, {
    resetAt: quota?.resetAt ?? null,
    ttlMs: quota && !quota.resetAt ? MIN_QUOTA_COOLDOWN_TTL_MS : undefined,
  });

  // D-3：换模型（禁止 resolveModelWithFallback）
  const next = getNextCandidate(state, isModelAvailable);
  if (!next) return { retried: false }; // 终止条件 ①

  // D-4：重复模型 / 超限检测
  if (state.attemptedModels.includes(next)) return { retried: false }; // 终止条件 ②
  if (state.attemptCount > MAX_MODEL_RETRIES) return { retried: false }; // 终止条件 ③

  const nextParsed = parseModelString(next);
  if (!nextParsed) return { retried: false };

  // D-5/P1-2：与 sync 路径统一——换模型重 prompt 原样重发 basePrompt（b10922e：重试原样重发，
  // 上下文由 session 承载，不含"接管轮次"声明）。basePrompt 取自 registry 条目上保存的原始 prompt。
  const send = await sendPromptOnce(client, {
    sessionID: task.sessionID,
    agent: task.subagentType,
    text: buildAttemptPrompt(
      registry.get(taskId)?.prompt ?? '',
      state.attemptCount,
      task.resolvedModel,
    ),
    model: nextParsed,
  });
  if (!send.ok) return { retried: false }; // D-7：前置校验失败不重试

  // 保持 running、不释放并发槽位（D-4 未命中前绝不宣告失败）
  recordAttempt(state, next);
  registry.set(taskId, {
    ...task,
    resolvedModel: next,
    status: 'running',
    attemptedModels: state.attemptedModels,
    _errorCount: 0,
  });

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

/**
 * P1-3：async 两路径（watcher / pollAndComplete）统一的 abort 终结逻辑。
 *
 * 与模型故障路径的差别是**零降级**：不拉黑模型、不换模型、不重发 prompt。
 * registry 复用既有 `status: 'error'`（ADR-4：不新增 'cancelled' 枚举，避免跨消费者契约变更），
 * 取消语义通过 error 文案显式声明。
 */
async function finalizeAbortedTask(params: {
  registry: BackgroundTaskRegistry;
  taskId: string;
  task: BackgroundTaskEntry;
  errName: string;
}): Promise<BackgroundTaskEntry> {
  const { registry, taskId, task, errName } = params;
  // 与故障转移路径一致：以 live registry 为基线，避免覆盖刚写入的 resolvedModel / attemptedModels
  const base = registry.get(taskId) ?? task;
  const message = `Task aborted (${errName}): no model fallback triggered`;
  const entry: BackgroundTaskEntry = {
    ...base,
    status: 'error',
    error: message,
    completedAt: Date.now(),
    slotReleased: base.slotReleased ?? false,
    _processing: false,
  };
  registry.set(taskId, entry);

  if (!entry.slotReleased) {
    releaseSubagentSlot(task.subagentType);
    entry.slotReleased = true;
    registry.set(taskId, entry);
  }

  try {
    const nm = createNotificationManager({ changeDir: task.changeDir || '' });
    await nm.writeNotification({
      type: 'async_error',
      subagent: task.subagentType,
      task_id: taskId,
      session_id: task.sessionID,
      summary: message,
    });
  } catch (err) {
    Logger.warn(
      `[CallFlowAgent] abort 任务通知写入失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return entry;
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
  /** NEW-P0-B: 用户配置 fallback 链（静态数组或按 subagent_type 解析的函数），故障转移时补传 */
  extraFallbacks?: string[] | ((subagentType: string) => string[] | undefined);
}

export function createBackgroundTaskWatcher(options: CreateWatcherOptions): BackgroundTaskWatcher {
  const { client, registry, pollIntervalMs = 200 } = options;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  // P1-1/NEW-P0-B: 解析用户 fallback 链（静态数组或按 subagent_type 的函数）
  const resolveWatcherFallbacks = (subagentType: string): string[] | undefined => {
    const fb = options.extraFallbacks;
    if (!fb) return undefined;
    return typeof fb === 'function' ? fb(subagentType) : fb;
  };

  // NEW-P0-B: async 路径与 sync 路径相同的失败识别——错误码驱动分类（唯一判据）。
  // 配额报错（带码）/ 模型错误码不算成功；无码报错无法分类是可接受的已知限制
  const classifyAsyncFailure = (
    text: string,
  ): { kind: 'quota'; resetAt: number | null } | { kind: 'error'; resetAt: null } | null => {
    // P2-1：收窄判定面——超长 poll 产出不分类，视为正常产出走正向判定（与 sync 路径一致）
    const code = shouldClassifyOutput(text) ? classifyModelErrorByCode(text) : null;
    if (code?.kind === 'non-transient') return { kind: 'quota', resetAt: code.resetAt };
    if (code?.kind === 'transient') return { kind: 'error', resetAt: null };
    return null;
  };

  /** NEW-P0-B: 模型错误 → 故障转移（quota 长冷却 + 用户 fallback 链）；耗尽返回 false */
  const attemptWatcherFallback = async (
    taskId: string,
    task: BackgroundTaskEntry,
    failure: { kind: 'quota'; resetAt: number | null } | { kind: 'error'; resetAt: null },
  ): Promise<boolean> => {
    const fb = await tryAsyncModelFallback({
      client,
      registry,
      taskId,
      changeDir: task.changeDir || '',
      // P1-1 残留: 补传用户 fallback 链
      extraFallbacks: resolveWatcherFallbacks(task.subagentType),
      quota: failure.kind === 'quota' ? { resetAt: failure.resetAt } : null,
    });
    return fb.retried;
  };

  /** P3-4 辅助：释放并发槽位并同步写 registry */
  function releaseSlot(taskId: string, entry: BackgroundTaskEntry): void {
    if (!entry.slotReleased && entry.status !== 'running') {
      releaseSubagentSlot(entry.subagentType);
      entry.slotReleased = true;
      registry.set(taskId, entry);
    }
  }

  /** P3-4 辅助：标记 completed 并写通知与 store */
  async function finalizeAsyncCompleted(
    taskId: string,
    baseEntry: BackgroundTaskEntry,
    output: string,
    storeDetail: string,
  ): Promise<void> {
    const asyncHasSignal = hasCompletionSignal(output);
    const now = Date.now();
    const completedEntry: BackgroundTaskEntry = {
      ...baseEntry,
      status: 'completed',
      result: output,
      completedAt: now,
      slotReleased: baseEntry.slotReleased ?? false,
      _errorCount: 0,
    };
    registry.set(taskId, completedEntry);
    releaseSlot(taskId, completedEntry);
    try {
      const nm = createNotificationManager({ changeDir: baseEntry.changeDir || '' });
      await nm.writeNotification({
        type: 'async_completed',
        subagent: baseEntry.subagentType,
        task_id: taskId,
        session_id: baseEntry.sessionID,
        summary: output.slice(0, 200),
        has_completion_signal: asyncHasSignal,
      });
    } catch (err) {
      Logger.warn(
        `[BackgroundTaskWatcher] 写入完成通知失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      const store = createSubagentStore({ changeDir: baseEntry.changeDir || '' });
      const agents = await store.listAgents();
      const matchedAgent = agents.find((a) => a.session_id === baseEntry.sessionID);
      if (matchedAgent) {
        await store.updateOutput(matchedAgent.agent_id, output);
        await store.appendEvent(matchedAgent.agent_id, {
          timestamp: new Date().toISOString(),
          event_type: 'completed',
          detail: storeDetail,
        });
      }
    } catch (err) {
      Logger.warn(
        `[BackgroundTaskWatcher] 更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** P3-4 辅助：标记 error 并写通知与 store */
  async function finalizeAsyncError(
    taskId: string,
    baseEntry: BackgroundTaskEntry,
    errorMessage: string,
    summary: string,
    storeDetail?: string,
  ): Promise<void> {
    const now = Date.now();
    const updated: BackgroundTaskEntry = {
      ...baseEntry,
      status: 'error',
      error: errorMessage,
      completedAt: now,
      slotReleased: baseEntry.slotReleased ?? false,
    };
    registry.set(taskId, updated);
    releaseSlot(taskId, updated);
    try {
      const nm = createNotificationManager({ changeDir: baseEntry.changeDir || '' });
      await nm.writeNotification({
        type: 'async_error',
        subagent: baseEntry.subagentType,
        task_id: taskId,
        session_id: baseEntry.sessionID,
        summary,
      });
    } catch (err) {
      Logger.warn(
        `[BackgroundTaskWatcher] 写入错误通知失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!storeDetail) return;
    try {
      const store = createSubagentStore({ changeDir: baseEntry.changeDir || '' });
      const agents = await store.listAgents();
      const matchedAgent = agents.find((a) => a.session_id === baseEntry.sessionID);
      if (matchedAgent) {
        await store.updateOutput(matchedAgent.agent_id, '', { status: 'error' });
        await store.appendEvent(matchedAgent.agent_id, {
          timestamp: new Date().toISOString(),
          event_type: 'error',
          detail: storeDetail,
        });
      }
    } catch (err) {
      Logger.warn(
        `[BackgroundTaskWatcher] 更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** P3-4 辅助：标记 no-valid-output（不拉黑/不换模/不重发） */
  async function finalizeAsyncNoSignal(
    taskId: string,
    baseEntry: BackgroundTaskEntry,
    output: string,
  ): Promise<void> {
    const now = Date.now();
    const noSignalEntry: BackgroundTaskEntry = {
      ...baseEntry,
      status: 'error',
      result: output,
      error: NO_VALID_OUTPUT_DETAIL,
      completedAt: now,
      slotReleased: baseEntry.slotReleased ?? false,
    };
    registry.set(taskId, noSignalEntry);
    releaseSlot(taskId, noSignalEntry);
    // P3-2：no-valid-output 终结路径补写降级通知（与 completed/error 分支一致）。
    // 仅通知补充，不改变 registry 写入行为；含失败原因与模型尝试信息供下游消费方区分。
    const attemptedForNotif = noSignalEntry.attemptedModels ?? [];
    const notifSummary = `${NO_VALID_OUTPUT_DETAIL} (attempted: ${attemptedForNotif.join(', ') || 'none'}); raw output preserved`;
    try {
      const nm = createNotificationManager({ changeDir: baseEntry.changeDir || '' });
      await nm.writeNotification({
        type: 'async_error',
        subagent: baseEntry.subagentType,
        task_id: taskId,
        session_id: baseEntry.sessionID,
        summary: notifSummary,
        has_completion_signal: false,
        failure_reason: 'no-valid-output',
      });
    } catch (err) {
      Logger.warn(
        `[BackgroundTaskWatcher] 写入 no-valid-output 通知失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** P3-4 辅助：noSignal verdict 的故障转移循环与终结（从 checkTasks 提取） */
  async function handleNoSignalFallback(taskId: string, task: BackgroundTaskEntry): Promise<void> {
    let identifiedErrorKind: 'quota' | 'model' | null = 'model';
    let fb = {
      retried: await attemptWatcherFallback(taskId, task, { kind: 'error', resetAt: null }),
    } as { retried: boolean };
    const baseEntry = registry.get(taskId) ?? task;
    let fallbackCompletedOutput: string | null = null;
    let fallbackNoValidOutput: string | null = null;
    let safety = 0;
    while (fb.retried && safety <= MAX_MODEL_RETRIES + 2) {
      safety++;
      const reProbe = await pollSessionCompletion(
        client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
        task.sessionID,
        {
          maxWaitMs: 300,
          probeMode: true,
          directory: task.changeDir,
          eventDriven: false,
          pollIntervalMs: 50,
        },
      );
      if (reProbe === PROBE_PENDING) {
        const live = registry.get(taskId);
        if (live) {
          live._processing = false;
          registry.set(taskId, live);
        }
        fb = { retried: false } as { retried: false };
        break;
      }
      if (reProbe !== null) {
        const reFailure = classifyAsyncFailure(reProbe as string);
        if (reFailure) {
          identifiedErrorKind = reFailure.kind === 'quota' ? 'quota' : 'model';
          const retried = await attemptWatcherFallback(taskId, task, reFailure);
          if (!retried) {
            fb = { retried: false } as { retried: false };
            break;
          }
          continue;
        }
        const echoBaseline = task.prompt ?? '';
        if (echoBaseline && (reProbe as string).trim() === echoBaseline.trim()) {
          identifiedErrorKind = 'model';
          const retried = await attemptWatcherFallback(taskId, task, {
            kind: 'error',
            resetAt: null,
          });
          if (!retried) {
            fb = { retried: false } as { retried: false };
            break;
          }
          continue;
        }
        if (!hasRealOutput(reProbe as string)) {
          fallbackNoValidOutput = reProbe as string;
          fb = { retried: false } as { retried: false };
          break;
        }
        fallbackCompletedOutput = reProbe as string;
        fb = { retried: false } as { retried: false };
        break;
      }
      fb = {
        retried: await attemptWatcherFallback(taskId, task, { kind: 'error', resetAt: null }),
      } as { retried: boolean };
      identifiedErrorKind = 'model';
    }

    if (fallbackCompletedOutput !== null) {
      await finalizeAsyncCompleted(
        taskId,
        baseEntry,
        fallbackCompletedOutput,
        `Async task ${taskId} completed (after model fallback)`,
      );
      return;
    }

    if (fallbackNoValidOutput !== null) {
      const liveBeforeNoSignal = registry.get(taskId);
      if (liveBeforeNoSignal && liveBeforeNoSignal.status !== 'running') {
        liveBeforeNoSignal._processing = false;
        registry.set(taskId, liveBeforeNoSignal);
        return;
      }
      await finalizeAsyncNoSignal(taskId, liveBeforeNoSignal ?? baseEntry, fallbackNoValidOutput);
      return;
    }

    if (fb.retried && safety <= MAX_MODEL_RETRIES + 2) {
      const live = registry.get(taskId);
      if (live) {
        live._processing = false;
        registry.set(taskId, live);
      }
      return;
    }

    const baseEntryForError = registry.get(taskId) ?? task;
    const attemptedModelsForErr = baseEntryForError.attemptedModels ?? [];
    const identifiedNote = identifiedErrorKind
      ? `async output identified as ${identifiedErrorKind === 'quota' ? 'quota/rate-limit' : 'model'} error; model fallback exhausted`
      : 'Task failed after max retries';
    await finalizeAsyncError(
      taskId,
      baseEntryForError,
      `${identifiedNote} (attempted: ${attemptedModelsForErr.join(', ') || 'none'})`,
      'Task failed after max retries',
      `Async task ${taskId} failed: max retries exceeded`,
    );
  }

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
      // P1-3: 跟踪故障转移过程中的错误分类，供耗尽路径写出结构化错误（与 pollAndComplete 对齐）
      let identifiedErrorKind: 'quota' | 'model' | null = null;

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

        // W4（P2-3）：recoverable 判定分支落地——probe null 且非 abort 类错误名时，
        // 先尝试从已完成 session 恢复产出。恢复门控：session.messages 最后一条
        // assistant 消息含文本且过 hasRealOutput 正向判定（假产出不采纳，走换模）。
        // abort 优先：canRecoverFromPollError 对 abort 类返回 false，此处短路跳过恢复。
        const errName =
          probeResult === null
            ? ((await readLastAssistantErrorName(client, task.sessionID)) ?? null)
            : null;
        let recoveredCandidate: string | null = null;
        if (probeResult === null && canRecoverFromPollError(errName ?? '')) {
          const recovered = await readRecoverableOutput(client, task.sessionID);
          recoveredCandidate = recovered !== null && hasRealOutput(recovered) ? recovered : null;
        }
        const verdict = resolveProbeVerdict(
          probeResult,
          null,
          currentTask,
          () => errName,
          () => recoveredCandidate !== null,
        );

        switch (verdict) {
          case 'pending': {
            currentTask._processing = false;
            registry.set(taskId, currentTask);
            continue;
          }
          case 'abort': {
            await finalizeAbortedTask({
              registry,
              taskId,
              task,
              errName: errName as string,
            });
            continue;
          }
          case 'recoverable': {
            // W4（P2-3）：从 session.messages 恢复已完成产出（hasRealOutput 已通过
            // 门控，recoveredCandidate 已缓存）。恢复成功直接标记 completed
            //（不换模、不拉黑）；恢复失败回退 noSignal 换模路径（窄竞态：判定后
            // 到读取间产出被新回合覆盖）。
            if (recoveredCandidate !== null) {
              await finalizeAsyncCompleted(
                taskId,
                currentTask,
                recoveredCandidate,
                `Async task ${taskId} completed (recovered from session after poll error)`,
              );
              continue;
            }
            await handleNoSignalFallback(taskId, task);
            continue;
          }
          case 'noSignal': {
            // Wave 2 Task 5：尝试模型故障转移（换模型重 prompt），直至成功/耗尽。
            // 设计：保持 running、不释放并发槽位；耗尽后才走原错误路径（D-4 未命中前不宣告失败）。
            await handleNoSignalFallback(taskId, task);
            continue;
          }
          case 'error': {
            identifiedErrorKind = 'model';
            const baseEntryForError = registry.get(taskId) ?? task;
            const attemptedModelsForErr = baseEntryForError.attemptedModels ?? [];
            await finalizeAsyncError(
              taskId,
              baseEntryForError,
              `async output identified as model error; model fallback exhausted (attempted: ${attemptedModelsForErr.join(', ') || 'none'})`,
              'Task failed after max retries',
              `Async task ${taskId} failed: max retries exceeded`,
            );
            continue;
          }
          case 'idle': {
            // probeResult is string
            const output = probeResult as string;

            // NEW-P0-B: 与 sync 路径相同的失败识别——错误文本 / 配额报错不算成功。
            const failure = classifyAsyncFailure(output);
            if (failure) {
              const retried = await attemptWatcherFallback(taskId, task, failure);
              if (retried) {
                const live = registry.get(taskId);
                if (live) {
                  live._processing = false;
                  registry.set(taskId, live);
                }
                continue;
              }
              // 故障转移耗尽 → error 路径
              const baseEntryForError = registry.get(taskId) ?? task;
              await finalizeAsyncError(
                taskId,
                baseEntryForError,
                'Task output was a model error/quota text; model fallback exhausted',
                'Task output was a model error/quota text; model fallback exhausted',
              );
              continue;
            }

            // P0-1：无错误码 且 无完成信号 → 不判 completed（不拉黑、不换模、不重发）。
            if (!hasRealOutput(output)) {
              const liveBeforeNoSignal = registry.get(taskId);
              if (liveBeforeNoSignal && liveBeforeNoSignal.status !== 'running') {
                liveBeforeNoSignal._processing = false;
                registry.set(taskId, liveBeforeNoSignal);
                continue;
              }
              await finalizeAsyncNoSignal(taskId, liveBeforeNoSignal ?? task, output);
              continue;
            }

            await finalizeAsyncCompleted(taskId, task, output, `Async task ${taskId} completed`);
            continue;
          }
        }
      } catch (err) {
        Logger.warn(
          `[BackgroundTaskWatcher] 检查任务失败: ${err instanceof Error ? err.message : String(err)}`,
        );
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
              releaseSlot(taskId, updated);
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
      session_id: z.string().nullish().describe('Existing session to continue (sync mode only)'),
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
        const uniqueWaves = waveMatches ? new Set(waveMatches.map((w) => w.toLowerCase())).size : 0;

        if (uniqueWaves > 1) {
          if (subagent_type === 'build-executor') {
            return await formatToolError(
              `Wave Orchestration Constraint Violation: Detected ${uniqueWaves} waves in single build-executor prompt. ` +
                `Waves MUST be dispatched one at a time with Review Gate checks between them. ` +
                `Please delegate waves sequentially: Wave 1 → Review Gate → Wave 2 → Review Gate → ...`,
            );
          } else {
            return await formatToolError(
              `Wave Orchestration Constraint Violation: Detected ${uniqueWaves} waves in single iflow-plan-executor prompt. ` +
                `Waves MUST be dispatched one at a time. ` +
                `Please delegate waves sequentially: Wave 1 → Wave 2 → ...`,
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
          // Wave 2: model_type 路由只读取用户配置（modelProfiles / configOverrides），
          // 不再回退任何内置默认模型 / 内置 fallback 列表（相关内置常量已移除，解析只认用户配置）。
          // 优先级链（高→低，与 agent-builder.ts resolveModelWithFallback 头注释保持一致）：
          //   1. programmatic override（overrides[name].model）
          //   2. model 参数
          //   3. model_type 显式 tier 信号（本分支入口，优先级高于 per-agent 覆盖）
          //   4. configOverrides per-agent 覆盖（configModel）
          //   5. AGENT_PROFILES 静态绑定 → 用户 tier 模型
          //   6. fallback 链（per-agent 配置 → 用户 tier fallback）
          //   7. 链尾 → { model: undefined, provenance: 'unconfigured' }

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
          if (!result.model) {
            // Wave 3 (P2-4)："未配置该 tier" 属于配置缺失而非系统故障 —— 先记录降级诊断日志
            // （Logger 目前无 debug 级别，LOG 为最低级别），再保留显式报错：既不注入假模型，
            // 也不静默回退。不带 model_type 调用时 agent 将使用 OpenCode 默认模型；
            // 需要指定模型时请在 modelProfiles / configOverrides 中配置该 tier。
            Logger.log(
              `[CallFlowAgent] model_type "${model_type}" 对 agent "${subagent_type}" 无用户配置` +
                `（provenance: ${result.provenance}）：不注入任何模型；不带 model_type 调用时 agent 将使用 OpenCode 默认模型。` +
                `如需指定模型，请在 modelProfiles / configOverrides 中配置该 tier。`,
            );
            // Wave 2: 无用户配置时降级为 unconfigured，明确报错而非注入假模型
            return await formatToolError(
              `No model configured for model_type "${model_type}". Provide modelProfiles/configOverrides for this tier or use agentModelMap.`,
            );
          }
          subagentModel = result.model;
        } else {
          // Use pre-resolved model from agentModelMap (populated during config hook)
          const modelFromMap = agentModelMap[subagent_type as string];
          if (!modelFromMap) {
            return await formatToolError(
              `No model configured for subagent "${subagent_type}". Available agents: ${Object.keys(agentModelMap).join(', ')}`,
            );
          }
          // P0-3: 模型解析时查黑名单——unavailable 模型跳过，走 fallback 链
          // （黑名单按 TTL 过期：长冷却配额按重置时间过期）
          if (isModelAvailable(modelFromMap)) {
            subagentModel = modelFromMap;
          } else {
            const fallbackNext = getAlternativeModel(
              modelFromMap,
              subagent_type as string,
              buildAgentFallbackChain(
                subagent_type as BuiltinAgentName,
                configOverrides,
                modelProfiles,
              ),
            );
            if (!fallbackNext) {
              return await formatToolError(
                `Model "${modelFromMap}" is currently unavailable (cooldown) and no alternative model is available for "${subagent_type}".`,
              );
            }
            subagentModel = fallbackNext;
          }
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
            `Invalid model format: "${subagentModel}". Expected "provider/modelID" (e.g., "provider/example-model")`,
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
            Logger.warn(
              `[CallFlowAgent] 创建 agent store 失败: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // ── Background 模式：发送首次 prompt 后立即返回 task_id（故障转移由 watcher/pollAndComplete 异步处理）──
        if (isBackground) {
          // R3-fix P1-3: reserve-then-dispatch——先占并发槽位再发送 prompt。
          // 槽位已满时直接返回错误：此时 prompt 尚未发送、session 尚未开始运行（零成本），
          // 不再产生「发了 prompt 却未进入 registry」的无人监控孤儿 session。
          if (!acquireSubagentSlot(subagent_type as string)) {
            return await formatToolError(
              `Concurrency limit reached for subagent "${subagent_type}". Maximum ${MAX_CONCURRENT_SUBAGENTS} parallel instances allowed. Wait for a running task to complete before starting another.`,
            );
          }

          // Wave 1 Task 1：以 sendPromptOnce 发送首次 prompt（{ throwOnError: true } + try/catch）
          const firstSend = await sendPromptOnce(client, {
            sessionID,
            agent: subagent_type as string,
            text: finalPrompt,
            model: parsedModel,
          });

          // Wave 1 Task 2 / D-7：前置校验失败不拉黑不换模型，直接返回工具错误
          if (!firstSend.ok) {
            // R3-fix P1-3: 占位成功但首发送失败——必须释放槽位，否则并发上限被永久侵蚀
            releaseSubagentSlot(subagent_type as string);
            return await formatToolError(
              `Failed to send prompt (HTTP ${firstSend.status ?? 'unknown'}): ${firstSend.message ?? 'no detail'}. ` +
                `前置校验失败（SessionBusy / model not found / agent 不存在）不属于模型故障，未触发模型故障转移。`,
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
            prompt: finalPrompt,
            attemptedModels: [subagentModel],
          });

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
              Logger.warn(
                `[CallFlowAgent] 追加事件失败: ${err instanceof Error ? err.message : String(err)}`,
              );
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
          // P1-1: 传入用户配置 fallback 链（换模候选完全来自用户配置，无内置 fallback）
          extraFallbacks: buildAgentFallbackChain(
            subagent_type as BuiltinAgentName,
            configOverrides,
            modelProfiles,
          ),
          agentName: subagent_type as string,
          basePrompt: finalPrompt,
          initialModel: subagentModel,
          maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS,
          directory: changeDir,
          poll: async () => {
            // R3-fix P1-1: 传入 echoBaseline（所发 prompt 文本）——polling 层在窗口超时
            // 且会话仍在 busy/retry 时返回 PROBE_PENDING 而非回显，避免「慢而健康」的
            // 模型被拉黑换模。
            const pollResult = await pollSessionCompletion(
              client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
              sessionID,
              {
                maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS,
                directory: changeDir,
                echoBaseline: finalPrompt,
              },
            );
            return pollResult;
          },
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
          // R3-fix P1-1: sync 窗口超时但会话仍在运行——模型健康，仅超时。
          // 不拉黑、不换模、不写 registry：明确告知编排器会话仍在产出，可稍后查询。
          if (fallbackResult.failureReason === 'timeout-pending') {
            return {
              title: sessionLabel,
              output: JSON.stringify(
                {
                  success: false,
                  subagent: subagent_type,
                  sessionID,
                  error: `同步等待超时（${DEFAULT_SYNC_MAX_WAIT_MS / 1000}s 窗口耗尽）但会话仍在运行：模型未被拉黑、未触发故障转移。可稍后使用 flowagent_output 携带 session_id 查询该会话的后续产出。`,
                  attempted_models: fallbackResult.attemptedModels,
                },
                null,
                2,
              ),
            };
          }
          if (
            fallbackResult.failureReason === 'fatal' ||
            fallbackResult.failureReason === 'invalid-model'
          ) {
            return await formatToolError(
              `模型调用失败 (${fallbackResult.detail ?? 'unknown'})：前置校验失败或模型格式非法，未触发模型故障转移。`,
            );
          }
          if (fallbackResult.failureReason === 'no-valid-output') {
            return {
              title: sessionLabel,
              output: JSON.stringify(
                {
                  success: false,
                  subagent: subagent_type,
                  sessionID,
                  error: `产出无完成信号（no completion signal），未判为成功（原始文本见 raw_output）；未拉黑模型、未触发故障转移`,
                  raw_output: fallbackResult.output ?? '',
                  attempted_models: fallbackResult.attemptedModels,
                },
                null,
                2,
              ),
            };
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
          if (fallbackResult.failureReason === 'aborted') {
            // P1-3：用户/系统取消 —— 文案必须明确"取消"，且不得出现"未触发模型故障转移"的
            // 误导组合（取消不是模型故障，排障方向不同）。
            return {
              title: sessionLabel,
              output: JSON.stringify(
                {
                  success: false,
                  subagent: subagent_type,
                  sessionID,
                  error: `任务被用户/系统取消（${fallbackResult.detail ?? 'aborted'}）：未拉黑模型、未触发模型故障转移`,
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
          Logger.warn(
            `[CallFlowAgent] 同步模式写入通知失败: ${err instanceof Error ? err.message : String(err)}`,
          );
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
            Logger.warn(
              `[CallFlowAgent] 同步模式更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`,
            );
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
              ...(fallbackResult.fallbacks.length > 0 && {
                model_fallbacks: fallbackResult.fallbacks,
              }),
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
            {
              success: false,
              error: `子 agent "${callerAgent}" 不允许调用 flowagent_output。只有主 orchestrator（sFlow/iFlow）可以委派子 agent。`,
            },
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
          // P1-2：output !== null（poll 已成功）时不触发 fallback——避免误拉黑健康模型
          // 并向同一 session 重复注入原始 prompt（对照 watcher 路径的 probeResult === null 守卫）。
          let fb: { retried: true; nextModel: string } | { retried: false } = { retried: false };
          // R3-P2-3: 第三路径（pollAndComplete 非 null 输出）接入错误/配额识别——
          // 与 sync 路径（runWithModelFallback）及 async watcher 路径对齐：
          // 错误文本/配额报错不算成功产出 → 换模型重 prompt 或结构化错误，不判 completed。
          // P1-2 守卫保留：正常产出（含 completion signal）仍不触发 fallback。
          let identifiedErrorKind: 'quota' | 'model' | null = null;
          let activeQuota: { resetAt: number | null } | null = null;
          // P0-1: 换模后 re-poll 无完成信号时的产出原文（no-valid-output 失败终结，不拉黑/不换模/不重发）
          let noValidOutput: string | null = null;
          if (typeof output === 'string') {
            // R3-fix P1-2: 初次 poll（非 probeMode）超时/结束时返回的最后一条消息可能就是
            // 所发 prompt 本身（回显）——此时模型尚未产出任何 assistant 内容。回显不是产出：
            // - 绝不判 completed（违反「无完成信号不判成功」不变量；prompt 含 Markdown
            //   标题时回显会被 hasRealOutput 误判为结构化报告）
            // - 不换模、不拉黑（对齐 re-poll 回显守卫与 watcher probeMode 守卫）
            // 保持 running 交还 watcher，下一轮 tick 继续探测。
            const initialEchoBaseline = task.prompt ?? '';
            if (initialEchoBaseline && output.trim() === initialEchoBaseline.trim()) {
              const stillRunningEntry: BackgroundTaskEntry = {
                ...(backgroundTaskRegistry.get(task_id) ?? task),
                status: 'running',
                _errorCount: 0,
              };
              backgroundTaskRegistry.set(task_id, stillRunningEntry);
              return stillRunningEntry;
            }
            // 错误码驱动分类（唯一判据）：错误码报错不算成功 → 换模型重 prompt 或结构化错误。
            // 无码报错无法分类是可接受的已知限制（文本模式兜底已删除）。
            // P2-1：收窄判定面——超长 poll 产出不分类（错误码只在正文中部引用时不应误判为模型错误）
            const identifiedCode = shouldClassifyOutput(output)
              ? classifyModelErrorByCode(output)
              : null;
            if (identifiedCode) {
              identifiedErrorKind = identifiedCode.kind === 'non-transient' ? 'quota' : 'model';
              activeQuota =
                identifiedCode.kind === 'non-transient'
                  ? { resetAt: identifiedCode.resetAt }
                  : null;
              fb = await tryAsyncModelFallback({
                client,
                registry: backgroundTaskRegistry,
                taskId: task_id,
                changeDir,
                extraFallbacks: buildAgentFallbackChain(
                  task.subagentType as BuiltinAgentName,
                  configOverrides,
                  modelProfiles,
                ),
                quota: activeQuota,
              });
              // 无效产出：置空交由下方 while 循环 re-poll；耗尽时走结构化错误路径
              output = null;
            } else if (!hasRealOutput(output)) {
              // P0-1：无错误码 且 无完成信号 → 不判 completed，也不换模重发（不拉黑）。
              // 产出原文保留在 result 中供编排器参考。
              const noSignalEntry: BackgroundTaskEntry = {
                ...task,
                status: 'error',
                result: output,
                error: NO_VALID_OUTPUT_DETAIL,
                completedAt: Date.now(),
                slotReleased: task.slotReleased ?? false,
              };
              backgroundTaskRegistry.set(task_id, noSignalEntry);

              if (!noSignalEntry.slotReleased) {
                releaseSubagentSlot(task.subagentType);
                noSignalEntry.slotReleased = true;
                backgroundTaskRegistry.set(task_id, noSignalEntry);
              }

              // P3-2：poll 首个产出即无完成信号 → 降级通知（与 error 分支一致，含失败原因与
              // 模型尝试信息）。仅通知补充，不改变 registry 写入行为。
              const attemptedForNotif = noSignalEntry.attemptedModels ?? [];
              const noSignalSummary = `${NO_VALID_OUTPUT_DETAIL} (attempted: ${attemptedForNotif.join(', ') || 'none'}); raw output preserved`;
              try {
                const nm = createNotificationManager({ changeDir });
                await nm.writeNotification({
                  type: 'async_error',
                  subagent: task.subagentType,
                  task_id,
                  session_id: task.sessionID,
                  summary: noSignalSummary,
                  has_completion_signal: false,
                  failure_reason: 'no-valid-output',
                });
              } catch (err) {
                Logger.warn(
                  `[CallFlowAgent] 异步模式写入 no-valid-output 通知失败: ${err instanceof Error ? err.message : String(err)}`,
                );
              }

              return noSignalEntry;
            }
          }
          // P1-3：abort 判定必须先于故障转移（与 watcher 路径 `:600` 对齐）——
          // 用户取消不是模型故障：命中则零降级终结（不拉黑、不换模、不重发）。
          if (output === null) {
            const abortErrName = await readLastAssistantErrorName(client, task.sessionID);
            if (isAbortErrorName(abortErrName)) {
              await finalizeAbortedTask({
                registry: backgroundTaskRegistry,
                taskId: task_id,
                task,
                errName: abortErrName as string,
              });
              return backgroundTaskRegistry.get(task_id) ?? task;
            }
          }
          if (output === null && identifiedErrorKind === null) {
            fb = await tryAsyncModelFallback({
              client,
              registry: backgroundTaskRegistry,
              taskId: task_id,
              changeDir,
              extraFallbacks: buildAgentFallbackChain(
                task.subagentType as BuiltinAgentName,
                configOverrides,
                modelProfiles,
              ),
            });
          }
          let fbSafety = 0;
          while (fb.retried && fbSafety <= MAX_MODEL_RETRIES + 2) {
            fbSafety++;
            // P1-2（ADR-3）：re-poll 与 watcher 的 reProbe 语义对齐 —— probeMode + 无事件总线。
            // 不再以 DEFAULT_SYNC_MAX_WAIT_MS 固定窗口给慢而健康的模型定罪：
            // PROBE_PENDING 表示"仍在进行中" → break 保持 running 交还 tick。
            const rePoll = await pollSessionCompletion(
              client as unknown as { session: import('../helpers/polling.js').SFlowClientSession },
              task.sessionID,
              {
                maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS,
                directory: changeDir,
                probeMode: true,
                eventDriven: false,
                pollIntervalMs: 50,
              },
            );
            if (rePoll === PROBE_PENDING) {
              // 换上的模型仍在运行：保持 running 交还 tick，绝不以固定短窗口超时定罪（P1-2）
              break;
            }
            if (rePoll !== null) {
              // R3-P2-3/P0-1: 换模后的 re-poll 输出做错误码识别（唯一判据），并补齐产出正向判定（对齐 sync 路径）
              // P2-1：同样收窄判定面——超长 re-poll 产出不分类
              const reOutput = rePoll as string;
              const reCode = shouldClassifyOutput(reOutput)
                ? classifyModelErrorByCode(reOutput)
                : null;
              if (reCode) {
                identifiedErrorKind = reCode.kind === 'non-transient' ? 'quota' : 'model';
                activeQuota = reCode.kind === 'non-transient' ? { resetAt: reCode.resetAt } : null;
                output = null;
              } else {
                // 回显：新模型原样回显所发 basePrompt → 视为未完成，继续故障转移（既有 model-failure 语义）
                const echoBaseline = task.prompt ?? '';
                if (echoBaseline && reOutput.trim() === echoBaseline.trim()) {
                  identifiedErrorKind = 'model';
                  output = null;
                  // 不 break：继续 while 循环触发下一次 tryAsyncModelFallback
                } else if (!hasRealOutput(reOutput)) {
                  // 无机器可读错误码 且 无完成信号 → no-valid-output 失败终结（不拉黑/不换模/不重发，原文保留）
                  noValidOutput = reOutput;
                  output = reOutput;
                  fb = { retried: false } as { retried: false };
                  break;
                } else {
                  output = reOutput;
                  fb = { retried: false } as { retried: false };
                  break;
                }
              }
            } else {
              output = null;
            }
            fb = await tryAsyncModelFallback({
              client,
              registry: backgroundTaskRegistry,
              taskId: task_id,
              changeDir,
              extraFallbacks: buildAgentFallbackChain(
                task.subagentType as BuiltinAgentName,
                configOverrides,
                modelProfiles,
              ),
              quota: activeQuota,
            });
          }

          if (fb.retried) {
            // 故障转移进行中仍 running：保持任务运行、不释放槽位，返回 running（交给 watcher 后续探测）
            // P1-2（ADR-3）：展开基线改用 live registry 快照——入参 task 是调用前的旧快照，
            // 直接展开会抹掉故障转移刚写入的 resolvedModel / attemptedModels。
            const runningEntry: BackgroundTaskEntry = {
              ...(backgroundTaskRegistry.get(task_id) ?? task),
              status: 'running',
              _errorCount: 0,
            };
            backgroundTaskRegistry.set(task_id, runningEntry);
            return runningEntry;
          }

          // 故障转移后使用最新 registry 快照（含新 resolvedModel），再走成功/错误路径
          const latestEntry = backgroundTaskRegistry.get(task_id);
          if (latestEntry) task = latestEntry;

          if (noValidOutput) {
            // P0-1：换模后 re-poll 无完成信号 → no-valid-output 失败终结（不拉黑/不换模/不重发，原文保留）
            const live = backgroundTaskRegistry.get(task_id) ?? task;
            const noSignalEntry: BackgroundTaskEntry = {
              ...live,
              status: 'error',
              result: noValidOutput,
              error: NO_VALID_OUTPUT_DETAIL,
              completedAt: now,
              slotReleased: live.slotReleased ?? false,
              _errorCount: 0,
            };
            backgroundTaskRegistry.set(task_id, noSignalEntry);

            if (!noSignalEntry.slotReleased) {
              releaseSubagentSlot(task.subagentType);
              noSignalEntry.slotReleased = true;
              backgroundTaskRegistry.set(task_id, noSignalEntry);
            }

            try {
              const nm = createNotificationManager({ changeDir });
              await nm.writeNotification({
                type: 'async_error',
                subagent: task.subagentType,
                task_id,
                session_id: task.sessionID,
                summary: `Task output has no completion signal; treated as failure (raw output preserved)`,
                has_completion_signal: false,
                failure_reason: 'no-valid-output',
              });
            } catch (err) {
              Logger.warn(
                `[CallFlowAgent] 异步模式写入错误通知失败: ${err instanceof Error ? err.message : String(err)}`,
              );
            }

            try {
              const asyncStore = createSubagentStore({ changeDir });
              const agents = await asyncStore.listAgents();
              const matchedAgent = agents.find((a) => a.session_id === task.sessionID);
              if (matchedAgent) {
                await asyncStore.updateOutput(matchedAgent.agent_id, noValidOutput);
                await asyncStore.appendEvent(matchedAgent.agent_id, {
                  timestamp: new Date().toISOString(),
                  event_type: 'error',
                  detail: `Async task ${task_id} failed: ${NO_VALID_OUTPUT_DETAIL}`,
                });
              }
            } catch (err) {
              Logger.warn(
                `[CallFlowAgent] 异步模式更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`,
              );
            }

            return noSignalEntry;
          }

          let updated: BackgroundTaskEntry;
          if (output === null) {
            // R3-P2-3: 耗尽时若识别出错误/配额，错误信息注明识别结果（结构化错误，不判 completed）
            const identifiedNote = identifiedErrorKind
              ? `async output identified as ${identifiedErrorKind === 'quota' ? 'quota/rate-limit' : 'model'} error; model fallback exhausted`
              : 'Session retry exhausted or polling failed';
            updated = {
              ...task,
              status: 'error',
              error: identifiedNote,
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
                summary: `Task failed: ${identifiedNote}`,
              });
            } catch (err) {
              Logger.warn(
                `[CallFlowAgent] 异步模式写入错误通知失败: ${err instanceof Error ? err.message : String(err)}`,
              );
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
                  detail: `Async task ${task_id} failed: ${identifiedNote}`,
                });
              }
            } catch (err) {
              Logger.warn(
                `[CallFlowAgent] 异步模式更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`,
              );
            }

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
            Logger.warn(
              `[CallFlowAgent] 异步模式写入通知失败: ${err instanceof Error ? err.message : String(err)}`,
            );
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
            Logger.warn(
              `[CallFlowAgent] 异步模式更新 subagent-store 失败: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          return updated;
        } catch (err) {
          // F-1: Handle pollSessionCompletion exceptions (network errors, etc.)
          Logger.warn(
            `[CallFlowAgent] pollAndComplete failed: ${err instanceof Error ? err.message : String(err)}`,
          );

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
            Logger.warn(
              `[CallFlowAgent] 异步模式写入错误通知失败: ${notificationErr instanceof Error ? notificationErr.message : String(notificationErr)}`,
            );
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
            Logger.warn(
              `[CallFlowAgent] 异步模式更新 subagent-store 失败: ${storeErr instanceof Error ? storeErr.message : String(storeErr)}`,
            );
          }

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
            {
              success: false,
              error: `子 agent "${callerAgent}" 不允许调用 flowagent_cancel。只有主 orchestrator（sFlow/iFlow）可以委派子 agent。`,
            },
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
          Logger.warn(
            `[CallFlowAgent] 取消 session 失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        // P1-A: Check slotReleased to prevent double release
        if (!task.slotReleased) {
          releaseSubagentSlot(task.subagentType);
        }
        backgroundTaskRegistry.delete(taskId);
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
    // P1-1/NEW-P0-B: 后台 watcher 故障转移补传用户配置 fallback 链（按 subagent_type 解析）
    extraFallbacks: (subagentType: string) =>
      buildAgentFallbackChain(subagentType as BuiltinAgentName, configOverrides, modelProfiles),
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
