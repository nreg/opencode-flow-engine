/**
 * execGitAsync - 异步执行 git 命令（不阻塞事件循环）
 *
 * 使用 child_process.execFile（Promise 化），替代 execFileSync/execSync
 * 在 async 函数内的同步阻塞调用。
 *
 * 降级语义：命令失败（非 git 环境、无效参数等）时返回 undefined，
 * 不抛异常，由调用方自行降级处理。
 */
export async function execGitAsync(args: string[], cwd: string): Promise<string | undefined> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return undefined;
  }
}
