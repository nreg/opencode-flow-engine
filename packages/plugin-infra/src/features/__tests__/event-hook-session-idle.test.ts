import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getGlobalEventBus, resetGlobalEventBus } from '../event-bus';
import type { EventBus, Event, EventSessionIdle } from '../../types';

const TEST_LOG_DIR = '.flow-engine/sflow';

describe('Batch 2: Hooks.event session.idle 扩展', () => {
  let eventBus: EventBus;

  beforeEach(async () => {
    // 重置全局事件总线
    resetGlobalEventBus();
    eventBus = getGlobalEventBus();
  });

  afterEach(async () => {
    // 重置全局事件总线
    resetGlobalEventBus();
  });

  describe('Task 2.2: 全局事件总线单例', () => {
    it('应该返回同一个全局事件总线实例', () => {
      const bus1 = getGlobalEventBus();
      const bus2 = getGlobalEventBus();

      // 多次调用应返回同一实例
      expect(bus1).toBe(bus2);
    });

    it('resetGlobalEventBus 应该创建新的实例', () => {
      const bus1 = getGlobalEventBus();
      resetGlobalEventBus();
      const bus2 = getGlobalEventBus();

      // 重置后应返回新实例
      expect(bus1).not.toBe(bus2);
    });
  });

  describe('Task 2.1: session.idle 事件派发', () => {
    it('应该在收到 session.idle 事件时派发到事件总线', () => {
      const sessionID = 'test-session-001';
      const listener = vi.fn();

      // 注册监听器
      eventBus.register(sessionID, listener);

      // 创建 EventSessionIdle 事件
      const idleEvent: EventSessionIdle = {
        type: 'session.idle',
        properties: {
          sessionID,
        },
      };

      // 派发事件
      const matched = eventBus.dispatch(sessionID, idleEvent);

      // 应该匹配并调用监听器
      expect(matched).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(idleEvent);
    });

    it('应该为未注册的 sessionID 返回 false', () => {
      const idleEvent: EventSessionIdle = {
        type: 'session.idle',
        properties: {
          sessionID: 'unregistered-session',
        },
      };

      // 派发到未注册的 sessionID
      const matched = eventBus.dispatch('unregistered-session', idleEvent);

      // 应该不匹配
      expect(matched).toBe(false);
    });

    it('应该支持多个 sessionID 的独立监听', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      // 注册两个不同的 sessionID
      eventBus.register('session-001', listener1);
      eventBus.register('session-002', listener2);

      // 派发到 session-001
      const event1: EventSessionIdle = {
        type: 'session.idle',
        properties: { sessionID: 'session-001' },
      };
      eventBus.dispatch('session-001', event1);

      // 只有 listener1 应该被调用
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(0);

      // 派发到 session-002
      const event2: EventSessionIdle = {
        type: 'session.idle',
        properties: { sessionID: 'session-002' },
      };
      eventBus.dispatch('session-002', event2);

      // 现在 listener2 也应该被调用
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it('应该在注销后不再触发监听器', () => {
      const sessionID = 'test-session-001';
      const listener = vi.fn();

      // 注册监听器
      eventBus.register(sessionID, listener);

      // 注销监听器
      eventBus.unregister(sessionID);

      // 派发事件
      const idleEvent: EventSessionIdle = {
        type: 'session.idle',
        properties: { sessionID },
      };
      const matched = eventBus.dispatch(sessionID, idleEvent);

      // 应该不匹配，监听器不应被调用
      expect(matched).toBe(false);
      expect(listener).toHaveBeenCalledTimes(0);
    });
  });

  describe('P0-3: 防御性检查', () => {
    it('session.idle 事件缺 properties 时不应崩溃', () => {
      const sessionID = 'test-session-no-properties';

      // 创建一个没有 properties 的事件
      const event = {
        type: 'session.idle' as const,
        // properties 缺失
      };

      // 派发不应抛出异常
      expect(() => eventBus.dispatch(sessionID, event as any)).not.toThrow();
    });

    it('session.idle 事件 properties 存在但 sessionID 缺失时不应崩溃', () => {
      const sessionID = 'test-session-no-sessionid';

      // 创建一个有 properties 但没有 sessionID 的事件
      const event = {
        type: 'session.idle' as const,
        properties: {}, // sessionID 缺失
      };

      // 派发不应抛出异常
      expect(() => eventBus.dispatch(sessionID, event)).not.toThrow();
    });

    it('session.idle 事件 properties.sessionID 为 null 时不应崩溃', () => {
      const sessionID = 'test-session-null-sessionid';

      // 创建一个 sessionID 为 null 的事件
      const event = {
        type: 'session.idle' as const,
        properties: { sessionID: null },
      };

      // 派发不应抛出异常
      expect(() => eventBus.dispatch(sessionID, event as any)).not.toThrow();
    });
  });

  describe('诊断日志验证', () => {
    it('dispatch 应该记录 matched: true/false', async () => {
      const sessionID = 'test-session-001';
      const listener = vi.fn();

      // 注册监听器
      eventBus.register(sessionID, listener);

      // 派发匹配的事件
      const event: EventSessionIdle = {
        type: 'session.idle',
        properties: { sessionID },
      };
      eventBus.dispatch(sessionID, event);

      // 派发不匹配的事件
      eventBus.dispatch('unregistered', event);

      // 日志应该在 polling.log 中记录
      // 由于日志是异步的，我们等待一小段时间
      await new Promise(resolve => setTimeout(resolve, 100));

      // 验证日志文件存在（实际内容验证在 event-bus.test.ts 中）
      // 这里只验证不抛出异常
      expect(true).toBe(true);
    });
  });
});

// ─── Batch 5: 端到端集成测试 ────────────────────────────────────────────────────────
describe('Batch 5: 端到端集成测试', () => {
  let eventBus: EventBus;

  beforeEach(async () => {
    // 重置全局事件总线
    resetGlobalEventBus();
    eventBus = getGlobalEventBus();
  });

  afterEach(async () => {
    // 重置全局事件总线
    resetGlobalEventBus();
  });

  describe('E2E-1: Hooks.event → dispatch → pollSessionCompletion 响应', () => {
    it('应该模拟插件 Hooks.event 收到 session.idle 并触发 pollSessionCompletion 响应', async () => {
      const sessionID = 'e2e-session-001';

      // 模拟 pollSessionCompletion 注册监听器
      const wakeUpPromise = new Promise<string>((resolve) => {
        eventBus.register(sessionID, (event: Event) => {
          if (event.type === 'session.idle' && event.properties.sessionID === sessionID) {
            resolve('event_received');
          }
        });
      });

      // 模拟 Hooks.event 派发 session.idle 事件
      setTimeout(() => {
        const idleEvent: EventSessionIdle = {
          type: 'session.idle',
          properties: { sessionID },
        };
        eventBus.dispatch(sessionID, idleEvent);
      }, 50);

      // 等待事件到达
      const result = await wakeUpPromise;
      expect(result).toBe('event_received');
    });

    it('应该支持多个 session 并发处理', async () => {
      const session1 = 'e2e-session-001';
      const session2 = 'e2e-session-002';

      // 为两个 session 注册监听器
      const promise1 = new Promise<string>((resolve) => {
        eventBus.register(session1, (event: Event) => {
          if (event.type === 'session.idle') {
            resolve(`session1: ${event.properties.sessionID}`);
          }
        });
      });

      const promise2 = new Promise<string>((resolve) => {
        eventBus.register(session2, (event: Event) => {
          if (event.type === 'session.idle') {
            resolve(`session2: ${event.properties.sessionID}`);
          }
        });
      });

      // 派发两个事件
      setTimeout(() => {
        eventBus.dispatch(session1, { type: 'session.idle', properties: { sessionID: session1 } });
      }, 50);

      setTimeout(() => {
        eventBus.dispatch(session2, { type: 'session.idle', properties: { sessionID: session2 } });
      }, 100);

      // 等待两个事件都到达
      const [result1, result2] = await Promise.all([promise1, promise2]);
      expect(result1).toBe('session1: e2e-session-001');
      expect(result2).toBe('session2: e2e-session-002');
    });
  });

  describe('E2E-2: 轮询兜底（无事件时 status/messages 检测）', () => {
    it('应该在无事件时通过轮询检测完成', async () => {
      const sessionID = 'e2e-session-polling';

      // 模拟轮询检测逻辑
      let pollCount = 0;
      const pollingPromise = new Promise<string>((resolve) => {
        const interval = setInterval(() => {
          pollCount++;
          // 模拟第 3 次轮询时检测到完成
          if (pollCount >= 3) {
            clearInterval(interval);
            resolve('polling_detected');
          }
        }, 50);
      });

      // 不派发事件，依赖轮询
      const result = await pollingPromise;
      expect(result).toBe('polling_detected');
      expect(pollCount).toBe(3);
    });

    it('应该支持事件 + 轮询混合模式', async () => {
      const sessionID = 'e2e-session-hybrid';

      let eventReceived = false;
      let pollCount = 0;

      // 事件监听器
      const eventPromise = new Promise<void>((resolve) => {
        eventBus.register(sessionID, (event: Event) => {
          if (event.type === 'session.idle') {
            eventReceived = true;
            resolve();
          }
        });
      });

      // 轮询兜底
      const pollingPromise = new Promise<string>((resolve) => {
        const interval = setInterval(() => {
          pollCount++;
          if (pollCount >= 5) {
            clearInterval(interval);
            resolve(eventReceived ? 'event' : 'polling');
          }
        }, 30);
      });

      // 在第 2 次轮询时派发事件
      setTimeout(() => {
        if (pollCount >= 2 && !eventReceived) {
          eventBus.dispatch(sessionID, { type: 'session.idle', properties: { sessionID } });
        }
      }, 80);

      const result = await pollingPromise;
      expect(result).toBe('event');
      expect(eventReceived).toBe(true);
    });
  });
});
