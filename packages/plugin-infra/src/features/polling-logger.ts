import { join, dirname } from 'path';
import { homedir } from 'os';
import { appendFile, writeFile, mkdir } from 'fs/promises';
import { Logger } from '../utils/logger.js';

/**
 * 机器级运行时日志目录。
 *
 * 动机：轮询日志属「机器级运行时产物」，而非项目工件。原先默认目录为
 * process.cwd()/.flow-engine/sflow，从项目目录跑测试/启动插件时会把日志写进
 * 项目目录（并被用例的清理动作误删）。故默认统一为 %USERPROFILE%/.flow-engine/sflow。
 */
export const DEFAULT_LOG_DIR = join(homedir(), '.flow-engine', 'sflow');

/**
 * PollingLogger - 轮询日志记录器
 *
 * 功能：
 * - 将轮询事件日志写入 %USERPROFILE%/.flow-engine/sflow/polling.log（默认）
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
      this.logFilePath = join(DEFAULT_LOG_DIR, 'polling.log');
    }

    // 插件初始化时清空旧日志文件，防止无限增长
    // P1-fix: 将 clear 串入 writeQueue，避免与首次 log 写入竞争
    // （fire-and-forget 的异步 clear 可能在首次 appendFile 之后到达，导致日志被清空）
    if (!PollingLogger._cleared) {
      PollingLogger._cleared = true;
      this.writeQueue = this.writeQueue
        .then(() => PollingLogger.clear(this.logFilePath))
        .catch(() => {});
    }
  }

  /**
   * 清空日志文件（覆盖为空内容）。
   * 静态方法，可在任意位置调用。
   * @param filePath - 日志文件路径，默认使用 %USERPROFILE% 下的机器级路径
   */
  static async clear(filePath?: string): Promise<void> {
    try {
      const target = filePath ?? join(DEFAULT_LOG_DIR, 'polling.log');
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
