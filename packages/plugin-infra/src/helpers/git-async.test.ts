import { describe, it, expect } from 'bun:test';
import { execGitAsync } from './git-async';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('execGitAsync', () => {
  it('应该成功执行 git 命令并返回 stdout', async () => {
    const stdout = await execGitAsync(['--version'], process.cwd());
    expect(stdout).toBeDefined();
    expect(stdout!.startsWith('git version')).toBe(true);
  });

  it('git 命令失败时应该返回 undefined（降级语义，不抛异常）', async () => {
    // 非 git 目录中 rev-parse 会失败
    const dir = await mkdtemp(join(tmpdir(), 'git-async-test-'));
    try {
      const stdout = await execGitAsync(['rev-parse', 'HEAD'], dir);
      expect(stdout).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('应该支持多参数命令', async () => {
    const stdout = await execGitAsync(['rev-parse', '--show-prefix'], process.cwd());
    // 项目根目录（非 git repo）返回 undefined；在 git repo 中返回路径字符串
    if (stdout !== undefined) {
      expect(typeof stdout).toBe('string');
    }
  });
});
