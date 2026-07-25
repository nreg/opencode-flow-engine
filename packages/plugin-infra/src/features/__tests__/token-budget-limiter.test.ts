/**
 * Tests for token-budget-limiter
 *
 * Covers:
 * - DEFAULT_LINE_LIMIT 常量值
 * - ARTIFACT_FILE_PATTERNS 工件文件豁免列表
 * - truncateContent: 截断内容至 limit 行
 * - isArtifactFile: 检查文件路径是否为工件文件（豁免不截断）
 * - isWithinLimit: 检查是否在预算内
 */
import { describe, it, expect } from 'bun:test';
import {
  DEFAULT_LINE_LIMIT,
  ARTIFACT_FILE_PATTERNS,
  truncateContent,
  isArtifactFile,
  isWithinLimit,
  applyTokenBudgetToContent,
  FileTier,
  REFERENCE_LINE_THRESHOLD,
  classifyFile,
} from '../token-budget-limiter.js';

// ─── 常量测试 ──────────────────────────────────────────────────────────────

describe('DEFAULT_LINE_LIMIT', () => {
  it('should be 150', () => {
    expect(DEFAULT_LINE_LIMIT).toBe(150);
  });
});

describe('ARTIFACT_FILE_PATTERNS', () => {
  it('should include proposal.md', () => {
    expect(ARTIFACT_FILE_PATTERNS.some(p => p.test('proposal.md'))).toBe(true);
  });

  it('should include design.md', () => {
    expect(ARTIFACT_FILE_PATTERNS.some(p => p.test('design.md'))).toBe(true);
  });

  it('should include tasks.md', () => {
    expect(ARTIFACT_FILE_PATTERNS.some(p => p.test('tasks.md'))).toBe(true);
  });

  it('should include execution-contract.md', () => {
    expect(ARTIFACT_FILE_PATTERNS.some(p => p.test('execution-contract.md'))).toBe(true);
  });

  it('should include state.json', () => {
    expect(ARTIFACT_FILE_PATTERNS.some(p => p.test('state.json'))).toBe(true);
  });

  it('should include specs/*.md pattern', () => {
    expect(ARTIFACT_FILE_PATTERNS.some(p => p.test('specs/auth-service.md'))).toBe(true);
    expect(ARTIFACT_FILE_PATTERNS.some(p => p.test('specs/some-spec.md'))).toBe(true);
  });

  it('should NOT match regular source files', () => {
    expect(ARTIFACT_FILE_PATTERNS.some(p => p.test('src/index.ts'))).toBe(false);
    expect(ARTIFACT_FILE_PATTERNS.some(p => p.test('utils.ts'))).toBe(false);
  });
});

// ─── truncateContent 测试 ──────────────────────────────────────────────────

describe('truncateContent', () => {
  it('should return full content when lines <= limit', () => {
    const content = 'line1\nline2\nline3';
    const result = truncateContent(content, 5);
    expect(result.content).toBe(content);
    expect(result.truncated).toBe(false);
    expect(result.totalLines).toBe(3);
    expect(result.returnedLines).toBe(3);
  });

  it('should truncate content when lines exceed limit', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = truncateContent(content, 150);
    expect(result.truncated).toBe(true);
    expect(result.totalLines).toBe(200);
    expect(result.returnedLines).toBe(150);
    // 返回的内容应该是前 150 行
    const returnedLines = result.content.split('\n');
    expect(returnedLines.length).toBe(150);
    expect(returnedLines[0]).toBe('line1');
    expect(returnedLines[149]).toBe('line150');
  });

  it('should use DEFAULT_LINE_LIMIT when limit is not provided', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = truncateContent(content);
    expect(result.truncated).toBe(true);
    expect(result.totalLines).toBe(200);
    expect(result.returnedLines).toBe(DEFAULT_LINE_LIMIT);
  });

  it('should handle empty content', () => {
    const result = truncateContent('');
    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.totalLines).toBe(0);
    expect(result.returnedLines).toBe(0);
  });

  it('should handle single line content within limit', () => {
    const result = truncateContent('single line', 150);
    expect(result.content).toBe('single line');
    expect(result.truncated).toBe(false);
    expect(result.totalLines).toBe(1);
    expect(result.returnedLines).toBe(1);
  });

  it('should handle content with trailing newline', () => {
    const content = 'line1\nline2\n';
    const result = truncateContent(content, 150);
    // 尾部换行不产生额外空行
    expect(result.totalLines).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it('should handle Windows-style CRLF line endings', () => {
    const content = 'line1\r\nline2\r\nline3';
    const result = truncateContent(content, 150);
    expect(result.totalLines).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it('should return exactly limit lines when content has more', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = truncateContent(content, 5);
    expect(result.returnedLines).toBe(5);
    expect(result.totalLines).toBe(10);
    expect(result.truncated).toBe(true);
  });
});

// ─── isArtifactFile 测试 ───────────────────────────────────────────────────

describe('isArtifactFile', () => {
  it('should return true for proposal.md', () => {
    expect(isArtifactFile('proposal.md')).toBe(true);
  });

  it('should return true for design.md', () => {
    expect(isArtifactFile('design.md')).toBe(true);
  });

  it('should return true for tasks.md', () => {
    expect(isArtifactFile('tasks.md')).toBe(true);
  });

  it('should return true for execution-contract.md', () => {
    expect(isArtifactFile('execution-contract.md')).toBe(true);
  });

  it('should return true for state.json', () => {
    expect(isArtifactFile('state.json')).toBe(true);
  });

  it('should return true for specs/*.md files', () => {
    expect(isArtifactFile('specs/auth-service.md')).toBe(true);
    expect(isArtifactFile('specs/api-design.md')).toBe(true);
  });

  it('should return true for .flow-engine/sflow/ paths', () => {
    expect(isArtifactFile('.flow-engine/sflow/state.json')).toBe(true);
    expect(isArtifactFile('.flow-engine/sflow/proposal.md')).toBe(true);
  });

  it('should return true for files with directory prefix', () => {
    expect(isArtifactFile('project/.flow-engine/sflow/design.md')).toBe(true);
    expect(isArtifactFile('/home/user/project/proposal.md')).toBe(true);
  });

  it('should return false for regular source files', () => {
    expect(isArtifactFile('src/index.ts')).toBe(false);
    expect(isArtifactFile('utils.ts')).toBe(false);
    expect(isArtifactFile('package.json')).toBe(false);
  });

  it('should return false for non-artifact md files', () => {
    expect(isArtifactFile('README.md')).toBe(false);
    expect(isArtifactFile('CHANGELOG.md')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isArtifactFile('')).toBe(false);
  });

  it('should handle Windows-style backslash paths', () => {
    expect(isArtifactFile('project\\.flow-engine\\sflow\\state.json')).toBe(true);
  });
});

// ─── isWithinLimit 测试 ────────────────────────────────────────────────────

describe('isWithinLimit', () => {
  it('should allow artifact files regardless of line count', () => {
    const result = isWithinLimit('proposal.md', 10000);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should allow artifact files in specs/ directory', () => {
    const result = isWithinLimit('specs/auth-service.md', 5000);
    expect(result.allowed).toBe(true);
  });

  it('should allow .flow-engine/sflow/ paths regardless of line count', () => {
    const result = isWithinLimit('.flow-engine/sflow/state.json', 99999);
    expect(result.allowed).toBe(true);
  });

  it('should allow regular files within limit', () => {
    const result = isWithinLimit('src/index.ts', 100);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should block regular files exceeding limit', () => {
    const result = isWithinLimit('src/index.ts', 200);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('200');
    expect(result.reason).toContain('150');
  });

  it('should allow regular files at exactly the limit', () => {
    const result = isWithinLimit('src/index.ts', DEFAULT_LINE_LIMIT);
    expect(result.allowed).toBe(true);
  });

  it('should block regular files just over the limit', () => {
    const result = isWithinLimit('src/index.ts', DEFAULT_LINE_LIMIT + 1);
    expect(result.allowed).toBe(false);
  });

  it('should provide reason with file path when blocking', () => {
    const result = isWithinLimit('src/large-file.ts', 500);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('src/large-file.ts');
  });

  it('should handle empty file path', () => {
    const result = isWithinLimit('', 200);
    expect(result.allowed).toBe(false);
  });
});

// ─── applyTokenBudgetToContent 测试 ──────────────────────────────────────────

describe('applyTokenBudgetToContent', () => {
  it('should not truncate artifact files regardless of line count', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('proposal.md', content);
    expect(result).toBe(content);
  });

  it('should not truncate specs/*.md artifact files', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('specs/auth-service.md', content);
    expect(result).toBe(content);
  });

  it('should not truncate .flow-engine/sflow/ paths', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('.flow-engine/sflow/design.md', content);
    expect(result).toBe(content);
  });

  it('should not truncate regular files within 150 lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('src/index.ts', content);
    expect(result).toBe(content);
  });

  it('should not truncate regular files at exactly 150 lines', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('src/index.ts', content);
    expect(result).toBe(content);
  });

  it('should truncate regular files exceeding 150 lines and append notice', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('src/index.ts', content);
    // 应包含截断后的前 150 行
    const resultLines = result.split('\n');
    // 150 行内容 + 1 行空行 + 1 行截断通知 = 152 行
    expect(resultLines.length).toBe(152);
    expect(resultLines[0]).toBe('line1');
    expect(resultLines[149]).toBe('line150');
    // 应包含截断通知
    expect(result).toContain('[Token Budget]');
    expect(result).toContain('200');
    expect(result).toContain('150');
  });

  it('should handle empty content', () => {
    const result = applyTokenBudgetToContent('src/index.ts', '');
    expect(result).toBe('');
  });

  it('should handle empty file path (treated as non-artifact)', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('', content);
    expect(result).toContain('[Token Budget]');
  });

  it('should preserve line-numbered format from read tool output', () => {
    // 模拟 read 工具返回的带行号格式
    const lines = Array.from({ length: 200 }, (_, i) => `${i + 1}: content line ${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('src/large-file.ts', content);
    const resultLines = result.split('\n');
    // 前 150 行保留行号格式
    expect(resultLines[0]).toBe('1: content line 1');
    expect(resultLines[149]).toBe('150: content line 150');
    // 截断通知
    expect(result).toContain('[Token Budget]');
  });

  it('should use custom line limit when provided', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('src/index.ts', content, 50);
    expect(result).toContain('[Token Budget]');
    expect(result).toContain('100');
    expect(result).toContain('50');
  });

  it('should not truncate with custom limit when content is within limit', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('src/index.ts', content, 50);
    expect(result).toBe(content);
  });
});

// ─── FileTier 三级分类测试 ────────────────────────────────────────────────────

describe('FileTier type and REFERENCE_LINE_THRESHOLD', () => {
  it('REFERENCE_LINE_THRESHOLD should be 200', () => {
    expect(REFERENCE_LINE_THRESHOLD).toBe(200);
  });
});

describe('classifyFile', () => {
  // SPEC 分类
  it('should classify proposal.md as SPEC', () => {
    expect(classifyFile('proposal.md', 300)).toBe<FileTier>('SPEC');
  });

  it('should classify design.md as SPEC', () => {
    expect(classifyFile('design.md', 500)).toBe<FileTier>('SPEC');
  });

  it('should classify tasks.md as SPEC', () => {
    expect(classifyFile('tasks.md', 100)).toBe<FileTier>('SPEC');
  });

  it('should classify execution-contract.md as SPEC', () => {
    expect(classifyFile('execution-contract.md', 200)).toBe<FileTier>('SPEC');
  });

  it('should classify state.json as SPEC', () => {
    expect(classifyFile('state.json', 50)).toBe<FileTier>('SPEC');
  });

  it('should classify specs/*.md as SPEC', () => {
    expect(classifyFile('specs/auth-service.md', 400)).toBe<FileTier>('SPEC');
  });

  it('should classify .flow-engine/sflow/ paths as SPEC', () => {
    expect(classifyFile('.flow-engine/sflow/state.json', 1000)).toBe<FileTier>('SPEC');
  });

  // REFERENCE 分类
  it('should classify large .md file (>200 lines) as REFERENCE', () => {
    expect(classifyFile('reference.md', 300)).toBe<FileTier>('REFERENCE');
  });

  it('should classify large README.md (>200 lines) as REFERENCE', () => {
    expect(classifyFile('README.md', 201)).toBe<FileTier>('REFERENCE');
  });

  it('should classify large CHANGELOG.md (>200 lines) as REFERENCE', () => {
    expect(classifyFile('CHANGELOG.md', 500)).toBe<FileTier>('REFERENCE');
  });

  it('should classify large .md file with path prefix as REFERENCE', () => {
    expect(classifyFile('docs/api-guide.md', 300)).toBe<FileTier>('REFERENCE');
  });

  // CODE 分类
  it('should classify small .md file (<=200 lines) as CODE', () => {
    expect(classifyFile('reference.md', 50)).toBe<FileTier>('CODE');
  });

  it('should classify .md file at exactly threshold as CODE', () => {
    expect(classifyFile('README.md', 200)).toBe<FileTier>('CODE');
  });

  it('should classify .ts files as CODE', () => {
    expect(classifyFile('src/file.ts')).toBe<FileTier>('CODE');
  });

  it('should classify .js files as CODE', () => {
    expect(classifyFile('src/file.js')).toBe<FileTier>('CODE');
  });

  it('should classify .py files as CODE', () => {
    expect(classifyFile('scripts/main.py')).toBe<FileTier>('CODE');
  });

  it('should classify empty string as CODE', () => {
    expect(classifyFile('')).toBe<FileTier>('CODE');
  });

  it('should classify .md file without totalLines as CODE', () => {
    expect(classifyFile('README.md')).toBe<FileTier>('CODE');
  });

  // 边界：SPEC 优先于 REFERENCE
  it('should classify proposal.md as SPEC even if >200 lines', () => {
    expect(classifyFile('proposal.md', 500)).toBe<FileTier>('SPEC');
  });

  // Windows 路径
  it('should handle Windows-style backslash paths', () => {
    expect(classifyFile('project\\.flow-engine\\sflow\\state.json', 100)).toBe<FileTier>('SPEC');
  });
});

// ─── isWithinLimit 三级分类测试 ──────────────────────────────────────────────

describe('isWithinLimit with three-tier classification', () => {
  it('should always allow SPEC files regardless of line count', () => {
    const result = isWithinLimit('proposal.md', 10000);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should always allow REFERENCE files regardless of line count', () => {
    const result = isWithinLimit('README.md', 500);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('should allow CODE files within limit', () => {
    const result = isWithinLimit('src/index.ts', 100);
    expect(result.allowed).toBe(true);
  });

  it('should block CODE files exceeding limit', () => {
    const result = isWithinLimit('src/index.ts', 200);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('CODE tier');
    expect(result.reason).toContain('200');
    expect(result.reason).toContain('150');
  });

  it('should allow CODE files at exactly the limit', () => {
    const result = isWithinLimit('src/index.ts', DEFAULT_LINE_LIMIT);
    expect(result.allowed).toBe(true);
  });

  it('should block CODE files just over the limit', () => {
    const result = isWithinLimit('src/index.ts', DEFAULT_LINE_LIMIT + 1);
    expect(result.allowed).toBe(false);
  });

  it('should provide reason with file path and tier for CODE files', () => {
    const result = isWithinLimit('src/large-file.ts', 500);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('src/large-file.ts');
    expect(result.reason).toContain('CODE tier');
  });

  it('should block empty path as CODE tier when exceeding limit', () => {
    const result = isWithinLimit('', 200);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('CODE tier');
  });
});

// ─── applyTokenBudgetToContent 三级分类测试 ──────────────────────────────────

describe('applyTokenBudgetToContent with three-tier classification', () => {
  it('should not truncate SPEC files regardless of line count', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('proposal.md', content);
    expect(result).toBe(content);
  });

  it('should not truncate REFERENCE files regardless of line count', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('README.md', content);
    expect(result).toBe(content);
  });

  it('should not truncate large CHANGELOG.md as REFERENCE', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('CHANGELOG.md', content);
    expect(result).toBe(content);
  });

  it('should truncate CODE files exceeding 150 lines', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('src/index.ts', content);
    expect(result).toContain('[Token Budget]');
    expect(result).toContain('200');
    expect(result).toContain('150');
  });

  it('should not truncate CODE files within 150 lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('src/index.ts', content);
    expect(result).toBe(content);
  });

  it('should not truncate small .md files (CODE tier) within limit', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('small-note.md', content);
    expect(result).toBe(content);
  });

  it('should truncate small .md files (CODE tier) exceeding limit', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    const result = applyTokenBudgetToContent('small-note.md', content);
    expect(result).toContain('[Token Budget]');
  });
});
