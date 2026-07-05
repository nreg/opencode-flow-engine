/**
 * Guard hook - Guard state transitions and block invalid operations
 * READ-ONLY: This hook NEVER writes state or artifacts. It only detects and reports.
 * State mutations (upgrades, repairs) happen through state-manager or workflow-manager.
 *
 * All file-level write guards (C4, C5, terminal state, illegal phase jump)
 * are consolidated here. Callers (index.ts) pass tool/agent/filePath info
 * through context.data and check the returned block flag.
 */

import type { HookHandler, HookContext, HookResult } from "./types.js";
import { fileExists, readFile, readJsonFile, directoryExists, isContractStale, getContractStalenessReport } from "@opencode-sflow/shared";
import { sharedValidator, HOTFIX_UPGRADE_THRESHOLDS, TWEAK_UPGRADE_THRESHOLDS } from "@opencode-sflow/core";
import { checkArtifactPreflight, findPreflightState } from "../features/artifact-preflight.js";
import { readProgressFile } from "../features/state-manager.js";

const SOURCE_CODE_PATTERNS = /\.(ts|js|tsx|jsx|mjs|cjs|mts|cts|py|java|kt|rs|go|rb|php|c|cpp|h|hpp|cs|swift|vue|svelte|css|scss|less)$/i;
const ARTIFACT_NAMES = new Set(['proposal.md', 'design.md', 'tasks.md', 'execution-contract.md']);

function isArtifactPath(filePath: string, changeDir: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const changeDirNorm = changeDir.replace(/\\/g, '/');
  if (normalized.includes('.sflow/') || normalized.endsWith('.sflow')) return true;
  const relative = normalized.startsWith(changeDirNorm)
    ? normalized.slice(changeDirNorm.length + 1)
    : normalized;
  const baseName = relative.split('/').pop() || '';
  if (ARTIFACT_NAMES.has(baseName)) return true;
  if (relative.startsWith('specs/') || relative === 'specs') return true;
  return false;
}

function isSourceCodePath(filePath: string): boolean {
  return SOURCE_CODE_PATTERNS.test(filePath);
}

/**
 * Create the guard hook
 */
export function createGuardHook(): HookHandler {
  return {
    name: "guard",
    description: "Guard state transitions and block invalid operations (read-only)",
    execute: async (context) => {
      const { changeDir, data } = context;

      try {
        const guards = [
          await checkArtifactAndPhaseConsistency(changeDir),
          await checkPresetUpgrade(changeDir),
          await checkContractStalenessGuard(changeDir),
          await checkTaskCompletion(changeDir),
          await checkDebuggingState(changeDir, context.action, data),
          await checkProgressAntiRepeatGuard(changeDir, data),
          await checkFileWriteGuard(changeDir, data),
        ];

        const blockingGuards = guards.filter((g) => g.block);
        if (blockingGuards.length > 0) {
          return {
            success: false,
            error: "Guard conditions not met",
            block: true,
            blockReason: blockingGuards.map((g) => g.blockReason).join("; "),
          };
        }

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Combined artifact existence + phase consistency check.
 * Merges checkArtifactExistence (C6 dedup) and checkPhaseConsistency into one pass.
 * Covers both: "does the artifact exist at this state" and "full mode consistency".
 */
async function checkArtifactAndPhaseConsistency(changeDir: string): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const dirExists = await fileExists(changeDir);
  if (!dirExists) return { success: true };

  const stateData = await readJsonFile<{ state?: string; mode?: string }>(`${changeDir}/.sflow/state.json`);
  const currentState = stateData?.state || "exploring";
  const mode = stateData?.mode;

    // Phase 1: Use shared checkArtifactPreflight — returns existence map to avoid redundant I/O
  const pf = await checkArtifactPreflight({ changeDir, targetState: currentState, fileExists, directoryExists, readJson: readJsonFile });
  if (!pf.passed) {
    return { success: false, block: true, blockReason: 'Missing required artifacts: ' + pf.missing.join(', ') };
  }

  // Phase 2: Full mode consistency — reuse pf.existence to avoid redundant stat calls
  if (mode === "full" && currentState && currentState !== "exploring" && currentState !== "abandoned") {
    const ex = pf.existence || {};
    const inconsistencies: string[] = [];

    // probe artifact only if not already in existence map (safety fallback)
    const probeFile = async (name: string) => name in ex ? ex[name] : await fileExists(`${changeDir}/${name}`);
    const probeDir = async (name: string) => name in ex ? ex[name] : await directoryExists(`${changeDir}/${name}`);

    if (!await probeFile('proposal.md')) inconsistencies.push("full workflow but proposal.md missing");
    if ((currentState === "bridging" || currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") && !await probeFile('design.md')) {
      inconsistencies.push("full workflow but design.md missing");
    }
    if ((currentState === "bridging" || currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") && !await probeFile('tasks.md')) {
      inconsistencies.push("full workflow but tasks.md missing");
    }
    if ((currentState === "bridging" || currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") && !await probeDir('specs')) {
      inconsistencies.push("full workflow but specs/ missing");
    }
    if ((currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") && !await probeFile('execution-contract.md')) {
      inconsistencies.push("execution state but execution-contract.md missing");
    }

    if (inconsistencies.length > 0) {
      return {
        success: false,
        block: true,
        blockReason: `Phase consistency check failed: ${inconsistencies.join("; ")}`,
      };
    }
  }

  return { success: true };
}

/**
 * Preset upgrade check — READ ONLY (C1).
 * Does NOT write state. Returns block reason and upgrade signal;
 * the caller (state-manager or index.ts) is responsible for applying the upgrade.
 */
async function checkPresetUpgrade(changeDir: string): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const stateData = await readJsonFile<{ state?: string; mode?: string }>(`${changeDir}/.sflow/state.json`);
  const mode = stateData?.mode;

  if (mode !== "hotfix" && mode !== "tweak") {
    return { success: true };
  }

  const tasksContent = await readFile(`${changeDir}/tasks.md`);
  if (!tasksContent) {
    return { success: true };
  }

  // C2: Use tasks.md to infer file count (parse file references from task descriptions)
  // instead of git diff which counts unrelated changes
  const taskLines = tasksContent.split("\n").filter((line: string) => line.match(/^-\s*\[.\]\s+/));
  const taskCount = taskLines.length;

  // Count unique file mentions across all task lines
  const fileRefs = new Set<string>();
  for (const line of taskLines) {
    // Match file path patterns: src/..., packages/..., *.ts, etc.
    const matches = line.matchAll(/(?:`([^`]+)`|(\b[\w/.-]+\.\w{1,4}\b))/g);
    for (const m of matches) {
      const ref = (m[1] ?? m[2] ?? '').trim();
      if (ref && (ref.includes('/') || /\.\w{1,4}$/.test(ref))) {
        fileRefs.add(ref);
      }
    }
  }
  const fileCount = fileRefs.size;

  const hasSchemaChange = taskLines.some((l: string) =>
    /schema|database|migrat|alter\s+table|ddl|create\s+table/i.test(l)
  );
  const hasApiChange = taskLines.some((l: string) =>
    /\bapi\b|endpoint|route|public\s+(method|function|api)|new\s+module|new\s+interface/i.test(l)
  );
  const hasCrossModule = taskLines.some((l: string) =>
    /cross.?(module|project|service)|multi.?(module|project|service)|coordination|interfaces/i.test(l)
  );

  // C3: Use shared threshold constants from @opencode-sflow/core
  const hotfixThresholds = HOTFIX_UPGRADE_THRESHOLDS;
  const tweakThresholds = TWEAK_UPGRADE_THRESHOLDS;

  const needsUpgrade =
    mode === "hotfix" && (fileCount > hotfixThresholds.MAX_FILES || taskCount > hotfixThresholds.MAX_TASKS || hasSchemaChange || hasApiChange) ||
    mode === "tweak" && (fileCount > tweakThresholds.MAX_FILES || taskCount > tweakThresholds.MAX_TASKS || hasSchemaChange || hasApiChange || hasCrossModule);

  if (needsUpgrade) {
    return {
      success: false,
      block: true,
      blockReason: `[SFLOW] Preset upgrade detected: ${mode} -> full. Reason: scope exceeds preset limits (${fileCount} files, ${taskCount} tasks, schema=${hasSchemaChange}, api=${hasApiChange}, crossModule=${hasCrossModule}). Guard blocks: upgrade has not been applied yet. Call state-manager.upgradeMode() to apply the upgrade, then route back to specifying.`,
      data: {
        upgradeFrom: mode,
        upgradeTo: 'full',
        upgradeReason: `scope exceeds ${mode} limits (${fileCount} files, ${taskCount} tasks)`,
        fileCount,
        taskCount,
      },
    };
  }

  return { success: true };
}

async function checkContractStalenessGuard(changeDir: string): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const stale = await isContractStale(changeDir);
  if (stale) {
    return {
      success: false,
      block: true,
      blockReason: "Contract is stale: proposal.md was modified after execution-contract.md was created",
    };
  }

  const report = await getContractStalenessReport(changeDir);
  if (report.stale && report.reason) {
    return {
      success: false,
      block: true,
      blockReason: `Contract is stale: ${report.reason}`,
    };
  }

  return { success: true };
}

async function checkTaskCompletion(changeDir: string): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const tasksContent = await readFile(`${changeDir}/tasks.md`);
  if (!tasksContent) return { success: true };

  const taskLines = tasksContent.split("\n").filter((line: string) => line.match(/^-\s*\[.\]\s+/));
  if (taskLines.length === 0) return { success: true };

  const incompleteTasks = taskLines.filter((line: string) => line.match(/^-\s*\[\s\]/));
  if (incompleteTasks.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `${incompleteTasks.length} task(s) are incomplete. Complete all tasks before closing.`,
    };
  }
  return { success: true };
}

/**
 * PROGRESS.md Anti-Repeat Guard — blocks approaches already excluded in PROGRESS.md.
 * Reads .sflow/progress.md and checks if the current operation (inferred from tool/agent/filePath)
 * matches any previously excluded approach.
 */
async function checkProgressAntiRepeatGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  const progress = await readProgressFile(changeDir);
  if (!progress || progress.excludedApproaches.length === 0) {
    return { success: true };
  }

  const filePath = (data.filePath as string) || '';
  const toolName = (data.toolName as string) || '';
  const agent = (data.agent as string) || '';

  if (!filePath && !toolName) return { success: true };

  const fileKeywords = filePath.replace(/\\/g, '/').split(/[/.]/).filter(k => k.length >= 3 && !['src', 'test', 'spec', 'index'].includes(k));
  const agentKeywords = agent ? agent.split(/[-_\s]+/).filter(k => k.length >= 3) : [];
  const combinedKeywords = [...new Set([...fileKeywords, ...agentKeywords])];

  if (combinedKeywords.length === 0) return { success: true };

  const { detectProgressAntiRepeat } = await import('../features/state-manager.js');
  const result = await detectProgressAntiRepeat(changeDir, combinedKeywords.join(' '));

  if (result.blocked && result.matched) {
    return {
      success: false, block: true,
      blockReason: `[SFLOW] PROGRESS anti-repeat: current operation matches excluded approach ${result.matched.id} ("${result.matched.approach}"). ${result.reason}`,
    };
  }

  return { success: true };
}

/**
 * File-level write guard — consolidated from previously inline logic in index.ts.
 *
 * Checks:
 * - C4: Planning phases (exploring/specifying/bridging) block source code writes
 * - Terminal states (closing/abandoned) block all writes
 * - C5: Debugging state only allows bug-investigator and build-executor agents
 * - Illegal phase jump: full mode executing without design.md
 */
async function checkFileWriteGuard(changeDir: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  const toolName = data.toolName as string | undefined;
  // File boundary and state guard apply to write/edit/rename/delete
  const modifyingTools = ['write', 'edit', 'rename', 'delete'];
  if (!toolName || !modifyingTools.includes(toolName)) return { success: true };

  const filePath = (data.filePath as string) || '';
  const agent = (data.agent as string) || '';
  if (!filePath) return { success: true };

  const stateData = await readJsonFile<{ state?: string; mode?: string }>(`${changeDir}/.sflow/state.json`);
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

    // Illegal phase jump: full mode executing but missing design.md
    if (stateData.mode === 'full' && currentState === 'executing') {
      const designExists = await fileExists(`${changeDir}/design.md`);
      if (!designExists) {
        return {
          success: false, block: true,
          blockReason: `[SFLOW] Write blocked: illegal phase jump detected. Full workflow in "executing" but design.md is missing. Route back to specifying to complete planning artifacts.`,
        };
      }
    }

    // File Boundary Control — applies during executing AND debugging
    if (currentState === 'executing' || currentState === 'debugging') {
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
 * Debugging state check — blocks non-debugging operations from non-debugging agents.
 * Uses both action string (from tool.execute.before) and agent name (from context.data).
 */


// ─── File Boundary Control — Cache ──────────────────────────────────────

/**
 * In-memory cache for parsed file boundary patterns.
 * Key: changeDir + ':' + contractHash (detect staleness)
 * Value: { patterns: string[], taskBoundaries: Map<string, string[]> }
 *
 * This avoids re-reading and re-parsing the contract on every write operation.
 * The cache is invalidated when the contract file changes (detected by hash).
 */
const boundaryCache = new Map<string, { contractHash: string; taskBoundaries: Map<string, string[]>; globalPatterns: string[] }>();

function getBoundaryCacheKey(changeDir: string, contractHash: string): string {
  return changeDir + ':' + contractHash;
}

/**
 * Parse task-level and global file boundary patterns from execution-contract.md.
 *
 * Supports 5 formats:
 * 1. XML-style: <write_files>...</write_files> (global)
 * 2. YAML-style: write_files:\n  - path (global)
 * 3. Inline list: write_files: [path1, path2] (global)
 * 4. Task table: | T01 | desc | read_files | write_files | (per-task)
 * 5. Legacy fallback: write_files: line + "- path" lines
 *
 * Returns both global patterns and per-task boundary maps.
 */
function parseFileBoundaryPatterns(contractContent: string): {
  taskBoundaries: Map<string, string[]>;
  globalPatterns: string[];
} {
  const globalPatterns: string[] = [];
  const taskBoundaries = new Map<string, string[]>();

  // Helper: parse a write_files cell value into a list of patterns
  const parseCell = (cell: string): string[] => {
    const pats: string[] = [];
    // Extract backtick-wrapped paths: `path/to/file`
    const backtickPaths = cell.match(/`([^`]+)`/g);
    if (backtickPaths) {
      for (const bp of backtickPaths) pats.push(bp.replace(/`/g, ''));
    }
    // Also extract bare paths separated by whitespace (no backticks)
    const bareParts = cell.replace(/`[^`]+`/g, '').trim();
    if (bareParts) {
      for (const part of bareParts.split(/\s+/)) {
        const t = part.trim();
        if (t && (t.includes('/') || t.includes('\\') || /\.\w{1,4}$/.test(t))) pats.push(t);
      }
    }
    return pats;
  };

  // === Format 1: XML-style <write_files>...</write_files> (task-scoped if inside a task block) ===
  // Task blocks: <!-- Task T01 --> ... <!-- /Task T01 -->
  const taskBlockRegex = /<!--\s*Task\s+(T\d+)\s*-->([\s\S]*?)<!--\s*\/Task\s+\1\s*-->/g;
  let taskBlockMatch: RegExpExecArray | null;
  while ((taskBlockMatch = taskBlockRegex.exec(contractContent)) !== null) {
    const taskId = taskBlockMatch[1];
    const blockContent = taskBlockMatch[2] || '';
    const taskPats: string[] = [];

    // XML-style within task block
    for (const m of blockContent.matchAll(/<write_files>([\s\S]*?)<\/write_files>/g)) {
      for (const l of (m[1] || '').split('\n')) {
        const t = l.trim();
        if (t && !t.startsWith('<')) taskPats.push(t);
      }
    }

    // YAML-style within task block
    const yamlMatch = blockContent.match(/write_files:\s*\n([\s\S]*?)(?=\n\S|\n*$)/);
    if (yamlMatch && yamlMatch[1]) {
      for (const l of yamlMatch[1].split('\n')) {
        const t = l.replace(/^[-\s]*/, '').trim();
        if (t && !t.startsWith('#') && !t.startsWith('write_files')) taskPats.push(t);
      }
    }

    if (taskPats.length > 0 && taskId) taskBoundaries.set(taskId, taskPats);
  }

  // === Format 2: XML-style <write_files>...</write_files> (global, outside task blocks) ===
  // First strip task-block content so we don't double-count
  const strippedContent = contractContent.replace(/<!--\s*Task\s+T\d+\s*-->[\s\S]*?<!--\s*\/Task\s+T\d+\s*-->/g, '');
  for (const m of strippedContent.matchAll(/<write_files>([\s\S]*?)<\/write_files>/g)) {
    for (const l of (m[1] || '').split('\n')) {
      const t = l.trim();
      if (t && !t.startsWith('<')) globalPatterns.push(t);
    }
  }

  // === Format 3: YAML-style write_files: list (global) ===
  for (const m of strippedContent.matchAll(/^write_files:\s*\n([\s\S]*?)(?=\n\S|\n*$)/gm)) {
    for (const l of (m[1] || '').split('\n')) {
      const t = l.replace(/^[-\s]*/, '').trim();
      if (t && !t.startsWith('#') && !t.startsWith('write_files') && !t.startsWith('<')) globalPatterns.push(t);
    }
  }

  // === Format 4: Inline list: write_files: [path1, path2] ===
  const inlineMatch = strippedContent.match(/write_files:\s*\[([^\]]+)\]/);
  if (inlineMatch && inlineMatch[1]) {
    for (const p of inlineMatch[1].split(',')) {
      const t = p.trim().replace(/['"]/g, '');
      if (t) globalPatterns.push(t);
    }
  }

  // === Format 5: Task table ===
  // Detect if this is a table with column headers to find write_files column index.
  // Heuristic: match the header row first.
  const headerRow = contractContent.match(/^\|?\s*Task\s*\|[^|]*\|[^|]*\|[^|]*\|?\s*$/im);
  const writeFilesColIndex = 3; // Default: 4th column (0-indexed: 3)

  // Match all table data rows: | T01 | ... | ... | ... |
  for (const m of contractContent.matchAll(/^\|\s*(T\d+)\s*\|[^|]*\|[^|]*\|[^|]*\|/gm)) {
    const taskId = m[1];
    if (!taskId) continue;
    const cellContent = m[0] || '';
    // Extract the write_files column (split by | and take the appropriate column)
    const cols = cellContent.split('|').map(c => c.trim());
    // cols[0] is empty (before first |), cols[1]=T01, cols[2]=description, cols[3]=read_files, cols[4]=write_files
    if (cols.length >= 5) {
      const writeCol = cols[writeFilesColIndex + 1]; // +1 because cols[0] is empty
      if (writeCol) {
        const pats = parseCell(writeCol);
        if (pats.length > 0) {
          taskBoundaries.set(taskId, pats);
        }
      }
    }
  }

  // === Format 6: Legacy fallback (no task isolation) ===
  if (globalPatterns.length === 0 && taskBoundaries.size === 0) {
    const ms = strippedContent.match(/write_files:[\s\S]*?(?=\n\w|$)/);
    if (ms) {
      for (const l of ms[0].split('\n')) {
        const t = l.replace(/^- /, '').trim();
        if (t && !t.startsWith('write_files')) globalPatterns.push(t);
      }
    }
  }

  // Deduplicate patterns
  const dedupedGlobals = [...new Set(globalPatterns)];
  for (const [tid, pats] of taskBoundaries) {
    taskBoundaries.set(tid, [...new Set(pats)]);
  }

  return { taskBoundaries, globalPatterns: dedupedGlobals };
}

/**
 * Get the active task ID from subagent-progress.md (if it exists).
 */
async function getActiveTaskId(changeDir: string): Promise<string | null> {
  const sp = await readFile(changeDir + '/.sflow/subagent-progress.md').catch(() => null);
  if (!sp) return null;
  const planMatch = sp.match(/\*\*Plan task\*\*:\s*(T\d+)/i);
  return planMatch?.[1] ? planMatch[1].toUpperCase() : null;
}

/**
 * Check if a file path matches any allowed boundary pattern.
 */
function matchesBoundary(filePath: string, patterns: string[]): boolean {
  const rel = filePath.replace(/\\/g, '/').toLowerCase();
  return patterns.some(p => {
    const np = p.replace(/\\/g, '/').toLowerCase();
    if (rel === np || rel.endsWith('/' + np)) return true;
    if (np.endsWith('/*') && rel.startsWith(np.slice(0, -1))) return true;
    if (np.endsWith('/') && rel.startsWith(np)) return true;
    // Glob: src/**/*.ts
    // ** matches across directory boundaries; single * matches within one dir level
    if (np.includes('*')) {
      const escaped = np
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '<<<DOUBLESTAR>>>')
        .replace(/\*/g, '[^/]*')
        .replace(/<<<DOUBLESTAR>>>/g, '.*');
      try {
        if (new RegExp('^' + escaped + '$', 's').test(rel)) return true;
      } catch { /* skip invalid regex */ }
    }
    return false;
  });
}

/**
 * Compute a simple hash of contract content for cache invalidation.
 */
function simpleContractHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const chr = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * File Boundary Control - validates source file writes against task write_files.
 * Runs in executing AND debugging states.
 *
 * Uses an in-memory cache to avoid re-reading the contract on every write.
 * Task-level isolation: only the active task's write_files are checked.
 * If no active task is found, falls back to global patterns.
 */
async function checkFileBoundary(changeDir: string, filePath: string): Promise<HookResult | null> {
  const cc = await readFile(changeDir + '/execution-contract.md');
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

async function checkDebuggingState(changeDir: string, action?: string, data?: Record<string, unknown>): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/.sflow/state.json`);
  if (stateData?.state !== "debugging") return { success: true };

  const agent = (data?.agent as string) || '';
  const isDebugAction =
    action?.includes("bug-investigator") ||
    action?.includes("debugging") ||
    action?.includes("tool:workflow_router") ||
    action?.includes("build-executor") ||
    (agent !== '' && (agent.includes("bug-investigator") || agent.includes("build-executor")));

  if (!isDebugAction) {
    return {
      success: false, block: true,
      blockReason: "Workflow is in debugging state. Only bug-investigator and build-executor (for fix verification) can operate. Fix the bug and transition back to executing before continuing.",
    };
  }
  return { success: true };
}


