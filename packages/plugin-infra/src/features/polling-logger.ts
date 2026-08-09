import { join, dirname } from 'path';
import { appendFile, mkdir } from 'fs/promises';

/**
 * PollingLogger - 轮询日志记录器
 *
 * 功能：
 * - 将轮询事件日志写入 .flow-engine/sflow/polling.log
 * - 使用追加模式（appendFile），不覆盖已有内容
 * - 结构化格式：[ISO-timestamp] [INFO] [sessionID] message | metadata
 * - 写入失败时降级到 console.warn，不抛出异常
 * - 异步写入，不阻塞主线程
 */
export class PollingLogger {
  private readonly logFilePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

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
        console.warn(
          `[PollingLogger] Failed to write log: ${message}`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }).catch((error) => {
      // P1-2: Ensure queue never rejects (isolates single write failure)
      console.warn(
        `[PollingLogger] Write queue error (isolated):`,
        error instanceof Error ? error.message : String(error)
      );
    });
    return this.writeQueue;
  }
}
