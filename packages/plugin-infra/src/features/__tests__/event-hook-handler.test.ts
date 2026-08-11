import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleSessionIdleEvent } from '../event-hook-handler';
import { getGlobalEventBus, resetGlobalEventBus } from '../event-bus';
import type { Event, EventSessionIdle } from '../../types';

describe('P1-2: handleSessionIdleEvent 共享函数', () => {
  beforeEach(() => {
    resetGlobalEventBus();
  });

  afterEach(() => {
    resetGlobalEventBus();
  });

  describe('session.idle 事件处理', () => {
    it('应该处理 session.idle 事件并派发到事件总线', () => {
      const sessionID = 'test-session-001';
      const prefix = 'sFlow';
      const eventBus = getGlobalEventBus();
      const listener = vi.fn();

      eventBus.register(sessionID, listener);

      const idleEvent: EventSessionIdle = {
        type: 'session.idle',
        properties: { sessionID },
      };

      const result = handleSessionIdleEvent(idleEvent as Event, prefix);

      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(idleEvent);
    });

    it('应该在 sessionID 缺失时返回 false', () => {
      const prefix = 'sFlow';
      const event = {
        type: 'session.idle' as const,
        properties: {},
      };

      const result = handleSessionIdleEvent(event as Event, prefix);

      expect(result).toBe(false);
    });

    it('应该在 properties 缺失时返回 false', () => {
      const prefix = 'sFlow';
      const event = {
        type: 'session.idle' as const,
      };

      const result = handleSessionIdleEvent(event as Event, prefix);

      expect(result).toBe(false);
    });

    it('应该使用正确的日志前缀', () => {
      const sessionID = 'test-session-001';
      const prefixes = ['sFlow', 'iFlow', 'Combined'];
      const consoleSpy = vi.spyOn(console, 'log');

      for (const prefix of prefixes) {
        resetGlobalEventBus();
        const idleEvent: EventSessionIdle = {
          type: 'session.idle',
          properties: { sessionID: `${sessionID}-${prefix}` },
        };

        handleSessionIdleEvent(idleEvent as Event, prefix);

        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining(`[${prefix}] event hook received session.idle`)
        );
      }

      consoleSpy.mockRestore();
    });

    it('应该为未注册的 sessionID 返回 false', () => {
      const prefix = 'sFlow';
      const idleEvent: EventSessionIdle = {
        type: 'session.idle',
        properties: { sessionID: 'unregistered-session' },
      };

      const result = handleSessionIdleEvent(idleEvent as Event, prefix);

      expect(result).toBe(false);
    });
  });

  describe('session.status 事件处理', () => {
    it('应该处理 status.type === "idle" 的 session.status 事件', () => {
      const sessionID = 'test-session-001';
      const prefix = 'iFlow';
      const eventBus = getGlobalEventBus();
      const listener = vi.fn();

      eventBus.register(sessionID, listener);

      const statusEvent = {
        type: 'session.status' as const,
        properties: {
          sessionID,
          status: { type: 'idle' },
        },
      };

      const result = handleSessionIdleEvent(statusEvent as Event, prefix);

      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      // 应该转换为 session.idle 事件格式
      expect(listener).toHaveBeenCalledWith({
        type: 'session.idle',
        properties: { sessionID },
      });
    });

    it('应该在 status.type !== "idle" 时返回 false', () => {
      const prefix = 'sFlow';
      const statusEvent = {
        type: 'session.status' as const,
        properties: {
          sessionID: 'test-session-001',
          status: { type: 'running' },
        },
      };

      const result = handleSessionIdleEvent(statusEvent as Event, prefix);

      expect(result).toBe(false);
    });

    it('应该在 sessionID 缺失时返回 false', () => {
      const prefix = 'sFlow';
      const statusEvent = {
        type: 'session.status' as const,
        properties: {
          status: { type: 'idle' },
        },
      };

      const result = handleSessionIdleEvent(statusEvent as Event, prefix);

      expect(result).toBe(false);
    });

    it('应该在 status 缺失时返回 false', () => {
      const prefix = 'sFlow';
      const statusEvent = {
        type: 'session.status' as const,
        properties: {
          sessionID: 'test-session-001',
        },
      };

      const result = handleSessionIdleEvent(statusEvent as Event, prefix);

      expect(result).toBe(false);
    });
  });

  describe('其他事件类型', () => {
    it('应该对非 session.idle/status 事件返回 false', () => {
      const prefix = 'sFlow';
      const otherEvent = {
        type: 'session.created' as const,
        properties: {},
      };

      const result = handleSessionIdleEvent(otherEvent as Event, prefix);

      expect(result).toBe(false);
    });

    it('应该对 session.deleted 事件返回 false', () => {
      const prefix = 'sFlow';
      const deletedEvent = {
        type: 'session.deleted' as const,
        properties: {},
      };

      const result = handleSessionIdleEvent(deletedEvent as Event, prefix);

      expect(result).toBe(false);
    });
  });

  describe('防御性检查', () => {
    it('应该处理 null properties', () => {
      const prefix = 'sFlow';
      const event = {
        type: 'session.idle' as const,
        properties: null,
      };

      expect(() => handleSessionIdleEvent(event as any, prefix)).not.toThrow();
    });

    it('应该处理 undefined properties', () => {
      const prefix = 'sFlow';
      const event = {
        type: 'session.idle' as const,
        properties: undefined,
      };

      expect(() => handleSessionIdleEvent(event as any, prefix)).not.toThrow();
    });
  });
});
