/**
 * Abstraction Grep Tracker — 抽象层 grep 追踪模块
 *
 * 在执行阶段检测新建的抽象文件（utils, helpers, services 等），
 * 并将对应的 grep 自查结果记录到 progress.md 的 6 维自查段。
 *
 * 6 维自查维度：
 * 1. HTTP 客户端 — 是否重复封装 HTTP 请求
 * 2. 日期格式化 — 是否重复实现日期处理
 * 3. 状态管理 — 是否重复引入状态管理方案
 * 4. Repository — 是否重复定义数据访问层
 * 5. 错误处理 — 是否重复封装错误处理逻辑
 * 6. 自定义 Hooks — 是否重复编写自定义 hooks
 */

import { ensureDir, readFile, writeFile } from '@opencode-flow-engine/shared';

// ─── ABSTRACTION_PATTERNS ──────────────────────────────────────────────────

/**
 * 多语言源代码扩展名（非捕获组）。
 * 支持 TypeScript / JavaScript / Python / Java / Kotlin / Go / Ruby / PHP / Rust / C# / Swift。
 */
const EXTENSIONS = '(?:ts|js|mjs|cjs|jsx|tsx|py|java|kt|go|rb|php|rs|cs|swift)';

/**
 * 抽象层路径目录列表。
 * 每个目录代表一种常见的抽象层组织方式。
 */
const ABSTRACTION_DIRS = [
  'utils',
  'helpers',
  'services',
  'lib',
  'hooks',
  'repositories',
  'adapters',
  'shared',
  'utilities',
  'common',
  'core',
  'util',
] as const;

/**
 * 匹配抽象类/函数文件路径的正则模式列表。
 * 当文件路径匹配以下任一模式时，视为"抽象层文件"，
 * 需要执行 grep 自查以避免重复抽象。
 *
 * 支持多语言扩展名和多种路径模式：
 * - 标准目录: utils/, helpers/, services/, lib/, hooks/, repositories/, adapters/, shared/
 * - 扩展目录: utilities/, common/, core/, util/
 * - 特定前缀: src/lib/, app/helpers/, src/util/
 */
export const ABSTRACTION_PATTERNS: RegExp[] = [
  // 标准目录模式：{dir}/{file}.{ext}
  ...ABSTRACTION_DIRS.map(
    dir => new RegExp(`(?:^|/)${dir}/[^/]+\\.${EXTENSIONS}$`),
  ),
  // 特定前缀模式：src/lib/{file}.{ext}
  new RegExp(`(?:^|/)src/lib/[^/]+\\.${EXTENSIONS}$`),
  // 特定前缀模式：app/helpers/{file}.{ext}
  new RegExp(`(?:^|/)app/helpers/[^/]+\\.${EXTENSIONS}$`),
  // 特定前缀模式：src/util/{file}.{ext}
  new RegExp(`(?:^|/)src/util/[^/]+\\.${EXTENSIONS}$`),
];

// ─── ABSTRACTION_CATEGORIES ────────────────────────────────────────────────

/**
 * 抽象类别定义。
 * 每个类别包含：
 * - label: 中文标签，用于 progress.md 展示
 * - grepCommand: grep 命令模板，{filePath} 为文件路径占位符
 * - keywords: 文件名/路径中的关键词，用于自动检测类别
 */
export interface AbstractionCategoryDef {
  label: string;
  grepCommand: string;
  keywords: string[];
}

/**
 * 6 种抽象类别的 grep 命令模板。
 * 当 detectNewAbstraction 检测到新建抽象文件时，
 * 使用对应的 grepCommand 模板在项目中搜索是否已存在类似实现。
 */
export const ABSTRACTION_CATEGORIES: Record<string, AbstractionCategoryDef> = {
  'http-client': {
    label: 'HTTP 客户端',
    grepCommand: 'grep -rn "fetch\\|axios\\|httpClient\\|apiClient" {filePath}',
    keywords: ['http', 'api', 'client', 'request', 'fetch', 'axios'],
  },
  'date-format': {
    label: '日期格式化',
    grepCommand: 'grep -rn "formatDate\\|parseDate\\|dayjs\\|moment\\|date-fns" {filePath}',
    keywords: ['date', 'time', 'format', 'parse', 'dayjs', 'moment'],
  },
  'state-management': {
    label: '状态管理',
    grepCommand: 'grep -rn "createStore\\|useState\\|useReducer\\|zustand\\|redux\\|pinia" {filePath}',
    keywords: ['store', 'state', 'zustand', 'redux', 'pinia', 'context'],
  },
  'repository': {
    label: 'Repository',
    grepCommand: 'grep -rn "Repository\\|Repo\\|findAll\\|findById\\|save\\|delete" {filePath}',
    keywords: ['repo', 'repository', 'dao', 'gateway', 'datasource'],
  },
  'error-handling': {
    label: '错误处理',
    grepCommand: 'grep -rn "ErrorHandler\\|catch\\|tryCatch\\|AppError\\|CustomError" {filePath}',
    keywords: ['error', 'exception', 'handler', 'catch', 'throw'],
  },
  'custom-hooks': {
    label: '自定义 Hooks',
    grepCommand: 'grep -rn "use[A-Z]\\|useCallback\\|useMemo\\|useEffect" {filePath}',
    keywords: ['use', 'hook', 'useAuth', 'useFetch', 'useQuery'],
  },
};

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * 检测到的抽象类别结果。
 */
export interface AbstractionCategory {
  /** 类别 ID（如 'http-client'） */
  category: string;
  /** 类别中文标签 */
  label: string;
}

// ─── detectNewAbstraction ──────────────────────────────────────────────────

/**
 * 检测写入的文件路径是否属于新建抽象。
 *
 * 1. 首先检查文件路径是否匹配 ABSTRACTION_PATTERNS
 * 2. 如果匹配，根据文件名/路径关键词推断具体类别
 * 3. 返回对应的 AbstractionCategory，或 null（非抽象文件）
 *
 * @param filePath - 文件路径（相对或绝对路径均可）
 * @returns 匹配的抽象类别，或 null
 */
export function detectNewAbstraction(filePath: string): AbstractionCategory | null {
  if (!filePath) return null;

  // Step 1: 检查是否匹配抽象文件路径模式
  const isAbstraction = ABSTRACTION_PATTERNS.some(p => p.test(filePath));
  if (!isAbstraction) return null;

  // Step 2: 根据路径目录推断（优先级最高，路径目录是更明确的信号）
  // 路径目录 → 类别映射
  const dirCategoryMap: [RegExp, string][] = [
    [/(?:^|\/)hooks\//, 'custom-hooks'],
    [/(?:^|\/)repositories\//, 'repository'],
    [/(?:^|\/)services\//, 'state-management'],
  ];

  for (const [pattern, catId] of dirCategoryMap) {
    if (pattern.test(filePath)) {
      return {
        category: catId,
        label: ABSTRACTION_CATEGORIES[catId]?.label ?? catId,
      };
    }
  }

  // Step 3: 根据文件名/路径关键词推断具体类别
  const lowerPath = filePath.toLowerCase();

  // 按优先级匹配：先匹配关键词最多的类别
  let bestCategory: string | null = null;
  let bestScore = 0;

  for (const [catId, catDef] of Object.entries(ABSTRACTION_CATEGORIES)) {
    let score = 0;
    for (const keyword of catDef.keywords) {
      if (lowerPath.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = catId;
    }
  }

  // Step 4: 如果没有关键词匹配，默认归类
  if (!bestCategory || bestScore === 0) {
    bestCategory = 'error-handling';
  }

  return {
    category: bestCategory,
    label: ABSTRACTION_CATEGORIES[bestCategory]?.label ?? bestCategory,
  };
}

// ─── progress.md 6 维自查段操作 ───────────────────────────────────────────

const PROGRESS_FILE = '.flow-engine/sflow/progress.md';
const SUMMARY_FILE = '.flow-engine/sflow/SUMMARY.md';
const GREP_SECTION_HEADER = '## 6 维自查（抽象层 grep 结果）';
const SUMMARY_GREP_SECTION_HEADER = '## 抽象层 grep 结果';

/**
 * 将 grep 结果记录到 progress.md 的 6 维自查段。
 *
 * 如果 progress.md 不存在，创建新文件并追加 6 维自查段。
 * 如果 progress.md 存在但没有 6 维自查段，追加该段。
 * 如果已有 6 维自查段，更新或新增对应类别的记录。
 *
 * 同时将结果写入 SUMMARY.md 的「抽象层 grep 结果」段。
 *
 * @param changeDir - 项目/变更目录
 * @param category - 抽象类别 ID（如 'http-client'）
 * @param result - grep 命令执行结果
 */
export async function recordGrepResult(
  changeDir: string,
  category: string,
  result: string,
): Promise<void> {
  const progressPath = changeDir + '/' + PROGRESS_FILE;
  const summaryPath = changeDir + '/' + SUMMARY_FILE;
  const catDef = ABSTRACTION_CATEGORIES[category];
  const label = catDef?.label ?? category;

  // 构建新的类别记录行
  const categoryLine = '- **' + label + '** (' + category + '): ' + result;

  // 确保目录存在
  await ensureDir(changeDir + '/.flow-engine/sflow');

  // ─── 写入 progress.md ─────────────────────────────────────────────────
  const existingProgress = await readFile(progressPath);
  let progressContent = existingProgress ?? '';

  progressContent = appendOrUpdateSection(
    progressContent,
    GREP_SECTION_HEADER,
    categoryLine,
    label,
    category,
  );

  await writeFile(progressPath, progressContent);

  // ─── 写入 SUMMARY.md ──────────────────────────────────────────────────
  const existingSummary = await readFile(summaryPath);
  let summaryContent = existingSummary ?? '';

  summaryContent = appendOrUpdateSection(
    summaryContent,
    SUMMARY_GREP_SECTION_HEADER,
    categoryLine,
    label,
    category,
  );

  await writeFile(summaryPath, summaryContent);
}

/**
 * 检查 progress.md 中是否存在对应类别的 grep 记录。
 *
 * @param changeDir - 项目/变更目录
 * @param category - 抽象类别 ID
 * @returns 是否存在记录
 */
export async function hasGrepRecord(
  changeDir: string,
  category: string,
): Promise<boolean> {
  const progressPath = changeDir + '/' + PROGRESS_FILE;
  const content = await readFile(progressPath);
  if (!content) return false;

  // 检查是否有 6 维自查段
  if (!content.includes(GREP_SECTION_HEADER)) return false;

  const catDef = ABSTRACTION_CATEGORIES[category];
  const label = catDef?.label ?? category;

  // 检查是否有该类别的记录
  const categoryPattern = new RegExp(
    '- \\*\\*' + escapeRegex(label) + '\\*\\* \\(' + escapeRegex(category) + '\\):',
  );

  return categoryPattern.test(content);
}

// ─── 内部辅助函数 ──────────────────────────────────────────────────────────

/**
 * 向 markdown 内容中追加或更新指定段落的类别记录行。
 *
 * 如果内容中已有该段落（sectionHeader），更新或新增类别记录。
 * 如果没有该段落，追加到文件末尾。
 *
 * @param content - 已有的 markdown 内容
 * @param sectionHeader - 段落标题（如 '## 6 维自查（抽象层 grep 结果）'）
 * @param categoryLine - 类别记录行（如 '- **HTTP 客户端** (http-client): result'）
 * @param label - 类别标签
 * @param category - 类别 ID
 * @returns 更新后的 markdown 内容
 */
function appendOrUpdateSection(
  content: string,
  sectionHeader: string,
  categoryLine: string,
  label: string,
  category: string,
): string {
  if (content.includes(sectionHeader)) {
    // 已有该段落：检查是否已有该类别的记录
    const sectionStart = content.indexOf(sectionHeader);
    const sectionEnd = content.indexOf('\n## ', sectionStart + sectionHeader.length);

    const beforeSection = content.slice(0, sectionStart);
    const sectionContent = sectionEnd === -1
      ? content.slice(sectionStart)
      : content.slice(sectionStart, sectionEnd);
    const afterSection = sectionEnd === -1 ? '' : content.slice(sectionEnd);

    // 检查是否已有该类别的记录行
    const categoryPattern = new RegExp(
      '- \\*\\*' + escapeRegex(label) + '\\*\\* \\(' + escapeRegex(category) + '\\):',
    );

    let updatedSection: string;
    if (categoryPattern.test(sectionContent)) {
      // 更新已有记录
      updatedSection = sectionContent.replace(
        new RegExp('- \\*\\*' + escapeRegex(label) + '\\*\\* \\(' + escapeRegex(category) + '\\):.*$', 'm'),
        categoryLine,
      );
    } else {
      // 新增记录
      updatedSection = sectionContent.trimEnd() + '\n' + categoryLine + '\n';
    }

    return beforeSection + updatedSection + afterSection;
  } else {
    // 没有该段落：追加到文件末尾
    return content.trimEnd() + '\n\n' + sectionHeader + '\n\n' + categoryLine + '\n';
  }
}

/**
 * 转义正则特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
