/**
 * Token Budget Limiter — 限制文件读取的行数以控制 token 消耗
 *
 * 核心功能：
 * - 三级文件分类：SPEC / REFERENCE / CODE
 * - SPEC（工件文件）豁免截断，全量返回
 * - REFERENCE（大 .md 参考文档）豁免截断，由调用方控制按节读取
 * - CODE（源码文件）超过行数限制时自动截断
 * - 截断大文件内容至指定行数
 * - 检查文件是否在 token 预算内
 *
 * 设计参考：
 * - helpers.ts 的 ARTIFACT_NAMES 和 isArtifactPath 提供工件文件识别
 * - file-utils.ts 提供文件读写基础设施
 */

/** 默认最大读取行数 */
export const DEFAULT_LINE_LIMIT = 150;

/** REFERENCE 分类的行数阈值 — 超过此行数的非 SPEC .md 文件归为 REFERENCE */
export const REFERENCE_LINE_THRESHOLD = 200;

/** 文件三级分类 */
export type FileTier = 'SPEC' | 'REFERENCE' | 'CODE';

/**
 * 工件文件豁免列表 — 匹配这些模式的文件不会被截断
 *
 * 包含：
 * - 工作流核心工件：proposal.md, design.md, tasks.md, execution-contract.md
 * - 状态文件：state.json
 * - 规格文件：specs/*.md
 * - .flow-engine/sflow/ 目录下的所有文件
 */
export const ARTIFACT_FILE_PATTERNS: RegExp[] = [
  // 工作流核心工件
  /(?:^|[\\/])proposal\.md$/i,
  /(?:^|[\\/])design\.md$/i,
  /(?:^|[\\/])tasks\.md$/i,
  /(?:^|[\\/])execution-contract\.md$/i,
  // 状态文件
  /(?:^|[\\/])state\.json$/i,
  // 规格文件目录
  /(?:^|[\\/])specs[\\/][^\\/]+\.md$/i,
  // .flow-engine/sflow/ 目录
  /[\\/]\.flow-engine[\\/]sflow[\\/]/i,
];

/**
 * 截断内容至指定行数
 *
 * @param content - 文件内容字符串
 * @param limit - 最大行数，默认 DEFAULT_LINE_LIMIT
 * @returns 截断结果，包含截断后的内容、是否截断、总行数、返回行数
 */
export function truncateContent(
  content: string,
  limit: number = DEFAULT_LINE_LIMIT,
): { content: string; truncated: boolean; totalLines: number; returnedLines: number } {
  if (!content) {
    return {
      content: '',
      truncated: false,
      totalLines: 0,
      returnedLines: 0,
    };
  }

  // 统一换行符：CRLF → LF
  const normalized = content.replace(/\r\n/g, '\n');
  // 移除尾部换行以避免产生空行
  const trimmed = normalized.replace(/\n$/, '');
  const lines = trimmed.split('\n');
  const totalLines = lines.length;

  if (totalLines <= limit) {
    return {
      content,
      truncated: false,
      totalLines,
      returnedLines: totalLines,
    };
  }

  const truncatedLines = lines.slice(0, limit);
  return {
    content: truncatedLines.join('\n'),
    truncated: true,
    totalLines,
    returnedLines: limit,
  };
}

/**
 * 检查文件路径是否为工件文件（豁免不截断）
 *
 * 工件文件包括工作流核心工件（proposal.md, design.md 等）、
 * 状态文件（state.json）、规格文件（specs/*.md）以及
 * .flow-engine/sflow/ 目录下的所有文件。
 *
 * @param filePath - 文件路径（支持 / 和 \ 分隔符）
 * @returns 是否为工件文件
 */
export function isArtifactFile(filePath: string): boolean {
  if (!filePath) return false;
  // 统一分隔符为 /
  const normalized = filePath.replace(/\\/g, '/');
  return ARTIFACT_FILE_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * 对文件进行三级分类：
 * - SPEC: 工作流工件（proposal.md, design.md, tasks.md, contract.md, specs/*.md, state.json, .flow-engine/sflow/）
 * - REFERENCE: > REFERENCE_LINE_THRESHOLD 行的非 SPEC .md 文件（大参考文档）
 * - CODE: 源码文件（.ts/.js/.py 等）及不足阈值的 .md 文件
 *
 * @param filePath - 文件路径
 * @param totalLines - 文件总行数（可选，用于 REFERENCE 判断）
 * @returns 分类结果 FileTier
 */
export function classifyFile(filePath: string, totalLines?: number): FileTier {
  if (!filePath) return 'CODE';

  // 1. 工件文件 → SPEC
  if (isArtifactFile(filePath)) return 'SPEC';

  // 2. 大 .md 文件 → REFERENCE
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.endsWith('.md') && totalLines !== undefined && totalLines > REFERENCE_LINE_THRESHOLD) {
    return 'REFERENCE';
  }

  // 3. 其余 → CODE
  return 'CODE';
}

/**
 * 检查文件是否在 token 预算内
 *
 * 三级分类策略：
 * - SPEC → 始终允许（工作流工件豁免）
 * - REFERENCE → 始终允许（由调用方控制按节读取）
 * - CODE → 行数 <= DEFAULT_LINE_LIMIT 时允许
 *
 * @param filePath - 文件路径
 * @param totalLines - 文件总行数
 * @returns 检查结果，allowed 表示是否允许，reason 提供拒绝原因
 */
export function isWithinLimit(
  filePath: string,
  totalLines: number,
): { allowed: boolean; reason?: string } {
  const tier = classifyFile(filePath, totalLines);

  if (tier === 'SPEC') {
    return { allowed: true };
  }

  if (tier === 'REFERENCE') {
    return { allowed: true }; // REFERENCE read by section, not whole file
  }

  // CODE files
  if (totalLines <= DEFAULT_LINE_LIMIT) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `[Token Budget] File "${filePath}" (CODE tier) has ${totalLines} lines, exceeding the limit of ${DEFAULT_LINE_LIMIT}. Read in chunks of ≤${DEFAULT_LINE_LIMIT} lines.`,
  };
}

/**
 * 对 read 工具返回的内容应用 token budget 截断策略
 *
 * 三级分类策略：
 * - SPEC → 不截断（全量返回）
 * - REFERENCE → 不截断（由调用方控制按节读取）
 * - CODE → 超过行数限制时自动截断并追加截断通知
 *
 * @param filePath - 文件路径（用于判断文件分类）
 * @param content - read 工具返回的内容字符串（可能带行号格式）
 * @param limit - 最大行数，默认 DEFAULT_LINE_LIMIT
 * @returns 截断后的内容字符串（含截断通知），或原始内容（未截断时）
 */
export function applyTokenBudgetToContent(
  filePath: string,
  content: string,
  limit: number = DEFAULT_LINE_LIMIT,
): string {
  // 空内容直接返回
  if (!content) {
    return content;
  }

  // 从内容计算行数，用于 REFERENCE 分类判断
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n$/, '');
  const totalLines = normalized.split('\n').length;
  const tier = classifyFile(filePath, totalLines);

  // SPEC 和 REFERENCE 不截断
  if (tier === 'SPEC' || tier === 'REFERENCE') {
    return content;
  }

  const result = truncateContent(content, limit);
  if (!result.truncated) {
    return content;
  }

  // 追加截断通知
  return `${result.content}\n\n[Token Budget] Content truncated: ${result.totalLines} lines total, showing first ${result.returnedLines} lines.`;
}
