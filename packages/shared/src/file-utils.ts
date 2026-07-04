/**
 * File utilities for sFlow
 *
 * Uses Bun's native file API consistently throughout.
 */

/**
 * Process-internal async mutex for serializing read-modify-write
 * operations on shared files (e.g. state.json).
 *
 * OpenCode runs plugins in a single process, so a lightweight
 * in-memory lock is sufficient to prevent concurrent write corruption.
 */
export class Mutex {
  private chain: Promise<void> = Promise.resolve();

  /** Acquire the lock. Resolves with a release function. */
  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    const prev = this.chain;
    this.chain = this.chain.then(() => next);
    await prev;
    return release;
  }

  /** Run `fn` while holding the lock. */
  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/** Global mutex for .sflow/state.json */
export const stateFileMutex = new Mutex();

/**
 * Check if file exists
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    const file = Bun.file(path);
    return await file.exists();
  } catch {
    return false;
  }
}

/**
 * Read file content
 */
export async function readFile(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write file content
 */
export async function writeFile(path: string, content: string): Promise<boolean> {
  try {
    await Bun.write(path, content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic write: write to temp file, then rename.
 * Prevents partial writes on crash.
 */
export async function atomicWriteFile(path: string, content: string): Promise<boolean> {
  const tmp = `${path}.tmp.${Date.now()}`;
  try {
    await Bun.write(tmp, content);
    const { rename } = await import('fs/promises');
    await rename(tmp, path);
    return true;
  } catch {
    // Clean up temp file on failure
    try {
      const { unlink } = await import('fs/promises');
      await unlink(tmp);
    } catch {
      // Ignore cleanup failure
    }
    return false;
  }
}

/**
 * List files in directory
 */
export async function listFiles(dirPath: string, extension?: string): Promise<string[]> {
  try {
    const { readdir } = await import('fs/promises');
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && (!extension || e.name.endsWith(extension)))
      .map(e => e.name);
  } catch {
    return [];
  }
}

/**
 * Check if directory exists
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const { stat } = await import('fs/promises');
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read and parse JSON file.
 * Returns { content: T } on success, null on file not found,
 * throws on parse error to distinguish between "missing" and "corrupt".
 */
export async function readJsonFile<T = Record<string, unknown>>(path: string): Promise<T | null> {
  const content = await readFile(path);
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch (parseError) {
    throw new Error(
      `Failed to parse JSON file: ${path}. Reason: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
    );
  }
}

/**
 * Write JSON file
 */
export async function writeJsonFile(path: string, data: unknown): Promise<boolean> {
  try {
    await Bun.write(path, JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic write JSON file
 */
export async function atomicWriteJsonFile(path: string, data: unknown): Promise<boolean> {
  return atomicWriteFile(path, JSON.stringify(data, null, 2));
}

/**
 * Ensure directory exists (creates parent directories if needed)
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    const { mkdir } = await import('fs/promises');
    await mkdir(dirPath, { recursive: true });
  } catch {
    // Directory might already exist or be created concurrently
  }
}
