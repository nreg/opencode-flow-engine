/**
 * Task Parser — tasks.md 复选框行单一解析入口（D7 / spec: task-parser）
 *
 * 背景：tasks.md 的 `- [ ]` / `- [x]` 判定此前散落在
 * transition-guards（checkTaskCompletion）、plan-crud（recommendExecutionMode）、
 * artifacts-guards（文件数推断）、boundary（活跃任务）四处，正则各不相同，阈值语义有漂移风险。
 *
 * 本模块移植上游 `spec-superflow/scripts/lib/task-parser.mjs` 的解析模型并做两处适配：
 * - 行匹配：与上游一致（`^[ \t]*- \[([^\]]*)\](?:[ \t]+(.*))?$`），容忍行首空白与 `[x]`/`[X]`
 * - id 提取：上游要求行首即数字；sFlow 模板为 `Task 1.1: …`，故额外容忍 `**` 加粗与 `Task ` 前缀，
 *   并把 id 后允许的分隔符扩展到 `:` / `：`（与 packages/core 的 validateTasks 任务集合保持一致）
 */

/** 解析后的任务行。 */
export interface ParsedTask {
  /** 任务编号（如 `1.1`）；无编号时为 null */
  id: string | null;
  /** 复选框之后的整行正文（不含 `- [ ] `） */
  text: string;
  /** 原始行（含缩进与复选框） */
  line: string;
  /** 行号（0 基） */
  index: number;
  /** 是否已完成（`[x]` / `[X]`） */
  complete: boolean;
  /** 复选框内的原始标记（如 ` `、`x`、`X`） */
  marker: string;
}

/** 与上游一致的任务行正则。 */
const TASK_LINE_PATTERN = /^[ \t]*- \[([^\]]*)\](?:[ \t]+(.*))?$/;

/** id 之前允许的前缀：`**` 加粗或 sFlow 的 `Task ` 前缀。 */
const ID_PREFIX_PATTERN = /^(?:\*\*|Task\s*)/i;

/** id 之后允许的分隔符：空白、加粗结束符、冒号（中英文）或行尾。 */
const ID_PATTERN = /^(\d+(?:\.\d+)*)(?=\s|\*\*|:|：|$)/;

/**
 * 解析 tasks.md 内容为结构化任务列表。
 *
 * @param content tasks.md 全文；空 / 非任务行返回空数组，绝不抛异常
 */
export function parseTasks(content: string): ParsedTask[] {
  return String(content ?? '')
    .split(/\r?\n/)
    .flatMap((line, index) => {
      const match = line.match(TASK_LINE_PATTERN);
      if (!match) return [];
      const text = match[2] ?? '';
      const id = text.replace(ID_PREFIX_PATTERN, '').match(ID_PATTERN)?.[1] ?? null;
      const marker = match[1] ?? '';
      return [{ id, text, line, index, complete: /^[xX]$/.test(marker), marker }];
    });
}

/**
 * 仅返回未完成的任务行。
 * 消费方（门禁完成判定、执行模式推荐的任务数）统一走它，避免各自解释复选框。
 */
export function incompleteTasks(content: string): ParsedTask[] {
  return parseTasks(content).filter(task => !task.complete);
}
