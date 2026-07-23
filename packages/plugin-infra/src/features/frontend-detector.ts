/**
 * Frontend Project Detector
 *
 * Detects whether a project is a frontend project by checking three dimensions:
 * 1. Frontend file extensions (.tsx/.jsx/.vue/.svelte/.css/.scss/.less/.html)
 * 2. Frontend config files (tailwind.config / vite.config / next.config / nuxt.config)
 * 3. Frontend dependencies in package.json (react/vue/svelte/next/nuxt/tailwindcss/@angular/core)
 *
 * Results are cached in memory per changeDir for the duration of a session.
 * The cache is cleared when clearFrontendCache() is called (typically on session end).
 */

import { fileExists, readJsonFile } from '@opencode-flow-engine/shared';
import * as path from 'path';
import { readdir, stat } from 'node:fs/promises';

const frontendCache = new Map<string, boolean>();

/**
 * Recursively scan a directory for files matching a given extension, up to maxDepth.
 */
async function findFilesByExtension(dir: string, ext: string, maxDepth: number, currentDepth: number = 0): Promise<boolean> {
  if (currentDepth > maxDepth) return false;

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip node_modules and hidden directories
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      if (entry.isFile() && entry.name.endsWith(ext)) {
        return true;
      }

      if (entry.isDirectory()) {
        const found = await findFilesByExtension(path.join(dir, entry.name), ext, maxDepth, currentDepth + 1);
        if (found) return true;
      }
    }
  } catch {
    // Directory might not exist or be unreadable
  }

  return false;
}

/**
 * Check if a file matching a glob-like pattern exists in the directory.
 * Supports patterns like 'tailwind.config.*', 'vite.config.*' etc.
 *
 * C2 fix: The pattern must end with '.*' (glob wildcard). When it does,
 * we list directory entries and match by prefix. When it doesn't,
 * we fall back to exact file existence check.
 */
async function findConfigFile(dir: string, pattern: string): Promise<boolean> {
  if (pattern.endsWith('.*')) {
    // Glob pattern: e.g. 'tailwind.config.*' → prefix = 'tailwind.config.'
    const prefix = pattern.slice(0, -2); // Remove trailing '.*'
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith(prefix)) {
          return true;
        }
      }
    } catch {
      // Directory might not exist or be unreadable
    }
    return false;
  }

  // Exact match (no glob)
  return fileExists(path.join(dir, pattern));
}

/**
 * Detect if the project at changeDir is a frontend project.
 *
 * Detection strategy (three dimensions, any hit returns true):
 * 1. Frontend file extensions — glob scan with maxDepth=3
 * 2. Frontend config files — check for well-known config file patterns
 * 3. Frontend dependencies — check package.json dependencies/devDependencies
 *
 * Results are cached per changeDir for the session lifetime.
 */
export async function isFrontendProject(changeDir: string): Promise<boolean> {
  if (frontendCache.has(changeDir)) return frontendCache.get(changeDir)!;

  // 1. Extension detection
  const frontendExtensions = ['.tsx', '.jsx', '.vue', '.svelte', '.css', '.scss', '.less', '.html'];
  for (const ext of frontendExtensions) {
    const found = await findFilesByExtension(changeDir, ext, 3);
    if (found) {
      frontendCache.set(changeDir, true);
      return true;
    }
  }

  // 2. Config file detection
  const configPatterns = ['tailwind.config.*', 'vite.config.*', 'next.config.*', 'nuxt.config.*'];
  for (const pattern of configPatterns) {
    const found = await findConfigFile(changeDir, pattern);
    if (found) {
      frontendCache.set(changeDir, true);
      return true;
    }
  }

  // 3. package.json frontend dependency detection
  const pkgPath = path.join(changeDir, 'package.json');
  if (await fileExists(pkgPath)) {
    const pkg = await readJsonFile<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(pkgPath);
    if (pkg) {
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const frontendDeps = ['react', 'vue', 'svelte', 'next', 'nuxt', 'tailwindcss', '@angular/core'];
      for (const dep of frontendDeps) {
        if (dep in deps) {
          frontendCache.set(changeDir, true);
          return true;
        }
      }
    }
  }

  frontendCache.set(changeDir, false);
  return false;
}

/**
 * Clear the frontend detection cache.
 * Should be called on session end to prevent stale cache across sessions.
 */
export function clearFrontendCache(): void {
  frontendCache.clear();
}
