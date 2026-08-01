/**
 * Artifact Language Detection Tests
 * T3.4-T3.6: 语言检测核心逻辑 + DP-0 集成 + 补检测
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  countChineseChars,
  calculateChineseRatio,
  detectTextLanguage,
  detectFileLanguage,
  resolveArtifactLanguage,
  checkAndDetectLanguage,
  type ArtifactLanguage,
} from '../artifact-language.js';

const TEST_DIR = join(import.meta.dir, '.tmp-artifact-language-test');

describe('Artifact Language Detection', () => {
  beforeEach(async () => {
    try {
      await mkdir(TEST_DIR, { recursive: true });
    } catch {
      // 目录已存在
    }
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试
    }
  });

  describe('countChineseChars', () => {
    it('应该正确统计纯中文文本', () => {
      const text = '这是一个测试';
      expect(countChineseChars(text)).toBe(6);
    });

    it('应该正确统计中英混合文本', () => {
      const text = '这是一个test测试';
      expect(countChineseChars(text)).toBe(6);
    });

    it('应该正确统计纯英文文本', () => {
      const text = 'this is a test';
      expect(countChineseChars(text)).toBe(0);
    });

    it('应该正确处理空字符串', () => {
      expect(countChineseChars('')).toBe(0);
    });

    it('应该正确处理包含数字和符号的文本', () => {
      const text = '测试123！@#测试';
      expect(countChineseChars(text)).toBe(4);
    });
  });

  describe('calculateChineseRatio', () => {
    it('应该正确计算纯中文文本的比例', () => {
      const text = '这是一个测试';
      expect(calculateChineseRatio(text)).toBe(1.0);
    });

    it('应该正确计算中英混合文本的比例', () => {
      const text = '这是test';
      // 2个中文字符 / 6个总字符 = 0.333...
      expect(calculateChineseRatio(text)).toBeCloseTo(0.333, 2);
    });

    it('应该正确计算纯英文文本的比例', () => {
      const text = 'test';
      expect(calculateChineseRatio(text)).toBe(0);
    });

    it('应该正确处理空字符串', () => {
      expect(calculateChineseRatio('')).toBe(0);
    });
  });

  describe('detectTextLanguage', () => {
    it('应该将高中文比例文本识别为中文', () => {
      const text = '这是一个中文测试文本，包含很多中文字符';
      expect(detectTextLanguage(text)).toBe('zh');
    });

    it('应该将低中文比例文本识别为英文', () => {
      const text = 'This is a test with a few 中文 words';
      expect(detectTextLanguage(text)).toBe('en');
    });

    it('应该将纯英文文本识别为英文', () => {
      const text = 'This is a pure English text';
      expect(detectTextLanguage(text)).toBe('en');
    });

    it('应该将纯中文文本识别为中文', () => {
      const text = '这是纯中文文本';
      expect(detectTextLanguage(text)).toBe('zh');
    });

    it('应该正确处理边界情况（刚好超过阈值）', () => {
      // 构造一个刚好超过 0.3 阈值的文本
      const text = '中文中文中文testtest'; // 6中文 / 14总字符 = 0.428
      expect(detectTextLanguage(text)).toBe('zh');
    });

    it('应该正确处理边界情况（刚好低于阈值）', () => {
      // 构造一个刚好低于 0.3 阈值的文本
      const text = '中文testtesttest'; // 2中文 / 13总字符 = 0.153
      expect(detectTextLanguage(text)).toBe('en');
    });
  });

  describe('detectFileLanguage', () => {
    it('应该正确检测中文文件', async () => {
      const filePath = join(TEST_DIR, 'chinese.md');
      await writeFile(filePath, '这是一个中文文件\n包含多行中文内容');
      const result = await detectFileLanguage(filePath);
      expect(result).toBe('zh');
    });

    it('应该正确检测英文文件', async () => {
      const filePath = join(TEST_DIR, 'english.md');
      await writeFile(filePath, 'This is an English file\nWith multiple lines');
      const result = await detectFileLanguage(filePath);
      expect(result).toBe('en');
    });

    it('应该对不存在的文件返回 null', async () => {
      const result = await detectFileLanguage(join(TEST_DIR, 'nonexistent.md'));
      expect(result).toBeNull();
    });

    it('应该对空文件返回 null', async () => {
      const filePath = join(TEST_DIR, 'empty.md');
      await writeFile(filePath, '');
      const result = await detectFileLanguage(filePath);
      expect(result).toBeNull();
    });

    it('应该对只有空白的文件返回 null', async () => {
      const filePath = join(TEST_DIR, 'whitespace.md');
      await writeFile(filePath, '   \n\n  \t  ');
      const result = await detectFileLanguage(filePath);
      expect(result).toBeNull();
    });
  });

  describe('resolveArtifactLanguage - 5 级优先级', () => {
    it('Level 1: 用户显式声明应该具有最高优先级', async () => {
      // 创建一个中文 proposal.md
      const proposalPath = join(TEST_DIR, 'proposal.md');
      await writeFile(proposalPath, '这是一个中文提案');

      // 用户显式声明为英文，应该覆盖文件检测
      const result = await resolveArtifactLanguage({
        projectRoot: TEST_DIR,
        userDeclaredLanguage: 'en',
      });
      expect(result).toBe('en');
    });

    it('Level 2: defaultLanguage 配置（非 auto）应该具有第二优先级', async () => {
      // 创建一个中文 proposal.md
      const proposalPath = join(TEST_DIR, 'proposal.md');
      await writeFile(proposalPath, '这是一个中文提案');

      // defaultLanguage 配置为英文，应该覆盖文件检测
      const result = await resolveArtifactLanguage({
        projectRoot: TEST_DIR,
        defaultLanguageConfig: 'en',
      });
      expect(result).toBe('en');
    });

    it('Level 2: defaultLanguage 为 auto 时应该继续解析', async () => {
      // 创建一个中文 proposal.md
      const proposalPath = join(TEST_DIR, 'proposal.md');
      await writeFile(proposalPath, '这是一个中文提案');

      // defaultLanguage 为 auto，应该继续到 Level 3
      const result = await resolveArtifactLanguage({
        projectRoot: TEST_DIR,
        defaultLanguageConfig: 'auto',
      });
      expect(result).toBe('zh');
    });

    it('Level 3: proposal.md 检测应该具有第三优先级', async () => {
      const proposalPath = join(TEST_DIR, 'proposal.md');
      await writeFile(proposalPath, '这是一个中文提案');

      const result = await resolveArtifactLanguage({ projectRoot: TEST_DIR });
      expect(result).toBe('zh');
    });

    it('Level 4: design.md 检测应该具有第四优先级', async () => {
      // proposal.md 不存在
      // design.md 存在且为中文
      const designPath = join(TEST_DIR, 'design.md');
      await writeFile(designPath, '这是一个中文设计文档');

      const result = await resolveArtifactLanguage({ projectRoot: TEST_DIR });
      expect(result).toBe('zh');
    });

    it('Level 5: tasks.md 检测应该具有第五优先级', async () => {
      // proposal.md 和 design.md 都不存在
      // tasks.md 存在且为中文
      const tasksPath = join(TEST_DIR, 'tasks.md');
      await writeFile(tasksPath, '这是一个中文任务列表');

      const result = await resolveArtifactLanguage({ projectRoot: TEST_DIR });
      expect(result).toBe('zh');
    });

    it('Level 6: 默认应该返回 en', async () => {
      // 所有文件都不存在
      const result = await resolveArtifactLanguage({ projectRoot: TEST_DIR });
      expect(result).toBe('en');
    });

    it('应该正确处理优先级覆盖：用户声明 > 配置 > 文件检测', async () => {
      // 创建中文文件
      const proposalPath = join(TEST_DIR, 'proposal.md');
      await writeFile(proposalPath, '这是中文');

      // 用户声明英文 > 配置中文 > 文件中文
      const result = await resolveArtifactLanguage({
        projectRoot: TEST_DIR,
        userDeclaredLanguage: 'en',
        defaultLanguageConfig: 'zh',
      });
      expect(result).toBe('en');
    });

    it('应该正确处理优先级覆盖：配置 > 文件检测', async () => {
      // 创建中文文件
      const proposalPath = join(TEST_DIR, 'proposal.md');
      await writeFile(proposalPath, '这是中文');

      // 配置英文 > 文件中文
      const result = await resolveArtifactLanguage({
        projectRoot: TEST_DIR,
        defaultLanguageConfig: 'en',
      });
      expect(result).toBe('en');
    });
  });

  describe('checkAndDetectLanguage - 补检测逻辑', () => {
    it('如果已有语言值，应该返回 null（无需补检测）', async () => {
      const result = await checkAndDetectLanguage(TEST_DIR, 'zh');
      expect(result).toBeNull();
    });

    it('如果语言值缺失，应该进行检测', async () => {
      // 创建中文 proposal.md
      const proposalPath = join(TEST_DIR, 'proposal.md');
      await writeFile(proposalPath, '这是一个中文提案');

      const result = await checkAndDetectLanguage(TEST_DIR, undefined);
      expect(result).toBe('zh');
    });

    it('如果语言值缺失且无文件，应该返回默认 en', async () => {
      const result = await checkAndDetectLanguage(TEST_DIR, undefined);
      expect(result).toBe('en');
    });
  });

  describe('Edge Cases', () => {
    it('应该正确处理包含大量空白和换行的文件', async () => {
      const filePath = join(TEST_DIR, 'whitespace-heavy.md');
      await writeFile(
        filePath,
        `
        
        
这是一个中文文件包含足够多的中文字符以确保超过阈值
        
        
包含很多空白
        
        
      `
      );
      const result = await detectFileLanguage(filePath);
      expect(result).toBe('zh');
    });

    it('应该正确处理包含代码块的文件', async () => {
      const filePath = join(TEST_DIR, 'code-block.md');
      await writeFile(
        filePath,
        `
# 这是一个中文标题

\`\`\`typescript
const message = "Hello World";
console.log(message);
\`\`\`

这是中文描述文字。
      `
      );
      const result = await detectFileLanguage(filePath);
      // 中文比例：8 / 总字符数 ≈ 0.2，低于阈值
      expect(result).toBe('en');
    });

    it('应该正确处理 Markdown 格式的文件', async () => {
      const filePath = join(TEST_DIR, 'markdown.md');
      await writeFile(
        filePath,
        `
# 标题测试文档

## 副标题内容

- 列表项一内容
- 列表项二内容

**粗体文字** 和 *斜体文字*

[链接描述](https://example.com)

这是一段中文描述文字，包含足够多的内容。
      `
      );
      const result = await detectFileLanguage(filePath);
      expect(result).toBe('zh');
    });
  });
});
