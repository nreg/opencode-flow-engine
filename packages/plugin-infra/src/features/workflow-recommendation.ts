/**
 * Workflow Recommendation Feature - P0-2: Quick 模式与结构化工作流推荐收据
 * 
 * 本模块实现 8 个 intake facts 的结构化收集、确定性工作流推荐、收据持久化与验证。
 * 参考：source/spec-superflow/scripts/lib/workflow-recommendation.mjs
 * 
 * 架构适配：
 * - 使用 packages/shared 的跨运行时抽象（atomicWriteJsonFile、readJsonFile）
 * - 收据路径：.flow-engine/sflow/workflow-selection.json
 * - 哈希算法：sha256（稳定 JSON 序列化）
 */

import { fileExists, readJsonFile, atomicWriteJsonFile, ensureDir } from '@opencode-flow-engine/shared';

// ─── Types ────────────────────────────────────────────────────────────────

/** 工作流模式 */
export type WorkflowMode = 'full' | 'hotfix' | 'tweak' | 'quick';

/** 枚举值类型 */
export type YesNoUnknown = 'yes' | 'no' | 'unknown';
export type LowHighUnknown = 'low' | 'high' | 'unknown';
export type RequestKind = 'standard' | 'incident';

/** Intake Facts 结构 */
export interface WorkflowFacts {
  task_count: number | null;
  file_count: number | null;
  config_doc_only: YesNoUnknown;
  schema_api_change: YesNoUnknown;
  new_module: YesNoUnknown;
  behavioral_constraint_change: YesNoUnknown;
  cross_module_change: YesNoUnknown;
  uncertainty: LowHighUnknown;
  request_kind: RequestKind;
}

/** 推荐结果 */
export interface WorkflowRecommendation {
  mode: WorkflowMode;
  reasons: string[];
  risk_reasons?: string[];
}

/** 工作流推荐收据 */
export interface WorkflowSelectionRecord {
  schema_version: number;
  available_modes: WorkflowMode[];
  facts: WorkflowFacts;
  missing_facts: string[];
  status: 'needs-input' | 'ready';
  recommendation: WorkflowRecommendation | null;
  created_at: string;
  selection: {
    mode: WorkflowMode;
    reason: string;
    followed_recommendation: boolean;
    acknowledged_non_recommendation: boolean;
    accepted_automatically: boolean;
    risk_override: boolean;
    verification_strategy: string | null;
    selected_at: string;
    source?: string;
  } | null;
  hash: string;
}

/** 读取结果 */
export interface ReadWorkflowSelectionResult {
  exists: boolean;
  valid: boolean;
  record: WorkflowSelectionRecord | null;
  failures: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────

export const WORKFLOW_MODES: WorkflowMode[] = ['full', 'hotfix', 'tweak', 'quick'];

const BOOLEAN_FACTS = [
  'config_doc_only',
  'schema_api_change',
  'new_module',
  'behavioral_constraint_change',
  'cross_module_change',
] as const;

const FACT_KEYS = [
  'task_count',
  'file_count',
  ...BOOLEAN_FACTS,
  'uncertainty',
] as const;

const WORKFLOW_SELECTION_FILE = '.flow-engine/sflow/workflow-selection.json';

// ─── Fact Normalization ────────────────────────────────────────────────────

/**
 * 归一化 intake facts
 * 将输入转换为标准化的 WorkflowFacts 结构
 */
export function normalizeWorkflowFacts(input: Partial<WorkflowFacts> = {}): WorkflowFacts {
  return {
    task_count: normalizeCount(input.task_count),
    file_count: normalizeCount(input.file_count),
    config_doc_only: normalizeEnum(input.config_doc_only, ['yes', 'no', 'unknown']),
    schema_api_change: normalizeEnum(input.schema_api_change, ['yes', 'no', 'unknown']),
    new_module: normalizeEnum(input.new_module, ['yes', 'no', 'unknown']),
    behavioral_constraint_change: normalizeEnum(input.behavioral_constraint_change, ['yes', 'no', 'unknown']),
    cross_module_change: normalizeEnum(input.cross_module_change, ['yes', 'no', 'unknown']),
    uncertainty: normalizeEnum(input.uncertainty, ['low', 'high', 'unknown']),
    request_kind: normalizeRequestKind(input.request_kind),
  };
}

function normalizeCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('task_count and file_count must be non-negative integers');
  }
  return value;
}

function normalizeEnum<T extends string>(value: unknown, allowed: T[]): T {
  if (value === null || value === undefined) return 'unknown' as T;
  if (!allowed.includes(value as T)) {
    throw new Error(`invalid workflow fact value: ${value}`);
  }
  return value as T;
}

function normalizeRequestKind(value: unknown): RequestKind {
  if (value === null || value === undefined) return 'standard';
  if (!['standard', 'incident'].includes(value as string)) {
    throw new Error('invalid request_kind value');
  }
  return value as RequestKind;
}

// ─── Workflow Recommendation Logic ────────────────────────────────────────

/**
 * 基于完整的 8+1 个 facts 输出确定性推荐
 * 
 * 推荐规则（优先级从高到低）：
 * 1. 任何风险信号 → full
 * 2. config_doc_only=yes 且 task_count<=4 且 file_count<=4 → tweak
 * 3. incident 且 config_doc_only=no 且 task_count<=2 且 file_count<=2 → hotfix
 * 4. 其余低风险代码工作且 task_count<=3 且 file_count<=3 → quick
 * 5. 默认 → full
 */
export function recommendWorkflowPath(input: Partial<WorkflowFacts> = {}): {
  available_modes: WorkflowMode[];
  facts: WorkflowFacts;
  missing_facts: string[];
  status: 'needs-input' | 'ready';
  recommendation: WorkflowRecommendation | null;
} {
  const facts = normalizeWorkflowFacts(input);
  const missing_facts = FACT_KEYS.filter((key) => {
    const value = facts[key];
    return value === null || value === 'unknown';
  });
  
  const base = {
    available_modes: [...WORKFLOW_MODES],
    facts,
    missing_facts,
  };

  // 缺失 facts → needs-input
  if (missing_facts.length > 0) {
    return { ...base, status: 'needs-input', recommendation: null };
  }

  // 风险信号检查
  const riskReasons = riskReasonsFor(facts);
  if (riskReasons.length > 0) {
    return ready(base, 'full', 'Risk signals require the user to choose Quick or Full.', riskReasons);
  }

  // config/doc-only → tweak
  if (facts.config_doc_only === 'yes' && facts.task_count! <= 4 && facts.file_count! <= 4) {
    return ready(base, 'tweak', 'Config/doc-only work is within the tweak thresholds.');
  }

  // incident → hotfix
  if (
    facts.request_kind === 'incident' &&
    facts.config_doc_only === 'no' &&
    facts.task_count! <= 2 &&
    facts.file_count! <= 2
  ) {
    return ready(base, 'hotfix', 'Bounded incident work is within the hotfix thresholds.');
  }

  // 低风险代码工作 → quick
  if (facts.config_doc_only === 'no' && facts.task_count! <= 3 && facts.file_count! <= 3) {
    return ready(base, 'quick', 'Bounded low-risk code work is within the quick thresholds.');
  }

  // 默认 → full
  return ready(base, 'full', 'The observed scope exceeds the fast-path thresholds.');
}

function ready(
  base: Omit<ReturnType<typeof recommendWorkflowPath>, 'status' | 'recommendation'>,
  mode: WorkflowMode,
  reason: string,
  riskReasons: string[] = []
): ReturnType<typeof recommendWorkflowPath> {
  return {
    ...base,
    status: 'ready',
    recommendation: { mode, reasons: [reason], risk_reasons: riskReasons },
  };
}

function riskReasonsFor(facts: WorkflowFacts): string[] {
  const reasons: string[] = [];
  if (facts.behavioral_constraint_change === 'yes') {
    reasons.push('behavioral constraint changed (PRD, spec, design, data, or permission)');
  }
  if (facts.schema_api_change === 'yes') {
    reasons.push('schema or API changes');
  }
  if (facts.new_module === 'yes') {
    reasons.push('new module');
  }
  if (facts.cross_module_change === 'yes') {
    reasons.push('cross-module change');
  }
  if (facts.uncertainty === 'high') {
    reasons.push('high uncertainty');
  }
  return reasons;
}

// ─── Hash & Atomic Write ───────────────────────────────────────────────────

/**
 * 稳定 JSON 序列化（按键排序）
 * 确保相同内容产生相同哈希
 */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(',')}}`;
}

/**
 * 计算收据哈希（sha256）
 */
async function hashRecord(record: Omit<WorkflowSelectionRecord, 'hash'>): Promise<string> {
  // 使用 withoutHash 确保去除 hash 字段（即使传入的 record 可能包含 hash）
  const content = withoutHash(record as WorkflowSelectionRecord);
  const stable = stableJson(content);
  const encoder = new TextEncoder();
  const data = encoder.encode(stable);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hashHex}`;
}

function withoutHash(record: WorkflowSelectionRecord | Omit<WorkflowSelectionRecord, 'hash'>): Omit<WorkflowSelectionRecord, 'hash'> {
  const { hash: _hash, ...content } = record as WorkflowSelectionRecord;
  return content;
}

async function withHash(content: Omit<WorkflowSelectionRecord, 'hash'>): Promise<WorkflowSelectionRecord> {
  const hash = await hashRecord(content);
  return { ...content, hash };
}

// ─── Receipt Persistence ───────────────────────────────────────────────────

/**
 * 保存工作流推荐收据
 * 写入 .flow-engine/sflow/workflow-selection.json
 */
export async function saveWorkflowRecommendation(
  changeDir: string,
  facts: Partial<WorkflowFacts>
): Promise<WorkflowSelectionRecord> {
  const recommendation = recommendWorkflowPath(facts);
  const record = await withHash({
    schema_version: 1,
    ...recommendation,
    created_at: new Date().toISOString(),
    selection: null,
  });

  const targetPath = `${changeDir}/${WORKFLOW_SELECTION_FILE}`;
  await ensureDir(targetPath.substring(0, targetPath.lastIndexOf('/')));
  await atomicWriteJsonFile(targetPath, record);

  return record;
}

/**
 * 读取工作流选择收据
 */
export async function readWorkflowSelection(changeDir: string): Promise<ReadWorkflowSelectionResult> {
  const path = `${changeDir}/${WORKFLOW_SELECTION_FILE}`;
  
  if (!(await fileExists(path))) {
    return {
      exists: false,
      valid: false,
      record: null,
      failures: ['workflow recommendation is missing'],
    };
  }

  try {
    const rawRecord = await readJsonFile<WorkflowSelectionRecord>(path);
    if (!rawRecord) {
      return {
        exists: true,
        valid: false,
        record: null,
        failures: ['workflow recommendation file is empty'],
      };
    }

    const valid = rawRecord.hash === (await hashRecord(rawRecord));
    const record = valid ? normalizeLegacyRecord(rawRecord) : rawRecord;

    return {
      exists: true,
      valid,
      record,
      failures: valid ? [] : ['workflow recommendation hash mismatch'],
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      record: null,
      failures: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * 归一化旧版收据（向后兼容）
 */
function normalizeLegacyRecord(record: WorkflowSelectionRecord): WorkflowSelectionRecord {
  if (record?.facts) {
    return {
      ...record,
      facts: {
        ...record.facts,
        request_kind: record.facts.request_kind ?? 'standard',
        behavioral_constraint_change: record.facts.behavioral_constraint_change ?? 'no',
        cross_module_change: record.facts.cross_module_change ?? 'no',
      },
    };
  }
  return record;
}

// ─── Workflow Selection Recording ───────────────────────────────────────────

/**
 * 记录用户的工作流选择
 * 
 * 约束：
 * - 非推荐路径需要 acknowledged=true
 * - Quick 风险覆盖需要 verification_strategy
 */
export async function recordWorkflowSelection(
  changeDir: string,
  options: {
    mode: WorkflowMode;
    reason: string;
    confirmed: boolean;
    acknowledged?: boolean;
    verificationStrategy?: string;
  }
): Promise<WorkflowSelectionRecord> {
  const { mode, reason, confirmed, acknowledged, verificationStrategy } = options;

  // 读取现有收据
  const loaded = await readWorkflowSelection(changeDir);
  if (!loaded.valid) {
    throw new Error(loaded.failures.join('; '));
  }
  if (!loaded.record) {
    throw new Error('workflow recommendation record is null');
  }
  if (loaded.record.status !== 'ready' || !loaded.record.recommendation) {
    throw new Error('workflow recommendation needs more input');
  }

  // 验证 mode
  if (!WORKFLOW_MODES.includes(mode)) {
    throw new Error(`invalid workflow mode: ${mode}`);
  }
  if (confirmed !== true) {
    throw new Error('workflow selection requires --confirm');
  }
  if (!isSafeReason(reason)) {
    throw new Error('workflow selection reason must be non-empty single-line text');
  }

  // 检查是否跟随推荐
  const followed = mode === loaded.record.recommendation.mode;
  if (!followed && acknowledged !== true) {
    throw new Error('non-recommended workflow selection requires acknowledgement');
  }

  // Quick 风险覆盖检查
  const riskOverride = mode === 'quick' && loaded.record.recommendation.mode !== 'quick';
  assertModeEligible(mode, loaded.record.facts);
  if (riskOverride && !isVerificationStrategy(verificationStrategy)) {
    throw new Error('risk-acknowledged Quick selection requires --verification tdd|new-test|bounded');
  }

  // 写入选择
  const selected = await withHash({
    ...withoutHash(loaded.record),
    selection: {
      mode,
      reason,
      followed_recommendation: followed,
      acknowledged_non_recommendation: !followed && acknowledged === true,
      accepted_automatically: false,
      risk_override: riskOverride,
      verification_strategy: verificationStrategy ?? (mode === 'quick' ? 'bounded' : null),
      selected_at: new Date().toISOString(),
    },
  });

  const targetPath = `${changeDir}/${WORKFLOW_SELECTION_FILE}`;
  await atomicWriteJsonFile(targetPath, selected);

  return selected;
}

/**
 * 自动接受推荐的工作流（quick 或 hotfix）
 */
export async function acceptWorkflowRecommendation(
  changeDir: string,
  options: {
    source: string;
    verificationStrategy: string;
  }
): Promise<WorkflowSelectionRecord> {
  const { source, verificationStrategy } = options;

  const loaded = await readWorkflowSelection(changeDir);
  if (!loaded.valid) {
    throw new Error(loaded.failures.join('; '));
  }
  if (!loaded.record) {
    throw new Error('workflow recommendation record is null');
  }
  const recommendation = loaded.record.recommendation;
  if (loaded.record.status !== 'ready' || !recommendation) {
    throw new Error('workflow recommendation needs more input');
  }

  // 只能自动接受 quick 或 hotfix
  if (!['quick', 'hotfix'].includes(recommendation.mode)) {
    throw new Error('only a recommended quick or hotfix workflow can be accepted directly');
  }

  // hotfix 必须是 incident
  if (recommendation.mode === 'hotfix' && loaded.record.facts.request_kind !== 'incident') {
    throw new Error('direct hotfix acceptance requires an incident request');
  }

  if (source !== 'direct-request') {
    throw new Error('workflow acceptance source must be direct-request');
  }
  if (!isVerificationStrategy(verificationStrategy)) {
    throw new Error('workflow acceptance verification must be tdd, new-test, or bounded');
  }

  const accepted = await withHash({
    ...withoutHash(loaded.record),
    selection: {
      mode: recommendation.mode,
      reason: `Automatically accepted recommendation: ${recommendation.reasons.join('; ')}`,
      source,
      followed_recommendation: true,
      acknowledged_non_recommendation: false,
      accepted_automatically: true,
      risk_override: false,
      verification_strategy: verificationStrategy,
      selected_at: new Date().toISOString(),
    },
  });

  const targetPath = `${changeDir}/${WORKFLOW_SELECTION_FILE}`;
  await atomicWriteJsonFile(targetPath, accepted);

  return accepted;
}

// ─── Direct Workflow Receipt Validation ─────────────────────────────────────

/**
 * 检查是否为有效的 direct workflow receipt
 * 用于 guard 验证
 */
export function isDirectWorkflowReceipt(
  record: WorkflowSelectionRecord | null,
  state: { workflow?: string }
): boolean {
  if (!record) return false;
  
  const selection = record.selection;
  if (!selection) return false;
  
  const mode = selection.mode;

  // 必须是 quick 或 hotfix
  if (!['quick', 'hotfix'].includes(mode)) return false;

  // state.workflow 必须匹配
  if (state?.workflow !== mode) return false;

  // status 必须为 ready
  if (record.status !== 'ready') return false;

  // 检查 direct acceptance 或 acknowledged quick
  const directAcceptance =
    record.recommendation?.mode === mode &&
    selection.accepted_automatically === true &&
    selection.source === 'direct-request';

  const acknowledgedQuick =
    mode === 'quick' &&
    selection.accepted_automatically === false &&
    selection.risk_override === true &&
    isVerificationStrategy(selection.verification_strategy);

  if (!directAcceptance && !acknowledgedQuick) return false;

  // hotfix 必须是 incident
  if (mode === 'hotfix' && record.facts?.request_kind !== 'incident') return false;

  return true;
}

// ─── Helper Functions ───────────────────────────────────────────────────────

function isVerificationStrategy(value: unknown): value is 'tdd' | 'new-test' | 'bounded' {
  return ['tdd', 'new-test', 'bounded'].includes(value as string);
}

function assertModeEligible(mode: WorkflowMode, facts: WorkflowFacts): void {
  const riskReasons = riskReasonsFor(facts);

  if (mode === 'quick') {
    if (facts.task_count! > 3 || facts.file_count! > 3 || facts.config_doc_only !== 'no') {
      throw new Error('Quick is limited to at most 3 non-document code tasks/files; split the change or choose Full');
    }
  }

  if (mode === 'tweak') {
    if (
      facts.task_count! > 4 ||
      facts.file_count! > 4 ||
      facts.config_doc_only !== 'yes' ||
      riskReasons.length > 0
    ) {
      throw new Error('Tweak requires at most 4 config/doc-only tasks/files with no risk signals; choose Full');
    }
  }

  if (mode === 'hotfix') {
    if (
      facts.request_kind !== 'incident' ||
      facts.task_count! > 2 ||
      facts.file_count! > 2 ||
      facts.config_doc_only !== 'no' ||
      riskReasons.length > 0
    ) {
      throw new Error('Hotfix requires an incident with at most 2 non-document tasks/files and no risk signals; choose Full');
    }
  }
}

function isSafeReason(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)
  );
}
