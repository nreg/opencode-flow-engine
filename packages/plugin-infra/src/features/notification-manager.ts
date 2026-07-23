/**
 * NotificationManager — 子 agent 完成通知管理模块
 *
 * 子 agent 完成时写入通知文件到 .flow-engine/sflow/notifications/，
 * 主 agent 启动时自动扫描消费，将通知内容注入 system prompt。
 *
 * 存储结构：
 * .flow-engine/sflow/notifications/
 * ├── sf_1700000000_1.json    ← 未消费通知
 * └── consumed/               ← 已消费通知
 *     └── sf_1699999000_1.json
 */

import { join, dirname } from 'path';
import {
  ensureDir,
  writeJsonFile,
  readJsonFile,
  fileExists,
  listFiles,
  removeFile,
  directoryExists,
} from '@opencode-flow-engine/shared';

// ─── 常量 ──────────────────────────────────────────────────────────────────

const NOTIFICATIONS_SUBDIR = '.flow-engine/sflow/notifications';
const CONSUMED_SUBDIR = 'consumed';

// ─── 类型定义 ──────────────────────────────────────────────────────────────

export type NotificationType = 'sync_completed' | 'async_completed';

export interface WriteNotificationParams {
  /** 通知类型：同步完成 / 异步完成 */
  type: NotificationType;
  /** 子 agent 类型（如 "build-executor"） */
  subagent: string;
  /** 任务 ID（如 "sf_1700000000_1"） */
  task_id: string;
  /** 所属 session ID */
  session_id: string;
  /** 完成摘要 */
  summary: string;
  /** P3: 输出是否包含完成信号 */
  has_completion_signal?: boolean;
}

export interface NotificationEntry {
  type: NotificationType;
  subagent: string;
  task_id: string;
  session_id: string;
  completed_at: string;
  summary: string;
  /** P3: 输出是否包含完成信号 */
  has_completion_signal?: boolean;
}

export interface ConsumedNotification extends NotificationEntry {
  /** 格式化后的 system prompt 片段 */
  formatted: string;
}

export interface NotificationManager {
  /** 子 agent 完成时写入通知文件 */
  writeNotification(params: WriteNotificationParams): Promise<void>;
  /** 扫描未消费通知、去重、移动已消费文件、返回通知内容数组 */
  consumeNotifications(): Promise<ConsumedNotification[]>;
  /** 获取未消费通知列表（不移动文件） */
  getPendingNotifications(): Promise<NotificationEntry[]>;
}

// ─── 内部辅助函数 ──────────────────────────────────────────────────────────

/**
 * 将通知内容格式化为 system prompt 片段
 */
function formatNotification(entry: NotificationEntry): string {
  const completionInfo = entry.has_completion_signal === true
    ? '（输出包含完成信号）'
    : entry.has_completion_signal === false
      ? '（输出可能不完整）'
      : '';
  return `[子 agent 通知] ${entry.subagent} (${entry.type}) 任务 ${entry.task_id} 已完成${completionInfo}。摘要: ${entry.summary}`;
}

/**
 * 移动文件：从 src 复制到 dst，然后删除 src
 */
async function moveFile(src: string, dst: string): Promise<boolean> {
  try {
    const { copyFile, unlink } = await import('fs/promises');
    await ensureDir(dirname(dst));
    await copyFile(src, dst);
    await unlink(src);
    return true;
  } catch (err) {
    console.warn('[NotificationManager] 移动文件失败:', err);
    return false;
  }
}

// ─── 创建 NotificationManager 实例 ─────────────────────────────────────────

/**
 * 创建 NotificationManager 实例
 *
 * @param config.changeDir - 项目根目录路径
 * @returns NotificationManager 实例
 */
export function createNotificationManager(config: { changeDir: string }): NotificationManager {
  const notificationsDir = join(config.changeDir, NOTIFICATIONS_SUBDIR);
  const consumedDir = join(notificationsDir, CONSUMED_SUBDIR);

  /**
   * 写入通知文件
   *
   * 文件名格式：{task_id}.json
   * 写入失败不抛出异常，仅记录警告
   */
  async function writeNotification(params: WriteNotificationParams): Promise<void> {
    try {
      await ensureDir(notificationsDir);

      const entry: NotificationEntry = {
        type: params.type,
        subagent: params.subagent,
        task_id: params.task_id,
        session_id: params.session_id,
        completed_at: new Date().toISOString(),
        summary: params.summary,
        ...(params.has_completion_signal !== undefined && { has_completion_signal: params.has_completion_signal }),
      };

      const filePath = join(notificationsDir, `${params.task_id}.json`);
      await writeJsonFile(filePath, entry);
    } catch (err) {
      // 通知写入失败不阻塞 agent 结果返回
      console.warn('[NotificationManager] 写入通知失败:', err);
    }
  }

  /**
   * 消费未读通知
   *
   * 1. 扫描 notifications/ 目录下所有 .json 文件
   * 2. 检查 consumed/ 中是否已存在同名文件（去重）
   * 3. 读取通知内容，格式化为 system prompt 片段
   * 4. 将已消费文件移动到 consumed/
   */
  async function consumeNotifications(): Promise<ConsumedNotification[]> {
    try {
      // 确保目录存在
      await ensureDir(notificationsDir);
      await ensureDir(consumedDir);

      const files = await listFiles(notificationsDir, '.json');
      if (files.length === 0) return [];

      // 获取已消费文件列表用于去重
      const consumedFiles = await listFiles(consumedDir, '.json');
      const consumedSet = new Set(consumedFiles);

      // 去重：删除已存在于 consumed/ 中的根目录重复文件（并行）
      const dedupTasks = files
        .filter(fileName => consumedSet.has(fileName))
        .map(fileName => removeFile(join(notificationsDir, fileName)).catch(err => console.warn('[NotificationManager] 删除重复通知失败:', err)));
      await Promise.allSettled(dedupTasks);

      // 并行读取并移动未消费的通知文件
      const tasks = files
        .filter(fileName => !consumedSet.has(fileName))
        .map(async (fileName) => {
          const filePath = join(notificationsDir, fileName);
          const entry = await readJsonFile<NotificationEntry>(filePath);
          if (!entry) return null;

          const destPath = join(consumedDir, fileName);
          await moveFile(filePath, destPath);

          return { ...entry, formatted: formatNotification(entry) };
        });

      const settled = await Promise.allSettled(tasks);
      const results: ConsumedNotification[] = [];
      for (const result of settled) {
        if (result.status === 'fulfilled' && result.value !== null) {
          results.push(result.value);
        }
      }

      return results;
    } catch (err) {
      console.warn('[NotificationManager] 消费通知失败:', err);
      return [];
    }
  }

  /**
   * 获取未消费通知列表（不移动文件）
   */
  async function getPendingNotifications(): Promise<NotificationEntry[]> {
    try {
      await ensureDir(notificationsDir);

      const files = await listFiles(notificationsDir, '.json');
      if (files.length === 0) return [];

      const results: NotificationEntry[] = [];

      for (const fileName of files) {
        const filePath = join(notificationsDir, fileName);
        const entry = await readJsonFile<NotificationEntry>(filePath);
        if (entry) {
          results.push(entry);
        }
      }

      return results;
    } catch (err) {
      console.warn('[NotificationManager] 获取待处理通知失败:', err);
      return [];
    }
  }

  return {
    writeNotification,
    consumeNotifications,
    getPendingNotifications,
  };
}
