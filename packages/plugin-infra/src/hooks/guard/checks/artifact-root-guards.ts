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

/**
 * 受守卫覆盖的写工具。
 *
 * P1-1 Gate 修复：对齐 OpenCode 1.19.0 二进制实证的工具注册表——仅
 * `write` / `edit` / `apply_patch` 三个真实存在的工具 ID。此前列举的
 * `multiedit` / `patch` 在该版本不存在（二进制无此工具 ID），属于虚假覆盖。
 */
export const GUARDED_WRITE_TOOLS: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'apply_patch',
]);

/**
 * apply_patch 的 patchText 文件行头（OpenCode 1.19.0 二进制实证）：
 * `*** Add File: <path>` / `*** Update File: <path>` / `*** Delete File: <path>`，
 * 以及仅出现在 Update File 行之后的移动目标行头 `*** Move to: <path>`
 * （执行期 `writeWithDirs(movePath) + remove(filePath)`，移动目标同样落盘）。
 * 大小写不敏感；行前后空白容忍（匹配前先 trim 行）。
 *
 * Gate-4 定向复核（P0）：`*** Move to:` 不出现在提取范围时，「合法 Update File +
 * 非法 Move to」patchText 被守卫放行——内容经移动目标写入
 * `<projectDir>/.flow-engine/**` 且原文件被删（二进制实证的执行期语义）。
 * 故四类行头全部纳入逐行匹配；二进制中 Move to 仅紧接 Update File 之后，
 * 此处按任意行匹配（超集）——多校验只会更严，不影响放行语义。
 */
const PATCH_FILE_HEADER = /^\*\*\*\s*(?:(?:Add|Update|Delete)\s+File|Move\s+to):\s*(.+)$/i;

/**
 * 从 apply_patch 的 patchText 中提取**全部**目标文件路径（多文件补丁）。
 *
 * 背景（P1-1 Gate 修复）：OpenCode 1.19.0 的 apply_patch 工具 schema 仅
 * `{ patchText }`（PatchSchema），**没有 filePath/path/file_path 参数**——
 * 文件路径只存在于 patchText 的 `*** Add/Update/Delete File:` 行头内。
 * provider 适配器在 write/edit 不可用时会回落合成 apply_patch，若不解析
 * patchText，经 apply_patch 写 `<projectDir>/.flow-engine/**` 将绕过守卫。
 *
 * Gate-4 修复：apply_patch 多文件是常态（Input 描述含 add/update/delete，
 * 逐 hunk 应用）。此前只返回**首个**行头路径——多文件 patchText 首个行头
 * 合法落 `<workDir>/.flow-engine`、后续行头指向 `<projectDir>/.flow-engine/**`
 * 时，守卫判定放行，非法写入得逞（审查探针实证）。故改为返回全部行头路径，
 * 由调用方逐一校验。
 *
 * Gate-4 定向复核（P0）：提取范围覆盖全部四类行头——Add/Update/Delete File
 * 与 Update File 行之后的 `*** Move to:` 移动目标（二进制实证：执行期
 * `writeWithDirs(movePath) + remove(filePath)`）。缺失 Move to 时，「合法
 * Update + 非法 Move to」patchText 放行，非法移动写入得逞。
 */
export function extractPatchTextPaths(patchText: unknown): string[] {
  if (typeof patchText !== 'string' || patchText.length === 0) return [];
  const paths: string[] = [];
  for (const rawLine of patchText.split('\n')) {
    const m = rawLine.trim().match(PATCH_FILE_HEADER);
    const p = m?.[1]?.trim();
    if (p && p.length > 0) paths.push(p);
  }
  return paths;
}

/**
 * 从写工具参数中提取**全部**目标文件路径。
 *
 * - write / edit：读 `filePath` / `path` / `file_path`（兼容三种命名），单元素数组
 * - apply_patch：读 `patchText`，逐行匹配 `*** (Add|Update|Delete) File:` 与
 *   `*** Move to:` 行头取全部命中（四类行头均为落盘目标）
 *
 * 相对路径在提供 `workDir` 时解析为绝对路径（守卫的归一化基准），
 * 保证后续判定不受调用方 cwd 影响；未提供时原样返回（由
 * `checkArtifactRootPath` 的 toAbsolute 二次解析兜底）。
 *
 * 无命中返回空数组（调用方据此跳过守卫）。
 */
export function extractWriteTargetPaths(
  toolName: string | undefined,
  args: unknown,
  workDir?: string,
): string[] {
  const lower = (toolName ?? '').toLowerCase();
  if (!GUARDED_WRITE_TOOLS.has(lower)) return [];
  const record = (args ?? {}) as Record<string, unknown>;

  if (lower === 'apply_patch') {
    return extractPatchTextPaths(record.patchText).map((patchPath) =>
      workDir && workDir.trim().length > 0 && !isAbsolute(patchPath)
        ? resolve(workDir, patchPath)
        : patchPath,
    );
  }

  const candidate = record.filePath ?? record.path ?? record.file_path;
  return typeof candidate === 'string' && candidate.length > 0 ? [candidate] : [];
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

/**
 * 对一组写路径**逐一**执行工件根守卫，任一非法即抛错中止（Gate-4 修复）。
 *
 * 动机：apply_patch 多文件 patchText 含多个行头路径，旧调用点只校验首个
 * 提取路径——后续非法行头（典型：`<projectDir>/.flow-engine/**`）绕过守卫。
 * 本函数把「全部路径逐一 enforceArtifactRootPath、任一非法即阻断」收敛为
 * 单一实现，供三工厂 `tool.execute.before` 钩子共用；阻断消息由
 * `checkArtifactRootPath` 生成，天然点名 offending path。
 *
 * 空列表为无操作（无行头/非写工具的返空语义）。
 *
 * @param filePaths - 待校验的写路径列表（绝对或相对 workDir）
 * @param workDir - 会话工作目录（工件根的上级）
 * @param projectDir - 子项目目录（仅用于给出更精确的阻断提示，可选）
 * @throws Error 当任一目标路径违反工件根锁定规则时
 */
export function enforceArtifactRootPaths(
  filePaths: readonly string[],
  workDir: string,
  projectDir?: string,
): void {
  for (const filePath of filePaths) {
    enforceArtifactRootPath({ filePath, workDir, projectDir });
  }
}