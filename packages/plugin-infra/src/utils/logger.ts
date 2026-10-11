import { join, dirname } from 'path';
import { appendFile, mkdir } from 'fs/promises';
import { DEFAULT_LOG_DIR, resolveLogRoot } from '../helpers/runtime-paths.js';

/**
 * 机器级运行时日志根目录（与 polling-logger 同源，经 runtime-paths 体系统一）。
 *
 * 动机：插件日志属「机器级运行时产物」，而非项目工件。原默认根为
 * process.cwd()，且 initialize(dir) 会向调用方目录拼 .flow-engine/sflow，
 * 导致工厂调用 initialize(workDir) 后 plugin.log 落进项目目录
 * （与 polling.log 的 %USERPROFILE% 根分裂，并污染仓库）。
 * 现默认根统一为 %USERPROFILE%/.flow-engine/sflow，与 cwd / workDir 完全解耦。
 *
 * re-export 保持既有导入路径（./logger）兼容。
 */
export { DEFAULT_LOG_DIR };

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
 *
 * 路径解析优先级（P1-1 钉死）：
 * 显式 initialize(logRoot) > FLOW_ENGINE_LOG_ROOT 环境变量 > %USERPROFILE%/.flow-engine/sflow
 */
export class Logger {
  /** 显式日志根覆盖（initialize 设置）；未设置时走 resolveLogRoot 默认解析 */
  private static explicitLogRoot: string | undefined;
  private static writeQueue: Promise<void> = Promise.resolve();

  /**
   * 初始化日志路径（显式指定日志根目录）。
   *
   * 语义（P1-1 钉死）：传入的目录**即日志根**，plugin.log 直接写在其下，
   * **不再**向调用方目录拼 `.flow-engine/sflow`。生产链路（三工厂）不再
   * 调用本方法——插件日志统一落机器级运行时目录
   * （%USERPROFILE%/.flow-engine/sflow，与 polling-logger 同源）。
   * 本方法保留给测试与运维做显式覆盖。
   *
   * @param logRootDir - 日志根目录路径
   */
  static initialize(logRootDir: string): void {
    Logger.explicitLogRoot = logRootDir;
  }

  /**
   * 测试支持：清除显式覆盖，恢复默认解析（env > 机器级默认）。
   * 避免测试根在同一进程内泄露给其它测试文件。
   */
  static reset(): void {
    Logger.explicitLogRoot = undefined;
  }

  /**
   * 当前生效的日志文件路径（供测试/观测断言接线，不产生写入）。
   */
  static getLogFilePath(): string {
    return join(resolveLogRoot(Logger.explicitLogRoot), 'plugin.log');
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
        const logFilePath = Logger.getLogFilePath();
        const logDir = dirname(logFilePath);
        await mkdir(logDir, { recursive: true });

        const logLine = Logger.formatMessage(level, message);
        await appendFile(logFilePath, logLine + '\n', 'utf-8');
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
