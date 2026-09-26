/**
 * Direct Short-Path Guard Check - P0-2: Quick 模式 guard 强验证
 * 
 * 本模块实现 direct-short-path 维度的 guard 检查，验证：
 * 1. workflow-selection.json 存在且有效
 * 2. isDirectWorkflowReceipt() 返回 true
 * 3. 当前 state 的 workflow 与收据 mode 一致
 * 
 * 参考：source/spec-superflow/scripts/guard/guard.mjs (DIRECT_SHORT_PATH_CHECKS)
 */

import { workflowPolicy, resolveWorkflowMode, type WorkflowPolicyState } from '../workflow-policy.js';
import { readJsonFile } from '@opencode-flow-engine/shared';

/** 拥有 direct 收据概念的工作流（tweak 走轻量路径，无 direct 收据）。 */
const DIRECT_RECEIPT_WORKFLOWS = ['quick', 'hotfix'];

/**
 * Guard 检查结果
 */
export interface GuardCheckResult {
  pass: boolean;
  failures: string[];
}

/**
 * 读取工作流状态
 */
async function readWorkflowState(changeDir: string): Promise<WorkflowPolicyState | null> {
  const statePath = `${changeDir}/.flow-engine/sflow/state.json`;
  return await readJsonFile<WorkflowPolicyState>(statePath);
}

/**
 * 检查 direct-short-path guard
 * 
 * 用于验证快路径转换（exploring→approved-for-build、approved-for-build→executing 等）
 * 是否有有效的 direct workflow receipt。
 * 
 * @param changeDir 项目根目录
 * @param workflow 当前工作流模式
 * @returns Guard 检查结果
 */
export async function checkDirectShortPath(
  changeDir: string,
  workflow: string
): Promise<GuardCheckResult> {
  // 读取当前 state；证据裁决统一交给 workflowPolicy（spec: workflow-policy / 单点裁决）
  const state = (await readWorkflowState(changeDir)) || {};
  const policy = await workflowPolicy(changeDir, { ...state, workflow: state.workflow ?? workflow });

  if (DIRECT_RECEIPT_WORKFLOWS.includes(workflow)) {
    // quick / hotfix 必须由 direct 收据授权
    if (!policy.directShortPath) {
      return {
        pass: false,
        failures: [
          policy.missingDirectReceipt
            ? `valid direct receipt is required for this short-path transition: ${workflow} workflow has no valid workflow-selection receipt`
            : 'a valid direct receipt matching the current workflow is required for this short-path transition',
        ],
      };
    }

    // 收据有效但 state 声明的工作流与期望不符
    if (resolveWorkflowMode(state) !== workflow) {
      return {
        pass: false,
        failures: [
          `workflow mismatch: state.workflow="${state?.workflow}" but expected "${workflow}"`,
        ],
      };
    }

    return { pass: true, failures: [] };
  }

  // tweak 等轻量路径：仅在裁决结论明确缺少收据（如 debugging 缺 debug 收据）时阻断
  if (policy.missingDebugReceipt) {
    return {
      pass: false,
      failures: [
        `valid direct receipt is required for this short-path transition: debugging ${workflow} workflow has no planless debug receipt`,
      ],
    };
  }

  return { pass: true, failures: [] };
}

/**
 * 检查 direct test result（用于 fast-path closing）
 * 
 * Quick/Tweak 模式的 closing 需要验证 test_result 为 pass
 * 
 * @param changeDir 项目根目录
 * @returns Guard 检查结果
 */
export async function checkDirectTestResult(changeDir: string): Promise<GuardCheckResult> {
  const state = await readWorkflowState(changeDir);
  
  if (!state) {
    return {
      pass: false,
      failures: ['state.json not found'],
    };
  }
  
  const testResult = (state as Record<string, unknown>).test_result;
  
  if (
    typeof testResult === 'string' &&
    testResult.trim().toLowerCase().startsWith('pass')
  ) {
    return { pass: true, failures: [] };
  }
  
  return {
    pass: false,
    failures: ['fast-path closing requires test_result starting with pass; DP-6 is not a substitute'],
  };
}

/**
 * 判断是否为 direct short path 转换
 * 
 * Quick 模式的所有转换都是 direct short path
 * Hotfix 的 exploring→approved-for-build 也是 direct short path
 * 
 * @param fromState 源状态
 * @param toState 目标状态
 * @param workflow 工作流模式
 * @returns 是否为 direct short path
 */
export function isDirectShortPathTransition(
  fromState: string,
  toState: string,
  workflow: string
): boolean {
  const key = `${fromState}:${toState}`;
  
  // Quick 模式的所有转换
  if (workflow === 'quick') {
    const quickPaths = [
      'exploring:approved-for-build',
      'approved-for-build:executing',
      'executing:closing',
      'debugging:executing',
    ];
    return quickPaths.includes(key);
  }
  
  // Hotfix 的快路径
  if (workflow === 'hotfix' && key === 'exploring:approved-for-build') {
    return true;
  }
  
  // Tweak 的快路径
  if (workflow === 'tweak') {
    const tweakPaths = [
      'exploring:approved-for-build',
      'approved-for-build:executing',
      'executing:closing',
      'debugging:executing',
    ];
    return tweakPaths.includes(key);
  }
  
  return false;
}

/**
 * 获取转换所需的 guard 检查维度
 * 
 * @param fromState 源状态
 * @param toState 目标状态
 * @param workflow 工作流模式
 * @returns 需要检查的维度列表
 */
export function getDirectShortPathChecks(
  fromState: string,
  toState: string,
  workflow: string
): string[] {
  const key = `${fromState}:${toState}`;
  
  // Quick 模式
  if (workflow === 'quick') {
    const checks: Record<string, string[]> = {
      'exploring:approved-for-build': ['direct-short-path'],
      'approved-for-build:executing': ['direct-short-path'],
      'executing:closing': ['direct-short-path', 'direct-test-result'],
      'debugging:executing': ['direct-short-path'],
    };
    return checks[key] || [];
  }
  
  // Hotfix 快路径
  if (workflow === 'hotfix' && key === 'exploring:approved-for-build') {
    return ['direct-short-path'];
  }
  
  // Tweak 快路径
  if (workflow === 'tweak') {
    const checks: Record<string, string[]> = {
      'exploring:approved-for-build': ['direct-short-path'],
      'approved-for-build:executing': ['direct-short-path'],
      'executing:closing': ['direct-short-path', 'direct-test-result'],
      'debugging:executing': ['direct-short-path'],
    };
    return checks[key] || [];
  }
  
  return [];
}
