/**
 * Parsing functions for spec-superflow core engine
 * Ported from spec-superflow/src/parsing/requirement-blocks.ts
 * Ported from spec-superflow/src/parsing/change-parser.ts
 */

import type { RequirementBlock, RequirementsSectionParts, DeltaPlan, ParsedDelta, ParsedChange } from './types.js';

/**
 * Markdown 行结构，包含文本、行号和是否在 fenced code block 内的标记
 */
export interface MarkdownLine {
  text: string;
  lineNumber: number;
  fenced: boolean;
}

/**
 * Fenced code block 的围栏信息
 */
interface Fence {
  marker: '`' | '~';
  length: number;
}

/**
 * 检测行是否为 opening fence（``` 或 ~~~）
 */
function openingFence(line: string): Fence | undefined {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return undefined;
  return {
    marker: match[1]![0] as Fence['marker'],
    length: match[1]!.length,
  };
}

/**
 * 检测行是否关闭当前 fence
 */
function closesFence(line: string, fence: Fence): boolean {
  const match = line.match(/^ {0,3}(`+|~+)\s*$/);
  return Boolean(
    match && match[1]![0] === fence.marker && match[1]!.length >= fence.length
  );
}

/**
 * 扫描 markdown 内容，标记每行是否在 fenced code block 内
 * 用于忽略代码示例中的假标题、假场景等
 *
 * @param content Markdown 内容
 * @returns 带有 fenced 标记的行数组
 */
export function scanMarkdownLines(content: string): MarkdownLine[] {
  const normalized = content.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  let activeFence: Fence | undefined;

  return lines.map((text, index) => {
    // 如果当前在 fenced block 内
    if (activeFence) {
      // 检查是否为 closing fence
      if (closesFence(text, activeFence)) {
        activeFence = undefined;
        return { text, lineNumber: index + 1, fenced: false };
      }
      // 仍在 fenced block 内
      return { text, lineNumber: index + 1, fenced: true };
    }

    // 不在 fenced block 内，检查是否为 opening fence
    const fence = openingFence(text);
    if (fence) activeFence = fence;
    return { text, lineNumber: index + 1, fenced: false };
  });
}

/**
 * Regex for requirement headers
 * 支持以下格式：
 * - ### Requirement: <name> (英文标准格式)
 * - ### 需求：<name> (中文冒号格式)
 * - ### REQ-<ID> <name> (REQ-ID 格式，无冒号)
 * - ### REQ-<ID>: <name> (REQ-ID 格式，带冒号)
 *
 * 捕获组说明：
 * - match[1]: Requirement/需求 格式的 name
 * - match[2]: REQ-ID 格式的完整内容（需要进一步解析）
 */
export const REQUIREMENT_HEADER_REGEX = /^###\s*(?:(?:Requirement|需求)\s*[:：]\s*(.+)|(REQ-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\s*:?\s*.+))\s*$/i;

/**
 * 从正则匹配结果中提取 requirement name
 * 处理两种格式的差异：
 * - Requirement/需求 格式：直接使用 match[1]
 * - REQ-ID 格式：从 match[2] 中去除 ID 前缀
 */
export function requirementNameFromMatch(match: RegExpMatchArray): string {
  // match[1] 存在说明是 Requirement: 或 需求： 格式
  if (match[1]) {
    return normalizeRequirementName(match[1]);
  }

  // match[2] 存在说明是 REQ-ID 格式
  if (match[2]) {
    // REQ-ID 格式：REQ-XXX-NNN name 或 REQ-XXX-NNN: name
    // 需要去除 REQ-ID 前缀
    const content = match[2];
    // 匹配 REQ-ID 部分（可能包含多个连字符）
    const idMatch = content.match(/^REQ-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\s*:?\s*/);
    if (idMatch) {
      const name = content.slice(idMatch[0].length);
      return normalizeRequirementName(name);
    }
    // 如果无法解析，返回原始内容
    return normalizeRequirementName(content);
  }

  // 理论上不会到达这里，但为了类型安全
  return '';
}

/**
 * Normalize a requirement name (trim)
 * Aligned with spec-superflow: only trim, do NOT lowercase
 * (lowercasing loses case information needed for cross-referencing)
 */
export function normalizeRequirementName(name: string): string {
  return name.trim();
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n?/g, '\n');
}

/**
 * Extract the requirements section from a spec file
 * Aligned with spec-superflow: returns structured parts
 * 使用 scanMarkdownLines 过滤 fenced code block 内的内容
 */
export function extractRequirementsSection(content: string): RequirementsSectionParts {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split('\n');
  const structure = scanMarkdownLines(normalized);

  // 查找 ## Requirements 标题，忽略 fenced block 内的假标题
  const reqHeaderIndex = structure.findIndex(
    ({ text, fenced }) => !fenced && /^##\s+Requirements\s*$/i.test(text)
  );

  if (reqHeaderIndex === -1) {
    const before = content.trimEnd();
    const headerLine = '## Requirements';
    return {
      before: before ? before + '\n\n' : '',
      headerLine,
      preamble: '',
      bodyBlocks: [],
      after: '\n',
    };
  }

  // 查找下一个 ## 标题作为结束位置，忽略 fenced block 内的假标题
  let endIndex = lines.length;
  for (let i = reqHeaderIndex + 1; i < lines.length; i++) {
    if (!structure[i]!.fenced && /^##\s+/.test(lines[i]!)) {
      endIndex = i;
      break;
    }
  }

  const before = lines.slice(0, reqHeaderIndex).join('\n');
  const headerLine = lines[reqHeaderIndex];
  const sectionBodyLines = lines.slice(reqHeaderIndex + 1, endIndex);

  const blocks: RequirementBlock[] = [];
  let cursor = 0;
  const preambleLines: string[] = [];

  // 收集 preamble（在第一个 requirement header 之前的内容）
  // 忽略 fenced block 内的假 requirement header
  while (
    cursor < sectionBodyLines.length &&
    (structure[reqHeaderIndex + 1 + cursor]!.fenced ||
      !REQUIREMENT_HEADER_REGEX.test(sectionBodyLines[cursor]!))
  ) {
    preambleLines.push(sectionBodyLines[cursor]!);
    cursor++;
  }

  // 解析 requirement blocks
  while (cursor < sectionBodyLines.length) {
    const headerLineCandidate = sectionBodyLines[cursor]!;
    // 检查是否为 requirement header，忽略 fenced block 内的假标题
    const headerMatch = structure[reqHeaderIndex + 1 + cursor]!.fenced
      ? undefined
      : headerLineCandidate.match(REQUIREMENT_HEADER_REGEX);

    if (!headerMatch) {
      cursor++;
      continue;
    }

    const name = requirementNameFromMatch(headerMatch);
    cursor++;
    const bodyLines: string[] = [headerLineCandidate];

    // 收集 requirement body，直到下一个 requirement header 或 ## 标题
    // 忽略 fenced block 内的假标题
    while (
      cursor < sectionBodyLines.length &&
      (structure[reqHeaderIndex + 1 + cursor]!.fenced ||
        (!REQUIREMENT_HEADER_REGEX.test(sectionBodyLines[cursor]!) &&
          !/^##\s+/.test(sectionBodyLines[cursor]!)))
    ) {
      bodyLines.push(sectionBodyLines[cursor]!);
      cursor++;
    }

    const raw = bodyLines.join('\n').trimEnd();
    blocks.push({ headerLine: headerLineCandidate!, name, raw });
  }

  const after = lines.slice(endIndex).join('\n');
  const preamble = preambleLines.join('\n').trimEnd();

  return {
    before: before!.trimEnd() ? before + '\n' : before,
    headerLine: headerLine!,
    preamble,
    bodyBlocks: blocks,
    after: after.startsWith('\n') ? after : '\n' + after,
  };
}

/**
 * Parse requirement blocks from a section body
 */
function parseRequirementBlocksFromSection(sectionBody: string): RequirementBlock[] {
  if (!sectionBody) return [];
  const lines = normalizeLineEndings(sectionBody).split('\n');
  const blocks: RequirementBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && !REQUIREMENT_HEADER_REGEX.test(lines[i]!)) i++;
    if (i >= lines.length) break;
    const headerLine = lines[i]!;
    const m = headerLine.match(REQUIREMENT_HEADER_REGEX);
    if (!m) {
      i++;
      continue;
    }
    const name = normalizeRequirementName(m[1]!);
    const buf: string[] = [headerLine];
    i++;
    while (
      i < lines.length &&
      !REQUIREMENT_HEADER_REGEX.test(lines[i]!) &&
      !/^##\s+/.test(lines[i]!)
    ) {
      buf.push(lines[i]!);
      i++;
    }
    blocks.push({ headerLine, name, raw: buf.join('\n').trimEnd() });
  }
  return blocks;
}

/**
 * Parse removed requirement names from a section body
 */
function parseRemovedNames(sectionBody: string): string[] {
  if (!sectionBody) return [];
  const names: string[] = [];
  const lines = normalizeLineEndings(sectionBody).split('\n');
  for (const line of lines) {
    const m = line.match(REQUIREMENT_HEADER_REGEX);
    if (m) {
      names.push(normalizeRequirementName(m[1]!));
      continue;
    }
    const bullet = line.match(/^\s*-\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
    if (bullet) {
      names.push(normalizeRequirementName(bullet[1]!));
    }
  }
  return names;
}

/**
 * Parse renamed pairs from a section body
 */
function parseRenamedPairs(sectionBody: string): Array<{ from: string; to: string }> {
  if (!sectionBody) return [];
  const pairs: Array<{ from: string; to: string }> = [];
  const lines = normalizeLineEndings(sectionBody).split('\n');
  let current: { from?: string; to?: string } = {};
  for (const line of lines) {
    const fromMatch = line.match(/^\s*-?\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
    const toMatch = line.match(/^\s*-?\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/);
    if (fromMatch) {
      current.from = normalizeRequirementName(fromMatch[1]!);
    } else if (toMatch) {
      current.to = normalizeRequirementName(toMatch[1]!);
      if (current.from && current.to) {
        pairs.push({ from: current.from, to: current.to });
        current = {};
      }
    }
  }
  return pairs;
}

/**
 * Split top-level ## sections from content
 */
function splitTopLevelSections(content: string): Record<string, string> {
  const lines = content.split('\n');
  const result: Record<string, string> = {};
  const indices: Array<{ title: string; index: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^##\s+(.+)$/);
    if (m) {
      indices.push({ title: m[1]!.trim(), index: i });
    }
  }
  for (let i = 0; i < indices.length; i++) {
    const current = indices[i]!;
    const next = indices[i + 1];
    const body = lines
      .slice(current.index + 1, next ? next.index : lines.length)
      .join('\n');
    result[current.title] = body;
  }
  return result;
}

/**
 * Get a section by name (case-insensitive)
 */
function getSectionCaseInsensitive(
  sections: Record<string, string>,
  desired: string,
): { body: string; found: boolean } {
  const target = desired.toLowerCase();
  for (const [title, body] of Object.entries(sections)) {
    if (title.toLowerCase() === target) return { body, found: true };
  }
  return { body: '', found: false };
}

/**
 * Parse a delta spec markdown into a DeltaPlan
 * Aligned with spec-superflow: uses section-based parsing
 */
export function parseDeltaSpec(content: string): DeltaPlan {
  const normalized = normalizeLineEndings(content);
  const sections = splitTopLevelSections(normalized);
  const addedLookup = getSectionCaseInsensitive(sections, 'ADDED Requirements');
  const modifiedLookup = getSectionCaseInsensitive(sections, 'MODIFIED Requirements');
  const removedLookup = getSectionCaseInsensitive(sections, 'REMOVED Requirements');
  const renamedLookup = getSectionCaseInsensitive(sections, 'RENAMED Requirements');
  const added = parseRequirementBlocksFromSection(addedLookup.body);
  const modified = parseRequirementBlocksFromSection(modifiedLookup.body);
  const removedNames = parseRemovedNames(removedLookup.body);
  const renamedPairs = parseRenamedPairs(renamedLookup.body);
  return {
    added,
    modified,
    removed: removedNames,
    renamed: renamedPairs,
    sectionPresence: {
      added: addedLookup.found,
      modified: modifiedLookup.found,
      removed: removedLookup.found,
      renamed: renamedLookup.found,
    },
  };
}

/**
 * Extract a section by heading from markdown content
 */
function extractSection(content: string, heading: string): string {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split('\n');
  const headingRegex = new RegExp(
    `^##\\s+${heading.replace(/\s+/g, '\\s+')}\\s*$`,
    'i',
  );
  const idx = lines.findIndex((l) => headingRegex.test(l));
  if (idx === -1) return '';

  let endIdx = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (i < lines.length && /^##\s+/.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }

  return lines.slice(idx + 1, endIdx).join('\n').trim();
}

/**
 * Parse a change markdown file
 * Aligned with spec-superflow/src/parsing/change-parser.ts
 */
export function parseChangeMarkdown(content: string, changeName: string): ParsedChange {
  const why = extractSection(content, 'Why');
  const whatChanges = extractSection(content, 'What Changes');

  const deltas: ParsedDelta[] = [];

  const deltaSectionRegex =
    /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/im;

  const sections = content.split(/(?=^##\s)/m);
  for (const section of sections) {
    const match = section.match(deltaSectionRegex);
    if (match) {
      const operation = match[1]!.toUpperCase();
      const body = section.substring(match[0].length).trim();
      const descLines: string[] = [];
      for (const line of body.split('\n')) {
        if (/^###\s+/.test(line)) break;
        const trimmed = line.trim();
        if (trimmed) descLines.push(trimmed);
      }
      deltas.push({
        spec: '',
        operation,
        description: descLines.join('\n'),
      });
    }
  }

  return {
    name: changeName,
    why,
    whatChanges,
    deltas,
  };
}
