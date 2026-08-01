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

import { readWorkflowSelection, isDirectWorkflowReceipt } from '../workflow-recommendation.js';
import { readJsonFile } from '@opencode-flow-engine/shared';

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
async function readWorkflowState(changeDir: string): Promise<{ workflow?: string } | null> {
  const statePath = `${changeDir}/.flow-engine/sflow/state.json`;
  return await readJsonFile<{ workflow?: string }>(statePath);
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
  // 读取 workflow selection receipt
  const receipt = await readWorkflowSelection(changeDir);
  
  // 读取当前 state
  const state = await readWorkflowState(changeDir);
  
  // 验证 receipt 有效性
  if (!receipt.valid) {
    return {
      pass: false,
      failures: [
        `valid direct receipt is required for this short-path transition: ${receipt.failures.join('; ')}`,
      ],
    };
  }
  
  if (!receipt.record) {
    return {
      pass: false,
      failures: ['valid direct receipt is required for this short-path transition: record is null'],
    };
  }
  
  // 验证 isDirectWorkflowReceipt
  if (!isDirectWorkflowReceipt(receipt.record, state || {})) {
    return {
      pass: false,
      failures: [
        'a valid direct receipt matching the current workflow is required for this short-path transition',
      ],
    };
  }
  
  // 验证 workflow 匹配
  if (state?.workflow !== workflow) {
    return {
      pass: false,
      failures: [
        `workflow mismatch: state.workflow="${state?.workflow}" but expected "${workflow}"`,
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
