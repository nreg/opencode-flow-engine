/**
 * 工件错位探测（Misplaced Artifact Probe）
 *
 * 动机：工件目录唯一合法位置是 `<workDir>/.flow-engine/sflow/`。子代理若把工件写进
 * 子项目目录（`<workDir>/<project>/.flow-engine/sflow/`），工具侧只会看到
 * 「File not found」，排查成本极高。本模块在 not-found 分支做**一层**常见错位探测
 * （`<workDir>` 下每个一级子目录各自的 `.flow-engine/sflow/<artifact>`），
 * 命中即回显真实所在目录与迁移指引。
 *
 * 只探一层：深层嵌套的子项目树不属于常见错位形态，避免大目录下的无谓 IO。
 */
import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileExists } from '@opencode-flow-engine/shared';

/** 工件根相对 workDir 的固定形态 */
const ARTIFACT_ROOT_SEGMENTS = ['.flow-engine', 'sflow'] as const;

export interface MisplacedArtifactHit {
  /** 命中的子项目目录（`<workDir>/<project>`） */
  projectDir: string;
  /** 命中的工件绝对路径 */
  artifactPath: string;
}

/** 合法的工件目录：`<workDir>/.flow-engine/sflow` */
export function expectedArtifactDir(workDir: string): string {
  return join(resolve(workDir), ...ARTIFACT_ROOT_SEGMENTS);
}

/**
 * 探测一层常见错位：`<workDir>` 下每个一级子目录各自的
 * `.flow-engine/sflow/<artifactFile>`
 *
 * @param workDir - 会话工作目录（工件根的上级）
 * @param artifactFile - 工件文件名，如 `execution-contract.md`
 * @returns 命中则返回所在子项目目录，未命中返回 null
 */
export async function probeMisplacedArtifact(
  workDir: string,
  artifactFile: string,
): Promise<MisplacedArtifactHit | null> {
  if (!workDir || workDir.trim().length === 0) return null;
  if (!artifactFile || artifactFile.trim().length === 0) return null;

  const root = resolve(workDir);

  // 工件根本身命中即视为合法（调用方已确认 not found，这里只做防御）
  const ownPath = join(root, ...ARTIFACT_ROOT_SEGMENTS, artifactFile);
  if (await fileExists(ownPath)) return null;

  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of candidates) {
    const projectDir = join(root, entry.name);
    const artifactPath = join(projectDir, ...ARTIFACT_ROOT_SEGMENTS, artifactFile);
    if (await fileExists(artifactPath)) {
      return { projectDir, artifactPath };
    }
  }

  return null;
}

/**
 * 生成 not-found 提示语。
 *
 * 命中错位：`工件位于 <项目目录>，必须在工件目录 <workDir>/.flow-engine/sflow/ 下，请迁移或重新生成`
 * 未命中：原建议 + 工件目录说明
 *
 * @param baseMessage - 原始建议文案（命中时会被替换）
 * @param workDir - 会话工作目录
 * @param hit - 错位探测结果
 * @param artifactFile - 工件文件名（用于未命中时点明归属）
 */
export function describeMissingArtifact(
  baseMessage: string,
  workDir: string,
  hit: MisplacedArtifactHit | null,
  artifactFile: string,
): string {
  const artifactDir = expectedArtifactDir(workDir);

  if (hit) {
    return (
      `${artifactFile} 未在工件目录下找到，但探测到工件位于「${hit.projectDir}」，` +
      `必须在工件目录「${artifactDir}」下，请迁移或重新生成。`
    );
  }

  return `${baseMessage}（${artifactFile} 应位于工件目录「${artifactDir}」下）`;
}