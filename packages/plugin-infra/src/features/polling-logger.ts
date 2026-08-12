import { join, dirname } from 'path';
import { appendFile, writeFile, mkdir } from 'fs/promises';
import { Logger } from '../utils/logger.js';

/**
 * PollingLogger - 轮询日志记录器
 *
 * 功能：
 * - 将轮询事件日志写入 .flow-engine/sflow/polling.log
 * - 使用追加模式（appendFile），不覆盖已有内容
 * - 结构化格式：[ISO-timestamp] [INFO] [sessionID] message | metadata
 * - 写入失败时降级到 console.warn，不抛出异常
 * - 异步写入，不阻塞主线程
 * - 插件初始化时自动清空旧日志（静态 guard，跑一次）。
 */
export class PollingLogger {
  private readonly logFilePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  /** 静态 guard：确保日志文件在插件生命周期内只清空一次 */
  private static _cleared = false;

  /**
   * @param customLogPath - 自定义日志文件路径（用于测试）
   */
  constructor(customLogPath?: string) {
    if (customLogPath) {
      this.logFilePath = customLogPath;
    } else {
      const logDir = join(process.cwd(), '.flow-engine', 'sflow');
      this.logFilePath = join(logDir, 'polling.log');
    }

    // 插件初始化时清空旧日志文件，防止无限增长
    if (!PollingLogger._cleared) {
      PollingLogger._cleared = true;
      PollingLogger.clear(this.logFilePath).catch(() => {});
    }
  }

  /**
   * 清空日志文件（覆盖为空内容）。
   * 静态方法，可在任意位置调用。
   * @param filePath - 日志文件路径，默认使用 default 构造的路径
   */
  static async clear(filePath?: string): Promise<void> {
    try {
      const logDir = filePath ? dirname(filePath) : join(process.cwd(), '.flow-engine', 'sflow');
      const target = filePath ?? join(logDir, 'polling.log');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, '', 'utf-8');
    } catch (error) {
      Logger.warn(
        `[PollingLogger] Failed to clear log file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * 写入日志
   *
   * @param sessionId - 会话 ID
   * @param message - 日志消息
   * @param metadata - 可选的元数据对象
   */
  async log(sessionId: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
    // P1-2: Catch errors to keep queue always resolved (prevent blocking subsequent writes)
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const logDir = dirname(this.logFilePath);
        await mkdir(logDir, { recursive: true });

        const timestamp = new Date().toISOString();
        let logLine = `[${timestamp}] [INFO] [${sessionId}] ${message}`;

        if (metadata && Object.keys(metadata).length > 0) {
          logLine += ` | ${JSON.stringify(metadata)}`;
        }

        await appendFile(this.logFilePath, logLine + '\n', 'utf-8');
      } catch (error) {
        Logger.warn(
          `[PollingLogger] Failed to write log: ${message} - ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }).catch((error) => {
      // P1-2: Ensure queue never rejects (isolates single write failure)
      Logger.warn(
        `[PollingLogger] Write queue error (isolated): ${error instanceof Error ? error.message : String(error)}`
      );
    });
    return this.writeQueue;
  }
}
