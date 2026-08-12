import type { EventBus, EventBusListener, Event } from '../types.js';
import { PollingLogger } from './polling-logger.js';
import { Logger } from '../utils/logger.js';

// ─── 全局事件总线单例 (Task 2.2) ───────────────────────────────────────────────

/**
 * 全局事件总线实例
 *
 * R2: 全局单例设计，使 pollSessionCompletion 与插件 hook 都能访问同一实例。
 * - pollSessionCompletion 在启动时注册 sessionID → 完成回调
 * - Hooks.event 在收到 session.idle 时派发事件
 * - 两者通过全局单例通信，无需跨模块传递实例
 */
let globalEventBus: EventBus | null = null;

/**
 * 获取全局事件总线实例
 *
 * @returns 全局事件总线单例
 *
 * Task 2.2: 创建全局事件总线实例并注入
 * - 首次调用时创建实例
 * - 后续调用返回同一实例
 * - 用于 pollSessionCompletion 和 Hooks.event 之间的通信
 */
export function getGlobalEventBus(): EventBus {
  if (!globalEventBus) {
    globalEventBus = createEventBus();
  }
  return globalEventBus;
}

/**
 * 重置全局事件总线实例
 *
 * 主要用于测试环境，确保每个测试用例使用独立的事件总线。
 */
export function resetGlobalEventBus(): void {
  globalEventBus = null;
}

/**
 * 创建事件总线实例
 *
 * R1: 载量级事件总线实现，使用 Map<sessionID, listener> 模式。
 * - 无消息队列依赖
 * - 无 EventEmitter 依赖
 * - 无 RxJS 依赖
 *
 * 功能：
 * - register: 注册 sessionID → 完成回调
 * - dispatch: 按 sessionID 派发事件
 * - unregister: 移除注册（防泄漏）
 *
 * 幂等性：同一 sessionID 可重复派发，每次都会触发监听器
 * 日志：register/dispatch/unregister 各记录一条诊断日志
 */
export function createEventBus(): EventBus {
  // 内部存储：Map<sessionID, listener>
  const listeners = new Map<string, EventBusListener>();

  // 日志记录器（复用 PollingLogger）
  const logger = new PollingLogger();

  return {
    /**
     * 注册监听器（非幂等操作）
     *
     * @param sessionID - 会话 ID
     * @param onComplete - 完成回调函数
     *
     * 语义说明：
     * - 若 sessionID 已存在监听器，覆盖旧监听器并触发 console.warn（重复注册通常是 bug 信号）
     * - 正常流程：pollSessionCompletion 启动时注册，完成/超时后 unregister
     * - 使用建议：确保成对调用 register/unregister，避免泄漏
     */
    register(sessionID: string, onComplete: EventBusListener): void {
      // 若已存在监听器，覆盖并记录警告（重复注册通常是 bug 信号）
      if (listeners.has(sessionID)) {
        Logger.warn(`[EventBus] Overwriting existing listener for sessionID: ${sessionID}`);
        listeners.delete(sessionID);
      }

      listeners.set(sessionID, onComplete);

      // 记录诊断日志
      logger.log(sessionID, 'event-bus register', {
        action: 'register',
        listenerCount: listeners.size,
      }).catch((error: unknown) => {
        Logger.warn(`[EventBus] Failed to log register: ${error instanceof Error ? error.message : String(error)}`);
      });
    },

    /**
     * 派发事件
     *
     * @param sessionID - 会话 ID
     * @param event - 事件数据
     * @returns true 如果找到并调用了监听器，false 否则
     *
     * 幂等性说明：
     * - 单次 dispatch 只调用一次监听器（幂等）
     * - 同一 sessionID 的监听器每次 dispatch 都会触发（非去重）
     */
    dispatch(sessionID: string, event: Event): boolean {
      const listener = listeners.get(sessionID);
      const matched = listener !== undefined;

      if (matched) {
        // 调用监听器
        listener(event);
      }

      // 记录诊断日志
      logger.log(sessionID, 'event-bus dispatch', {
        action: 'dispatch',
        eventType: event.type,
        matched,
        listenerCount: listeners.size,
      }).catch((error: unknown) => {
        Logger.warn(`[EventBus] Failed to log dispatch: ${error instanceof Error ? error.message : String(error)}`);
      });

      return matched;
    },

    /**
     * 注销监听器
     *
     * @param sessionID - 会话 ID
     */
    unregister(sessionID: string): void {
      const existed = listeners.has(sessionID);
      listeners.delete(sessionID);

      // 记录诊断日志
      logger.log(sessionID, 'event-bus unregister', {
        action: 'unregister',
        existed,
        listenerCount: listeners.size,
      }).catch((error: unknown) => {
        Logger.warn(`[EventBus] Failed to log unregister: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
  };
}
