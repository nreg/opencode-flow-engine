/**
 * Workflow Policy 单点裁决测试（Wave 2 / Task 2.3-2.4）
 *
 * 覆盖 spec: workflow-policy
 * - 单点裁决函数返回四字段
 * - tweak/quick 不要求执行计划
 * - quick 缺少 direct 收据被识别
 * - twe ak/hotfix 既有场景判定不变（第三处旧逻辑收敛后行为等价）
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { workflowPolicy } from '../workflow-policy.js';
import {
  saveWorkflowRecommendation,
  acceptWorkflowRecommendation,
  isDirectWorkflowReceipt,
  readWorkflowSelection,
} from '../workflow-recommendation.js';

function tempDir(name: string): string {
  return join(import.meta.dir, '..', '__test_workdir__', `workflow-policy-${name}`);
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
  } catch {}
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {}
}

/** 写入 state.json；未显式给 workflow 时与 mode 一致（真实链路两字段同步）。 */
async function writeState(dir: string, state: Record<string, unknown>): Promise<void> {
  await ensureDir(join(dir, '.flow-engine', 'sflow'));
  await writeFile(
    join(dir, '.flow-engine', 'sflow', 'state.json'),
    JSON.stringify({ workflow: state.mode, ...state }, null, 2),
  );
}

/** 生成一份有效的 direct 收据（quick / hotfix）。 */
async function seedDirectReceipt(dir: string, mode: 'quick' | 'hotfix'): Promise<void> {
  await writeState(dir, { state: 'exploring', mode });
  await saveWorkflowRecommendation(dir, {
    task_count: 1,
    file_count: 1,
    config_doc_only: 'no',
    schema_api_change: 'no',
    new_module: 'no',
    behavioral_constraint_change: 'no',
    cross_module_change: 'no',
    uncertainty: 'low',
    request_kind: mode === 'hotfix' ? 'incident' : 'standard',
  });
  await acceptWorkflowRecommendation(dir, { source: 'direct-request', verificationStrategy: 'tdd' });
}

describe('workflowPolicy — 单点裁决四字段', () => {
  const dir = tempDir('suite');

  beforeEach(async () => {
    await cleanupDir(dir);
    await ensureDir(dir);
  });

  afterEach(async () => {
    await cleanupDir(dir);
  });

  it('返回且仅返回四个布尔结论字段', async () => {
    await writeState(dir, { state: 'exploring', mode: 'full' });

    const policy = await workflowPolicy(dir);

    expect(Object.keys(policy).sort()).toEqual([
      'directShortPath',
      'missingDebugReceipt',
      'missingDirectReceipt',
      'requiresExecutionPlan',
    ]);
    expect(typeof policy.directShortPath).toBe('boolean');
    expect(typeof policy.requiresExecutionPlan).toBe('boolean');
    expect(typeof policy.missingDirectReceipt).toBe('boolean');
    expect(typeof policy.missingDebugReceipt).toBe('boolean');
  });

  it('full 模式无收据：要求执行计划，不缺 direct 收据', async () => {
    await writeState(dir, { state: 'exploring', mode: 'full' });

    const policy = await workflowPolicy(dir);

    expect(policy.directShortPath).toBe(false);
    expect(policy.requiresExecutionPlan).toBe(true);
    expect(policy.missingDirectReceipt).toBe(false);
    expect(policy.missingDebugReceipt).toBe(false);
  });

  it('tweak 模式不要求执行计划', async () => {
    await writeState(dir, { state: 'exploring', mode: 'tweak' });

    const policy = await workflowPolicy(dir);

    expect(policy.requiresExecutionPlan).toBe(false);
    expect(policy.missingDirectReceipt).toBe(false);
  });

  it('quick 模式不要求执行计划', async () => {
    await writeState(dir, { state: 'exploring', mode: 'quick' });

    const policy = await workflowPolicy(dir);

    expect(policy.requiresExecutionPlan).toBe(false);
  });

  it('quick 缺少 direct 收据被识别为 missingDirectReceipt', async () => {
    await writeState(dir, { state: 'exploring', mode: 'quick' });

    const policy = await workflowPolicy(dir);

    expect(policy.directShortPath).toBe(false);
    expect(policy.missingDirectReceipt).toBe(true);
  });

  it('quick 持有有效 direct 收据：directShortPath 为真且不缺收据', async () => {
    await seedDirectReceipt(dir, 'quick');

    const policy = await workflowPolicy(dir);

    expect(policy.directShortPath).toBe(true);
    expect(policy.missingDirectReceipt).toBe(false);
    expect(policy.requiresExecutionPlan).toBe(false);
  });

  it('hotfix 持有有效 direct 收据：判定与迁移前一致（放行）', async () => {
    await seedDirectReceipt(dir, 'hotfix');

    const policy = await workflowPolicy(dir);
    const loaded = await readWorkflowSelection(dir);

    expect(policy.directShortPath).toBe(true);
    expect(policy.missingDirectReceipt).toBe(false);
    // 与推荐层 isDirectWorkflowReceipt 的结论完全一致（同一裁决源）
    expect(isDirectWorkflowReceipt(loaded.record, { workflow: 'hotfix' })).toBe(policy.directShortPath);
  });

  it('hotfix 声明 direct 变体但收据失效：识别为缺失（lostDirectHotfix）', async () => {
    await writeState(dir, { state: 'exploring', mode: 'hotfix', workflow_variant: 'direct' });

    const policy = await workflowPolicy(dir);

    expect(policy.directShortPath).toBe(false);
    expect(policy.missingDirectReceipt).toBe(true);
    expect(policy.requiresExecutionPlan).toBe(false);
  });

  it('debugging 下的 tweak 缺少 debug 收据被识别', async () => {
    await writeState(dir, { state: 'debugging', mode: 'tweak' });

    const policy = await workflowPolicy(dir);

    expect(policy.missingDebugReceipt).toBe(true);
    expect(policy.missingDirectReceipt).toBe(true);
  });

  it('state 显式传入时不再依赖 state.json（与门禁调用形态一致）', async () => {
    await writeState(dir, { state: 'exploring', mode: 'full' });

    const policy = await workflowPolicy(dir, { state: 'exploring', workflow: 'quick' });

    expect(policy.requiresExecutionPlan).toBe(false);
    expect(policy.missingDirectReceipt).toBe(true);
  });
});
