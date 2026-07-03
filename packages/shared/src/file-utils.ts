/**
 * File utilities for sFlow
 *
 * Unified on Node.js fs/promises to avoid mixed Bun/Node runtime behavior.
 */

import { access, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Check if file exists
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read file content
 */
export async function readFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Write file content
 */
export async function writeFile(path: string, content: string): Promise<boolean> {
  try {
    await writeFile(path, content, 'utf-8');
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
    await writeFile(tmp, content, 'utf-8');
    await rename(tmp, path);
    return true;
  } catch {
    // Clean up temp file on failure
    try {
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
    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
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
    await mkdir(dirPath, { recursive: true });
  } catch {
    // Directory might already exist or be created concurrently
  }
}
