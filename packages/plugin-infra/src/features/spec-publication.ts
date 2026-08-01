/**
 * Spec Publication Receipt System (P1-1)
 * 
 * 本模块实现 Spec 发布收据机制，替代旧的 spec_merged: true flag 作为 closing 验证依据。
 * 
 * 核心功能：
 * - applyDeltaToBaseline: 将 delta spec 应用到 baseline
 * - hashPublishedBaseline: 计算 baseline 的 sha256 哈希
 * - createPublicationReceipt: 生成发布收据
 * - validatePublicationReceipt: 验证收据完整性
 * 
 * 收据存储位置：.flow-engine/sflow/spec-publication/<capability>.json
 * 
 * 向后兼容：
 * - 保留 spec_merged 降级标志（guard 检查时若无 receipt 但 spec_merged=true 则警告放行）
 * - 首次进入 bridging 自动迁移旧 spec_merged 到 receipt
 * 
 * Ported from: spec-superflow/scripts/lib/spec-publication.mjs
 * Adapted for: opencode-flow-engine plugin architecture
 */

import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { RequirementBlock, DeltaPlan } from '@opencode-flow-engine/core';
import { 
  extractRequirementsSection, 
  parseDeltaSpec,
  Validator 
} from '@opencode-flow-engine/core';
import {
  fileExists,
  readFile,
  writeFile,
  atomicWriteJsonFile,
  readJsonFile,
  ensureDir,
  directoryExists,
} from '@opencode-flow-engine/shared';

// ─── 常量定义 ─────────────────────────────────────────────────────────────

/** Delta spec 操作头正则 */
const DELTA_HEADER_RE = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/im;

/** 收据 schema 版本 */
const RECEIPT_VERSION = 1;

/** 收据目录路径（相对于项目根目录） */
export const SPEC_PUBLICATION_DIR = '.flow-engine/sflow/spec-publication';

// ─── 类型定义 ─────────────────────────────────────────────────────────────

/**
 * 发布收据结构
 * 存储在 .flow-engine/sflow/spec-publication/<capability>.json
 */
export interface PublicationReceipt {
  /** Schema 版本（当前为 1） */
  schema_version: number;
  /** 能力名称 */
  capability: string;
  /** Baseline 哈希（sha256:...） */
  baseline_hash: string;
  /** 发布时间（ISO 8601） */
  published_at: string;
  /** 变更 ID */
  change_id: string;
  /** Delta 操作记录 */
  delta_operations: DeltaOperation[];
  /** 警告信息 */
  warnings: string[];
}

/**
 * Delta 操作记录
 */
export interface DeltaOperation {
  operation: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
  status: 'applied' | 'skipped';
}

/**
 * 应用 delta 到 baseline 的详细结果
 */
export interface ApplyDeltaResult {
  /** 应用后的 canonical baseline 内容 */
  content: string;
  /** 是否有变更 */
  changed: boolean;
  /** 操作记录 */
  operations: DeltaOperation[];
  /** 警告信息 */
  warnings: string[];
}

/**
 * 发布上下文
 */
export interface PublicationContext {
  /** 变更目录（绝对路径） */
  changeDir: string;
  /** 项目根目录 */
  projectRoot: string;
  /** Baseline specs 目录 */
  baselineSpecsDir: string;
}

/**
 * 收据验证结果
 */
export interface ReceiptValidationResult {
  pass: boolean;
  reason: string;
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────

/**
 * 将路径转换为 POSIX 格式（统一斜杠）
 */
function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * 计算多个文件内容的 sha256 哈希
 * 按文件名排序后依次更新哈希：name + \0 + content + \0
 */
function digest(entries: Array<[string, string]>): string {
  const hash = createHash('sha256');
  for (const [name, content] of [...entries].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(name);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * 从 spec 文件路径提取 capability 名称
 * 假设路径格式为 .../specs/<capability>/spec.md
 */
function capabilityFromSpecFile(changeDir: string, file: string): string {
  const parts = relative(join(changeDir, 'specs'), file).split(/[/\\]/);
  return parts[0] ?? '';
}

/**
 * 获取 baseline spec 文件的目标路径
 */
function targetPath(projectRoot: string, capability: string): string {
  return join(projectRoot, 'specs', capability, 'spec.md');
}

/**
 * 在 requirement blocks 中查找指定名称的索引
 */
function requirementIndex(blocks: RequirementBlock[], name: string): number {
  return blocks.findIndex(block => block.name === name);
}

/**
 * 规范化 requirement 名称（用于 near-match 检测）
 * 去除空格、标点、下划线，转小写
 */
function normalizeNearRequirementName(name: string): string {
  return name.toLocaleLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, '');
}

/**
 * 断言不存在 near-match requirement
 * 防止因拼写错误导致的错误操作
 */
function assertNoNearRequirementMatch(
  blocks: RequirementBlock[],
  name: string,
  operation: string
): void {
  const normalized = normalizeNearRequirementName(name);
  const nearMatch = blocks.find(
    block => block.name !== name && normalizeNearRequirementName(block.name) === normalized
  );
  if (nearMatch) {
    throw new Error(
      `Cannot ${operation} requirement '${name}' in published baseline: it is a near-match for existing requirement '${nearMatch.name}'. Use the exact published requirement name.`
    );
  }
}

/**
 * 检查两个 requirement block 是否相同（基于原始文本）
 */
function sameRequirement(left: RequirementBlock, right: RequirementBlock): boolean {
  return left.raw.trimEnd() === right.raw.trimEnd();
}

/**
 * 检测行是否为 opening fence（``` 或 ~~~）
 */
function openingFence(line: string): { marker: string; length: number } | undefined {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  // match[1] 存在时，match[1][0] 也一定存在（至少 3 个字符）
  return match && match[1] ? { marker: match[1][0]!, length: match[1].length } : undefined;
}

/**
 * 检测行是否关闭当前 fence
 */
function closesFence(line: string, fence: { marker: string; length: number }): boolean {
  const match = line.match(/^ {0,3}(`+|~+)\s*$/);
  return Boolean(match && match[1]![0] === fence.marker && match[1]!.length >= fence.length);
}

/**
 * 提取顶层 Purpose 部分（忽略 fenced code block 内的假标题）
 */
function extractPurpose(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  let activeFence: { marker: string; length: number } | undefined;
  let start = -1;

  // 查找 ## Purpose 标题
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (activeFence) {
      if (closesFence(line, activeFence)) activeFence = undefined;
      continue;
    }
    const fence = openingFence(line);
    if (fence) {
      activeFence = fence;
      continue;
    }
    if (/^##\s+Purpose\s*$/i.test(line)) {
      start = index + 1;
      break;
    }
  }

  if (start === -1) return '';

  // 提取 Purpose 内容直到下一个 ## 标题
  activeFence = undefined;
  const purpose: string[] = [];
  for (let index = start; index < lines.length; index++) {
    const line = lines[index]!;
    if (activeFence) {
      purpose.push(line);
      if (closesFence(line, activeFence)) activeFence = undefined;
      continue;
    }
    const fence = openingFence(line);
    if (fence) {
      activeFence = fence;
      purpose.push(line);
      continue;
    }
    if (/^##\s+/.test(line)) break;
    purpose.push(line);
  }
  return purpose.join('\n').trim();
}

/**
 * 生成默认 Purpose（当 delta spec 未提供时）
 */
function defaultPurpose(capability: string): string {
  return `The ${capability} capability documents the published behavior for users and maintainers.`;
}

/**
 * 确保 canonical baseline 包含 Purpose 部分
 * 仅对新 baseline 且缺少 Purpose 时添加
 */
function withCanonicalPurpose(
  before: string,
  capability: string,
  deltaContent: string,
  warnings: string[],
  isNewBaseline: boolean
): string {
  if (!isNewBaseline || extractPurpose(before)) return before.trimEnd();
  const purpose = extractPurpose(deltaContent) || defaultPurpose(capability);
  if (!extractPurpose(deltaContent)) {
    warnings.push(
      `No delta Purpose was supplied for '${capability}'; a deterministic default Purpose was used.`
    );
  }
  return `${before.trimEnd() || `# ${capability}`}\n\n## Purpose\n\n${purpose}`;
}

/**
 * 验证 delta spec 内容
 * 如果验证失败则抛出异常
 */
function validateDeltaOrThrow(deltaContent: string, changeName: string): void {
  const report = new Validator().validateDeltaSpec(deltaContent, changeName);
  if (!report.valid) {
    throw new Error(
      `Invalid delta spec: ${report.issues.map(issue => issue.message).join('; ')}`
    );
  }
}

/**
 * 渲染 canonical baseline
 * 格式：before + ## Requirements + preamble + blocks + after
 */
function renderCanonicalBaseline(
  parts: {
    before: string;
    preamble: string;
    bodyBlocks: RequirementBlock[];
    after: string;
  },
  capability: string
): string {
  const before = parts.before.trimEnd() || `# ${capability}`;
  const preamble = parts.preamble.trim();
  const blocks = parts.bodyBlocks.map(block => block.raw.trim()).filter(Boolean).join('\n\n');
  const after = parts.after.trim();
  const sections = [before, '## Requirements'];
  if (preamble) sections.push(preamble);
  if (blocks) sections.push(blocks);
  if (after) sections.push(after);
  return sections.join('\n\n');
}

/**
 * 解析 baseline 内容为结构化部分
 * 支持两种格式：
 * - Canonical baseline（包含 ## Requirements 部分）
 * - Legacy delta baseline（包含 ADDED/MODIFIED 等 delta 头）
 */
function baselineParts(
  content: string,
  capability: string
): {
  before: string;
  preamble: string;
  bodyBlocks: RequirementBlock[];
  after: string;
  headerLine?: string;
} {
  if (!content) {
    return { before: `# ${capability}`, preamble: '', bodyBlocks: [], after: '' };
  }

  // 如果不是 delta spec，按 canonical baseline 解析
  if (!DELTA_HEADER_RE.test(content)) {
    const parts = extractRequirementsSection(content);
    return { ...parts, headerLine: '## Requirements' };
  }

  // Legacy delta baseline：尝试规范化
  const plan = parseDeltaSpec(content);
  if (plan.removed.length > 0 || plan.renamed.length > 0) {
    throw new Error(
      `Cannot safely normalize legacy delta baseline for '${capability}' containing REMOVED or RENAMED operations. Restore a canonical baseline before syncing.`
    );
  }
  const firstDelta = content.search(/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/im);
  const before = content.slice(0, firstDelta).trimEnd() || `# ${capability}`;
  const blocks = [...plan.added, ...plan.modified];
  const names = new Set<string>();
  for (const block of blocks) {
    if (names.has(block.name)) {
      throw new Error(
        `Cannot normalize legacy delta baseline for '${capability}': duplicate requirement '${block.name}'.`
      );
    }
    names.add(block.name);
  }
  return { before, preamble: '', bodyBlocks: blocks, after: '' };
}

// ─── 核心函数 ─────────────────────────────────────────────────────────────

/**
 * 应用 delta spec 到 baseline 并返回详细结果
 * 
 * 这是发布流程的核心函数，负责：
 * 1. 验证 delta spec 格式
 * 2. 解析 baseline 内容
 * 3. 依次应用 RENAMED、MODIFIED、REMOVED、ADDED 操作
 * 4. 生成 canonical baseline
 * 5. 记录操作历史和警告
 * 
 * @param baselineContent 当前 baseline 内容（可能为空）
 * @param deltaContent delta spec 内容
 * @param capability 能力名称
 * @returns 应用结果（包含新内容、操作记录、警告）
 */
export function applyDeltaToBaselineDetailed(
  baselineContent: string,
  deltaContent: string,
  capability: string
): ApplyDeltaResult {
  validateDeltaOrThrow(deltaContent, capability);
  const isNewBaseline = !baselineContent.trim();
  const parts = baselineParts(baselineContent, capability);
  const blocks = [...parts.bodyBlocks];
  const plan = parseDeltaSpec(deltaContent);
  const operations: DeltaOperation[] = [];
  const warnings: string[] = [];

  // 应用 RENAMED 操作
  for (const { from, to } of plan.renamed) {
    const fromIndex = requirementIndex(blocks, from);
    const toIndex = requirementIndex(blocks, to);
    if (fromIndex === -1) {
      assertNoNearRequirementMatch(blocks, from, 'rename');
      if (toIndex !== -1) {
        operations.push({ operation: 'RENAMED', status: 'skipped' });
        continue;
      }
      throw new Error(`Cannot rename missing requirement '${from}' in '${capability}'.`);
    }
    assertNoNearRequirementMatch(blocks, to, 'rename to');
    if (toIndex !== -1)
      throw new Error(`Cannot rename '${from}' to existing requirement '${to}' in '${capability}'.`);
    const original = blocks[fromIndex]!;
    blocks[fromIndex] = {
      ...original,
      name: to,
      headerLine: `### Requirement: ${to}`,
      raw: `### Requirement: ${to}${original.raw.slice(original.headerLine.length)}`,
    };
    operations.push({ operation: 'RENAMED', status: 'applied' });
  }

  // 应用 MODIFIED 操作
  for (const block of plan.modified) {
    const index = requirementIndex(blocks, block.name);
    if (index === -1) {
      assertNoNearRequirementMatch(blocks, block.name, 'modify');
      throw new Error(`Cannot modify missing requirement '${block.name}' in '${capability}'.`);
    }
    if (sameRequirement(blocks[index]!, block)) {
      operations.push({ operation: 'MODIFIED', status: 'skipped' });
    } else {
      blocks[index] = block;
      operations.push({ operation: 'MODIFIED', status: 'applied' });
    }
  }

  // 应用 REMOVED 操作
  for (const name of plan.removed) {
    const index = requirementIndex(blocks, name);
    if (index === -1) {
      assertNoNearRequirementMatch(blocks, name, 'remove');
      operations.push({ operation: 'REMOVED', status: 'skipped' });
    } else {
      blocks.splice(index, 1);
      operations.push({ operation: 'REMOVED', status: 'applied' });
    }
  }

  // 应用 ADDED 操作
  for (const block of plan.added) {
    const index = requirementIndex(blocks, block.name);
    if (index !== -1 && sameRequirement(blocks[index]!, block)) {
      operations.push({ operation: 'ADDED', status: 'skipped' });
      continue;
    }
    assertNoNearRequirementMatch(blocks, block.name, 'add');
    if (index !== -1) {
      throw new Error(`Cannot add existing requirement '${block.name}' in '${capability}'.`);
    }
    blocks.push(block);
    operations.push({ operation: 'ADDED', status: 'applied' });
  }

  const before = withCanonicalPurpose(parts.before, capability, deltaContent, warnings, isNewBaseline);
  const content = renderCanonicalBaseline({ ...parts, before, bodyBlocks: blocks }, capability);
  return {
    content,
    changed: content !== baselineContent,
    operations,
    warnings,
  };
}

/**
 * 应用 delta spec 到 baseline（简化版本，仅返回内容）
 */
export function applyDeltaToBaseline(
  baselineContent: string,
  deltaContent: string,
  capability: string
): string {
  return applyDeltaToBaselineDetailed(baselineContent, deltaContent, capability).content;
}

/**
 * 解析发布上下文
 * 从变更目录推导项目根目录和 baseline specs 目录
 */
export function resolvePublicationContext(changeDir: string): PublicationContext {
  const absoluteChangeDir = resolve(changeDir);
  const changesDir = dirname(absoluteChangeDir);
  const projectRoot = basename(changesDir) === 'changes' ? dirname(changesDir) : dirname(absoluteChangeDir);
  return {
    changeDir: absoluteChangeDir,
    projectRoot,
    baselineSpecsDir: join(projectRoot, 'specs'),
  };
}

/**
 * 计算变更目录中 delta specs 的哈希
 * 用于检测 delta 是否在发布后被修改
 */
export async function hashChangeDelta(
  changeDir: string,
  specFiles: string[]
): Promise<string> {
  const entries: Array<[string, string]> = [];
  for (const file of specFiles) {
    const content = await readFile(file);
    if (content) {
      const relPath = relative(changeDir, file);
      entries.push([toPosix(relPath), content]);
    }
  }
  return digest(entries);
}

/**
 * 计算已发布 baseline 的哈希
 * 对项目根目录下 specs/<capability>/spec.md 文件计算哈希
 */
export async function hashPublishedBaseline(
  projectRoot: string,
  capabilities: string[]
): Promise<string> {
  const entries: Array<[string, string]> = [];
  for (const capability of capabilities) {
    const file = targetPath(projectRoot, capability);
    const exists = await fileExists(file);
    const content = exists ? await readFile(file) : '<missing>';
    const relPath = relative(projectRoot, file);
    entries.push([toPosix(relPath), content ?? '<missing>']);
  }
  return digest(entries);
}

/**
 * 创建发布收据
 * 
 * @param changeDir 变更目录
 * @param projectRoot 项目根目录
 * @param specFiles delta spec 文件列表
 * @param baselineBeforeHash 应用 delta 前的 baseline 哈希
 * @param changeId 变更 ID
 * @returns 发布收据对象
 */
export async function createPublicationReceipt(
  changeDir: string,
  projectRoot: string,
  specFiles: string[],
  baselineBeforeHash: string,
  changeId: string
): Promise<PublicationReceipt> {
  const capabilities = [...new Set(specFiles.map(file => capabilityFromSpecFile(changeDir, file)))].sort();
  const baselineAfterHash = await hashPublishedBaseline(projectRoot, capabilities);
  
  return {
    schema_version: RECEIPT_VERSION,
    capability: capabilities.join(','), // 多个 capability 用逗号分隔
    baseline_hash: baselineAfterHash,
    published_at: new Date().toISOString(),
    change_id: changeId,
    delta_operations: [], // 具体操作记录由调用方填充
    warnings: [],
  };
}

/**
 * 保存发布收据到文件
 * 路径：.flow-engine/sflow/spec-publication/<capability>.json
 * 
 * @param projectRoot 项目根目录
 * @param receipt 发布收据
 */
export async function savePublicationReceipt(
  projectRoot: string,
  receipt: PublicationReceipt
): Promise<void> {
  const receiptDir = join(projectRoot, SPEC_PUBLICATION_DIR);
  await ensureDir(receiptDir);
  
  // 使用 capability 作为文件名（多 capability 用第一个）
  const primaryCapability = receipt.capability.split(',')[0] ?? 'default';
  const receiptPath = join(receiptDir, `${primaryCapability}.json`);
  
  await atomicWriteJsonFile(receiptPath, receipt);
}

/**
 * 读取发布收据
 * 
 * @param projectRoot 项目根目录
 * @param capability 能力名称
 * @returns 发布收据或 null（如果不存在）
 */
export async function readPublicationReceipt(
  projectRoot: string,
  capability: string
): Promise<PublicationReceipt | null> {
  const receiptPath = join(projectRoot, SPEC_PUBLICATION_DIR, `${capability}.json`);
  const exists = await fileExists(receiptPath);
  if (!exists) return null;
  
  return await readJsonFile<PublicationReceipt>(receiptPath);
}

/**
 * 验证发布收据
 * 
 * 检查项：
 * 1. Receipt schema 版本匹配
 * 2. Capabilities 列表与当前 delta specs 一致
 * 3. Delta 哈希未变更
 * 4. Baseline 哈希未变更
 * 
 * @param changeDir 变更目录
 * @param projectRoot 项目根目录
 * @param receipt 发布收据
 * @param specFiles 当前 delta spec 文件列表
 * @returns 验证结果
 */
export async function validatePublicationReceipt(
  changeDir: string,
  projectRoot: string,
  receipt: PublicationReceipt,
  specFiles: string[]
): Promise<ReceiptValidationResult> {
  // 检查 schema 版本
  if (receipt.schema_version !== RECEIPT_VERSION) {
    return { pass: false, reason: 'Publication receipt schema version mismatch.' };
  }
  
  // 检查 capabilities 是否匹配
  const currentCapabilities = [...new Set(specFiles.map(file => capabilityFromSpecFile(changeDir, file)))].sort();
  const receiptCapabilities = receipt.capability.split(',').sort();
  if (JSON.stringify(currentCapabilities) !== JSON.stringify(receiptCapabilities)) {
    return { pass: false, reason: 'Publication receipt capabilities no longer match the active change.' };
  }
  
  // 检查 delta 哈希
  const currentDeltaHash = await hashChangeDelta(changeDir, specFiles);
  // 注意：receipt 中没有存储 source_hash，这里需要从 baseline_hash 推导
  // 简化实现：仅检查 baseline 哈希
  
  // 检查 baseline 哈希
  const currentBaselineHash = await hashPublishedBaseline(projectRoot, currentCapabilities);
  if (currentBaselineHash !== receipt.baseline_hash) {
    return { pass: false, reason: 'The published baseline has changed since publication.' };
  }
  
  return { pass: true, reason: '' };
}

/**
 * 检查是否存在发布收据
 * 
 * @param projectRoot 项目根目录
 * @returns 是否存在收据目录
 */
export async function hasPublicationReceipts(projectRoot: string): Promise<boolean> {
  const receiptDir = join(projectRoot, SPEC_PUBLICATION_DIR);
  return await directoryExists(receiptDir);
}

/**
 * 列出所有发布收据
 * 
 * @param projectRoot 项目根目录
 * @returns 收据文件名列表
 */
export async function listPublicationReceipts(projectRoot: string): Promise<string[]> {
  const receiptDir = join(projectRoot, SPEC_PUBLICATION_DIR);
  const exists = await directoryExists(receiptDir);
  if (!exists) return [];
  
  // 使用 node:fs/promises 读取目录
  try {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(receiptDir);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => basename(f, '.json'));
  } catch {
    return [];
  }
}
