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

    // Phase 1: Use shared checkArtifactPreflight
  const pf = await checkArtifactPreflight({ changeDir, targetState: currentState, fileExists, directoryExists, readJson: readJsonFile });
  if (!pf.passed) {
    return { success: false, block: true, blockReason: 'Missing required artifacts: ' + pf.missing.join(', ') };
  }

  // Phase 2: Full mode consistency (reverse check — are artifacts missing that state implies?)
  if (mode === "full" && currentState && currentState !== "exploring" && currentState !== "abandoned") {
    const inconsistencies: string[] = [];

    const proposalExists = await fileExists(`${changeDir}/proposal.md`);
    const designExists = await fileExists(`${changeDir}/design.md`);
    const tasksExists = await fileExists(`${changeDir}/tasks.md`);
    const specsExists = await directoryExists(`${changeDir}/specs`);
    const contractExists = await fileExists(`${changeDir}/execution-contract.md`);

    if (!proposalExists) inconsistencies.push("full workflow but proposal.md missing");
    if ((currentState === "bridging" || currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") && !designExists) {
      inconsistencies.push("full workflow but design.md missing");
    }
    if ((currentState === "bridging" || currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") && !tasksExists) {
      inconsistencies.push("full workflow but tasks.md missing");
    }
    if ((currentState === "bridging" || currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") && !specsExists) {
      inconsistencies.push("full workflow but specs/ missing");
    }
    if ((currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") && !contractExists) {
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
  if (toolName !== 'write' && toolName !== 'edit') return { success: true };

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


/**
 * Parse file boundary patterns from execution-contract.md.
 * Supports both XML-style (<write_files>...</write_files>) and
 * YAML-style (write_files:\n  - path/to/file) formats.
 */
function parseFileBoundaryPatterns(contractContent: string): string[] {
  const pats: string[] = [];

  // XML-style: <write_files>...</write_files>
  for (const m of contractContent.matchAll(/<write_files>([\s\S]*?)<\/write_files>/g)) {
    for (const l of (m[1] || '').split('\n')) {
      const t = l.trim();
      if (t && !t.startsWith('<')) pats.push(t);
    }
  }

  // YAML-style: write_files:\n  - path/to/file
  const yamlMatch = contractContent.match(/write_files:\s*\n([\s\S]*?)(?=\n\S|\n*$)/);
  if (yamlMatch && yamlMatch[1]) {
    for (const l of yamlMatch[1].split('\n')) {
      const t = l.replace(/^[-\s]*/, '').trim();
      if (t && !t.startsWith('#') && !t.startsWith('write_files')) pats.push(t);
    }
  }

  // Inline list: write_files: [path1, path2]
  const inlineMatch = contractContent.match(/write_files:\s*\[([^\]]+)\]/);
  if (inlineMatch && inlineMatch[1]) {
    for (const p of inlineMatch[1].split(',')) {
      const t = p.trim().replace(/['"]/g, '');
      if (t) pats.push(t);
    }
  }

  // Legacy format: "write_files:" line followed by "- path" lines with no YAML structure
  // (fallback for edge cases the above patterns miss)
  if (pats.length === 0) {
    const ms = contractContent.match(/write_files:[\s\S]*?(?=\n\w|$)/);
    if (ms) {
      for (const l of ms[0].split('\n')) {
        const t = l.replace(/^- /, '').trim();
        if (t && !t.startsWith('write_files')) pats.push(t);
      }
    }
  }

  return pats;
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
    if (np.includes('*')) {
      const escaped = np.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      try {
        if (new RegExp('^' + escaped + '$').test(rel)) return true;
      } catch { /* skip invalid regex */ }
    }
    return false;
  });
}

/**
 * File Boundary Control - validates source file writes against task write_files.
 * Runs in executing AND debugging states.
 */
async function checkFileBoundary(changeDir: string, filePath: string): Promise<HookResult | null> {
  const cc = await readFile(changeDir + '/execution-contract.md');
  if (!cc) return null;

  const pats = parseFileBoundaryPatterns(cc);
  if (pats.length === 0) return null;

  if (!matchesBoundary(filePath, pats)) {
    return {
      success: false, block: true,
      blockReason: '[SFLOW] File Boundary: ' + filePath + ' not in write_files. Allowed boundaries: ' + pats.join(', '),
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


