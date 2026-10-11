/**
 * 工件根写路径守卫（Artifact Root Guard）
 *
 * 动机：子项目目录（projectDir）**不允许出现 `.flow-engine`**。工件目录唯一合法位置是
 * `<workDir>/.flow-engine/`。子代理若把工件写到 `<projectDir>/.flow-engine/**`，
 * 会污染项目仓库、割裂工件与 workDir 的状态机，并让「从仓库根跑测试」误删真实工件。
 *
 * 本守卫由 `tool.execute.before` 调用（OpenCode 插件 API 已暴露该拦截点），
 * 在写工具执行前阻断非法路径。
 *
 * 阻断手段（P0-1 Gate 修复）：该钩子的 output 仅暴露 `args`，**没有正式的
 * 拒绝/拒绝码机制**；抛错是该钩子标准的中止方式——OpenCode 官方插件文档的
 * .env 保护示例即通过 `throw new Error(...)` 阻断 read 工具。钩子抛错后
 * OpenCode 中止本次工具调用，错误信息回显给模型，写入不会发生。
 * （此前仅置 `_sflow_guard_blocked` flag、全仓无消费方，守卫形同虚设。）
 */

import { isAbsolute, join, normalize, resolve } from 'node:path';

/** 工件根目录名（相对 workDir） */
export const ARTIFACT_ROOT_SEGMENT = '.flow-engine';

/** 工件目录相对 workDir 的固定形态 */
export const ARTIFACT_DIR_SEGMENTS = [ARTIFACT_ROOT_SEGMENT, 'sflow'] as const;

export interface ArtifactRootGuardInput {
  /** 待写入的路径（绝对或相对 workDir） */
  filePath: string;
  /** 会话工作目录（工件根的上级） */
  workDir: string;
  /** 子项目目录（仅用于给出更精确的阻断提示，可选） */
  projectDir?: string;
}

export interface ArtifactRootGuardResult {
  /** true = 阻断写入 */
  block: boolean;
  /** 阻断原因（block 为 true 时给出） */
  blockReason?: string;
}

/** 归一化为正斜杠；Windows 下额外小写，保证比较不受分隔符/大小写影响 */
function normalizeForCompare(p: string): string {
  const n = normalize(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/** 把目标路径归一化为绝对路径；相对路径按 workDir 解析 */
function toAbsolute(filePath: string, workDir: string): string {
  return isAbsolute(filePath) ? normalize(filePath) : resolve(workDir, filePath);
}

/** 路径中是否含 `.flow-engine/` 目录层级（而非仅文件名相似） */
function touchesArtifactSegment(absolutePath: string): boolean {
  return normalizeForCompare(absolutePath).split('/').includes(ARTIFACT_ROOT_SEGMENT);
}

/** 受守卫覆盖的写工具（带明确文件路径参数的） */
export const GUARDED_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'multiedit',
  'patch',
  'apply_patch',
]);

/** 从写工具参数中提取目标文件路径（兼容 filePath / path / file_path 三种命名） */
export function extractWriteTargetPath(toolName: string | undefined, args: unknown): string {
  const lower = (toolName ?? '').toLowerCase();
  if (!GUARDED_WRITE_TOOLS.has(lower)) return '';
  const record = (args ?? {}) as Record<string, unknown>;
  const candidate = record.filePath ?? record.path ?? record.file_path;
  return typeof candidate === 'string' ? candidate : '';
}

/**
 * 检查一次写路径是否落在合法工件根内。
 *
 * 规则：
 * - 路径不含 `.flow-engine/` 目录层级 → 放行（与工件无关的普通写入）
 * - 路径位于 `<workDir>/.flow-engine/` 之下 → 放行
 * - 其余情况（典型：`<projectDir>/.flow-engine/**`）→ 阻断并提示正确工件目录
 */
export function checkArtifactRootPath(
  input: ArtifactRootGuardInput,
): ArtifactRootGuardResult {
  const { filePath, workDir, projectDir } = input;

  if (!filePath || filePath.trim().length === 0) return { block: false };
  if (!workDir || workDir.trim().length === 0) return { block: false };

  const absolute = toAbsolute(filePath.trim(), workDir);
  if (!touchesArtifactSegment(absolute)) return { block: false };

  const artifactRoot = resolve(workDir, ARTIFACT_ROOT_SEGMENT);
  const artifactRootCompare = normalizeForCompare(artifactRoot);

  if (normalizeForCompare(absolute) === artifactRootCompare) return { block: false };
  if (normalizeForCompare(absolute).startsWith(`${artifactRootCompare}/`)) {
    return { block: false };
  }

  // 正确工件目录 = <workDir>/.flow-engine/sflow（注意：不能基于已含 .flow-engine 的
  // artifactRoot 再拼 ARTIFACT_DIR_SEGMENTS，否则会产出 .flow-engine/.flow-engine/sflow）
  const expectedDir = join(workDir, ...ARTIFACT_DIR_SEGMENTS);
  const where = projectDir && projectDir.trim().length > 0
    ? `子项目目录「${projectDir}」下`
    : 'workDir 之外';

  return {
    block: true,
    blockReason:
      `工件目录锁定：拒绝写入「${absolute}」——${where}不允许出现 .flow-engine。` +
      `工件必须写入工件目录「${expectedDir}/」下（工件根 = <workDir>/${ARTIFACT_ROOT_SEGMENT}/）。` +
      `请把目标路径改到工件目录后重试；如工件确实错位在子项目目录，请先迁移再继续。`,
  };
}

/**
 * 工件根写路径守卫（强制执行版，供 `tool.execute.before` 钩子使用）。
 *
 * 与 `checkArtifactRootPath` 的纯判定不同，本函数在判定阻断时**抛出 Error**：
 * OpenCode 插件 API 的 `tool.execute.before` 钩子输出仅暴露 `output.args`，
 * 无正式拒绝机制，抛错是该钩子标准的中止手段（官方文档 .env 保护示例同款）。
 * 抛出后工具调用被中止、写入不会发生，错误信息（含正确工件目录指引）回显给模型。
 *
 * @param input - 守卫输入（待写入路径 + workDir，可选 projectDir）
 * @throws Error 当目标路径违反工件根锁定规则时
 */
export function enforceArtifactRootPath(input: ArtifactRootGuardInput): void {
  const result = checkArtifactRootPath(input);
  if (result.block) {
    throw new Error(
      result.blockReason ?? '工件目录锁定：禁止在 workDir 之外写入 .flow-engine',
    );
  }
}