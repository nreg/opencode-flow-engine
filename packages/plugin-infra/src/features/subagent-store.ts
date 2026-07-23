/**
 * SubagentStore — 子 agent 持久化与恢复模块
 *
 * 将子 agent 的执行状态持久化到文件系统，支持长任务中断后恢复上下文继续执行。
 *
 * 存储结构：
 * .flow-engine/sflow/subagent-store/
 * ├── index.json
 * ├── agent_001/
 * │   ├── meta.json       # agent_id, subagent_type, session_id, created_at, updated_at, completed_at, status
 * │   ├── prompt.md       # 原始 prompt
 * │   ├── output.md       # 输出摘要
 * │   └── events.log      # 事件流水（每行一个 JSON 事件）
 * └── agent_002/
 *     ├── meta.json
 *     ├── prompt.md
 *     ├── output.md
 *     └── events.log
 */

import { join } from 'path';
import {
  stateFileMutex,
  ensureDir,
  writeJsonFile,
  readJsonFile,
  writeFile as sharedWriteFile,
  readFile as sharedReadFile,
  fileExists,
  directoryExists,
  appendToFile,
} from '@opencode-flow-engine/shared';

// ─── 常量 ──────────────────────────────────────────────────────────────────

const SUBAGENT_STORE_SUBDIR = '.flow-engine/sflow/subagent-store';
const INDEX_FILE = 'index.json';
const META_FILE = 'meta.json';
const PROMPT_FILE = 'prompt.md';
const OUTPUT_FILE = 'output.md';
const EVENTS_FILE = 'events.log';

// ─── 类型定义 ──────────────────────────────────────────────────────────────

export type AgentStatus = 'running' | 'completed' | 'error' | 'resumed';

export interface AgentMeta {
  /** 子 agent 唯一标识 */
  agent_id: string;
  /** 子 agent 类型（如 "build-executor"） */
  subagent_type: string;
  /** 所属 session ID */
  session_id: string;
  /** 创建时间 ISO 8601 */
  created_at: string;
  /** 最后更新时间 ISO 8601 */
  updated_at: string;
  /** 完成时间 ISO 8601，未完成时为 null */
  completed_at: string | null;
  /** 当前状态 */
  status: AgentStatus;
}

export interface AgentEvent {
  /** 事件时间戳 ISO 8601 */
  timestamp: string;
  /** 事件类型（如 "started", "completed", "error"） */
  event_type: string;
  /** 事件详情 */
  detail: string;
}

export interface AgentData {
  /** agent 元信息 */
  meta: AgentMeta;
  /** 原始 prompt */
  prompt: string;
  /** 输出摘要 */
  output: string;
  /** 事件列表 */
  events: AgentEvent[];
}

export interface CreateAgentParams {
  /** 子 agent 唯一标识 */
  agent_id: string;
  /** 子 agent 类型 */
  subagent_type: string;
  /** 所属 session ID */
  session_id: string;
  /** 原始 prompt */
  prompt: string;
}

export interface IndexEntry {
  agent_id: string;
  subagent_type: string;
  session_id: string;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ResumeResult {
  /** 合成后的 prompt */
  prompt: string;
  /** 更新后的 meta */
  meta: AgentMeta;
}

export interface SubagentStore {
  /** 创建子 agent store（目录结构 + index.json 更新） */
  createAgent(params: CreateAgentParams): Promise<AgentMeta>;
  /** 更新子 agent 输出（可选指定 status，默认 completed） */
  updateOutput(agentId: string, output: string, options?: { status?: AgentStatus }): Promise<void>;
  /** 追加事件到 events.log */
  appendEvent(agentId: string, event: AgentEvent): Promise<void>;
  /** 获取单个子 agent 完整数据 */
  getAgent(agentId: string): Promise<AgentData | null>;
  /** 列出子 agent（可按 status 过滤，detailed=false 时仅从 index 读取） */
  listAgents(filter?: { status?: AgentStatus; detailed?: boolean }): Promise<AgentMeta[]>;
  /** 恢复子 agent 上下文，返回合成 prompt */
  resumeAgent(agentId: string, newPrompt: string): Promise<ResumeResult>;
}

// ─── 内部辅助函数 ──────────────────────────────────────────────────────────

/**
 * 从 meta.json 生成 index.json 条目
 */
function metaToIndexEntry(meta: AgentMeta): IndexEntry {
  return {
    agent_id: meta.agent_id,
    subagent_type: meta.subagent_type,
    session_id: meta.session_id,
    status: meta.status,
    created_at: meta.created_at,
    updated_at: meta.updated_at,
    completed_at: meta.completed_at,
  };
}

/**
 * 解析 events.log 内容为 AgentEvent 数组
 */
function parseEventsLog(content: string): AgentEvent[] {
  if (!content || content.trim().length === 0) return [];
  return content
    .trim()
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      try {
        return JSON.parse(line) as AgentEvent;
      } catch (err) {
        console.warn('[SubagentStore] 解析事件行失败:', err);
        return null;
      }
    })
    .filter((e): e is AgentEvent => e !== null);
}

// ─── 创建 SubagentStore 实例 ────────────────────────────────────────────────

/**
 * 创建 SubagentStore 实例
 *
 * @param config.changeDir - 项目根目录路径
 * @returns SubagentStore 实例
 */
export function createSubagentStore(config: { changeDir: string }): SubagentStore {
  const storeDir = join(config.changeDir, SUBAGENT_STORE_SUBDIR);
  const indexPath = join(storeDir, INDEX_FILE);

  /**
   * 读取 index.json
   */
  async function readIndex(): Promise<IndexEntry[]> {
    const data = await readJsonFile<IndexEntry[]>(indexPath);
    return data ?? [];
  }

  /**
   * 写入 index.json（使用互斥锁保证并发安全）
   */
  async function writeIndex(entries: IndexEntry[]): Promise<void> {
    await stateFileMutex.runExclusive(async () => {
      await ensureDir(storeDir);
      await writeJsonFile(indexPath, entries);
    });
  }

  /**
   * 获取 agent 目录路径
   */
  function agentDir(agentId: string): string {
    return join(storeDir, agentId);
  }

  /**
   * 创建子 agent store
   *
   * 1. 创建 agent 目录
   * 2. 写入 meta.json、prompt.md、output.md（空）、events.log（空）
   * 3. 更新 index.json
   */
  async function createAgent(params: CreateAgentParams): Promise<AgentMeta> {
    const dir = agentDir(params.agent_id);
    const now = new Date().toISOString();

    const meta: AgentMeta = {
      agent_id: params.agent_id,
      subagent_type: params.subagent_type,
      session_id: params.session_id,
      created_at: now,
      updated_at: now,
      completed_at: null,
      status: 'running',
    };

    // 1. 创建 agent 目录
    await ensureDir(dir);

    // 2. 写入四个文件
    await writeJsonFile(join(dir, META_FILE), meta);
    await sharedWriteFile(join(dir, PROMPT_FILE), params.prompt);
    await sharedWriteFile(join(dir, OUTPUT_FILE), '');
    await sharedWriteFile(join(dir, EVENTS_FILE), '');

    // 3. 更新 index.json
    await stateFileMutex.runExclusive(async () => {
      const entries = await readIndex();
      entries.push(metaToIndexEntry(meta));
      await writeJsonFile(indexPath, entries);
    });

    return meta;
  }

  /**
   * 更新子 agent 输出
   *
   * 1. 写入 output.md
   * 2. 更新 meta.json 的 status 和 completed_at
   * 3. 更新 index.json 中对应条目
   */
  async function updateOutput(agentId: string, output: string, options?: { status?: AgentStatus }): Promise<void> {
    const dir = agentDir(agentId);
    const metaPath = join(dir, META_FILE);

    // 检查 agent 目录是否存在
    const exists = await directoryExists(dir);
    if (!exists) {
      throw new Error(`Agent ${agentId} not found in subagent-store`);
    }

    // 1. 写入 output.md
    await sharedWriteFile(join(dir, OUTPUT_FILE), output);

    // 2. 更新 meta.json
    const meta = await readJsonFile<AgentMeta>(metaPath);
    if (!meta) {
      throw new Error(`Failed to read meta.json for agent ${agentId}`);
    }

    const now = new Date().toISOString();
    const status = options?.status ?? 'completed';
    const updatedMeta: AgentMeta = {
      ...meta,
      updated_at: now,
      completed_at: status === 'completed' ? now : null,
      status,
    };
    await writeJsonFile(metaPath, updatedMeta);

    // 3. 更新 index.json 中对应条目
    await stateFileMutex.runExclusive(async () => {
      const entries = await readIndex();
      const idx = entries.findIndex(e => e.agent_id === agentId);
      if (idx !== -1) {
        entries[idx] = metaToIndexEntry(updatedMeta);
        await writeJsonFile(indexPath, entries);
      }
    });
  }

  /**
   * 追加事件到 events.log
   *
   * 每行一个 JSON 事件，追加写入。
   * 同时更新 meta.json 的 updated_at。
   */
  async function appendEvent(agentId: string, event: AgentEvent): Promise<void> {
    const dir = agentDir(agentId);
    const eventsPath = join(dir, EVENTS_FILE);
    const metaPath = join(dir, META_FILE);

    // 检查 agent 目录是否存在
    const exists = await directoryExists(dir);
    if (!exists) {
      throw new Error(`Agent ${agentId} not found in subagent-store`);
    }

    // 1. 追加事件到 events.log（使用 appendFile，O(1) 写入）
    const newLine = JSON.stringify(event) + '\n';
    await appendToFile(eventsPath, newLine);

    // 2. 更新 meta.json 的 updated_at
    const meta = await readJsonFile<AgentMeta>(metaPath);
    if (meta) {
      const updatedMeta: AgentMeta = {
        ...meta,
        updated_at: new Date().toISOString(),
      };
      await writeJsonFile(metaPath, updatedMeta);

      // 更新 index.json
      await stateFileMutex.runExclusive(async () => {
        const entries = await readIndex();
        const idx = entries.findIndex(e => e.agent_id === agentId);
        if (idx !== -1) {
          entries[idx] = metaToIndexEntry(updatedMeta);
          await writeJsonFile(indexPath, entries);
        }
      });
    }
  }

  /**
   * 获取单个子 agent 完整数据
   */
  async function getAgent(agentId: string): Promise<AgentData | null> {
    const dir = agentDir(agentId);

    const exists = await directoryExists(dir);
    if (!exists) return null;

    const meta = await readJsonFile<AgentMeta>(join(dir, META_FILE));
    if (!meta) return null;

    const prompt = await sharedReadFile(join(dir, PROMPT_FILE)) ?? '';
    const output = await sharedReadFile(join(dir, OUTPUT_FILE)) ?? '';
    const eventsContent = await sharedReadFile(join(dir, EVENTS_FILE)) ?? '';
    const events = parseEventsLog(eventsContent);

    return { meta, prompt, output, events };
  }

  /**
   * 列出子 agent（可按 status 过滤）
   *
   * - detailed !== false（默认）: 读取完整 meta（当前行为）
   * - detailed === false（显式要求）: 从 index.json 条目直接构造 AgentMeta，不读取 meta.json
   */
  async function listAgents(filter?: { status?: AgentStatus; detailed?: boolean }): Promise<AgentMeta[]> {
    const entries = await readIndex();
    const results: AgentMeta[] = [];

    for (const entry of entries) {
      if (filter?.status && entry.status !== filter.status) continue;

      if (filter?.detailed === false) {
        // 轻量模式：从 index 条目直接构造（不读 meta.json）
        results.push({
          agent_id: entry.agent_id,
          subagent_type: entry.subagent_type,
          session_id: entry.session_id ?? '',
          created_at: entry.created_at,
          updated_at: entry.updated_at,
          completed_at: entry.completed_at ?? null,
          status: entry.status,
        });
      } else {
        // 详细模式：读取完整 meta（默认行为）
        const dir = agentDir(entry.agent_id);
        const meta = await readJsonFile<AgentMeta>(join(dir, META_FILE));
        if (meta) {
          results.push(meta);
        }
      }
    }

    return results;
  }

  /**
   * 恢复子 agent 上下文
   *
   * - 有 output 时：合成 prompt = 用户 prompt + "\n\n--- 之前的工作摘要 ---\n" + output.md 内容
   * - output 为空时：使用原始 prompt + 用户 prompt
   * - agent_id 不存在时返回错误
   */
  async function resumeAgent(agentId: string, newPrompt: string): Promise<ResumeResult> {
    const dir = agentDir(agentId);

    const exists = await directoryExists(dir);
    if (!exists) {
      throw new Error(`Agent ${agentId} not found in subagent-store`);
    }

    // 读取 meta 和 output
    const meta = await readJsonFile<AgentMeta>(join(dir, META_FILE));
    if (!meta) {
      throw new Error(`Failed to read meta.json for agent ${agentId}`);
    }

    const output = await sharedReadFile(join(dir, OUTPUT_FILE)) ?? '';
    const originalPrompt = await sharedReadFile(join(dir, PROMPT_FILE)) ?? '';

    // 合成 prompt
    let composedPrompt: string;
    if (output.trim().length > 0) {
      composedPrompt = newPrompt + '\n\n--- 之前的工作摘要 ---\n' + output;
    } else {
      composedPrompt = originalPrompt + '\n\n' + newPrompt;
    }

    // 更新 meta.json 的 status 为 resumed
    const now = new Date().toISOString();
    const updatedMeta: AgentMeta = {
      ...meta,
      status: 'resumed',
      updated_at: now,
    };
    await writeJsonFile(join(dir, META_FILE), updatedMeta);

    // 更新 index.json
    await stateFileMutex.runExclusive(async () => {
      const entries = await readIndex();
      const idx = entries.findIndex(e => e.agent_id === agentId);
      if (idx !== -1) {
        entries[idx] = metaToIndexEntry(updatedMeta);
        await writeJsonFile(indexPath, entries);
      }
    });

    return { prompt: composedPrompt, meta: updatedMeta };
  }

  return {
    createAgent,
    updateOutput,
    appendEvent,
    getAgent,
    listAgents,
    resumeAgent,
  };
}
