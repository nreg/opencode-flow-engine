/**
 * TaskTracker — 子 agent 调用追踪模块
 *
 * 通过 beforeHook/afterHook 模式追踪 call_flow_agent 的调用，
 * 记录子 agent 的执行时间、输入输出摘要、完成状态等。
 * 追踪数据持久化到 .flow-engine/iflow/subagent-tracker.json
 */

import {
  stateFileMutex,
  ensureDir,
  writeJsonFile,
  readJsonFile,
  fileExists,
} from '@opencode-flow-engine/shared';

// ─── 常量 ──────────────────────────────────────────────────────────────────

const TRACKER_FILE = '.flow-engine/iflow/subagent-tracker.json';
const MAX_SUMMARY_LENGTH = 200;
const TARGET_TOOL = 'call_flow_agent';

// ─── 类型定义 ──────────────────────────────────────────────────────────────

export interface TrackerBeforeRecord {
  /** 工具名（如 "call_flow_agent"） */
  tool: string;
  /** 子 agent 类型（从 args 中提取，如 "iflow-plan-executor"） */
  subagentType: string;
  /** 开始时间 ISO 8601 */
  startedAt: string;
  /** 输入摘要（最长 200 字符） */
  inputSummary: string;
  /** 所属 session ID */
  sessionId: string;
}

export interface TrackerAfterRecord {
  /** 完成时间 ISO 8601 */
  completedAt: string;
  /** 输出摘要（最长 200 字符） */
  outputSummary: string;
  /** 执行时长（毫秒） */
  durationMs: number;
  /** 执行状态 */
  status: 'completed' | 'failed';
}

export interface TrackerRecord extends TrackerBeforeRecord, TrackerAfterRecord {}

export interface TrackerData {
  sessionId: string;
  records: TrackerRecord[];
}

export interface TaskTrackerInstance {
  beforeHook: (input: {
    tool: string;
    sessionID: string;
    args: Record<string, unknown>;
  }) => Promise<void>;
  afterHook: (
    input: { tool: string; sessionID: string },
    output: { output?: string },
  ) => Promise<void>;
  getTrackerData: (sessionId: string) => Promise<TrackerRecord[]>;
  clearTracker: () => Promise<void>;
}

// ─── 内部辅助函数 ──────────────────────────────────────────────────────────

/**
 * 截断字符串到指定最大长度
 */
function truncate(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * 从 args 中提取 subagentType
 * 优先取 args.subagent_type，其次从 args.prompt 中推断
 */
function extractSubagentType(args: Record<string, unknown>): string {
  // 优先使用显式的 subagent_type 参数
  if (typeof args.subagent_type === 'string' && args.subagent_type) {
    return args.subagent_type;
  }
  // 兼容：从 prompt 中尝试推断
  if (typeof args.prompt === 'string' && args.prompt) {
    const knownTypes = [
      'iflow-discuss-planner',
      'iflow-researcher',
      'iflow-plan-executor',
      'iflow-verifier',
      'iflow-shipper',
      'build-executor',
      'test-engineer',
      'review-engineer',
      'code-reviewer',
      'spec-writer',
      'contract-builder',
      'need-explorer',
      'bug-investigator',
      'release-archivist',
      'ui-director',
      'ui-implementer',
    ];
    for (const t of knownTypes) {
      if (args.prompt.includes(t)) {
        return t;
      }
    }
  }
  return 'unknown';
}

/**
 * 生成内存 Map 的 key：sessionID + tool + 递增序号
 */
function makePendingKey(sessionID: string, tool: string, seq: number): string {
  return sessionID + '::' + tool + '::' + seq;
}

// ─── 持久化文件操作 ────────────────────────────────────────────────────────

interface TrackerFileData {
  records: TrackerRecord[];
}

async function readTrackerFile(): Promise<TrackerFileData> {
  const exists = await fileExists(TRACKER_FILE);
  if (!exists) return { records: [] };
  const data = await readJsonFile<TrackerFileData>(TRACKER_FILE);
  return data ?? { records: [] };
}

async function writeTrackerFile(data: TrackerFileData): Promise<void> {
  await ensureDir('.flow-engine/iflow');
  await writeJsonFile(TRACKER_FILE, data);
}

// ─── 创建 TaskTracker 实例 ─────────────────────────────────────────────────

/**
 * 创建 TaskTracker 实例
 *
 * @param config.enabled - 是否启用追踪，默认 true
 * @returns TaskTrackerInstance
 */
export function createTaskTracker(
  config?: { enabled?: boolean },
): TaskTrackerInstance {
  const enabled = config?.enabled !== false;

  // 内存中的 pending 记录：key = sessionID::tool::seq, value = beforeRecord
  const pendingMap = new Map<string, TrackerBeforeRecord>();
  // 每个 session+tool 的递增序号
  const seqCounter = new Map<string, number>();

  /**
   * beforeHook：在 call_flow_agent 调用前记录
   */
  async function beforeHook(input: {
    tool: string;
    sessionID: string;
    args: Record<string, unknown>;
  }): Promise<void> {
    if (!enabled) return;
    if (input.tool !== TARGET_TOOL) return;

    const subagentType = extractSubagentType(input.args);
    const inputSummary = truncate(
      typeof input.args.prompt === 'string' ? input.args.prompt : '',
      MAX_SUMMARY_LENGTH,
    );

    const beforeRecord: TrackerBeforeRecord = {
      tool: input.tool,
      subagentType,
      startedAt: new Date().toISOString(),
      inputSummary,
      sessionId: input.sessionID,
    };

    // 计算递增序号
    const counterKey = input.sessionID + '::' + input.tool;
    const currentSeq = (seqCounter.get(counterKey) ?? 0) + 1;
    seqCounter.set(counterKey, currentSeq);

    const pendingKey = makePendingKey(input.sessionID, input.tool, currentSeq);
    pendingMap.set(pendingKey, beforeRecord);
  }

  /**
   * afterHook：在 call_flow_agent 调用后合并记录并持久化
   */
  async function afterHook(
    input: { tool: string; sessionID: string },
    output: { output?: string },
  ): Promise<void> {
    if (!enabled) return;

    // 查找匹配的 beforeHook 记录
    const prefix = input.sessionID + '::' + input.tool + '::';
    let matchedKey: string | null = null;
    let matchedBefore: TrackerBeforeRecord | null = null;

    // 找到最早的未匹配记录（FIFO）
    for (const [key, record] of pendingMap.entries()) {
      if (key.startsWith(prefix)) {
        matchedKey = key;
        matchedBefore = record;
        break;
      }
    }

    if (!matchedKey || !matchedBefore) return;

    // 从内存中移除
    pendingMap.delete(matchedKey);

    const now = new Date();
    const startedAt = new Date(matchedBefore.startedAt);
    const durationMs = now.getTime() - startedAt.getTime();

    // 判断状态：有输出内容且不包含明显错误标记为 completed
    const outputText = output.output ?? '';
    const hasError =
      outputText.toLowerCase().includes('error') &&
      !outputText.toLowerCase().includes('error handling');
    const status: 'completed' | 'failed' =
      outputText.length > 0 && !hasError ? 'completed' : 'failed';

    const afterRecord: TrackerAfterRecord = {
      completedAt: now.toISOString(),
      outputSummary: truncate(outputText, MAX_SUMMARY_LENGTH),
      durationMs,
      status,
    };

    const fullRecord: TrackerRecord = {
      ...matchedBefore,
      ...afterRecord,
    };

    // 使用互斥锁写入文件
    await stateFileMutex.runExclusive(async () => {
      const fileData = await readTrackerFile();
      fileData.records.push(fullRecord);
      await writeTrackerFile(fileData);
    });
  }

  /**
   * 获取指定 session 的追踪记录
   */
  async function getTrackerData(sessionId: string): Promise<TrackerRecord[]> {
    if (!enabled) return [];

    const fileData = await readTrackerFile();
    return fileData.records.filter(
      (r) => r.sessionId === sessionId,
    );
  }

  /**
   * 清空追踪记录
   */
  async function clearTracker(): Promise<void> {
    if (!enabled) return;

    await stateFileMutex.runExclusive(async () => {
      await writeTrackerFile({ records: [] });
    });

    // 同时清空内存
    pendingMap.clear();
    seqCounter.clear();
  }

  return {
    beforeHook,
    afterHook,
    getTrackerData,
    clearTracker,
  };
}
