/**
 * Test for resolveChangeDir utility function
 * 
 * Validates the unified changeDir resolution logic:
 * Priority: explicitChangeDir > contextDirectory > cwd > throw error
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolveChangeDir } from '../resolve-change-dir.js';

describe('resolveChangeDir', () => {
  const originalCwd = process.cwd();
  const mockCwd = '/mock/cwd';

  beforeEach(() => {
    // Mock process.cwd
    process.cwd = () => mockCwd;
  });

  afterEach(() => {
    // Restore original process.cwd
    process.cwd = () => originalCwd;
  });

  describe('优先级 1: 显式 changeDir 参数', () => {
    it('当 explicitChangeDir 提供时，应优先使用该值', () => {
      const explicit = '/explicit/path';
      const contextDir = '/context/path';
      
      const result = resolveChangeDir(explicit, contextDir);
      
      expect(result).toBe(explicit);
    });

    it('显式 changeDir 应覆盖 context.directory', () => {
      const explicit = '/explicit/path';
      const contextDir = '/context/path';
      
      const result = resolveChangeDir(explicit, contextDir);
      
      expect(result).toBe(explicit);
      expect(result).not.toBe(contextDir);
    });

    it('显式 changeDir 应覆盖 cwd', () => {
      const explicit = '/explicit/path';
      
      const result = resolveChangeDir(explicit, undefined);
      
      expect(result).toBe(explicit);
      expect(result).not.toBe(mockCwd);
    });
  });

  describe('优先级 2: context.directory', () => {
    it('当无 explicitChangeDir 但有 contextDirectory 时，应使用 contextDirectory', () => {
      const contextDir = '/context/path';
      
      const result = resolveChangeDir(undefined, contextDir);
      
      expect(result).toBe(contextDir);
    });

    it('contextDirectory 应覆盖 cwd', () => {
      const contextDir = '/context/path';
      
      const result = resolveChangeDir(undefined, contextDir);
      
      expect(result).toBe(contextDir);
      expect(result).not.toBe(mockCwd);
    });

    it('空字符串 explicitChangeDir 应视为未提供，回退到 contextDirectory', () => {
      const contextDir = '/context/path';
      
      const result = resolveChangeDir('', contextDir);
      
      expect(result).toBe(contextDir);
    });
  });

  describe('优先级 3: cwd 回退', () => {
    it('当无 explicitChangeDir 和 contextDirectory 时，应回退到 cwd', () => {
      const result = resolveChangeDir(undefined, undefined);
      
      expect(result).toBe(mockCwd);
    });

    it('空字符串参数应视为未提供，回退到 cwd', () => {
      const result = resolveChangeDir('', '');
      
      expect(result).toBe(mockCwd);
    });
  });

  describe('错误处理', () => {
    it('当所有参数为空字符串且 cwd 不可用时，应抛出清晰错误', () => {
      // 临时移除 cwd
      const originalCwdFn = process.cwd;
      process.cwd = () => {
        throw new Error('cwd not available');
      };

      expect(() => {
        resolveChangeDir('', '');
      }).toThrow('Unable to resolve changeDir: no explicit path, no context directory, and cwd unavailable');

      // 恢复
      process.cwd = originalCwdFn;
    });
  });

  describe('边界条件', () => {
    it('应正确处理包含空格的路径', () => {
      const pathWithSpaces = '/path/with spaces/dir';

      const result = resolveChangeDir(pathWithSpaces, undefined);

      expect(result).toBe(pathWithSpaces);
    });

    it('应正确处理相对路径', () => {
      const relativePath = './relative/path';

      const result = resolveChangeDir(relativePath, undefined);

      expect(result).toBe(relativePath);
    });

    it('应正确处理 Windows 路径', () => {
      const windowsPath = 'C:\\Users\\admin\\project';

      const result = resolveChangeDir(windowsPath, undefined);

      expect(result).toBe(windowsPath);
    });
  });

  describe('相对路径处理（P1 补充）', () => {
    it('相对路径作为显式参数时，应原样返回（不转换为绝对路径）', () => {
      const relativePath = './relative/project';

      const result = resolveChangeDir(relativePath, '/absolute/context');

      expect(result).toBe(relativePath);
      expect(result).not.toBe('/absolute/context');
    });

    it('context.directory 为相对路径时，应原样返回（不转换为绝对路径）', () => {
      const relativeContextDir = './relative/context';

      const result = resolveChangeDir(undefined, relativeContextDir);

      expect(result).toBe(relativeContextDir);
      expect(result).not.toBe(mockCwd);
    });

    it('父目录相对路径（../）应原样返回', () => {
      const parentRelativePath = '../parent/project';

      const result = resolveChangeDir(parentRelativePath, undefined);

      expect(result).toBe(parentRelativePath);
    });
  });
});
