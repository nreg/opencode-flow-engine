/**
 * Tests for SubagentStore
 *
 * Covers:
 * - createAgent（目录结构 4 文件 + index.json 更新）
 * - updateOutput（输出写入 + meta 状态更新 + index 更新）
 * - appendEvent（事件追加 + meta updated_at 更新）
 * - getAgent（读取单个）
 * - listAgents（按 status 过滤）
 * - resumeAgent（上下文注入 + 空输出 + 不存在 agent）
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdir, rm, readFile, readdir, stat } from 'fs/promises';
import { createSubagentStore } from '../subagent-store.js';
import type { CreateAgentParams, AgentEvent } from '../subagent-store.js';

// ─── 测试临时目录 ──────────────────────────────────────────────────────────

const TEST_TMP = join(import.meta.dir, '__ss_test_tmp__');

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

function makeCreateParams(overrides: Partial<CreateAgentParams> = {}): CreateAgentParams {
  return {
    agent_id: 'agent_001',
    subagent_type: 'build-executor',
    session_id: 'sess_abc',
    prompt: 'Build the feature',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<AgentEvent> = {}): AgentEvent {
  return {
    timestamp: new Date().toISOString(),
    event_type: 'started',
    detail: 'Task started',
    ...overrides,
  };
}

// ─── 测试用例 ──────────────────────────────────────────────────────────────

describe('SubagentStore', () => {
  let store: ReturnType<typeof createSubagentStore>;

  beforeEach(async () => {
    // 清理并创建临时目录
    await rm(TEST_TMP, { recursive: true, force: true });
    await mkdir(TEST_TMP, { recursive: true });
    store = createSubagentStore({ changeDir: TEST_TMP });
  });

  afterEach(async () => {
    await rm(TEST_TMP, { recursive: true, force: true });
  });

  // ─── createAgent ────────────────────────────────────────────────────────

  describe('createAgent', () => {
    it('should create agent directory with 4 files', async () => {
      const meta = await store.createAgent(makeCreateParams());

      const agentDir = join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001');
      const files = await readdir(agentDir);
      expect(files.sort()).toEqual(['events.log', 'meta.json', 'output.md', 'prompt.md']);
    });

    it('should write meta.json with correct fields', async () => {
      const meta = await store.createAgent(makeCreateParams());

      const metaPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001/meta.json');
      const content = JSON.parse(await readFile(metaPath, 'utf-8'));

      expect(content.agent_id).toBe('agent_001');
      expect(content.subagent_type).toBe('build-executor');
      expect(content.session_id).toBe('sess_abc');
      expect(content.status).toBe('running');
      expect(content.created_at).toBeTruthy();
      expect(content.updated_at).toBeTruthy();
      expect(content.completed_at).toBeNull();
    });

    it('should write prompt.md with original prompt', async () => {
      await store.createAgent(makeCreateParams({ prompt: 'Build the feature' }));

      const promptPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001/prompt.md');
      const content = await readFile(promptPath, 'utf-8');
      expect(content).toBe('Build the feature');
    });

    it('should create empty output.md', async () => {
      await store.createAgent(makeCreateParams());

      const outputPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001/output.md');
      const content = await readFile(outputPath, 'utf-8');
      expect(content).toBe('');
    });

    it('should create empty events.log', async () => {
      await store.createAgent(makeCreateParams());

      const eventsPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001/events.log');
      const content = await readFile(eventsPath, 'utf-8');
      expect(content).toBe('');
    });

    it('should update index.json with new agent entry', async () => {
      await store.createAgent(makeCreateParams());

      const indexPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/index.json');
      const index = JSON.parse(await readFile(indexPath, 'utf-8'));

      expect(index.length).toBe(1);
      expect(index[0].agent_id).toBe('agent_001');
      expect(index[0].subagent_type).toBe('build-executor');
      expect(index[0].status).toBe('running');
      expect(index[0].created_at).toBeTruthy();
      expect(index[0].updated_at).toBeTruthy();
    });

    it('should return AgentMeta with correct values', async () => {
      const meta = await store.createAgent(makeCreateParams());

      expect(meta.agent_id).toBe('agent_001');
      expect(meta.subagent_type).toBe('build-executor');
      expect(meta.session_id).toBe('sess_abc');
      expect(meta.status).toBe('running');
      expect(meta.completed_at).toBeNull();
    });

    it('should handle multiple agents', async () => {
      await store.createAgent(makeCreateParams({ agent_id: 'agent_001' }));
      await store.createAgent(makeCreateParams({ agent_id: 'agent_002' }));

      const indexPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/index.json');
      const index = JSON.parse(await readFile(indexPath, 'utf-8'));

      expect(index.length).toBe(2);
      expect(index[0].agent_id).toBe('agent_001');
      expect(index[1].agent_id).toBe('agent_002');
    });
  });

  // ─── updateOutput ───────────────────────────────────────────────────────

  describe('updateOutput', () => {
    it('should write output to output.md', async () => {
      await store.createAgent(makeCreateParams());
      await store.updateOutput('agent_001', 'Build completed successfully');

      const outputPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001/output.md');
      const content = await readFile(outputPath, 'utf-8');
      expect(content).toBe('Build completed successfully');
    });

    it('should update meta.json status to completed', async () => {
      await store.createAgent(makeCreateParams());
      await store.updateOutput('agent_001', 'Build completed');

      const metaPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001/meta.json');
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'));

      expect(meta.status).toBe('completed');
      expect(meta.completed_at).toBeTruthy();
      expect(meta.updated_at).toBeTruthy();
    });

    it('should update index.json entry', async () => {
      await store.createAgent(makeCreateParams());
      await store.updateOutput('agent_001', 'Build completed');

      const indexPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/index.json');
      const index = JSON.parse(await readFile(indexPath, 'utf-8'));

      expect(index[0].status).toBe('completed');
      expect(index[0].updated_at).toBeTruthy();
    });

    it('should throw error for non-existent agent', async () => {
      await expect(store.updateOutput('agent_999', 'output')).rejects.toThrow(
        'Agent agent_999 not found in subagent-store',
      );
    });
  });

  // ─── appendEvent ────────────────────────────────────────────────────────

  describe('appendEvent', () => {
    it('should append event to events.log', async () => {
      await store.createAgent(makeCreateParams());
      const event = makeEvent({ event_type: 'started', detail: 'Task started' });
      await store.appendEvent('agent_001', event);

      const eventsPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001/events.log');
      const content = await readFile(eventsPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.event_type).toBe('started');
      expect(parsed.detail).toBe('Task started');
      expect(parsed.timestamp).toBeTruthy();
    });

    it('should append multiple events on separate lines', async () => {
      await store.createAgent(makeCreateParams());
      await store.appendEvent('agent_001', makeEvent({ event_type: 'started', detail: 'Task started' }));
      await store.appendEvent('agent_001', makeEvent({ event_type: 'completed', detail: 'Task completed' }));

      const eventsPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001/events.log');
      const content = await readFile(eventsPath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);

      const first = JSON.parse(lines[0]);
      expect(first.event_type).toBe('started');

      const second = JSON.parse(lines[1]);
      expect(second.event_type).toBe('completed');
    });

    it('should update meta.json updated_at', async () => {
      await store.createAgent(makeCreateParams());
      const metaBefore = JSON.parse(
        await readFile(join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001/meta.json'), 'utf-8'),
      );

      // 等待一小段时间确保 updated_at 变化
      await new Promise(resolve => setTimeout(resolve, 10));

      await store.appendEvent('agent_001', makeEvent());

      const metaAfter = JSON.parse(
        await readFile(join(TEST_TMP, '.flow-engine/sflow/subagent-store/agent_001/meta.json'), 'utf-8'),
      );

      expect(metaAfter.updated_at >= metaBefore.updated_at).toBe(true);
    });

    it('should throw error for non-existent agent', async () => {
      await expect(store.appendEvent('agent_999', makeEvent())).rejects.toThrow(
        'Agent agent_999 not found in subagent-store',
      );
    });
  });

  // ─── getAgent ───────────────────────────────────────────────────────────

  describe('getAgent', () => {
    it('should return full agent data', async () => {
      await store.createAgent(makeCreateParams());
      await store.updateOutput('agent_001', 'Build completed');
      await store.appendEvent('agent_001', makeEvent({ event_type: 'started', detail: 'Task started' }));

      const data = await store.getAgent('agent_001');

      expect(data).not.toBeNull();
      expect(data!.meta.agent_id).toBe('agent_001');
      expect(data!.meta.subagent_type).toBe('build-executor');
      expect(data!.prompt).toBe('Build the feature');
      expect(data!.output).toBe('Build completed');
      expect(data!.events.length).toBe(1);
      expect(data!.events[0].event_type).toBe('started');
    });

    it('should return null for non-existent agent', async () => {
      const data = await store.getAgent('agent_999');
      expect(data).toBeNull();
    });

    it('should return empty output and events for newly created agent', async () => {
      await store.createAgent(makeCreateParams());
      const data = await store.getAgent('agent_001');

      expect(data!.output).toBe('');
      expect(data!.events).toEqual([]);
    });
  });

  // ─── listAgents ─────────────────────────────────────────────────────────

  describe('listAgents', () => {
    it('should return all agents when no filter', async () => {
      await store.createAgent(makeCreateParams({ agent_id: 'agent_001' }));
      await store.createAgent(makeCreateParams({ agent_id: 'agent_002' }));
      await store.createAgent(makeCreateParams({ agent_id: 'agent_003' }));

      const agents = await store.listAgents();
      expect(agents.length).toBe(3);
    });

    it('should filter by status', async () => {
      await store.createAgent(makeCreateParams({ agent_id: 'agent_001' }));
      await store.createAgent(makeCreateParams({ agent_id: 'agent_002' }));

      // 完成 agent_001
      await store.updateOutput('agent_001', 'Done');

      const running = await store.listAgents({ status: 'running' });
      expect(running.length).toBe(1);
      expect(running[0].agent_id).toBe('agent_002');

      const completed = await store.listAgents({ status: 'completed' });
      expect(completed.length).toBe(1);
      expect(completed[0].agent_id).toBe('agent_001');
    });

    it('should return empty array when no agents', async () => {
      const agents = await store.listAgents();
      expect(agents).toEqual([]);
    });

    it('should return empty array when no agents match filter', async () => {
      await store.createAgent(makeCreateParams({ agent_id: 'agent_001' }));

      const completed = await store.listAgents({ status: 'completed' });
      expect(completed).toEqual([]);
    });
  });

  // ─── resumeAgent ────────────────────────────────────────────────────────

  describe('resumeAgent', () => {
    it('should compose prompt with previous output context', async () => {
      await store.createAgent(makeCreateParams({ prompt: 'Build the feature' }));
      await store.updateOutput('agent_001', '已完成数据库迁移');

      const result = await store.resumeAgent('agent_001', '继续实现 API');

      expect(result.prompt).toContain('继续实现 API');
      expect(result.prompt).toContain('--- 之前的工作摘要 ---');
      expect(result.prompt).toContain('已完成数据库迁移');
    });

    it('should use original prompt when output is empty', async () => {
      await store.createAgent(makeCreateParams({ prompt: 'Build the feature' }));

      const result = await store.resumeAgent('agent_001', '继续完成剩余任务');

      // output 为空时：原始 prompt + 用户 prompt（不附加摘要分隔符）
      expect(result.prompt).toBe('Build the feature继续完成剩余任务');
      expect(result.prompt).not.toContain('--- 之前的工作摘要 ---');
    });

    it('should update meta status to resumed', async () => {
      await store.createAgent(makeCreateParams());
      await store.updateOutput('agent_001', 'Some output');

      const result = await store.resumeAgent('agent_001', 'Continue');

      expect(result.meta.status).toBe('resumed');
    });

    it('should update index.json entry to resumed', async () => {
      await store.createAgent(makeCreateParams());
      await store.updateOutput('agent_001', 'Some output');

      await store.resumeAgent('agent_001', 'Continue');

      const indexPath = join(TEST_TMP, '.flow-engine/sflow/subagent-store/index.json');
      const index = JSON.parse(await readFile(indexPath, 'utf-8'));

      expect(index[0].status).toBe('resumed');
    });

    it('should throw error for non-existent agent', async () => {
      await expect(store.resumeAgent('agent_999', 'Continue')).rejects.toThrow(
        'Agent agent_999 not found in subagent-store',
      );
    });

    it('should return ResumeResult with correct prompt format', async () => {
      await store.createAgent(makeCreateParams({ prompt: 'Original prompt' }));
      await store.updateOutput('agent_001', 'Previous work output');

      const result = await store.resumeAgent('agent_001', 'New prompt');

      expect(result.prompt).toBe('New prompt\n\n--- 之前的工作摘要 ---\nPrevious work output');
    });
  });
});
