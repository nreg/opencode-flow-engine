/**
 * Session Error Handler — 事件驱动预降级（D2 / W7）
 *
 * 订阅 SDK session.error 事件，做「错误码驱动的预分类 + 拉黑加速」。
 *
 * 设计定位（与既有降级链路的关系）：
 * - 本 hook 是「预分类补充」：在 SDK 推送 session.error 时即时拉黑，缩短故障转移延迟。
 * - 既有轮询路径（pollAndComplete / BackgroundTaskWatcher）仍保留，两路径拉黑语义一致、
 *   幂等（markModelUnavailable 单调合并），不重复终结/重派任务（避免双路径竞态写 registry）。
 * - 本 hook 只做：预分类 → markModelUnavailable 拉黑 + event-bus 通知 + subagent-store 写入。
 *
 * 约束：
 * - C-6：只用错误码 / 错误名，禁止 provider 文案匹配；
 * - abort 零降级：error.name ∈ ABORT_ERROR_NAMES → 零动作；
 * - 分类未命中（none）→ 不拉黑、不通知；
 * - 防重入：同一 sessionID 的 error 在短窗口内去重（事件层 + 轮询层幂等）。
 */

import {
  MIN_QUOTA_COOLDOWN_TTL_MS,
  markModelUnavailable,
  TRANSIENT_COOLDOWN_TTL_MS,
} from '../agents/agent-builder.js';
import { Logger } from '../utils/logger.js';
import { createNotificationManager, type NotificationManager } from './notification-manager.js';
import {
  classifySessionError,
  isAbortSessionError,
  type SessionErrorData,
} from './session-error-classifier.js';
import { createSubagentStore, type SubagentStore } from './subagent-store.js';

/** 去重窗口（毫秒）：同一 sessionID 的重复 session.error 在该窗口内只处理一次 */
export const SESSION_ERROR_DEDUP_WINDOW_MS = 3000;

/** 拉黑 + 通知依赖（可注入，便于单测） */
export interface SessionErrorSideEffects {
  /** 拉黑模型（默认 markModelUnavailable） */
  blacklistModel: (model: string, opts: { resetAt?: number | null; ttlMs?: number }) => void;
  /** 写入降级通知（默认 NotificationManager.writeNotification） */
  writeNotification: (params: {
    type: 'async_error';
    subagent: string;
    task_id: string;
    session_id: string;
    summary: string;
    failure_reason?: string;
  }) => Promise<void>;
  /** 写 subagent-store 事件流水（默认 SubagentStore.appendEvent） */
  writeStoreEvent?: (params: {
    workDir: string;
    sessionID: string;
    detail: string;
  }) => Promise<void>;
}

/** 默认副作用（生产路径） */
function defaultSideEffects(workDir: string): SessionErrorSideEffects {
  const nm: NotificationManager = createNotificationManager({ workDir });
  const store: SubagentStore = createSubagentStore({ workDir });
  return {
    blacklistModel: (model, opts) => markModelUnavailable(model, opts),
    writeNotification: (params) => nm.writeNotification(params),
    writeStoreEvent: async ({ sessionID, detail }) => {
      try {
        const agents = await store.listAgents();
        const matched = agents.find((a) => a.session_id === sessionID);
        if (matched) {
          await store.appendEvent(matched.agent_id, {
            timestamp: new Date().toISOString(),
            event_type: 'error',
            detail,
          });
        }
      } catch {
        // store 写入失败不阻塞事件链路
      }
    },
  };
}

/** 创建有状态 handler 的可注入依赖 */
export interface CreateSessionErrorHandlerDeps {
  /** workDir，用于通知 / store 落地（插件工作目录） */
  workDir: string;
  /** sessionID → 模型字符串 解析器（如后台任务注册表反查） */
  modelResolver: (sessionID: string | undefined) => string | undefined;
  /** 可选：覆盖副作用（测试用） */
  sideEffects?: SessionErrorSideEffects;
  /** 可选：覆盖去重窗口（测试用） */
  dedupWindowMs?: number;
}

export interface SessionErrorHandler {
  /**
   * 处理一条 session.error 事件。
   * @param event.sessionID - 事件携带的 sessionID
   * @param event.error - SDK error 对象
   * @returns 处理结果：'aborted' | 'blacklisted' | 'deduped' | 'unclassified' | 'no-model'
   */
  handle: (event: {
    sessionID?: string;
    error?: SessionErrorData;
  }) => Promise<'aborted' | 'blacklisted' | 'deduped' | 'unclassified' | 'no-model'>;
  /** 清空去重窗口（测试用） */
  resetDedup: () => void;
}

/**
 * 创建 session.error 事件 handler。
 *
 * 纯逻辑 + 可注入副作用，便于单测覆盖 6 条验收场景。
 */
export function createSessionErrorHandler(
  deps: CreateSessionErrorHandlerDeps,
): SessionErrorHandler {
  const windowMs = deps.dedupWindowMs ?? SESSION_ERROR_DEDUP_WINDOW_MS;
  const effects = deps.sideEffects ?? defaultSideEffects(deps.workDir);
  // 去重窗口：sessionID → 最近一次处理时间戳
  const lastSeen = new Map<string, number>();

  function isDeduped(sessionID: string | undefined): boolean {
    if (!sessionID) return false; // 无 sessionID 无法去重，直接放行
    const prev = lastSeen.get(sessionID);
    const now = Date.now();
    if (prev !== undefined && now - prev < windowMs) {
      return true;
    }
    lastSeen.set(sessionID, now);
    return false;
  }

  async function handle(event: {
    sessionID?: string;
    error?: SessionErrorData;
  }): Promise<'aborted' | 'blacklisted' | 'deduped' | 'unclassified' | 'no-model'> {
    const { sessionID, error } = event;

    // 1. abort 零降级优先：零动作
    if (isAbortSessionError(error)) {
      return 'aborted';
    }

    // 2. 去重（事件层 + 轮询层幂等）
    if (isDeduped(sessionID)) {
      await Logger.log(`[SessionErrorHandler] 去重跳过 session.error: sessionID=${sessionID}`);
      return 'deduped';
    }

    // 3. 预分类（纯函数，错误码驱动，不含文案匹配）。
    // modelResolver 已内置 P1-1 护栏：换模后（attemptedModels>1）返回 undefined，
    // 使分类失败 → 'no-model'，不拉黑当前健康模型（轮询路径仍会兜底）。
    const classification = classifySessionError({
      sessionID,
      error,
      modelResolver: deps.modelResolver,
    });

    if (!classification) {
      // 分类未命中（none）/ 无法定位模型（含 P1-1 护栏命中） → 不拉黑、不通知
      await Logger.log(`[SessionErrorHandler] 分类未命中，跳过拉黑: sessionID=${sessionID}`);
      return sessionID && deps.modelResolver(sessionID) ? 'unclassified' : 'no-model';
    }

    // 4. 拉黑（沿用 markModelUnavailable 冷却语义：non-transient 长冷却 / transient 短冷却）
    const { kind, model, info } = classification;
    if (kind === 'non-transient') {
      effects.blacklistModel(model, {
        resetAt: info.resetAt,
        ttlMs: info.resetAt ? undefined : MIN_QUOTA_COOLDOWN_TTL_MS,
      });
    } else {
      effects.blacklistModel(model, { ttlMs: TRANSIENT_COOLDOWN_TTL_MS });
    }

    // 5. 通知 + store（标注来源为「事件预降级」，与既有 async_error 风格一致）
    const summary = `session.error 事件预降级：${kind} 错误，模型 ${model} 已临时拉黑（来源：事件预降级）`;
    try {
      await effects.writeNotification({
        type: 'async_error',
        subagent: 'session-error-hook',
        task_id: sessionID ?? 'unknown',
        session_id: sessionID ?? 'unknown',
        summary,
        failure_reason: kind === 'non-transient' ? 'quota-or-persistent' : 'transient',
      });
    } catch {
      // 通知写入失败不阻塞拉黑
    }
    if (effects.writeStoreEvent && sessionID) {
      try {
        await effects.writeStoreEvent({
          workDir: deps.workDir,
          sessionID,
          detail: `session.error 事件预降级拉黑：${kind} → ${model}`,
        });
      } catch {
        // store 写入失败不阻塞
      }
    }

    return 'blacklisted';
  }

  return {
    handle,
    resetDedup: () => lastSeen.clear(),
  };
}
