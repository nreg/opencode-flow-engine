/**
 * Path normalization for subagent-visible text (Task 2).
 *
 * Windows 路径（反斜杠 / 盘符）注入子代理可见文本（<workDir> / <projectDir> /
 * 路径回显）时统一转为正斜杠，避免下游解析歧义。纯内部 fs 写入路径不经此函数。
 */

/**
 * Normalize a path string to POSIX style:
 * - backslashes → forward slashes
 * - consecutive separators collapsed to a single one
 * - drive root "E:\" / "E:\\" → "E:/" (no trailing duplicate)
 *
 * 纯字符串处理，不做 fs 校验，不解析符号链接。
 */
export function normalizeToPosix(path: string): string {
  if (!path) return path;
  let normalized = path.replace(/\\/g, '/');
  // 折叠连续分隔符（不含盘符根前的两个斜杠——`//server` UNC 保留原样折叠即可）
  normalized = normalized.replace(/\/{2,}/g, '/');
  // 盘符根 "E:/" 后的多余斜杠已被折叠；"E:" 无分隔符时保持不变
  return normalized;
}
