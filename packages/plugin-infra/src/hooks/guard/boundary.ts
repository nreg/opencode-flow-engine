/**
 * File Boundary Control — parse and match file boundary patterns from execution-contract.md.
 * Extracted from guard.ts for maintainability.
 *
 * Supports 6 format variants: XML, YAML, inline, task table, legacy, and task blocks.
 */

import { readFile } from "@opencode-flow-engine/shared";

export interface BoundaryCacheEntry {
  contractHash: string;
  taskBoundaries: Map<string, string[]>;
  globalPatterns: string[];
}

export const boundaryCache = new Map<string, BoundaryCacheEntry>();
export const READ_FILES_WHITELIST = [
  'tsconfig.json', 'tsconfig.build.json', 'tsconfig.node.json', 'jsconfig.json',
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock',
  '.npmrc', '.yarnrc', '.pnpmfile.cjs',
  'babel.config.js', 'babel.config.json', '.babelrc', '.babelrc.json',
  'eslint.config.js', '.eslintrc', '.eslintrc.json', '.eslintrc.js',
  'prettier.config.js', '.prettierrc', '.prettierrc.json',
  '.editorconfig', '.gitignore', '.gitattributes', '.gitmodules',
  'README.md', 'CHANGELOG.md', 'LICENSE', 'CONTRIBUTING.md',
  'vite.config.ts', 'vite.config.js', 'vite.config.mjs',
  'webpack.config.js', 'rollup.config.js', 'rollup.config.mjs',
  'jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js',
  'mocha.opts', '.mocharc.js', '.mocharc.json',
  '.env', '.env.local', '.env.development', '.env.production', '.env.test',
  '.env.example',
  'opencode.json', '.opencode.json', '.vscode/',
  'node_modules/', '.git/',
];

export function getBoundaryCacheKey(changeDir: string, contractHash: string): string {
  return changeDir + ':' + contractHash;
}

/**
 * Parse task-level and global file boundary patterns from execution-contract.md.
 */
export function parseFileBoundaryPatterns(contractContent: string): {
  taskBoundaries: Map<string, string[]>;
  globalPatterns: string[];
} {
  const globalPatterns: string[] = [];
  const taskBoundaries = new Map<string, string[]>();

  const parseCell = (cell: string): string[] => {
    const pats: string[] = [];
    const backtickPaths = cell.match(/`([^`]+)`/g);
    if (backtickPaths) {
      for (const bp of backtickPaths) pats.push(bp.replace(/`/g, ''));
    }
    const bareParts = cell.replace(/`[^`]+`/g, '').trim();
    if (bareParts) {
      for (const part of bareParts.split(/\s+/)) {
        const t = part.trim();
        if (t && (t.includes('/') || t.includes('\\') || /\.\w{1,4}$/.test(t))) pats.push(t);
      }
    }
    return pats;
  };

  // Format 1: XML-style task blocks
  const taskBlockRegex = /<!--\s*Task\s+(T\d+)\s*-->([\s\S]*?)<!--\s*\/Task\s+\1\s*-->/g;
  let taskBlockMatch: RegExpExecArray | null;
  while ((taskBlockMatch = taskBlockRegex.exec(contractContent)) !== null) {
    const taskId = taskBlockMatch[1];
    const blockContent = taskBlockMatch[2] || '';
    const taskPats: string[] = [];
    for (const m of blockContent.matchAll(/<write_files>([\s\S]*?)<\/write_files>/g)) {
      for (const l of (m[1] || '').split('\n')) {
        const t = l.trim();
        if (t && !t.startsWith('<')) taskPats.push(t);
      }
    }
    const yamlMatch = blockContent.match(/write_files:\s*\n([\s\S]*?)(?=\n\S|\n*$)/);
    if (yamlMatch && yamlMatch[1]) {
      for (const l of yamlMatch[1].split('\n')) {
        const t = l.replace(/^[-\s]*/, '').trim();
        if (t && !t.startsWith('#') && !t.startsWith('write_files')) taskPats.push(t);
      }
    }
    if (taskPats.length > 0 && taskId) taskBoundaries.set(taskId, taskPats);
  }

  // Strip task blocks for global pattern extraction
  const strippedContent = contractContent.replace(/<!--\s*Task\s+T\d+\s*-->[\s\S]*?<!--\s*\/Task\s+T\d+\s*-->/g, '');

  // Format 2: Global XML-style
  for (const m of strippedContent.matchAll(/<write_files>([\s\S]*?)<\/write_files>/g)) {
    for (const l of (m[1] || '').split('\n')) {
      const t = l.trim();
      if (t && !t.startsWith('<')) globalPatterns.push(t);
    }
  }

  // Format 3: Global YAML-style
  for (const m of strippedContent.matchAll(/^write_files:\s*\n([\s\S]*?)(?=\n\S|\n*$)/gm)) {
    for (const l of (m[1] || '').split('\n')) {
      const t = l.replace(/^[-\s]*/, '').trim();
      if (t && !t.startsWith('#') && !t.startsWith('write_files') && !t.startsWith('<')) globalPatterns.push(t);
    }
  }

  // Format 4: Inline list
  const inlineMatch = strippedContent.match(/write_files:\s*\[([^\]]+)\]/);
  if (inlineMatch && inlineMatch[1]) {
    for (const p of inlineMatch[1].split(',')) {
      const t = p.trim().replace(/['"]/g, '');
      if (t) globalPatterns.push(t);
    }
  }

  // Format 5: Task table with dynamic header parsing
  const tableMatch = contractContent.match(/^\|?\s*Task\s*\|[\s\S]*?(?=\n\n|\n#|\n##|$)/m);
  if (tableMatch) {
    const lines = tableMatch[0].split('\n').filter(l => l.trim().startsWith('|'));
    if (lines.length >= 2) {
      const headerLine = lines[0] || '';
      const headers = (headerLine || '').split('|').map(h => h.trim().toLowerCase());
      let writeFilesColIndex = headers.findIndex(h => h.includes('write') || h.includes('写') || h.includes('修改'));
      let readFilesColIndex = headers.findIndex(h => h.includes('read') || h.includes('读') || h.includes('参考'));
      let taskColIndex = headers.findIndex(h => h.includes('task') || h.includes('任务') || h.includes('id'));
      if (writeFilesColIndex === -1) writeFilesColIndex = 4;
      if (readFilesColIndex === -1) readFilesColIndex = 3;
      if (taskColIndex === -1) taskColIndex = 1;

      for (let i = 2; i < lines.length; i++) {
        const cols = (lines[i] || '').split('|').map(c => c.trim());
        if (cols.length > Math.max(writeFilesColIndex, readFilesColIndex, taskColIndex)) {
          const taskIdMatch = cols[taskColIndex]?.match(/(T\d+)/);
          const taskId = taskIdMatch?.[1];
          if (!taskId) continue;
          const writeCol = cols[writeFilesColIndex];
          if (writeCol) {
            const pats = parseCell(writeCol);
            if (pats.length > 0) taskBoundaries.set(taskId, pats);
          }
          const readCol = cols[readFilesColIndex];
          if (readCol) {
            const readPats = parseCell(readCol);
            if (readPats.length > 0) taskBoundaries.set(taskId + ':read', readPats);
          }
        }
      }
    }
  }

  // Format 6: Legacy fallback
  if (globalPatterns.length === 0 && taskBoundaries.size === 0) {
    const ms = strippedContent.match(/write_files:[\s\S]*?(?=\n\w|$)/);
    if (ms) {
      for (const l of ms[0].split('\n')) {
        const t = l.replace(/^- /, '').trim();
        if (t && !t.startsWith('write_files')) globalPatterns.push(t);
      }
    }
  }

  return {
    taskBoundaries,
    globalPatterns: [...new Set(globalPatterns)],
  };
}

/**
 * Check if a file path matches any allowed boundary pattern.
 */
export function matchesBoundary(filePath: string, patterns: string[]): boolean {
  let rel = filePath.replace(/\\/g, '/').toLowerCase();
  rel = rel.replace(/^[a-z]:\//, '/');
  const knownSourcePrefixes = ['/src/', '/packages/', '/lib/', '/app/', '/components/', '/test/', '/tests/', '__tests__/'];
  if (rel.startsWith('/')) {
    const parts = rel.split('/');
    const srcIdx = parts.findIndex(p => knownSourcePrefixes.some(pre => p.startsWith(pre) || p === pre.replace(/[\/]/g, '')));
    if (srcIdx > 0 && srcIdx < parts.length - 1) {
      rel = parts.slice(srcIdx).join('/');
    }
  }
  rel = rel.replace(/^\.\//, '');

  return patterns.some(p => {
    const np = p.replace(/\\/g, '/').toLowerCase().replace(/^\.\//, '');
    if (rel === np || rel.endsWith('/' + np)) return true;
    if (np.endsWith('/*') && rel.startsWith(np.slice(0, -1))) return true;
    if (np.endsWith('/') && rel.startsWith(np)) return true;
    if (np.includes('*')) {
      const escaped = np
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
        .replace(/\*/g, '[^/]*')
        .replace(/<<<DOUBLESTAR>>>/g, '.*');
      try {
        if (new RegExp('^' + escaped + '$', 's').test(rel)) return true;
      } catch { /* skip */ }
    }
    return false;
  });
}

/**
 * Get the active task ID from subagent-progress.md (with tasks.md fallback).
 */
export async function getActiveTaskId(changeDir: string): Promise<string | null> {
  const sp = await readFile(changeDir + '/.sflow/subagent-progress.md').catch(() => null);
  if (sp) {
    const planMatch = sp.match(/\*\*Plan task\*\*:\s*(T\d+)/i);
    if (planMatch?.[1]) return planMatch[1].toUpperCase();
  }
  const tasksContent = await readFile(changeDir + '/tasks.md').catch(() => null);
  if (tasksContent) {
    const firstUnchecked = tasksContent.match(/^-\s*\[\s*\]\s*(?:T\d+\s*[—-]?\s*)?(.+)/m);
    if (firstUnchecked) {
      const idMatch = firstUnchecked[0].match(/(T\d+)/);
      if (idMatch && idMatch[1]) return idMatch[1].toUpperCase();
    }
  }
  return null;
}
