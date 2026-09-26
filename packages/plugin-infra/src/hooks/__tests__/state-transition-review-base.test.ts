/**
 * P1 fix: 进入 executing 时挂载 recordReviewBase（规格 P1-5 review_base WRITE_ONCE）
 *
 * 覆盖 spec: execution-plan / P1-5 review_base
 * - approved-for-build → executing 转换时调用 recordReviewBase 记录 review_base
 * - 其他转换不触发（WRITE_ONCE no-op）
 * - 非 git 环境降级：转换不因 review_base 记录失败而阻断
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { createStateTransitionHook, checkReviewBaseRecording } from '../state-transition.js';
import { createExecutionPlan, readExecutionPlan } from '../../features/execution-plan.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', `state-transition-${name}`);
}

async function ensureDir(dir: string): Promise<void> {
  try { await mkdir(dir, { recursive: true }); } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try { await rm(dir, { recursive: true, force: true }); } catch {}
}

async function writeStateJson(dir: string, state: string): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow');
  await writeFile(
    dir + '/.flow-engine/sflow/state.json',
    JSON.stringify({
      state,
      mode: 'full',
      artifacts_hash: 'abc123',
      contract_hash: 'def456',
    }, null, 2),
  );
}

function initGitRepo(dir: string): string {
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  run(['init', '-q']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'commit.gpgsign', 'false']);
  return '';
}

async function commitFile(dir: string, file: string, content: string): Promise<string> {
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
  await writeFile(join(dir, file), content);
  run(['add', '.']);
  run(['commit', '-q', '-m', `add ${file}`]);
  return run(['rev-parse', 'HEAD']).trim();
}

async function writePreflightArtifacts(dir: string): Promise<void> {
  await ensureDir(dir + '/.flow-engine/sflow/specs');
  await writeFile(dir + '/.flow-engine/sflow/proposal.md', '# Proposal');
  await writeFile(dir + '/.flow-engine/sflow/specs/test.md', '# Spec');
  await writeFile(dir + '/.flow-engine/sflow/design.md', '# Design');
  await writeFile(dir + '/.flow-engine/sflow/tasks.md', '# Tasks');
  await writeFile(dir + '/.flow-engine/sflow/execution-contract.md', '# Contract');
}

describe('P1 fix: checkReviewBaseRecording（executing 时记录 review_base）', () => {
  const dir = tempDir('review-base');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('approved-for-build → executing 时记录 review_base（WRITE_ONCE）', async () => {
    initGitRepo(dir);
    const headSha = await commitFile(dir, 'a.txt', 'a\n');
    await writeStateJson(dir, 'approved-for-build');
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'test',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    const result = await checkReviewBaseRecording({
      changeDir: dir,
      currentState: 'approved-for-build',
      newState: 'executing',
    });

    expect(result.blocked).toBe(false);
    const plan = await readExecutionPlan(dir);
    expect(plan?.review_base).toBeTruthy();
    expect(plan?.review_base).toBe(headSha);
  }, 30000);

  it('review_base 已设置时不覆盖（WRITE_ONCE）', async () => {
    initGitRepo(dir);
    const headSha = await commitFile(dir, 'a.txt', 'a\n');
    await writeStateJson(dir, 'approved-for-build');
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'test',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    await checkReviewBaseRecording({
      changeDir: dir,
      currentState: 'approved-for-build',
      newState: 'executing',
    });

    // Append a second commit — WRITE_ONCE means review_base must not change
    await commitFile(dir, 'b.txt', 'b\n');
    const headSha2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();

    await checkReviewBaseRecording({
      changeDir: dir,
      currentState: 'executing',
      newState: 'debugging',
    }).catch(() => undefined);

    const plan = await readExecutionPlan(dir);
    expect(plan?.review_base).toBe(headSha);
    expect(plan?.review_base).not.toBe(headSha2);
  }, 30000);

  it('非 executing 转换不触发（no-op）', async () => {
    initGitRepo(dir);
    await commitFile(dir, 'a.txt', 'a\n');
    await writeStateJson(dir, 'specifying');
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'test',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    const result = await checkReviewBaseRecording({
      changeDir: dir,
      currentState: 'specifying',
      newState: 'bridging',
    });

    expect(result.blocked).toBe(false);
    const plan = await readExecutionPlan(dir);
    expect(plan?.review_base).toBeUndefined();
  }, 30000);

  it('非 git 环境降级：不阻断转换、review_base 不设置', async () => {
    // Use a directory OUTSIDE any git repo so `git rev-parse HEAD` cannot resolve
    const nonGitDir = 'C:/Users/admin/AppData/Local/Temp/opencode/sflow-non-git-review-base';
    await cleanupDir(nonGitDir);
    await ensureDir(nonGitDir);
    try {
      await writeStateJson(nonGitDir, 'approved-for-build');
      await createExecutionPlan(nonGitDir, {
        mode: 'sdd',
        source: 'default',
        rationale: 'test',
        waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
      });

      const result = await checkReviewBaseRecording({
        changeDir: nonGitDir,
        currentState: 'approved-for-build',
        newState: 'executing',
      });

      expect(result.blocked).toBe(false);
      const plan = await readExecutionPlan(nonGitDir);
      // No commits reachable (not a git repo) — review_base stays unset
      expect(plan?.review_base).toBeUndefined();
    } finally {
      await cleanupDir(nonGitDir);
    }
  }, 30000);
});

describe('P1 fix: state_transition hook 端到端（executing 时记录 review_base）', () => {
  const dir = tempDir('review-base-hook-e2e');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('hook 执行 approved-for-build → executing 后 plan 带 review_base', async () => {
    initGitRepo(dir);
    await commitFile(dir, 'a.txt', 'a\n');
    await writeStateJson(dir, 'approved-for-build');
    await writePreflightArtifacts(dir);
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'test',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    const hook = createStateTransitionHook();
    const result = await hook.execute({
      changeDir: dir,
      data: { newState: 'executing' },
    } as any);

    expect(result.success).toBe(true);
    const plan = await readExecutionPlan(dir);
    expect(plan?.review_base).toBeTruthy();

    // state.json advanced to executing
    const stateRaw = await readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8');
    expect(JSON.parse(stateRaw).state).toBe('executing');
  }, 30000);
});

// ─── P2-2/P2-3：计划哈希派生同步与 executing 阶段创建补锚点 ─────────────────────

describe('P2-2/P2-3：execution_plan_hash 派生键同步', () => {
  const dir = tempDir('review-base-hash-sync');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('P2-2：recordReviewBase 改写 plan.hash 后同步 state.execution_plan_hash', async () => {
    initGitRepo(dir);
    await commitFile(dir, 'a.txt', 'a\n');
    await writeStateJson(dir, 'approved-for-build');
    const plan = await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'test',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    // 创建后 state 摘要与 plan.hash 一致
    const state0 = JSON.parse(await readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8'));
    expect(state0.execution_plan_hash).toBe(plan.hash);

    await checkReviewBaseRecording({
      changeDir: dir,
      currentState: 'approved-for-build',
      newState: 'executing',
    });

    // recordReviewBase 改写 plan（review_base + 重算 hash）后，state 摘要必须同步
    const plan2 = await readExecutionPlan(dir);
    expect(plan2?.review_base).toBeTruthy();
    const state1 = JSON.parse(await readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8'));
    expect(state1.execution_plan_hash).toBe(plan2!.hash);
  }, 30000);

  it('P2-3：executing 阶段创建计划时补写 review_base（WRITE_ONCE）', async () => {
    initGitRepo(dir);
    const headSha = await commitFile(dir, 'a.txt', 'a\n');
    await writeStateJson(dir, 'executing');
    const plan = await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'test',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    const plan2 = await readExecutionPlan(dir);
    expect(plan2?.review_base).toBe(headSha);

    // N-1: createExecutionPlan 返回的必须是补锚点后的快照
    expect(plan.review_base).toBe(headSha);
    expect(plan.hash).toBe(plan2!.hash);

    // 补写锚点后 state 摘要同步（锚点不改变 hash）
    const stateRaw = JSON.parse(await readFile(dir + '/.flow-engine/sflow/state.json', 'utf-8'));
    expect(stateRaw.execution_plan_hash).toBe(plan2!.hash);
    expect(plan2!.hash).toBe(plan.hash); // review_base 是状态锚点非计划内容，不改变 hash
  }, 30000);

  it('P2-3：非 executing 阶段创建计划不写 review_base（回归）', async () => {
    initGitRepo(dir);
    await commitFile(dir, 'a.txt', 'a\n');
    await writeStateJson(dir, 'specifying');
    await createExecutionPlan(dir, {
      mode: 'sdd',
      source: 'default',
      rationale: 'test',
      waves: [{ id: 'W1', strategy: 'serial', tasks: ['1.1'], depends_on: [] }],
    });

    const plan = await readExecutionPlan(dir);
    expect(plan?.review_base).toBeUndefined();
  }, 30000);
});
