/**
 * Workflow Policy — 工作流证据单点裁决（D3 / spec: workflow-policy）
 *
 * 背景：此前「工作流证据怎么解读」散落在三处，语义有漂移风险：
 *   1. 门禁层 `checkWorkflowModeTransition`（transition-guards.ts）
 *   2. 推荐层 `isDirectWorkflowReceipt`（workflow-recommendation.ts）
 *   3. 已实现但未挂载的 `checkDirectShortPath`（features/guard-checks/check-direct-short-path.ts）
 *
 * 本模块移植上游 `spec-superflow/scripts/lib/workflow-policy.mjs` 的裁决模型，
 * 成为门禁层、恢复链路判定这四个结论的**唯一入口**：
 *   - `directShortPath`       当前是否存在与 state 匹配的 direct 收据
 *   - `requiresExecutionPlan` 该工作流是否必须有执行计划
 *   - `missingDirectReceipt`  是否缺少快路径所要求的 direct 收据
 *   - `missingDebugReceipt`   debugging 下的轻量工作流是否缺少 debug 收据
 *
 * 架构适配（无 CLI / 事件驱动）：
 * - 收据读取经 `readWorkflowSelection`（异步，插件侧跨运行时抽象）
 * - state 缺省时从 `.flow-engine/sflow/state.json` 读取
 * - 真实 state.json 以 `mode` 为主字段，`workflow` 为工作流选择域字段，二者均兼容
 */

import { readJsonFile } from '@opencode-flow-engine/shared';
import {
  isDirectWorkflowReceipt,
  readWorkflowSelection,
  type WorkflowSelectionRecord,
} from './workflow-recommendation.js';

/** 裁决所需的 state 片段（真实 state.json 的超集）。 */
export interface WorkflowPolicyState {
  state?: string;
  /** 工作流选择域字段（direct 收据判定以它为准） */
  workflow?: string;
  /** sFlow state.json 的主字段（无 workflow 时回退） */
  mode?: string;
  workflow_variant?: string;
}

/** 裁决结论：四个布尔字段，供调用方解构消费。 */
export interface WorkflowPolicyVerdict {
  directShortPath: boolean;
  requiresExecutionPlan: boolean;
  missingDirectReceipt: boolean;
  missingDebugReceipt: boolean;
}

/** 不要求执行计划的轻量工作流。 */
const PLANLESS_WORKFLOWS = ['tweak', 'quick'];

/** debugging 下需要 debug 收据的轻量工作流。 */
const DEBUG_RECEIPT_WORKFLOWS = ['tweak', 'quick'];

const STATE_FILE = '.flow-engine/sflow/state.json';

/**
 * 解析工作流模式：`workflow` 优先，回退 `mode`，缺省按 `full` 处理。
 * 保证门禁（用 mode）与推荐层（用 workflow）看到同一个结论。
 */
export function resolveWorkflowMode(state?: WorkflowPolicyState | null): string {
  const raw = state?.workflow ?? state?.mode;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : 'full';
}

/** 读取工作流 state（供未显式传入 state 的调用方使用）。 */
export async function readWorkflowPolicyState(changeDir: string): Promise<WorkflowPolicyState | null> {
  return await readJsonFile<WorkflowPolicyState>(`${changeDir}/${STATE_FILE}`);
}

/**
 * 单点裁决：回答「当前工作流证据到底说明了什么」。
 *
 * @param changeDir 项目根目录
 * @param state     可选 state 片段；缺省时从 state.json 读取
 */
export async function workflowPolicy(
  changeDir: string,
  state?: WorkflowPolicyState | null,
): Promise<WorkflowPolicyVerdict> {
  const resolvedState: WorkflowPolicyState = state ?? (await readWorkflowPolicyState(changeDir)) ?? {};
  const workflow = resolveWorkflowMode(resolvedState);

  const receipt = await readWorkflowSelection(changeDir);
  const directShortPath = receipt.valid && isDirectWorkflowReceipt(receipt.record, { workflow });

  // 声明走 direct hotfix 但收据已失效 —— 不能静默降级成「无收据的普通 hotfix」
  const lostDirectHotfix = workflow === 'hotfix' && resolvedState.workflow_variant === 'direct' && !directShortPath;

  const missingDebugReceipt =
    resolvedState.state === 'debugging' &&
    DEBUG_RECEIPT_WORKFLOWS.includes(workflow) &&
    !(await readPlanlessDebugReceipt(changeDir, resolvedState));

  return {
    directShortPath,
    requiresExecutionPlan: !PLANLESS_WORKFLOWS.includes(workflow) && !directShortPath && !lostDirectHotfix,
    missingDirectReceipt:
      (workflow === 'quick' && !directShortPath) || missingDebugReceipt || lostDirectHotfix,
    missingDebugReceipt,
  };
}

/**
 * 读取「无计划也能成立的 debug 收据」：优先 direct 收据，
 * 其次是 tweak 的人工确认收据（非自动接受、跟随推荐、有 confirmed_at）。
 */
export async function readPlanlessDebugReceipt(
  changeDir: string,
  state: WorkflowPolicyState,
): Promise<WorkflowSelectionRecord | null> {
  const workflow = resolveWorkflowMode(state);
  const loaded = await readWorkflowSelection(changeDir);
  if (!loaded.valid) return null;
  if (isDirectWorkflowReceipt(loaded.record, { workflow })) return loaded.record;

  const selection = loaded.record?.selection as (Record<string, unknown> | null | undefined);
  const confirmedAt = selection?.confirmed_at;
  const validTweak =
    workflow === 'tweak' &&
    loaded.record?.status === 'ready' &&
    loaded.record?.recommendation?.mode === 'tweak' &&
    selection?.mode === 'tweak' &&
    selection?.accepted_automatically === false &&
    selection?.followed_recommendation === true &&
    typeof confirmedAt === 'string' &&
    Number.isFinite(Date.parse(confirmedAt));

  return validTweak ? loaded.record : null;
}
