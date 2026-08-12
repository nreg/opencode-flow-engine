import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleSessionIdleEvent } from '../event-hook-handler';
import { getGlobalEventBus, resetGlobalEventBus } from '../event-bus';
import { PollingLogger } from '../polling-logger';
import type { Event, EventSessionIdle } from '../../types';

// 创建 mock PollingLogger
function createMockLogger() {
  return {
    log: vi.fn().mockResolvedValue(undefined),
  } as unknown as PollingLogger;
}

describe('P1-2: handleSessionIdleEvent 共享函数', () => {
  beforeEach(() => {
    resetGlobalEventBus();
  });

  afterEach(() => {
    resetGlobalEventBus();
  });

  describe('session.idle 事件处理', () => {
    it('应该处理 session.idle 事件并派发到事件总线', async () => {
      const sessionID = 'test-session-001';
      const prefix = 'sFlow';
      const eventBus = getGlobalEventBus();
      const listener = vi.fn();
      const logger = createMockLogger();

      eventBus.register(sessionID, listener);

      const idleEvent: EventSessionIdle = {
        type: 'session.idle',
        properties: { sessionID },
      };

      const result = await handleSessionIdleEvent(idleEvent as Event, prefix, logger);

      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(idleEvent);
      // 验证 logger.log 被调用
      expect(logger.log).toHaveBeenCalled();
    });

    it('应该在 sessionID 缺失时返回 false', async () => {
      const prefix = 'sFlow';
      const logger = createMockLogger();
      const event = {
        type: 'session.idle' as const,
        properties: {},
      };

      const result = await handleSessionIdleEvent(event as Event, prefix, logger);

      expect(result).toBe(false);
    });

    it('应该在 properties 缺失时返回 false', async () => {
      const prefix = 'sFlow';
      const logger = createMockLogger();
      const event = {
        type: 'session.idle' as const,
      };

      const result = await handleSessionIdleEvent(event as Event, prefix, logger);

      expect(result).toBe(false);
    });

    it('应该使用正确的日志前缀', async () => {
      const sessionID = 'test-session-001';
      const prefixes = ['sFlow', 'iFlow', 'Combined'];
      const logger = createMockLogger();

      for (const prefix of prefixes) {
        resetGlobalEventBus();
        (logger.log as ReturnType<typeof vi.fn>).mockClear();
        const idleEvent: EventSessionIdle = {
          type: 'session.idle',
          properties: { sessionID: `${sessionID}-${prefix}` },
        };

        await handleSessionIdleEvent(idleEvent as Event, prefix, logger);

        // 验证 logger.log 被调用，且消息包含正确的前缀
        expect(logger.log).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining('event hook received session.idle'),
          expect.objectContaining({ prefix })
        );
      }
    });

    it('应该为未注册的 sessionID 返回 false', async () => {
      const prefix = 'sFlow';
      const logger = createMockLogger();
      const idleEvent: EventSessionIdle = {
        type: 'session.idle',
        properties: { sessionID: 'unregistered-session' },
      };

      const result = await handleSessionIdleEvent(idleEvent as Event, prefix, logger);

      expect(result).toBe(false);
    });
  });

  describe('session.status 事件处理', () => {
    it('应该处理 status.type === "idle" 的 session.status 事件', async () => {
      const sessionID = 'test-session-001';
      const prefix = 'iFlow';
      const eventBus = getGlobalEventBus();
      const listener = vi.fn();
      const logger = createMockLogger();

      eventBus.register(sessionID, listener);

      const statusEvent = {
        type: 'session.status' as const,
        properties: {
          sessionID,
          status: { type: 'idle' },
        },
      };

      const result = await handleSessionIdleEvent(statusEvent as Event, prefix, logger);

      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      // 应该转换为 session.idle 事件格式
      expect(listener).toHaveBeenCalledWith({
        type: 'session.idle',
        properties: { sessionID },
      });
      // 验证 logger.log 被调用
      expect(logger.log).toHaveBeenCalled();
    });

    it('应该在 status.type !== "idle" 时返回 false', async () => {
      const prefix = 'sFlow';
      const logger = createMockLogger();
      const statusEvent = {
        type: 'session.status' as const,
        properties: {
          sessionID: 'test-session-001',
          status: { type: 'running' },
        },
      };

      const result = await handleSessionIdleEvent(statusEvent as Event, prefix, logger);

      expect(result).toBe(false);
    });

    it('应该在 sessionID 缺失时返回 false', async () => {
      const prefix = 'sFlow';
      const logger = createMockLogger();
      const statusEvent = {
        type: 'session.status' as const,
        properties: {
          status: { type: 'idle' },
        },
      };

      const result = await handleSessionIdleEvent(statusEvent as Event, prefix, logger);

      expect(result).toBe(false);
    });

    it('应该在 status 缺失时返回 false', async () => {
      const prefix = 'sFlow';
      const logger = createMockLogger();
      const statusEvent = {
        type: 'session.status' as const,
        properties: {
          sessionID: 'test-session-001',
        },
      };

      const result = await handleSessionIdleEvent(statusEvent as Event, prefix, logger);

      expect(result).toBe(false);
    });
  });

  describe('其他事件类型', () => {
    it('应该对非 session.idle/status 事件返回 false', async () => {
      const prefix = 'sFlow';
      const logger = createMockLogger();
      const otherEvent = {
        type: 'session.created' as const,
        properties: {},
      };

      const result = await handleSessionIdleEvent(otherEvent as Event, prefix, logger);

      expect(result).toBe(false);
    });

    it('应该对 session.deleted 事件返回 false', async () => {
      const prefix = 'sFlow';
      const logger = createMockLogger();
      const deletedEvent = {
        type: 'session.deleted' as const,
        properties: {},
      };

      const result = await handleSessionIdleEvent(deletedEvent as Event, prefix, logger);

      expect(result).toBe(false);
    });
  });

  describe('防御性检查', () => {
    it('应该处理 null properties', async () => {
      const prefix = 'sFlow';
      const logger = createMockLogger();
      const event = {
        type: 'session.idle' as const,
        properties: null,
      };

      const result = await handleSessionIdleEvent(event as any, prefix, logger);
      expect(result).toBe(false);
    });

    it('应该处理 undefined properties', async () => {
      const prefix = 'sFlow';
      const logger = createMockLogger();
      const event = {
        type: 'session.idle' as const,
        properties: undefined,
      };

      const result = await handleSessionIdleEvent(event as any, prefix, logger);
      expect(result).toBe(false);
    });
  });
});
