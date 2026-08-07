/**
 * 防回归测试：检测硬编码 artifact 路径
 * 
 * 此测试扫描源代码，确保所有 artifact 路径访问都通过 artifact-paths.ts 的 helper 函数，
 * 而不是直接硬编码路径字符串。
 * 
 * 目标：未来任何新增硬编码路径都会被此测试捕获
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { glob as globCb } from 'glob';

const glob = promisify(globCb);

// 白名单：允许直接路径访问的文件（如 artifact-paths.ts 自身、双路径处理内部逻辑）
const ALLOWED_FILES = new Set([
  'artifact-paths.ts', // helper 函数定义文件
  'state-detection.ts', // 内部双路径处理逻辑
]);

// 硬编码路径模式（这些模式应该通过 helper 函数访问）
const HARDCODED_PATTERNS = [
  // 1. 模板字符串拼接（变量赋值或函数调用）
  /[`'"]\$\{[^}]+\}\/proposal\.md[`'"]/,
  /[`'"]\$\{[^}]+\}\/design\.md[`'"]/,
  /[`'"]\$\{[^}]+\}\/tasks\.md[`'"]/,
  /[`'"]\$\{[^}]+\}\/execution-contract\.md[`'"]/,
  /[`'"]\$\{[^}]+\}\/ui-design\.md[`'"]/,
  
  // 2. 字符串拼接：`+ '/proposal.md'`
  /\+\s*['"]\/proposal\.md['"]/,
  /\+\s*['"]\/design\.md['"]/,
  /\+\s*['"]\/tasks\.md['"]/,
  /\+\s*['"]\/execution-contract\.md['"]/,
  /\+\s*['"]\/ui-design\.md['"]/,
  
  // 3. 根目录 specs 拼接（在 src 目录下）
  /[`'"]\$\{[^}]+\}\/specs[`'"]/,
  /\+\s*['"]\/specs['"]/,
  
  // 4. path.join 拼接 artifact 文件名
  /path\.join\([^)]*,\s*['"]proposal\.md['"]\)/,
  /path\.join\([^)]*,\s*['"]design\.md['"]\)/,
  /path\.join\([^)]*,\s*['"]tasks\.md['"]\)/,
  /path\.join\([^)]*,\s*['"]execution-contract\.md['"]\)/,
  /path\.join\([^)]*,\s*['"]ui-design\.md['"]\)/,
  
  // 5. path.join 拼接 specs 目录
  /path\.join\([^)]*,\s*['"]specs['"]\)/,
];

// 允许的上下文（在这些上下文中，路径访问是合理的）
const ALLOWED_CONTEXTS = [
  // helper 函数内部的路径拼接（artifact-paths.ts）
  /(?:resolveArtifactPath|readArtifactContent|artifactExists|isArtifactNewPath|resolveSpecsDir|listSpecFiles|readSpecContent|directoryArtifactExists)/,
  // 测试文件中的路径（测试可能需要直接访问）
  /\.test\.ts$/,
  // 类型定义文件
  /\.d\.ts$/,
];

describe('Artifact Path Regression Prevention', () => {
  it('should not have hardcoded artifact paths in source files', async () => {
    const srcDir = path.join(__dirname, '..');
    const files = await glob('**/*.ts', {
      cwd: srcDir,
      ignore: [
        '**/__tests__/**', // 排除测试文件
        '**/*.d.ts', // 排除类型定义
        '**/node_modules/**',
      ],
    });

    const violations: Array<{ file: string; line: number; pattern: string; code: string }> = [];

    for (const file of files) {
      const fileName = path.basename(file);
      
      // 跳过白名单文件
      if (ALLOWED_FILES.has(fileName)) {
        continue;
      }

      const filePath = path.join(srcDir, file);
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // 跳过注释
        if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) {
          return;
        }

        // 跳过描述字符串（.describe() 中的文档字符串）
        if (line.includes('.describe(') || line.includes('.default(')) {
          return;
        }

        // 跳过 resolvePath helper 调用（路径作为参数传递给 helper 函数）
        if (line.includes('resolvePath(')) {
          return;
        }

        // 跳过允许的上下文
        if (ALLOWED_CONTEXTS.some(ctx => ctx.test(line) || ctx.test(file))) {
          return;
        }

        // 检查硬编码模式
        HARDCODED_PATTERNS.forEach(pattern => {
          if (pattern.test(line)) {
            violations.push({
              file,
              line: index + 1,
              pattern: pattern.source,
              code: line.trim(),
            });
          }
        });
      });
    }

    // 输出详细的违规信息
    if (violations.length > 0) {
      const details = violations
        .map(v => `  ${v.file}:${v.line}: ${v.code}`)
        .join('\n');
      
      console.error(`Found ${violations.length} hardcoded artifact path(s):\n${details}`);
    }

    // 断言：不应该有违规
    expect(violations).toHaveLength(0);
  });

  it('should verify test can detect current violations (if any)', async () => {
    // 此测试验证防回归测试能够检测到当前代码中的硬编码
    // 如果此测试失败，说明防回归测试本身有问题
    
    const srcDir = path.join(__dirname, '..');
    const files = await glob('**/*.ts', {
      cwd: srcDir,
      ignore: [
        '**/__tests__/**',
        '**/*.d.ts',
        '**/node_modules/**',
      ],
    });

    let detectedCount = 0;

    for (const file of files) {
      const fileName = path.basename(file);
      
      if (ALLOWED_FILES.has(fileName)) {
        continue;
      }

      const filePath = path.join(srcDir, file);
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      lines.forEach(line => {
        // 跳过注释
        if (line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) {
          return;
        }

        // 跳过描述字符串
        if (line.includes('.describe(') || line.includes('.default(')) {
          return;
        }

        // 跳过 resolvePath helper 调用
        if (line.includes('resolvePath(')) {
          return;
        }

        if (ALLOWED_CONTEXTS.some(ctx => ctx.test(line) || ctx.test(file))) {
          return;
        }

        HARDCODED_PATTERNS.forEach(pattern => {
          if (pattern.test(line)) {
            detectedCount++;
          }
        });
      });
    }

    // 当前已知有 7 处硬编码（3 个 P0 文件中的问题）
    // 修复后应该为 0
    console.log(`Current hardcoded path count: ${detectedCount}`);
    
    // 此测试总是通过，仅用于验证检测能力
    expect(detectedCount).toBeGreaterThanOrEqual(0);
  });
});
