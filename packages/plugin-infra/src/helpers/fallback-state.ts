/**
 * Shared FallbackState state machine (P3-3 / P3-4 / omo-5)
 *
 * 收敛 sync runWithModelFallback / async tryAsyncModelFallback / watcher checkTasks
 * 三处重复的"拉黑→选候选→终止判定"结构。
 * attemptedModels 单源，消除 taskModelAttempts 与 registry.attemptedModels 双写。
 */

import { getAvailabilityState } from '../agents/model-availability.js';
import type { BackgroundTaskEntry } from '../types.js';
import { PROBE_PENDING } from '../types.js';
import { Logger } from '../utils/logger.js';

/** availabilitySkipped 状态说明只 warn 一次，避免重复刷屏 */
let availabilitySkipWarnEmitted = false;

/**
 * 模型回退状态机。
 * attemptedModels 为单源真值，async 路径废弃 taskModelAttempts Map，
 * 统一由 recordAttempt 单点写入 registry.attemptedModels。
 */
export interface FallbackState {
  providerID: string;
  modelID: string;
  fallbackChain: string[];
  attemptCount: number;
  attemptedModels: string[];
  pending: boolean;
  /**
   * W3：换模候选判定时可用性状态机（model-availability）不在 'ready' 状态
   * （冷缓存 'cold' / 查询失败 'failed'，可用性快照不可信），本次降级决策
   * 跳过了黑名单检查（availabilitySkipped）。仅供观测标注，不影响候选来源
   * （候选仍全部来自用户配置链）。
   */
  availabilitySkipped?: boolean;
}

/** 六值枚举：probe 结果的高阶判定 */
export type ProbeVerdict = 'idle' | 'pending' | 'noSignal' | 'recoverable' | 'error' | 'abort';

/**
 * 从首模型与配置链创建初始状态。
 * 首模型自动加入 attemptedModels，attemptCount 初始为 1。
 */
export function createFallbackState(initialModel: string, fallbackChain: string[]): FallbackState {
  const parts = initialModel.split('/');
  const providerID = parts[0] ?? initialModel;
  const modelID = parts[1] ?? initialModel;
  return {
    providerID,
    modelID,
    fallbackChain,
    attemptCount: 1,
    attemptedModels: [initialModel],
    pending: false,
  };
}

/**
 * 把模型加入 attemptedModels，递增 attemptCount，更新当前 provider/model。
 */
export function recordAttempt(state: FallbackState, model: string): void {
  state.attemptedModels.push(model);
  state.attemptCount++;
  const parts = model.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    state.providerID = parts[0];
    state.modelID = parts[1];
  }
}

/**
 * 沿 fallbackChain 查找第一个不在 attemptedModels 中
 * 且 isModelAvailable(model) !== false 的候选；若无则返回 null。
 *
 * W3（P2-2，omo 冷缓存 skipped 信号）：model-availability 状态机接入换模判定。
 * 当 state === 'cold'（未刷新/空）或 'failed'（provider.list 查询失败）时，
 * 可用性快照不可信，跳过 isModelAvailable 黑名单过滤直接沿用户配置链取候选——
 * 冷缓存跳过只为加速降级决策，不代表拉黑失效；候选仍全部来自用户配置链，
 * abort 零降级 / timeout-pending 语义不受影响。同时置位 availabilitySkipped 标注。
 */
export function getNextCandidate(
  state: FallbackState,
  isModelAvailable: (model: string) => boolean | undefined,
): string | null {
  const availabilityState = getAvailabilityState();
  const availabilityTrusted = availabilityState === 'ready';
  if (!availabilityTrusted) {
    state.availabilitySkipped = true;
    warnAvailabilitySkippedOnce();
  }
  for (const model of state.fallbackChain) {
    if (state.attemptedModels.includes(model)) continue;
    if (availabilityTrusted && isModelAvailable(model) === false) continue;
    return model;
  }
  return null;
}

/** W3：cold/failed 状态下跳过黑名单检查只提示一次（对齐 model-availability warnStatusOnce 语义） */
function warnAvailabilitySkippedOnce(): void {
  if (availabilitySkipWarnEmitted) return;
  availabilitySkipWarnEmitted = true;
  void Logger.warn('[model-availability] 可用性快照不可用（cold/failed），换模候选跳过黑名单检查');
}

/** W3：重置 availabilitySkipped 一次性 warn 标记（仅供测试隔离使用） */
export function resetAvailabilitySkipWarnFlag(): void {
  availabilitySkipWarnEmitted = false;
}

/**
 * 判定是否已耗尽换模次数或 fallbackChain 已全部尝试。
 * 语义对齐既有代码：attemptCount > maxRetries（与 sync/async 路径的 > 检查一致）。
 */
export function isExhausted(state: FallbackState, maxRetries: number): boolean {
  if (state.attemptCount > maxRetries) return true;
  if (state.fallbackChain.every((m) => state.attemptedModels.includes(m))) return true;
  return false;
}

/**
 * 基于错误名判定 poll 失败是否可从 session messages 恢复。
 * Abort 类错误不可恢复；其余可恢复。
 */
export function canRecoverFromPollError(errorName: string): boolean {
  if (!errorName) return true;
  if (errorName === 'MessageAbortedError' || errorName === 'AbortError') return false;
  if (errorName.includes('the operation was aborted')) return false;
  return true;
}

/**
 * 纯函数：根据 probe 结果、registry 状态与错误名返回 verdict 枚举。
 * MUST NOT 产生副作用（不读写 registry、不调用 session 方法、不触发换模）。
 *
 * W1：recoverable 枚举已占位，但判定逻辑暂归 noSignal；W4 填充 recoverable 分支。
 */
export function resolveProbeVerdict(
  probeResult: string | null | typeof PROBE_PENDING,
  _reProbe: typeof PROBE_PENDING | null,
  registryEntry: BackgroundTaskEntry,
  readErrorName: () => string | null,
  /** W4：恢复能力回调（session messages 含可采用的 assistant 产出）。缺省不恢复。 */
  readRecoverable?: () => boolean,
): ProbeVerdict {
  // pending
  if (probeResult === PROBE_PENDING) return 'pending';

  // idle（有产出字符串，进入产出判定）
  if (probeResult !== null) return 'idle';

  // probeResult === null：从此时起需读取错误名
  const errName = readErrorName();

  // abort 优先（零降级）
  if (errName === 'MessageAbortedError' || errName === 'AbortError') {
    return 'abort';
  }

  // 尝试耗尽 → error
  const attempted = registryEntry.attemptedModels ?? [];
  const MAX_MODEL_RETRIES = 2; // 与 call-flow-agent.ts 常量对齐
  if (attempted.length > MAX_MODEL_RETRIES) {
    return 'error';
  }

  // W4（P2-3）：recoverable 落地——调用方注入 readRecoverable 且判定会话内已有
  // 可恢复产出时返回 recoverable（不再走 noSignal 换模）；否则维持 noSignal 原语义。
  if (readRecoverable?.() === true) {
    return 'recoverable';
  }
  return 'noSignal';
}

/**
 * W4（P2-3）：从 session.messages 原始数据提取「最后一条 assistant 消息」的最终文本，
 * 作为 poll 失败时可恢复产出候选。
 *
 * 严格最新消息守卫（对齐 omo fetchSyncResult 的 strictAbortRecovery，
 * sync-result-fetcher.ts:100-129）：
 * - 仅考察最新一条 assistant 消息，绝不回溯更早消息——最新产出正是 poll 关心的回合；
 *   若最新回合被错误/中止污染，回溯旧内容会以陈旧产出掩盖失败、报告假成功。
 * - 最新 assistant 消息带 error（info.error）→ 拒绝恢复（返回 null）。
 * - 最新 assistant 消息无可读文本（text part 为空）→ 拒绝恢复（返回 null）。
 * - 仅拼接 `type === 'text'` part（不含 reasoning，避免链式思考中的关键词
 *   「假产出」通过 hasRealOutput 正向判定——比 omo 的 messageText 更保守）。
 *
 * 纯函数，无副作用（不发起 IO，不读写 registry）。提取结果须再由调用方
 *（恢复层）过 hasRealOutput 正向判定（completion-detector），假产出不采纳。
 */
export function extractLastAssistantText(messagesData: unknown): string | null {
  if (!Array.isArray(messagesData)) return null;
  let lastAssistant:
    | {
        info?: { error?: { name?: string } };
        parts?: Array<{ type?: string; text?: string }>;
      }
    | null = null;
  for (let i = messagesData.length - 1; i >= 0; i--) {
    const msg = messagesData[i] as
      | {
          info?: { role?: string; error?: { name?: string } };
          parts?: Array<{ type?: string; text?: string }>;
        }
      | undefined;
    if (msg?.info?.role === 'assistant') {
      lastAssistant = msg;
      break;
    }
  }
  if (!lastAssistant) return null;
  // 最新回合本身是 error → 拒绝恢复（严禁用陈旧内容掩盖失败）
  if (lastAssistant.info?.error) return null;
  const text = (lastAssistant.parts ?? [])
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .filter((t) => t.length > 0)
    .join('\n');
  return text ? text : null;
}
