import { join, dirname } from 'path';
import { homedir } from 'os';
import { appendFile, mkdir } from 'fs/promises';

/**
 * 机器级运行时日志根目录。
 *
 * 动机：插件日志属「机器级运行时产物」，而非项目工件。原先默认根为
 * process.cwd()，导致从仓库根跑测试/从项目目录启动插件时，日志被写进
 * 项目目录的 .flow-engine/sflow/，与工件目录混在一起（并触发工件误删事故）。
 * 故默认根统一为 %USERPROFILE%/.flow-engine/，与 cwd 完全解耦。
 */
export const DEFAULT_LOG_DIR = join(homedir(), '.flow-engine', 'sflow');

/**
 * Logger - 统一日志工具类
 *
 * 功能：
 * - 将插件日志写入 %USERPROFILE%/.flow-engine/sflow/plugin.log（默认）
 * - 使用追加模式（appendFile），不覆盖已有内容
 * - 格式：[YYYY-MM-DD HH:mm:ss] [LEVEL] message
 * - 写入失败时静默降级（不抛异常、不降级到 console）
 * - 队列串行化写入保证并发安全
 * - 时间戳精确到秒
 */
export class Logger {
  private static logFilePath: string = join(DEFAULT_LOG_DIR, 'plugin.log');
  private static writeQueue: Promise<void> = Promise.resolve();

  /**
   * 初始化日志路径（显式指定日志根目录）
   *
   * 注意：调用方传入的目录是**显式**的日志根（例如插件拿到的 workDir），
   * 与 cwd 无关；未显式初始化时使用 DEFAULT_LOG_DIR（%USERPROFILE%/.flow-engine）。
   *
   * @param logRootDir - 日志根目录路径
   */
  static initialize(logRootDir: string): void {
    Logger.logFilePath = join(logRootDir, '.flow-engine', 'sflow', 'plugin.log');
  }

  /**
   * 格式化日志消息
   * @param level - 日志级别
   * @param message - 日志消息
   * @returns 格式化后的日志行
   */
  private static formatMessage(level: 'WARN' | 'LOG' | 'ERROR', message: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    return `[${timestamp}] [${level}] ${message}`;
  }

  /**
   * 写入日志到文件（队列串行化）
   * @param level - 日志级别
   * @param message - 日志消息
   */
  private static async writeLog(level: 'WARN' | 'LOG' | 'ERROR', message: string): Promise<void> {
    Logger.writeQueue = Logger.writeQueue.then(async () => {
      try {
        const logDir = dirname(Logger.logFilePath);
        await mkdir(logDir, { recursive: true });

        const logLine = Logger.formatMessage(level, message);
        await appendFile(Logger.logFilePath, logLine + '\n', 'utf-8');
      } catch {
        // 静默降级：不抛异常、不降级到 console
      }
    }).catch(() => {
      // 静默降级：确保队列永远不会 reject
    });

    return Logger.writeQueue;
  }

  /**
   * 记录警告日志
   * @param message - 日志消息
   */
  static async warn(message: string): Promise<void> {
    return Logger.writeLog('WARN', message);
  }

  /**
   * 记录普通日志
   * @param message - 日志消息
   */
  static async log(message: string): Promise<void> {
    return Logger.writeLog('LOG', message);
  }

  /**
   * 记录错误日志
   * @param message - 日志消息
   */
  static async error(message: string): Promise<void> {
    return Logger.writeLog('ERROR', message);
  }
}
