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
 * Ensure directory exists
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    const dir = Bun.dir(dirPath);
    if (!(await dir.exists())) {
      await Bun.write(`${dirPath}/.gitkeep`, '');
    }
  } catch {
    // Directory creation will be handled by write operations
  }
}
