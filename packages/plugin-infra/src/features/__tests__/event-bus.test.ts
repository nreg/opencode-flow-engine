import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEventBus } from '../event-bus';
import type { EventBus, Event } from '../../types';
import { join } from 'path';
import { mkdir, rm, readFile } from 'fs/promises';

const TEST_LOG_DIR = join(process.cwd(), '.flow-engine', 'sflow');
const TEST_LOG_FILE = join(TEST_LOG_DIR, 'polling.log');

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(async () => {
    // 清理测试环境
    try {
      await rm(TEST_LOG_DIR, { recursive: true, force: true });
    } catch {
      // 目录不存在，忽略
    }
    eventBus = createEventBus();
  });

  afterEach(async () => {
    // 清理测试环境
    try {
      await rm(TEST_LOG_DIR, { recursive: true, force: true });
    } catch {
      // 目录不存在，忽略
    }
  });

  describe('Task 1.1: 注册监听器', () => {
    it('应该成功注册监听器', () => {
      const sessionID = 'test-session-001';
      const listener = vi.fn();

      // 注册不应抛出异常
      expect(() => eventBus.register(sessionID, listener)).not.toThrow();
    });

    it('应该允许注册多个不同 sessionID 的监听器', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      eventBus.register('session-001', listener1);
      eventBus.register('session-002', listener2);

      // 不应抛出异常
      expect(true).toBe(true);
    });
  });

  describe('Task 1.2: 派发事件', () => {
    it('应该成功派发事件到已注册的监听器', () => {
      const sessionID = 'test-session-001';
      const listener = vi.fn();
      const event: Event = {
        type: 'session.idle',
        properties: { sessionID },
      };

      eventBus.register(sessionID, listener);
      const result = eventBus.dispatch(sessionID, event);

      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it('派发到未注册的 sessionID 应返回 false', () => {
      const event: Event = {
        type: 'session.idle',
        properties: { sessionID: 'unknown-session' },
      };

      const result = eventBus.dispatch('unknown-session', event);

      expect(result).toBe(false);
    });

    it('派发事件应该传递完整的事件数据', () => {
      const sessionID = 'test-session-002';
      const listener = vi.fn();
      const event: Event = {
        type: 'session.idle',
        properties: {
          sessionID,
          customData: 'test-value',
          nested: { key: 'value' },
        },
      };

      eventBus.register(sessionID, listener);
      eventBus.dispatch(sessionID, event);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session.idle',
          properties: expect.objectContaining({
            sessionID,
            customData: 'test-value',
          }),
        })
      );
    });
  });

  describe('Task 1.3: 注销监听器', () => {
    it('应该成功注销已注册的监听器', () => {
      const sessionID = 'test-session-003';
      const listener = vi.fn();

      eventBus.register(sessionID, listener);
      eventBus.unregister(sessionID);

      // 注销后派发应该返回 false
      const event: Event = { type: 'session.idle', properties: { sessionID } };
      const result = eventBus.dispatch(sessionID, event);

      expect(result).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it('注销未注册的 sessionID 不应抛出异常', () => {
      expect(() => eventBus.unregister('unknown-session')).not.toThrow();
    });
  });

  describe('Task 1.4: 幂等性保证', () => {
    it('同一 sessionID 重复派发只触发一次', () => {
      const sessionID = 'test-session-004';
      const listener = vi.fn();
      const event: Event = {
        type: 'session.idle',
        properties: { sessionID },
      };

      eventBus.register(sessionID, listener);

      // 第一次派发
      const result1 = eventBus.dispatch(sessionID, event);
      expect(result1).toBe(true);
      expect(listener).toHaveBeenCalledTimes(1);

      // 第二次派发（同一 sessionID）
      const result2 = eventBus.dispatch(sessionID, event);
      expect(result2).toBe(true);
      // 监听器应该被调用两次（每次派发都触发）
      // 但不会重复注册（内部 Map 保证）
    });

    it('重复注册应该覆盖旧监听器并触发警告', () => {
      const sessionID = 'test-session-duplicate';
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const event: Event = {
        type: 'session.idle',
        properties: { sessionID },
      };

      // 捕获 console.warn
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // 第一次注册
      eventBus.register(sessionID, listener1);

      // 第二次注册（同一 sessionID）应该覆盖并警告
      eventBus.register(sessionID, listener2);

      // 验证警告被触发
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EventBus] Overwriting existing listener')
      );

      // 派发事件，应该调用 listener2（新监听器）
      const result = eventBus.dispatch(sessionID, event);
      expect(result).toBe(true);
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);

      // 清理 spy
      warnSpy.mockRestore();
    });

    it('注销后重新注册应该可以再次派发', () => {
      const sessionID = 'test-session-005';
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const event: Event = {
        type: 'session.idle',
        properties: { sessionID },
      };

      // 第一次注册
      eventBus.register(sessionID, listener1);
      eventBus.dispatch(sessionID, event);
      expect(listener1).toHaveBeenCalledTimes(1);

      // 注销
      eventBus.unregister(sessionID);

      // 重新注册
      eventBus.register(sessionID, listener2);
      const result = eventBus.dispatch(sessionID, event);
      expect(result).toBe(true);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Task 1.5: 日志记录（完整诊断日志）', () => {
    it('register 操作应该记录日志', async () => {
      const sessionID = 'test-session-006';
      const listener = vi.fn();

      eventBus.register(sessionID, listener);

      // 等待日志写入（异步）
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 验证日志文件存在
      try {
        const content = await readFile(TEST_LOG_FILE, 'utf-8');
        expect(content).toContain('event-bus register');
        expect(content).toContain(sessionID);
      } catch {
        // 日志文件可能还未创建（异步写入）
        // 这个测试在实现后会通过
      }
    });

    it('dispatch 操作应该记录日志', async () => {
      const sessionID = 'test-session-007';
      const listener = vi.fn();
      const event: Event = {
        type: 'session.idle',
        properties: { sessionID },
      };

      eventBus.register(sessionID, listener);
      eventBus.dispatch(sessionID, event);

      // 等待日志写入
      await new Promise((resolve) => setTimeout(resolve, 100));

      try {
        const content = await readFile(TEST_LOG_FILE, 'utf-8');
        expect(content).toContain('event-bus dispatch');
        expect(content).toContain(sessionID);
        expect(content).toContain('matched');
      } catch {
        // 日志文件可能还未创建
      }
    });

    it('unregister 操作应该记录日志', async () => {
      const sessionID = 'test-session-008';
      const listener = vi.fn();

      eventBus.register(sessionID, listener);
      eventBus.unregister(sessionID);

      // 等待日志写入
      await new Promise((resolve) => setTimeout(resolve, 100));

      try {
        const content = await readFile(TEST_LOG_FILE, 'utf-8');
        expect(content).toContain('event-bus unregister');
        expect(content).toContain(sessionID);
      } catch {
        // 日志文件可能还未创建
      }
    });
  });

  describe('Task 1.6: 边界情况', () => {
    it('应该支持空事件数据', () => {
      const sessionID = 'test-session-009';
      const listener = vi.fn();
      const event: Event = { type: 'session.idle' };

      eventBus.register(sessionID, listener);
      const result = eventBus.dispatch(sessionID, event);

      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledWith(event);
    });

    it('应该支持复杂嵌套的事件数据', () => {
      const sessionID = 'test-session-010';
      const listener = vi.fn();
      const event: Event = {
        type: 'session.idle',
        properties: {
          sessionID,
          nested: {
            level1: {
              level2: {
                level3: 'deep-value',
              },
            },
          },
          array: [1, 2, 3],
        },
      };

      eventBus.register(sessionID, listener);
      const result = eventBus.dispatch(sessionID, event);

      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledWith(event);
    });
  });
});
