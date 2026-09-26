/**
 * Task Parser 测试（Wave 2 / Task 2.6-2.7）
 *
 * 覆盖 spec: task-parser
 * - 六字段结构化解析（id / text / line / index / complete / marker）
 * - 缩进任务行、`[X]` 大写完成标记
 * - 与 packages/core 的 validateTasks 识别出相同任务集合
 * - 非任务行被忽略、空内容返回空数组
 * - 消费方（checkTaskCompletion / recommendExecutionMode）判定一致且阈值结果不变
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { parseTasks, incompleteTasks } from '../task-parser.js';
import { recommendExecutionMode } from '../plan-crud.js';
import { checkTaskCompletion } from '../../../hooks/guard/checks/transition-guards.js';
import { sharedValidator } from '@opencode-flow-engine/core';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', `task-parser-${name}`);
}

describe('parseTasks — 结构化解析', () => {
  it('解析出六字段（id / text / line / index / complete / marker）', () => {
    const tasks = parseTasks('- [ ] Task 1.1: 建表 — 迁移文件已生成\n');

    expect(tasks.length).toBe(1);
    expect(tasks[0]!.id).toBe('1.1');
    expect(tasks[0]!.complete).toBe(false);
    expect(tasks[0]!.text).toBe('Task 1.1: 建表 — 迁移文件已生成');
    expect(tasks[0]!.line).toBe('- [ ] Task 1.1: 建表 — 迁移文件已生成');
    expect(tasks[0]!.index).toBe(0);
    expect(tasks[0]!.marker).toBe(' ');
  });

  it('大写 [X] 视为已完成，小写 [x] 同样视为已完成', () => {
    const tasks = parseTasks('- [X] Task 2.1: done\n- [x] Task 2.2: done too\n- [ ] Task 2.3: pending');

    expect(tasks.length).toBe(3);
    expect(tasks[0]!.complete).toBe(true);
    expect(tasks[1]!.complete).toBe(true);
    expect(tasks[2]!.complete).toBe(false);
  });

  it('缩进任务行（两空格 / Tab）同样被解析', () => {
    const tasks = parseTasks('  - [x] Task 1.2: 子步骤\n\t- [ ] Task 1.3: 另一个子步骤');

    expect(tasks.length).toBe(2);
    expect(tasks[0]!.complete).toBe(true);
    expect(tasks[1]!.complete).toBe(false);
    expect(tasks[1]!.id).toBe('1.3');
  });

  it('非任务行（普通列表项 / 正文 / 标题）被忽略', () => {
    const tasks = parseTasks('# Tasks\n\n- 这是普通列表，不是任务\n说明文本\n\n- [ ] Task 1.1: 真任务\n');

    expect(tasks.length).toBe(1);
    expect(tasks[0]!.id).toBe('1.1');
  });

  it('无任务内容时返回空数组（不抛异常）', () => {
    expect(parseTasks('')).toEqual([]);
    expect(parseTasks('# 只有标题\n普通段落\n')).toEqual([]);
  });

  it('incompleteTasks 只返回未完成任务', () => {
    const incomplete = incompleteTasks('- [x] T1 done\n- [ ] T2 pending\n- [ ] T3 pending');

    expect(incomplete.length).toBe(2);
    expect(incomplete.map(t => t.id)).toEqual([null, null]);
  });
});

describe('parseTasks — 与 validateTasks 语义一致', () => {
  it('同一份混合输入上，任务条数与 core validateTasks 的识别结果相同', () => {
    const content = [
      '# Tasks',
      '',
      '- 说明文本（普通列表，不是任务）',
      '- [ ] Task one without completion marker',
      '- [ ] Task two without completion marker',
      '- 另一个普通列表项',
      '',
    ].join('\n');

    const tasks = parseTasks(content);
    const report = sharedValidator.validateTasks(content);
    // 每条任务缺少完成定义（无 `:` / `—` / `-`）时，validateTasks 输出一条 task[N] 告警
    const validatorTaskCount = report.issues.filter(issue => String(issue.path ?? '').startsWith('tasks.md:task[')).length;

    expect(tasks.length).toBe(2);
    expect(validatorTaskCount).toBe(2);
    expect(tasks.length).toBe(validatorTaskCount);
  });
});

describe('parseTasks — 消费方一致性与阈值不变', () => {
  const dir = tempDir('consumers');

  async function writeTasksMd(name: string, content: string): Promise<string> {
    const workDir = tempDir(name);
    await mkdir(join(workDir, '.flow-engine', 'sflow'), { recursive: true });
    await mkdir(workDir, { recursive: true });
    await writeFile(join(workDir, '.flow-engine', 'sflow', 'tasks.md'), content, 'utf8');
    return workDir;
  }

  afterAll(async () => {
    await rm(join(import.meta.dir, '..', '__test_workdir__'), { recursive: true, force: true }).catch(() => {});
  });

  it('recommendExecutionMode 的任务数与 parseTasks 未完成数一致（阈值不变）', () => {
    // 3 条任务 → inline 阈值 maxTasks=2 之外、batch-inline 阈值 maxTasks=5 之内
    const content = '- [ ] Task 1.1: Setup\n- [ ] Task 1.2: Migrate\n- [ ] Task 2.1: Verify\n';
    const parsed = parseTasks(content);
    const result = recommendExecutionMode(content);

    expect(result.taskCount).toBe(3);
    expect(result.taskCount).toBe(parsed.filter(t => !t.complete).length);
    expect(result.mode).toBe('batch-inline');
    expect(result.hasDependencies).toBe(false);
  });

  it('存在未完成任务时 checkTaskCompletion 阻断 closing', async () => {
    const workDir = await writeTasksMd('incomplete', '- [x] Task 1.1: done\n- [ ] Task 2.1: 未完成的任务\n');
    try {
      const result = await checkTaskCompletion(workDir, 'sflow');

      expect(result.success).toBe(false);
      expect(result.block).toBe(true);
      expect(result.blockReason ?? '').toContain('incomplete');
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('全部完成时 checkTaskCompletion 放行', async () => {
    const workDir = await writeTasksMd('complete', '- [x] Task 1.1: done\n- [X] Task 2.1: done\n');
    try {
      const first = await checkTaskCompletion(workDir, 'sflow');

      expect(first.success).toBe(true);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('缺少 tasks.md 时优雅通过（不抛异常）', async () => {
    const workDir = tempDir('no-tasks');
    await mkdir(join(workDir, '.flow-engine', 'sflow'), { recursive: true });
    try {
      const result = await checkTaskCompletion(workDir, 'sflow');
      expect(result.success).toBe(true);
      expect(parseTasks('')).toEqual([]);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
