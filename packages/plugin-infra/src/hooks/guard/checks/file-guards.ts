/**
 * File-related guard checks.
 * Extracted from guard.ts for maintainability.
 */

import type { HookResult } from "../../types.js";
import { fileExists, readJsonFile, readFile } from "@opencode-flow-engine/shared";
import { getStateFilePath } from "../../../features/state-manager.js";
import { isArtifactPath, isSourceCodePath, simpleContractHash } from "../helpers.js";
import { parseFileBoundaryPatterns, matchesBoundary, getActiveTaskId, boundaryCache, getBoundaryCacheKey, READ_FILES_WHITELIST } from "../boundary.js";
import { checkIFlowFileWriteGuard } from "../iflow-shared-guards.js";
import { readArtifactContent, artifactExists } from "../../../features/state-manager/artifact-paths.js";

/**
 * File-level write guard — consolidated from previously inline logic in index.ts.
 *
 * Checks:
 * - C4: Planning phases (exploring/specifying/bridging) block source code writes
 * - Terminal states (closing/abandoned) block all writes
 * - C5: Debugging state only allows bug-investigator and build-executor agents
 * - Illegal phase jump: full mode executing without design.md
 */
export async function checkFileWriteGuard(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  if (activeWorkflow === 'iflow') {
    return checkIFlowFileWriteGuard(changeDir, data);
  }

  const toolName = data.toolName as string | undefined;
  // File boundary and state guard apply to write/edit/rename/delete
  const modifyingTools = ['write', 'edit', 'rename', 'delete'];
  if (!toolName || !modifyingTools.includes(toolName)) return { success: true };

  const filePath = (data.filePath as string) || '';
  const agent = (data.agent as string) || '';
  if (!filePath) return { success: true };

  const stateData = await readJsonFile<{ state?: string; mode?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  if (!stateData?.state) return { success: true };

  const currentState = stateData.state;
  const isArtifact = isArtifactPath(filePath, changeDir);
  const isSourceCode = !isArtifact && isSourceCodePath(filePath);

  if (isSourceCode) {
    // C4: Planning phases block source code writes
    if (currentState === 'exploring' || currentState === 'specifying' || currentState === 'bridging') {
      return {
        success: false, block: true,
        blockReason: `[SFLOW] Write blocked: workflow is in "${currentState}" state. Planning phases do not allow source code changes. Complete planning artifacts first.`,
      };
    }

    // C5: Debugging state — only allow for bug-investigator and build-executor
    if (currentState === 'debugging') {
      const allowedAgents = ['bug-investigator', 'build-executor'];
      const isAllowed = agent && allowedAgents.some(a => agent.toLowerCase().includes(a));
      if (!isAllowed) {
        return {
          success: false, block: true,
          blockReason: `[SFLOW] Write blocked: workflow is in "debugging" state and current agent (${agent || 'unknown'}) is not a debugging agent. Only bug-investigator and build-executor can modify source code during debugging.`,
        };
      }
    }

    // Illegal phase jump: full mode executing without design.md
    if (stateData.mode === 'full' && currentState === 'executing') {
      const designExists = await artifactExists(changeDir, 'design.md');
      if (!designExists) {
        return {
          success: false, block: true,
          blockReason: `[SFLOW] Write blocked: illegal phase jump detected. Full workflow in "executing" but design.md is missing. Route back to specifying to complete planning artifacts.`,
        };
      }
    }

    // File Boundary Control — applies during executing AND debugging
    if (currentState === 'executing' || currentState === 'debugging') {
      // P16: If no execution-contract.md found, block writes and require regeneration
      const contractExists = await artifactExists(changeDir, 'execution-contract.md');
      if (!contractExists) {
        return {
          success: false, block: true,
          blockReason: `[SFLOW] Write blocked: workflow is in "${currentState}" state but execution-contract.md is missing. Route back to bridging to regenerate the contract.`,
        };
      }
      const br = await checkFileBoundary(changeDir, filePath);
      if (br) return br;
    }
  }


  // Terminal states block all writes (including artifacts)
  if (currentState === 'closing' || currentState === 'abandoned') {
    return {
      success: false, block: true,
      blockReason: `[SFLOW] Write blocked: workflow is in terminal state "${currentState}". No further changes allowed.`,
    };
  }

  return { success: true };
}

/**
 * P19: Read files boundary check — warns when agent reads files
 * outside the declared read_files in execution-contract.md.
 */
export async function checkReadFilesBoundary(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  const hasContract = await artifactExists(changeDir, 'execution-contract.md');
  if (!hasContract) return { success: true };

  const toolName = data.toolName as string | undefined;
  if (toolName !== 'read') return { success: true };

  const filePath = (data.filePath as string) || '';
  if (!filePath) return { success: true };

  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  if (!stateData?.state) return { success: true };

  const currentState = stateData.state;
  // Only apply in executing/debugging states where active task tracking exists
  if (currentState !== 'executing' && currentState !== 'debugging') return { success: true };

  // Don't warn about reading artifacts or .flow-engine/sflow files
  if (isArtifactPath(filePath, changeDir) || filePath.includes('.flow-engine/sflow/')) return { success: true };

  // P39: Check whitelist first — config/infra files are always readable
  const relPathForWhitelist = filePath.replace(changeDir.replace(/\\/g, '/'), '').replace(/^[\/\\]/, '');
  const normalizedFilePath = relPathForWhitelist || filePath.replace(/\\/g, '/').split('/').pop() || '';
  const isInWhitelist = READ_FILES_WHITELIST.some(wl => {
    if (wl.endsWith('/')) {
      // Directory prefix match
      return normalizedFilePath.startsWith(wl) || normalizedFilePath.includes('/' + wl.substring(0, wl.length - 1));
    }
    return normalizedFilePath === wl || normalizedFilePath.endsWith('/' + wl);
  });
  if (isInWhitelist) {
    return { success: true }; // Whitelisted, skip warning
  }

  // Parse read_files from execution-contract.md
  const activeTaskId = await getActiveTaskId(changeDir);
  const patterns = await getActiveTaskReadFiles(changeDir, activeTaskId);
  if (!patterns || patterns.length === 0) return { success: true };

  if (!matchesBoundary(filePath, patterns)) {
    return {
      success: true,
      warnings: [`[SFLOW] Read outside declared read_files: ${filePath}. Allowed: ${patterns.join(', ')}`],
    };
  }

  return { success: true };
}

/**
 * P20: Git diff boundary verify at commit time — blocks git commit when
 * staged files include paths outside the active task's write_files.
 */
export async function checkGitCommitBoundary(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  const hasContract = await artifactExists(changeDir, 'execution-contract.md');
  if (!hasContract) return { success: true };

  const toolName = data.toolName as string | undefined;
  if (toolName !== 'bash') return { success: true };

  const command = (data.command as string) || '';
  if (!command) return { success: true };

  // Detect git commit commands (with -m flag, or commit with -c/--amend)
  if (!/\bgit\s+commit\s+/.test(command)) return { success: true };

  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  if (!stateData?.state) return { success: true };

  const currentState = stateData.state;
  if (currentState !== 'executing' && currentState !== 'debugging') return { success: true };

  // Get staged files using git status
  //
  // P17: changeDir may be under .flow-engine/sflow/changes/<id> (not the git root).
  // Use `git rev-parse --show-toplevel` to find the real repo root,
  // then run `git diff --cached` from there.
  try {
    const { execSync } = await import('child_process');
    const gitRoot = execSync('git rev-parse --show-toplevel', { cwd: changeDir, encoding: 'utf8' }).trim();
    if (!gitRoot) return { success: true };

    const stagedOutput = execSync('git diff --cached --name-only', { cwd: gitRoot, encoding: 'utf8' }).trim();
    if (!stagedOutput) return { success: true };

    const stagedFiles = stagedOutput.split('\n').filter((l: string) => l.trim());

    // Parse write_files from execution-contract.md
    const activeTaskId = await getActiveTaskId(changeDir);
    const allowedPatterns = await getActiveTaskWriteFiles(changeDir, activeTaskId);
    if (!allowedPatterns || allowedPatterns.length === 0) return { success: true };

    // Use global patterns if no task-level patterns found
    const globalPatterns = await getGlobalWriteFiles(changeDir);
    const allPatterns = [...allowedPatterns, ...globalPatterns];
    if (allPatterns.length === 0) return { success: true };

    const violated = stagedFiles.filter((f: string) => !matchesBoundary(f, allPatterns));
    if (violated.length > 0) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Git commit blocked: staged files outside write_files boundary: ${violated.join(', ')}. Allowed: ${allPatterns.join(', ')}. Move these files out of staging or update execution-contract.md first.`,
      };
    }
  } catch (err) {
    console.warn('[SFLOW] P19: git boundary check skipped — ' + (err instanceof Error ? err.message : String(err)));
  }

  return { success: true };
}

/**
 * Get read_files patterns for the active task from execution-contract.md.
 */
async function getActiveTaskReadFiles(changeDir: string, taskId: string | null): Promise<string[] | null> {
  const cc = await readArtifactContent(changeDir, 'execution-contract.md');
  if (!cc) return null;
  const parsed = parseFileBoundaryPatterns(cc);

  if (taskId && parsed.taskBoundaries.has(taskId + ':read')) {
    return parsed.taskBoundaries.get(taskId + ':read')!;
  }
  return null;
}

/**
 * Get write_files patterns for the active task from execution-contract.md.
 */
async function getActiveTaskWriteFiles(changeDir: string, taskId: string | null): Promise<string[] | null> {
  const cc = await readArtifactContent(changeDir, 'execution-contract.md');
  if (!cc) return null;
  const parsed = parseFileBoundaryPatterns(cc);

  if (taskId && parsed.taskBoundaries.has(taskId)) {
    return parsed.taskBoundaries.get(taskId)!;
  }
  return null;
}

/**
 * Get global write_files patterns from execution-contract.md.
 */
async function getGlobalWriteFiles(changeDir: string): Promise<string[]> {
  const cc = await readArtifactContent(changeDir, 'execution-contract.md');
  if (!cc) return [];
  const parsed = parseFileBoundaryPatterns(cc);
  return parsed.globalPatterns;
}

/**
 * File boundary check helper.
 */
export async function checkFileBoundary(changeDir: string, filePath: string): Promise<HookResult | null> {
  const cc = await readArtifactContent(changeDir, 'execution-contract.md');
  if (!cc) return null;

  const contractHash = simpleContractHash(cc);
  const cacheKey = getBoundaryCacheKey(changeDir, contractHash);

  // Check cache first
  let cached = boundaryCache.get(cacheKey);
  if (!cached) {
    const parsed = parseFileBoundaryPatterns(cc);
    cached = {
      contractHash,
      taskBoundaries: parsed.taskBoundaries,
      globalPatterns: parsed.globalPatterns,
    };
    boundaryCache.set(cacheKey, cached);

    // Evict old cache entries for this changeDir (keep at most 3)
    const keys = [...boundaryCache.keys()].filter(k => k.startsWith(changeDir + ':'));
    if (keys.length > 3) {
      for (const oldKey of keys.slice(0, keys.length - 3)) {
        boundaryCache.delete(oldKey);
      }
    }
  }

  // Task-level isolation: try to get the active task's boundary first
  const activeTaskId = await getActiveTaskId(changeDir);
  let allowedPatterns: string[] | null = null;

  if (activeTaskId && cached.taskBoundaries.has(activeTaskId)) {
    allowedPatterns = cached.taskBoundaries.get(activeTaskId)!;
  }

  // Fall back to global patterns
  if (!allowedPatterns || allowedPatterns.length === 0) {
    allowedPatterns = cached.globalPatterns;
  }

  if (allowedPatterns.length === 0) return null;

  if (!matchesBoundary(filePath, allowedPatterns)) {
    const boundarySource = activeTaskId && cached.taskBoundaries.has(activeTaskId!)
      ? `task ${activeTaskId} write_files`
      : 'global write_files';
    return {
      success: false, block: true,
      blockReason: `[SFLOW] File Boundary: ${filePath} not in ${boundarySource}. Allowed: ${allowedPatterns.join(', ')}`,
    };
  }
  return null;
}
