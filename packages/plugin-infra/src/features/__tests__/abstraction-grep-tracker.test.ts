/**
 * Tests for abstraction-grep-tracker
 *
 * Covers:
 * - ABSTRACTION_PATTERNS: 正则匹配抽象类文件路径
 * - ABSTRACTION_CATEGORIES: 6 种抽象类别 grep 命令模板
 * - detectNewAbstraction: 检测文件路径是否属于新建抽象
 * - recordGrepResult: 将 grep 结果记录到 progress.md 的 6 维自查段
 * - hasGrepRecord: 检查是否存在对应的 grep 记录
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdir, rm, readFile, writeFile } from 'fs/promises';
import {
  ABSTRACTION_PATTERNS,
  ABSTRACTION_CATEGORIES,
  detectNewAbstraction,
  recordGrepResult,
  hasGrepRecord,
  type AbstractionCategory,
} from '../abstraction-grep-tracker.js';

// ─── 测试临时目录 ──────────────────────────────────────────────────────────

const TEST_TMP = join(import.meta.dir, '__agt_test_tmp__');

// ─── ABSTRACTION_PATTERNS 测试 ─────────────────────────────────────────────

describe('ABSTRACTION_PATTERNS', () => {
  it('should be a non-empty array of RegExp', () => {
    expect(Array.isArray(ABSTRACTION_PATTERNS)).toBe(true);
    expect(ABSTRACTION_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of ABSTRACTION_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });

  it('should match utils/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utils/format.ts'));
    expect(matched).toBe(true);
  });

  it('should match helpers/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/helpers/date.ts'));
    expect(matched).toBe(true);
  });

  it('should match services/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/services/user-service.ts'));
    expect(matched).toBe(true);
  });

  it('should NOT match component files', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/components/Button.tsx'));
    expect(matched).toBe(false);
  });

  it('should NOT match page files', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/pages/Home.tsx'));
    expect(matched).toBe(false);
  });

  it('should match lib/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/lib/http-client.ts'));
    expect(matched).toBe(true);
  });

  it('should match hooks/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/hooks/useAuth.ts'));
    expect(matched).toBe(true);
  });

  it('should match repositories/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/repositories/user-repo.ts'));
    expect(matched).toBe(true);
  });
});

// ─── ABSTRACTION_CATEGORIES 测试 ───────────────────────────────────────────

describe('ABSTRACTION_CATEGORIES', () => {
  it('should have exactly 6 categories', () => {
    const keys = Object.keys(ABSTRACTION_CATEGORIES);
    expect(keys.length).toBe(6);
  });

  it('should include http-client category', () => {
    expect(ABSTRACTION_CATEGORIES).toHaveProperty('http-client');
  });

  it('should include date-format category', () => {
    expect(ABSTRACTION_CATEGORIES).toHaveProperty('date-format');
  });

  it('should include state-management category', () => {
    expect(ABSTRACTION_CATEGORIES).toHaveProperty('state-management');
  });

  it('should include repository category', () => {
    expect(ABSTRACTION_CATEGORIES).toHaveProperty('repository');
  });

  it('should include error-handling category', () => {
    expect(ABSTRACTION_CATEGORIES).toHaveProperty('error-handling');
  });

  it('should include custom-hooks category', () => {
    expect(ABSTRACTION_CATEGORIES).toHaveProperty('custom-hooks');
  });

  it('each category should have grepCommand template with {filePath} placeholder', () => {
    for (const [key, cat] of Object.entries(ABSTRACTION_CATEGORIES)) {
      expect(cat.grepCommand).toContain('{filePath}');
      expect(typeof cat.label).toBe('string');
      expect(cat.label.length).toBeGreaterThan(0);
    }
  });

  it('each category should have a label', () => {
    for (const [key, cat] of Object.entries(ABSTRACTION_CATEGORIES)) {
      expect(cat.label).toBeTruthy();
    }
  });
});

// ─── detectNewAbstraction 测试 ─────────────────────────────────────────────

describe('detectNewAbstraction', () => {
  it('should return http-client for http client files', () => {
    const result = detectNewAbstraction('src/utils/http-client.ts');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('http-client');
  });

  it('should return date-format for date formatting files', () => {
    const result = detectNewAbstraction('src/utils/date-formatter.ts');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('date-format');
  });

  it('should return state-management for state management files', () => {
    const result = detectNewAbstraction('src/services/store.ts');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('state-management');
  });

  it('should return repository for repository files', () => {
    const result = detectNewAbstraction('src/repositories/user-repo.ts');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('repository');
  });

  it('should return error-handling for error handling files', () => {
    const result = detectNewAbstraction('src/utils/error-handler.ts');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('error-handling');
  });

  it('should return custom-hooks for hook files', () => {
    const result = detectNewAbstraction('src/hooks/useAuth.ts');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('custom-hooks');
  });

  it('should return null for non-abstraction files', () => {
    const result = detectNewAbstraction('src/components/Button.tsx');
    expect(result).toBeNull();
  });

  it('should return null for page files', () => {
    const result = detectNewAbstraction('src/pages/Home.tsx');
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    const result = detectNewAbstraction('');
    expect(result).toBeNull();
  });

  it('should detect abstraction in nested utils paths', () => {
    const result = detectNewAbstraction('packages/shared/src/utils/helpers.ts');
    expect(result).not.toBeNull();
  });

  it('should return category with label for matched file', () => {
    const result = detectNewAbstraction('src/utils/http-client.ts');
    expect(result).not.toBeNull();
    expect(result!.label).toBeTruthy();
    expect(typeof result!.label).toBe('string');
  });
});

// ─── recordGrepResult / hasGrepRecord 测试 ────────────────────────────────

describe('recordGrepResult and hasGrepRecord', () => {
  beforeEach(async () => {
    await rm(TEST_TMP, { recursive: true, force: true });
    await mkdir(TEST_TMP, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_TMP, { recursive: true, force: true });
  });

  it('hasGrepRecord should return false when no progress.md exists', async () => {
    const exists = await hasGrepRecord(TEST_TMP, 'http-client');
    expect(exists).toBe(false);
  });

  it('hasGrepRecord should return false when progress.md has no grep section', async () => {
    // 创建一个没有 grep 段的 progress.md
    const progressDir = join(TEST_TMP, '.flow-engine/sflow');
    await mkdir(progressDir, { recursive: true });
    await writeFile(
      join(progressDir, 'progress.md'),
      '# PROGRESS: T1\n\n## 已完成的子步骤\n- [x] step1\n',
    );
    const exists = await hasGrepRecord(TEST_TMP, 'http-client');
    expect(exists).toBe(false);
  });

  it('recordGrepResult should create progress.md with grep section if not exists', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'grep -rn "fetch" src/ → 3 matches');

    const progressPath = join(TEST_TMP, '.flow-engine/sflow/progress.md');
    const content = await readFile(progressPath, 'utf-8');
    expect(content).toContain('6 维自查');
    expect(content).toContain('http-client');
    expect(content).toContain('grep -rn "fetch" src/ → 3 matches');
  });

  it('hasGrepRecord should return true after recordGrepResult', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'grep result here');
    const exists = await hasGrepRecord(TEST_TMP, 'http-client');
    expect(exists).toBe(true);
  });

  it('hasGrepRecord should return false for unrecorded category', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'some result');
    const exists = await hasGrepRecord(TEST_TMP, 'date-format');
    expect(exists).toBe(false);
  });

  it('recordGrepResult should append to existing progress.md', async () => {
    // 先创建一个已有的 progress.md
    const progressDir = join(TEST_TMP, '.flow-engine/sflow');
    await mkdir(progressDir, { recursive: true });
    await writeFile(
      join(progressDir, 'progress.md'),
      '# PROGRESS: T1\n\n## 已完成的子步骤\n- [x] step1\n',
    );

    await recordGrepResult(TEST_TMP, 'http-client', 'grep result');

    const content = await readFile(join(progressDir, 'progress.md'), 'utf-8');
    // 原有内容应保留
    expect(content).toContain('已完成的子步骤');
    expect(content).toContain('step1');
    // 新增 grep 段
    expect(content).toContain('6 维自查');
    expect(content).toContain('http-client');
  });

  it('recordGrepResult should append additional category to existing grep section', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'first result');
    await recordGrepResult(TEST_TMP, 'date-format', 'second result');

    const progressPath = join(TEST_TMP, '.flow-engine/sflow/progress.md');
    const content = await readFile(progressPath, 'utf-8');

    expect(content).toContain('http-client');
    expect(content).toContain('first result');
    expect(content).toContain('date-format');
    expect(content).toContain('second result');

    // 两个类别都应被记录
    expect(await hasGrepRecord(TEST_TMP, 'http-client')).toBe(true);
    expect(await hasGrepRecord(TEST_TMP, 'date-format')).toBe(true);
  });

  it('recordGrepResult should update existing category result', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'old result');
    await recordGrepResult(TEST_TMP, 'http-client', 'new result');

    const progressPath = join(TEST_TMP, '.flow-engine/sflow/progress.md');
    const content = await readFile(progressPath, 'utf-8');

    expect(content).toContain('new result');
    // 不应包含旧结果（被更新）
    expect(content).not.toContain('old result');
  });

  it('recordGrepResult should include category label in progress.md', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'some grep output');

    const progressPath = join(TEST_TMP, '.flow-engine/sflow/progress.md');
    const content = await readFile(progressPath, 'utf-8');

    // 应包含类别标签（如 "HTTP 客户端"）
    const cat = ABSTRACTION_CATEGORIES['http-client'];
    expect(content).toContain(cat.label);
  });

  it('recordGrepResult should handle all 6 categories', async () => {
    const categories = Object.keys(ABSTRACTION_CATEGORIES);
    for (const cat of categories) {
      await recordGrepResult(TEST_TMP, cat, 'result for ' + cat);
    }

    for (const cat of categories) {
      expect(await hasGrepRecord(TEST_TMP, cat)).toBe(true);
    }
  });
});

// ─── Wave 3 / F3: 多语言扩展名测试 ──────────────────────────────────────

describe('ABSTRACTION_PATTERNS - multi-language extensions (F3)', () => {
  it('should match utils/*.py paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utils/http_client.py'));
    expect(matched).toBe(true);
  });

  it('should match utils/*.java paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utils/DateHelper.java'));
    expect(matched).toBe(true);
  });

  it('should match utils/*.go paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utils/http_client.go'));
    expect(matched).toBe(true);
  });

  it('should match utils/*.rb paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utils/format_helper.rb'));
    expect(matched).toBe(true);
  });

  it('should match utils/*.php paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utils/StringHelper.php'));
    expect(matched).toBe(true);
  });

  it('should match services/*.py paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/services/user_service.py'));
    expect(matched).toBe(true);
  });

  it('should match hooks/*.jsx paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/hooks/useAuth.jsx'));
    expect(matched).toBe(true);
  });

  it('should match lib/*.rs paths (Rust)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/lib/http_client.rs'));
    expect(matched).toBe(true);
  });

  it('should match repositories/*.kt paths (Kotlin)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/repositories/UserRepo.kt'));
    expect(matched).toBe(true);
  });

  it('should match adapters/*.cs paths (C#)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/adapters/CacheAdapter.cs'));
    expect(matched).toBe(true);
  });

  it('should match helpers/*.swift paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/helpers/DateHelper.swift'));
    expect(matched).toBe(true);
  });

  it('should match shared/*.mjs paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/shared/constants.mjs'));
    expect(matched).toBe(true);
  });

  it('should match shared/*.cjs paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/shared/config.cjs'));
    expect(matched).toBe(true);
  });

  it('should NOT match .md files in utils/', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utils/README.md'));
    expect(matched).toBe(false);
  });

  it('should NOT match .css files in utils/', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utils/styles.css'));
    expect(matched).toBe(false);
  });
});

// ─── Wave 3 / F3: 新路径模式测试 ────────────────────────────────────────

describe('ABSTRACTION_PATTERNS - new path patterns (F3)', () => {
  it('should match utilities/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utilities/format.ts'));
    expect(matched).toBe(true);
  });

  it('should match common/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/common/helpers.ts'));
    expect(matched).toBe(true);
  });

  it('should match core/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/core/http-client.ts'));
    expect(matched).toBe(true);
  });

  it('should match src/lib/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/lib/api-client.ts'));
    expect(matched).toBe(true);
  });

  it('should match app/helpers/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('app/helpers/format.ts'));
    expect(matched).toBe(true);
  });

  it('should match src/util/*.ts paths', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/util/date.ts'));
    expect(matched).toBe(true);
  });

  it('should match utilities/*.py paths (new path + multi-lang)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utilities/http_client.py'));
    expect(matched).toBe(true);
  });

  it('should match common/*.java paths (new path + multi-lang)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/common/StringUtils.java'));
    expect(matched).toBe(true);
  });

  it('should match core/*.go paths (new path + multi-lang)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/core/service.go'));
    expect(matched).toBe(true);
  });
});

// ─── Wave 3 / F3: 向后兼容测试 ──────────────────────────────────────────

describe('ABSTRACTION_PATTERNS - backward compatibility (F3)', () => {
  it('should still match utils/*.ts paths (original)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/utils/format.ts'));
    expect(matched).toBe(true);
  });

  it('should still match helpers/*.ts paths (original)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/helpers/date.ts'));
    expect(matched).toBe(true);
  });

  it('should still match services/*.ts paths (original)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/services/user-service.ts'));
    expect(matched).toBe(true);
  });

  it('should still match lib/*.ts paths (original)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/lib/http-client.ts'));
    expect(matched).toBe(true);
  });

  it('should still match hooks/*.ts paths (original)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/hooks/useAuth.ts'));
    expect(matched).toBe(true);
  });

  it('should still match repositories/*.ts paths (original)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/repositories/user-repo.ts'));
    expect(matched).toBe(true);
  });

  it('should still match adapters/*.ts paths (original)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/adapters/cache-adapter.ts'));
    expect(matched).toBe(true);
  });

  it('should still match shared/*.ts paths (original)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/shared/constants.ts'));
    expect(matched).toBe(true);
  });

  it('should still NOT match component files (original)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/components/Button.tsx'));
    expect(matched).toBe(false);
  });

  it('should still NOT match page files (original)', () => {
    const matched = ABSTRACTION_PATTERNS.some(p => p.test('src/pages/Home.tsx'));
    expect(matched).toBe(false);
  });
});

// ─── Wave 3 / F3: detectNewAbstraction 多语言测试 ────────────────────────

describe('detectNewAbstraction - multi-language support (F3)', () => {
  it('should detect abstraction in utils/*.py files', () => {
    const result = detectNewAbstraction('src/utils/http_client.py');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('http-client');
  });

  it('should detect abstraction in services/*.java files', () => {
    const result = detectNewAbstraction('src/services/UserService.java');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('state-management');
  });

  it('should detect abstraction in hooks/*.jsx files', () => {
    const result = detectNewAbstraction('src/hooks/useAuth.jsx');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('custom-hooks');
  });

  it('should detect abstraction in repositories/*.kt files', () => {
    const result = detectNewAbstraction('src/repositories/UserRepo.kt');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('repository');
  });

  it('should detect abstraction in utilities/*.ts files', () => {
    const result = detectNewAbstraction('src/utilities/format.ts');
    expect(result).not.toBeNull();
  });

  it('should detect abstraction in common/*.ts files', () => {
    const result = detectNewAbstraction('src/common/helpers.ts');
    expect(result).not.toBeNull();
  });

  it('should detect abstraction in core/*.ts files', () => {
    const result = detectNewAbstraction('src/core/http-client.ts');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('http-client');
  });

  it('should detect abstraction in src/util/*.py files', () => {
    const result = detectNewAbstraction('src/util/date.py');
    expect(result).not.toBeNull();
  });
});

// ─── Wave 3 / F3: SUMMARY.md 写入测试 ──────────────────────────────────

describe('recordGrepResult - SUMMARY.md write (F3)', () => {
  beforeEach(async () => {
    await rm(TEST_TMP, { recursive: true, force: true });
    await mkdir(TEST_TMP, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_TMP, { recursive: true, force: true });
  });

  it('should create SUMMARY.md when it does not exist', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'grep -rn "fetch" src/ → 3 matches');

    const summaryPath = join(TEST_TMP, '.flow-engine/sflow/SUMMARY.md');
    const content = await readFile(summaryPath, 'utf-8');
    expect(content).toContain('抽象层 grep 结果');
    expect(content).toContain('http-client');
    expect(content).toContain('grep -rn "fetch" src/ → 3 matches');
  });

  it('should append to existing SUMMARY.md', async () => {
    // 先创建已有的 SUMMARY.md
    const sflowDir = join(TEST_TMP, '.flow-engine/sflow');
    await mkdir(sflowDir, { recursive: true });
    await writeFile(
      join(sflowDir, 'SUMMARY.md'),
      '# 项目摘要\n\n## 已有段落\n\n一些内容\n',
    );

    await recordGrepResult(TEST_TMP, 'http-client', 'grep result');

    const content = await readFile(join(sflowDir, 'SUMMARY.md'), 'utf-8');
    // 原有内容应保留
    expect(content).toContain('项目摘要');
    expect(content).toContain('已有段落');
    // 新增 grep 段
    expect(content).toContain('抽象层 grep 结果');
    expect(content).toContain('http-client');
  });

  it('should update existing category in SUMMARY.md', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'old result');
    await recordGrepResult(TEST_TMP, 'http-client', 'new result');

    const summaryPath = join(TEST_TMP, '.flow-engine/sflow/SUMMARY.md');
    const content = await readFile(summaryPath, 'utf-8');

    expect(content).toContain('new result');
    expect(content).not.toContain('old result');
  });

  it('should append additional category to existing SUMMARY.md section', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'first result');
    await recordGrepResult(TEST_TMP, 'date-format', 'second result');

    const summaryPath = join(TEST_TMP, '.flow-engine/sflow/SUMMARY.md');
    const content = await readFile(summaryPath, 'utf-8');

    expect(content).toContain('http-client');
    expect(content).toContain('first result');
    expect(content).toContain('date-format');
    expect(content).toContain('second result');
  });

  it('should include category label in SUMMARY.md', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'some grep output');

    const summaryPath = join(TEST_TMP, '.flow-engine/sflow/SUMMARY.md');
    const content = await readFile(summaryPath, 'utf-8');

    const cat = ABSTRACTION_CATEGORIES['http-client'];
    expect(content).toContain(cat.label);
  });

  it('should write to both progress.md and SUMMARY.md', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'dual write test');

    const progressPath = join(TEST_TMP, '.flow-engine/sflow/progress.md');
    const summaryPath = join(TEST_TMP, '.flow-engine/sflow/SUMMARY.md');

    const progressContent = await readFile(progressPath, 'utf-8');
    const summaryContent = await readFile(summaryPath, 'utf-8');

    // 两个文件都应包含结果
    expect(progressContent).toContain('http-client');
    expect(progressContent).toContain('dual write test');
    expect(summaryContent).toContain('http-client');
    expect(summaryContent).toContain('dual write test');
  });

  it('SUMMARY.md should use correct section header format', async () => {
    await recordGrepResult(TEST_TMP, 'http-client', 'format test');

    const summaryPath = join(TEST_TMP, '.flow-engine/sflow/SUMMARY.md');
    const content = await readFile(summaryPath, 'utf-8');

    // 段标题格式: ## 抽象层 grep 结果
    expect(content).toContain('## 抽象层 grep 结果');
    // 行格式: - **{label}** ({categoryId}): {result}
    expect(content).toMatch(/- \*\*HTTP 客户端\*\* \(http-client\): format test/);
  });
});
