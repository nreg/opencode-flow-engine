/**
 * Artifact Language Detection Module
 * 实现 5 级固定优先级检测 + DP-0 阶段检测一次 + 持久化到 state.json
 * 
 * T3.4: 语言检测核心逻辑
 */

import { readFile, fileExists } from '@opencode-flow-engine/shared';
import { readArtifactContent } from './state-manager/artifact-paths.js';

/**
 * 语言类型：中文或英文
 * 注意：绝不持久化 'auto'，auto 只是表示"继续解析"
 */
export type ArtifactLanguage = 'zh' | 'en';

/**
 * 中文检测阈值：中文字符比例超过此值则判定为中文
 */
const CHINESE_RATIO_THRESHOLD = 0.3;

/**
 * 统计文本中的中文字符数量
 * 中文字符范围：U+4E00 到 U+9FFF（CJK 统一汉字）
 */
export function countChineseChars(text: string): number {
  let count = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0x4E00 && code <= 0x9FFF) {
      count++;
    }
  }
  return count;
}

/**
 * 计算中文字符比例
 * 返回值范围：0.0 ~ 1.0
 */
export function calculateChineseRatio(text: string): number {
  if (text.length === 0) return 0;
  const chineseCount = countChineseChars(text);
  return chineseCount / text.length;
}

/**
 * 检测文本语言
 * 根据中文字符比例判断
 */
export function detectTextLanguage(text: string): ArtifactLanguage {
  const ratio = calculateChineseRatio(text);
  return ratio > CHINESE_RATIO_THRESHOLD ? 'zh' : 'en';
}

/**
 * 检测文件语言
 * 读取文件内容并检测语言
 * 如果文件不存在或为空，返回 null
 */
export async function detectFileLanguage(filePath: string): Promise<ArtifactLanguage | null> {
  const exists = await fileExists(filePath);
  if (!exists) {
    return null;
  }

  const content = await readFile(filePath);
  if (!content || content.trim().length === 0) {
    return null;
  }

  return detectTextLanguage(content);
}

/**
 * 5 级优先级解析上下文
 */
export interface LanguageResolutionContext {
  /** 项目根目录（changeDir） */
  projectRoot: string;
  /** 用户显式声明的语言（如果对话中明确指定） */
  userDeclaredLanguage?: ArtifactLanguage;
  /** execution.defaultLanguage 配置值（可能是 'auto'） */
  defaultLanguageConfig?: 'auto' | ArtifactLanguage;
}

/**
 * 5 级优先级解析（从高到低）：
 * 1. 用户显式声明（对话中明确指定语言）
 * 2. execution.defaultLanguage 配置（如果为非 auto 值）
 * 3. proposal.md 检测（中文字符比例）
 * 4. design.md 检测
 * 5. tasks.md 检测
 * 6. 默认 'en'
 * 
 * 注意：如果 defaultLanguageConfig 为 'auto'，视为"继续解析"而非语言
 */
export async function resolveArtifactLanguage(
  context: LanguageResolutionContext
): Promise<ArtifactLanguage> {
  const { projectRoot, userDeclaredLanguage, defaultLanguageConfig } = context;

  // Level 1: 用户显式声明（最高优先级）
  if (userDeclaredLanguage) {
    return userDeclaredLanguage;
  }

  // Level 2: execution.defaultLanguage 配置（如果为非 auto 值）
  if (defaultLanguageConfig && defaultLanguageConfig !== 'auto') {
    return defaultLanguageConfig;
  }

  // Level 3: proposal.md 检测（在项目根目录）
  const proposalContent = await readArtifactContent(projectRoot, 'proposal.md');
  if (proposalContent && proposalContent.trim().length > 0) {
    return detectTextLanguage(proposalContent);
  }

  // Level 4: design.md 检测（在项目根目录）
  const designContent = await readArtifactContent(projectRoot, 'design.md');
  if (designContent && designContent.trim().length > 0) {
    return detectTextLanguage(designContent);
  }

  // Level 5: tasks.md 检测（在项目根目录）
  const tasksContent = await readArtifactContent(projectRoot, 'tasks.md');
  if (tasksContent && tasksContent.trim().length > 0) {
    return detectTextLanguage(tasksContent);
  }

  // Level 6: 默认 'en'
  return 'en';
}

/**
 * 补检测逻辑：检查 state.json 中是否已有 artifact_language
 * 如果没有，则进行检测并返回语言值
 * 如果已有，返回 null（表示无需更新）
 */
export async function checkAndDetectLanguage(
  projectRoot: string,
  currentArtifactLanguage?: ArtifactLanguage
): Promise<ArtifactLanguage | null> {
  // 如果已有语言值，无需补检测
  if (currentArtifactLanguage) {
    return null;
  }

  // 否则进行检测
  return resolveArtifactLanguage({ projectRoot });
}
