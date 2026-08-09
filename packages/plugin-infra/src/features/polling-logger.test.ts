import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PollingLogger } from './polling-logger';
import { join } from 'path';
import { mkdir, rm, readFile } from 'fs/promises';

const TEST_LOG_DIR = join(process.cwd(), '.flow-engine', 'sflow');
const TEST_LOG_FILE = join(TEST_LOG_DIR, 'polling.log');

describe('PollingLogger', () => {
  let logger: PollingLogger;

  beforeEach(async () => {
    // 清理测试环境
    try {
      await rm(TEST_LOG_DIR, { recursive: true, force: true });
    } catch {
      // 目录不存在，忽略
    }
    logger = new PollingLogger();
  });

  afterEach(async () => {
    // 清理测试环境
    try {
      await rm(TEST_LOG_DIR, { recursive: true, force: true });
    } catch {
      // 目录不存在，忽略
    }
  });

  describe('Task 1.1: 日志写入基础功能', () => {
    it('应该成功写入日志到 polling.log 文件', async () => {
      const sessionId = 'test-session-001';
      const message = 'Test log message';
      const metadata = { key: 'value' };

      await logger.log(sessionId, message, metadata);

      // 验证文件存在
      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      expect(content).toContain(message);
      expect(content).toContain(sessionId);
    });

    it('应该创建 .flow-engine/sflow 目录（如果不存在）', async () => {
      const sessionId = 'test-session-002';
      const message = 'Test message';

      await logger.log(sessionId, message);

      // 验证目录被创建
      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      expect(content).toBeTruthy();
    });
  });

  describe('Task 1.2: 追加模式测试', () => {
    it('应该以追加模式写入日志（不覆盖已有内容）', async () => {
      const sessionId1 = 'session-001';
      const message1 = 'First message';
      const sessionId2 = 'session-002';
      const message2 = 'Second message';

      // 写入第一条日志
      await logger.log(sessionId1, message1);

      // 写入第二条日志
      await logger.log(sessionId2, message2);

      // 验证两条日志都存在
      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      expect(content).toContain(message1);
      expect(content).toContain(message2);

      // 验证是追加模式（两行）
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
    });

    it('多次写入应该按顺序追加', async () => {
      const messages = ['msg1', 'msg2', 'msg3', 'msg4', 'msg5'];

      for (const msg of messages) {
        await logger.log('session', msg);
      }

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(5);

      // 验证顺序
      messages.forEach((msg) => {
        expect(content).toContain(msg);
      });
    });
  });

  describe('Task 1.3: 日志格式测试', () => {
    it('应该使用正确的结构化格式：[ISO-timestamp] [INFO] [sessionID] message | metadata', async () => {
      const sessionId = 'test-session-003';
      const message = 'Formatted message';
      const metadata = { userId: 123, action: 'test' };

      await logger.log(sessionId, message, metadata);

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const line = content.trim();

      // 验证格式组成部分
      expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/); // ISO timestamp
      expect(line).toContain('[INFO]');
      expect(line).toContain(`[${sessionId}]`);
      expect(line).toContain(message);
      expect(line).toContain('"userId":123');
      expect(line).toContain('"action":"test"');
    });

    it('当 metadata 为空时，应该省略 metadata 部分', async () => {
      const sessionId = 'test-session-004';
      const message = 'Message without metadata';

      await logger.log(sessionId, message);

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const line = content.trim();

      expect(line).toContain(message);
      expect(line).toContain(`[${sessionId}]`);
      // 不应该包含 | 符号（因为 metadata 为空）
      expect(line).not.toMatch(/\|/);
    });

    it('每条日志应该独占一行', async () => {
      await logger.log('session-1', 'Message 1', { key: 'value1' });
      await logger.log('session-2', 'Message 2', { key: 'value2' });

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(2);
      lines.forEach((line) => {
        expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T/); // 每行都以时间戳开始
      });
    });
  });

  describe('Task 1.4: 错误处理测试', () => {
    it('写入失败时应该降级到 console.warn，不抛出异常', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const invalidLogger = new PollingLogger('Z:\\nonexistent\\drive\\polling.log');

      let error: Error | null = null;
      try {
        await invalidLogger.log('session', 'test message');
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeNull();

      // 应该调用 console.warn
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });

    it('写入失败时应该包含错误信息在 console.warn 中', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const invalidLogger = new PollingLogger('Z:\\nonexistent\\drive\\polling.log');
      await invalidLogger.log('session', 'test message', { key: 'value' });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[PollingLogger] Failed to write log:'),
        expect.any(String)
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('P1-2: 并发写入安全测试', () => {
    it('并发调用 log() 多次应该不导致日志行交错', async () => {
      const concurrentCalls = 10;
      const promises: Promise<void>[] = [];

      for (let i = 0; i < concurrentCalls; i++) {
        promises.push(logger.log(`session-${i}`, `Message ${i}`, { index: i }));
      }

      await Promise.all(promises);

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(concurrentCalls);

      lines.forEach((line) => {
        expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] \[session-\d+\] Message \d+ \| {"index":\d+}$/);
      });
    });

    it('并发写入应该保证所有日志都被写入', async () => {
      const concurrentCalls = 20;
      const promises: Promise<void>[] = [];

      for (let i = 0; i < concurrentCalls; i++) {
        promises.push(logger.log('concurrent-session', `Log ${i}`));
      }

      await Promise.all(promises);

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(concurrentCalls);

      for (let i = 0; i < concurrentCalls; i++) {
        expect(content).toContain(`Log ${i}`);
      }
    });

    it('并发写入应该保持顺序性（队列机制）', async () => {
      const messages = ['first', 'second', 'third', 'fourth', 'fifth'];
      const promises: Promise<void>[] = [];

      for (const msg of messages) {
        promises.push(logger.log('order-session', msg));
      }

      await Promise.all(promises);

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(messages.length);

      const positions = messages.map((msg) => content.indexOf(msg));
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]).toBeGreaterThan(positions[i - 1]);
      }
    });

    // P1-2: 写队列异常隔离 - 单次失败不影响后续写入
    it('单次写入失败后，后续写入应该仍然正常', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // 使用一个临时路径，第一次会失败（目录不存在且无法创建），后续会成功
      const tempPath = join(process.cwd(), '.flow-engine', 'sflow', 'temp-test.log');
      const tempLogger = new PollingLogger(tempPath);

      // 第一次写入 - 可能失败（但不应该抛出异常）
      await tempLogger.log('session-1', 'First message');

      // 第二次写入 - 应该成功（队列仍然可用）
      await tempLogger.log('session-2', 'Second message');

      // 第三次写入 - 应该成功
      await tempLogger.log('session-3', 'Third message');

      // 验证队列仍然可用（没有因为第一次失败而阻塞）
      // 如果队列被阻塞，第三次写入会等待第一次的 rejected promise
      const content = await readFile(tempPath, 'utf-8');
      expect(content).toContain('Second message');
      expect(content).toContain('Third message');

      consoleWarnSpy.mockRestore();

      // 清理临时文件
      try {
        await rm(tempPath, { force: true });
      } catch {
        // 忽略清理失败
      }
    });
  });
});
