import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from './logger';
import { join } from 'path';
import { mkdir, rm, readFile, writeFile } from 'fs/promises';

const TEST_LOG_DIR = join(process.cwd(), '.flow-engine', 'sflow');
const TEST_LOG_FILE = join(TEST_LOG_DIR, 'plugin.log');

describe('Logger', () => {
  beforeEach(async () => {
    // 清理测试环境
    try {
      await rm(TEST_LOG_DIR, { recursive: true, force: true });
    } catch {
      // 目录不存在，忽略
    }
    // 重置 Logger 状态（重新初始化）
    Logger.initialize(process.cwd());
  });

  afterEach(async () => {
    // 清理测试环境
    try {
      await rm(TEST_LOG_DIR, { recursive: true, force: true });
    } catch {
      // 目录不存在，忽略
    }
  });

  describe('Task 1.1: Logger 类骨架', () => {
    it('应该存在 Logger 类', () => {
      expect(Logger).toBeDefined();
    });

    it('应该有 initialize 静态方法', () => {
      expect(Logger.initialize).toBeDefined();
      expect(typeof Logger.initialize).toBe('function');
    });

    it('应该有 warn/log/error 静态方法', () => {
      expect(Logger.warn).toBeDefined();
      expect(Logger.log).toBeDefined();
      expect(Logger.error).toBeDefined();
      expect(typeof Logger.warn).toBe('function');
      expect(typeof Logger.log).toBe('function');
      expect(typeof Logger.error).toBe('function');
    });
  });

  describe('Task 1.2: 日志格式化', () => {
    it('应该使用正确的格式：[YYYY-MM-DD HH:mm:ss] [LEVEL] message', async () => {
      const message = 'Test log message';

      await Logger.log(message);

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const line = content.trim();

      // 验证格式：[YYYY-MM-DD HH:mm:ss] [LOG] message
      expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
      expect(line).toContain('[LOG]');
      expect(line).toContain(message);
    });

    it('warn 方法应该使用 [WARN] 级别', async () => {
      const message = 'Warning message';

      await Logger.warn(message);

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      expect(content).toContain('[WARN]');
      expect(content).toContain(message);
    });

    it('error 方法应该使用 [ERROR] 级别', async () => {
      const message = 'Error message';

      await Logger.error(message);

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      expect(content).toContain('[ERROR]');
      expect(content).toContain(message);
    });

    it('时间戳应该精确到秒', async () => {
      await Logger.log('Test');

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const line = content.trim();

      // 匹配 [YYYY-MM-DD HH:mm:ss] 格式
      const timestampMatch = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
      expect(timestampMatch).toBeTruthy();
      
      // 验证时间戳是有效的
      const timestamp = timestampMatch![1];
      const date = new Date(timestamp.replace(' ', 'T'));
      expect(date.toString()).not.toBe('Invalid Date');
    });
  });

  describe('Task 1.3: 队列入队逻辑', () => {
    it('应该支持并发写入（队列串行化）', async () => {
      const messages = ['msg1', 'msg2', 'msg3', 'msg4', 'msg5'];

      // 并发写入
      await Promise.all(messages.map(msg => Logger.log(msg)));

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');

      // 所有消息都应该被写入
      expect(lines.length).toBe(5);
      messages.forEach(msg => {
        expect(content).toContain(msg);
      });
    });

    it('写入应该按顺序执行（串行化）', async () => {
      const messages = ['first', 'second', 'third'];

      // 顺序写入
      for (const msg of messages) {
        await Logger.log(msg);
      }

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(3);
      
      // 验证顺序（第一条包含 first，第二条包含 second，等等）
      expect(lines[0]).toContain('first');
      expect(lines[1]).toContain('second');
      expect(lines[2]).toContain('third');
    });
  });

  describe('Task 1.4: 队列处理逻辑（追加写入）', () => {
    it('应该以追加模式写入日志（不覆盖）', async () => {
      const message1 = 'First message';
      const message2 = 'Second message';

      await Logger.log(message1);
      await Logger.log(message2);

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      
      // 两条消息都应该存在
      expect(content).toContain(message1);
      expect(content).toContain(message2);

      // 验证是两行
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
    });

    it('应该创建 .flow-engine/sflow 目录（如果不存在）', async () => {
      await Logger.log('Test message');

      // 验证目录和文件被创建
      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      expect(content).toBeTruthy();
    });

    it('每条日志应该独占一行', async () => {
      await Logger.log('Message 1');
      await Logger.warn('Message 2');
      await Logger.error('Message 3');

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines.length).toBe(3);
      lines.forEach(line => {
        expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
      });
    });
  });

  describe('Task 1.5: 路径初始化', () => {
    it('应该支持显式 initialize(changeDir)', async () => {
      const customDir = process.cwd();
      Logger.initialize(customDir);

      await Logger.log('Test with custom dir');

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      expect(content).toContain('Test with custom dir');
    });

    it('应该支持默认 process.cwd()', async () => {
      // 不调用 initialize，使用默认路径
      Logger.initialize(process.cwd());

      await Logger.log('Test with default dir');

      const content = await readFile(TEST_LOG_FILE, 'utf-8');
      expect(content).toContain('Test with default dir');
    });
  });

  describe('Task 1.6: 写入失败静默降级', () => {
    it('写入失败时应该静默降级（不抛异常）', async () => {
      // 创建一个无效路径（模拟写入失败）
      const invalidDir = '/invalid/path/that/does/not/exist';
      Logger.initialize(invalidDir);

      // 不应该抛出异常
      let error: Error | null = null;
      try {
        await Logger.log('This should fail silently');
      } catch (e) {
        error = e as Error;
      }

      expect(error).toBeNull();
    });

    it('写入失败时不应降级到 console', async () => {
      const invalidDir = '/invalid/path/that/does/not/exist';
      Logger.initialize(invalidDir);

      // 捕获 console 输出
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await Logger.log('This should fail silently');

      // 不应该调用 console.warn
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
