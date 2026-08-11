/**
 * Event Hook Handler
 *
 * Shared logic for handling session.idle and session.status events
 * across SFlow, IFlow, and Combined plugin factories.
 *
 * P1-2: Extracted from three plugin factories to eliminate ~20 lines of duplicate code.
 */

import type { Event } from '../types.js';
import { getGlobalEventBus } from './event-bus.js';

/**
 * Handle session.idle and session.status events
 *
 * This function handles two event types:
 * 1. session.idle: Directly dispatch to event bus
 * 2. session.status: Check if status.type === 'idle', then dispatch
 *
 * @param event - The event to handle
 * @param prefix - Log prefix (e.g., 'sFlow', 'iFlow', 'Combined')
 * @returns true if the event was handled (matched and dispatched), false otherwise
 *
 * @example
 * ```ts
 * const event = input.event;
 * console.log(`[${prefix}] event hook received: type=${event.type}`);
 *
 * if (event.type === 'session.created' || event.type === 'session.deleted') {
 *   // Handle workflow-specific hooks
 * } else {
 *   // Handle session.idle/status with shared logic
 *   handleSessionIdleEvent(event, 'sFlow');
 * }
 * ```
 */
export function handleSessionIdleEvent(event: Event, prefix: string): boolean {
  if (event.type === 'session.idle') {
    // Batch 2 Task 2.1: 监听 session.idle 事件并派发到事件总线
    // P0-3: 防御性检查 - 确保 properties 和 sessionID 存在
    const properties = event.properties as { sessionID?: string } | undefined;
    if (properties?.sessionID) {
      // 诊断日志：记录 hook 收到事件
      console.log(`[${prefix}] event hook received session.idle: type=${event.type}, sessionID=${properties.sessionID}`);

      // 派发到全局事件总线
      const eventBus = getGlobalEventBus();
      const matched = eventBus.dispatch(properties.sessionID, event);

      // 诊断日志：记录派发结果
      console.log(`[${prefix}] eventBus.dispatch result: matched=${matched}`);

      return matched;
    } else {
      console.log(`[${prefix}] event hook received session.idle without sessionID, ignored`);
      return false;
    }
  } else if (event.type === 'session.status') {
    // P0-2: 兜底监听 session.status 事件（当插件不推送独立的 session.idle 时）
    // 检查 status.type === 'idle' 且 sessionID 匹配时也派发到事件总线
    const statusData = event.properties as { sessionID?: string; status?: { type?: string } };
    if (statusData.status?.type === 'idle' && statusData.sessionID) {
      console.log(`[${prefix}] event hook received session.status idle: sessionID=${statusData.sessionID}`);

      // 派发到全局事件总线（转换为 session.idle 事件格式）
      const eventBus = getGlobalEventBus();
      const idleEvent = {
        type: 'session.idle',
        properties: { sessionID: statusData.sessionID },
      };
      const matched = eventBus.dispatch(statusData.sessionID, idleEvent);

      console.log(`[${prefix}] eventBus.dispatch (from session.status) result: matched=${matched}`);

      return matched;
    }
    return false;
  }

  // Not a session.idle or session.status event
  return false;
}
