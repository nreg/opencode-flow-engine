/**
 * Runtime detection and cross-runtime helpers for sFlow.
 *
 * sFlow is designed primarily for Bun, but some deployments (e.g. OpenCode
 * running on Node.js) may not have Bun's native APIs available. This module
 * provides runtime-agnostic wrappers for Bun-specific functionality.
 */

/** Check whether Bun runtime is available */
export const isBun: boolean = typeof Bun !== 'undefined' && typeof Bun.file === 'function';

/**
 * Cross-runtime sleep. Bun has Bun.sleep(ms), Node.js uses setTimeout.
 */
export function sleep(ms: number): Promise<void> {
  if (isBun) {
    return (Bun as unknown as { sleep(ms: number): Promise<void> }).sleep(ms);
  }
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Read a file's text content. Falls back to fs/promises when Bun is unavailable.
 */
export async function readTextFile(path: string): Promise<string | null> {
  if (isBun) {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
    return null;
  }
  try {
    const { readFile: fsRead } = await import('fs/promises');
    return await fsRead(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Check if a file exists.
 */
export async function checkFileExists(path: string): Promise<boolean> {
  if (isBun) {
    const file = Bun.file(path);
    return await file.exists();
  }
  try {
    const { access } = await import('fs/promises');
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write text content to a file.
 */
export async function writeTextFile(path: string, content: string): Promise<boolean> {
  if (isBun) {
    try {
      await Bun.write(path, content);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const { writeFile: fsWrite } = await import('fs/promises');
    await fsWrite(path, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a child process. Returns { pid, exited } interface.
 * On Bun, uses Bun.spawn. On Node.js, uses child_process.spawn.
 */
export async function spawnProcess(
  command: string,
  args: string[],
  env?: Record<string, string | undefined>,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{
  pid: number | undefined;
  exited: Promise<number | null>;
  kill: (signal?: number) => void;
  stdout: any;
  stderr: any;
}> {
  if (isBun) {
    const proc = Bun.spawn([command, ...args], {
      env: { ...process.env, ...env } as Record<string, string>,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return {
      pid: proc.pid,
      exited: proc.exited as Promise<number | null>,
      kill: (signal?: number) => proc.kill(signal),
      stdout: proc.stdout.getReader(),
      stderr: proc.stderr.getReader(),
    };
  }

  // Node.js fallback
  const { spawn } = await import('child_process');
  const child = spawn(command, args, {
    env: { ...process.env, ...env } as Record<string, string>,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let exitedResolve: (code: number | null) => void;
  const exited = new Promise<number | null>(resolve => { exitedResolve = resolve; });
  child.on('exit', (code) => exitedResolve(code));
  child.on('error', () => exitedResolve(null));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stdoutReader: any = child.stdout
    ? new ReadableStream({ start(controller) { child.stdout!.on('data', (chunk: Buffer) => controller.enqueue(chunk)); child.stdout!.on('end', () => controller.close()); } }).getReader()
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stderrReader: any = child.stderr
    ? new ReadableStream({ start(controller) { child.stderr!.on('data', (chunk: Buffer) => controller.enqueue(chunk)); child.stderr!.on('end', () => controller.close()); } }).getReader()
    : null;

  return {
    pid: child.pid,
    exited,
    kill: (signal?: number) => {
      if (signal === 9) {
        child.kill('SIGKILL');
      } else {
        child.kill('SIGTERM');
      }
    },
    stdout: stdoutReader,
    stderr: stderrReader,
  };
}
