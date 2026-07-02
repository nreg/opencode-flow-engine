/**
 * File utilities for sFlow
 */

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
 * List files in directory
 */
export async function listFiles(dirPath: string, extension?: string): Promise<string[]> {
  try {
    const dir = Bun.dir(dirPath);
    const files: string[] = [];
    
    for await (const file of dir) {
      if (file.isFile()) {
        if (!extension || file.name.endsWith(extension)) {
          files.push(file.name);
        }
      }
    }
    
    return files;
  } catch {
    return [];
  }
}

/**
 * Check if directory exists
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const dir = Bun.file(dirPath);
    return await dir.exists();
  } catch {
    return false;
  }
}

/**
 * Read and parse JSON file
 */
export async function readJsonFile<T = Record<string, unknown>>(path: string): Promise<T | null> {
  const content = await readFile(path);
  if (!content) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
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
 * Ensure directory exists (creates parent directories if needed)
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    const { mkdir } = await import('fs/promises');
    await mkdir(dirPath, { recursive: true });
  } catch {
  }
}
