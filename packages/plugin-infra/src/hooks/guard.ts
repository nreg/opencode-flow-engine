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
import { simpleContractHash } from "./guard/helpers.js";
import { parseFileBoundaryPatterns, matchesBoundary, getActiveTaskId, boundaryCache, getBoundaryCacheKey, READ_FILES_WHITELIST } from "./guard/boundary.js";
import { fileExists, readFile, readJsonFile, directoryExists, isContractStale, getContractStalenessReport } from "@opencode-flow-engine/shared";
import { sharedValidator, HOTFIX_UPGRADE_THRESHOLDS, TWEAK_UPGRADE_THRESHOLDS } from "@opencode-flow-engine/core";
import { checkArtifactPreflight, findPreflightState } from "../features/artifact-preflight.js";
import { readProgressFile, searchLessonsInFile, getStateFilePath, findProjectRoot } from "../features/state-manager.js";
import { getHasOmoPlugin } from "../agents/agent-tools.js";
import { iflowDirectoryExists, checkIFlowGuards } from "./iflow-guard.js";
import { checkIFlowFileWriteGuard, checkIFlowLessonsGuard, checkIFlowProgressAntiRepeatGuard, checkIFlowArtifactAndPhaseConsistency, checkIFlowOmoUsageGuard } from "./guard/iflow-shared-guards.js";
import { readExecutionPlan as readExecutionPlanFeature } from "../features/execution-plan.js";
import type { Wave } from "../features/execution-plan-types.js";

async function detectActiveWorkflow(changeDir: string): Promise<'iflow' | 'sflow' | 'none'> {
  const iflowExists = await directoryExists(`${changeDir}/.iflow`);
  if (iflowExists) return 'iflow';
  const sflowExists = await directoryExists(`${changeDir}/.sflow`);
  if (sflowExists) return 'sflow';
  return 'none';
}

let _omoUsedInCurrentExploring = false;

export function markOmoUsed(): void {
  _omoUsedInCurrentExploring = true;
}

export function resetOmoTracking(): void {
  _omoUsedInCurrentExploring = false;
}

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

// ─── Wave W4: checkWaveDependencies ──────────────────────────────────────────

/**
 * Topological sort using Kahn's algorithm (BFS-based).
 * Returns sorted wave IDs or throws if a cycle is detected.
 */
function topologicalSort(waves: Wave[]): string[] {
  if (waves.length === 0) return [];

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const wave of waves) {
    inDegree.set(wave.id, 0);
    adjacency.set(wave.id, []);
  }

  for (const wave of waves) {
    for (const depId of wave.depends_on) {
      if (adjacency.has(depId)) {
        adjacency.get(depId)!.push(wave.id);
        inDegree.set(wave.id, (inDegree.get(wave.id) || 0) + 1);
      }
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== waves.length) {
    throw new Error('Circular wave dependencies detected. Wave dependency graph must be acyclic.');
  }

  return sorted;
}

/**
 * WD-1/WD-2/WD-3: Check wave dependencies in execution plan.
 * Validates: circular dependencies, missing wave references, empty waves.
 * Only applies for sflow workflow.
 * READ-ONLY (C4): never writes state.
 */
async function checkWaveDependencies(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // C7: Only apply for sflow workflow
  if (activeWorkflow !== 'sflow') return { success: true };

  // Read execution plan — skip if none exists (backward compatible)
  const plan = await readExecutionPlanFeature(changeDir);
  if (!plan) return { success: true };

  const waves = plan.waves;
  if (!waves || waves.length === 0) return { success: true };

  // Check for empty waves
  for (const wave of waves) {
    if (!wave.tasks || wave.tasks.length === 0) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Wave dependency check: wave "${wave.id}" is empty (no tasks). Every wave must have at least one task.`,
      };
    }
  }

  // Check for missing wave references in depends_on
  const waveIds = new Set(waves.map(w => w.id));
  for (const wave of waves) {
    for (const depId of wave.depends_on) {
      if (!waveIds.has(depId)) {
        return {
          success: false,
          block: true,
          blockReason: `[SFLOW] Wave dependency check: wave "${wave.id}" depends on non-existent wave "${depId}". All depends_on references must exist in the execution plan.`,
        };
      }
    }
  }

  // Check for circular dependencies using topological sort
  try {
    topologicalSort(waves);
  } catch (err) {
    return {
      success: false,
      block: true,
      blockReason: `[SFLOW] Wave dependency check: ${(err instanceof Error ? err.message : String(err))}`,
    };
  }

  return { success: true };
}

// ─── Wave W4: checkReceiptIntegrity ─────────────────────────────────────────

/**
 * RR-2/RR-4/RR-5: Check review receipt integrity.
 * Validates: receipt existence, required fields, symlink detection, commit hash validity.
 * Only applies for sflow workflow.
 * READ-ONLY (C4): never writes state.
 */
async function checkReceiptIntegrity(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // C7: Only apply for sflow workflow
  if (activeWorkflow !== 'sflow') return { success: true };

  // Read execution plan — skip if none exists (backward compatible)
  const plan = await readExecutionPlanFeature(changeDir);
  if (!plan) return { success: true };

  const waves = plan.waves;
  if (!waves || waves.length === 0) return { success: true };

  const REQUIRED_RECEIPT_FIELDS = ['status', 'base', 'head', 'report'] as const;

  for (const wave of waves) {
    const receiptPath = `${changeDir}/.sflow/reviews/${wave.id}.json`;
    const receiptExists = await fileExists(receiptPath);

    if (!receiptExists) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Receipt integrity check: missing receipt for wave "${wave.id}". Expected at ${receiptPath}.`,
      };
    }

    // RR-5: Symlink detection using fs.realpathSync
    try {
      const fs = await import('fs');
      const realPath = fs.realpathSync(receiptPath);
      const expectedPath = receiptPath.replace(/\\/g, '/');
      const resolvedReal = realPath.replace(/\\/g, '/');
      if (resolvedReal !== expectedPath) {
        return {
          success: false,
          block: true,
          blockReason: `[SFLOW] Receipt integrity check: symlinked receipt detected for wave "${wave.id}". Receipt path "${expectedPath}" resolves to "${resolvedReal}". Symlinked receipts are not allowed.`,
        };
      }
    } catch {
      // realpathSync may fail on some systems — skip symlink check
    }

    const receipt = await readJsonFile<Record<string, unknown>>(receiptPath);
    if (!receipt) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Receipt integrity check: cannot read receipt for wave "${wave.id}".`,
      };
    }

    // RR-2: Validate required fields
    for (const field of REQUIRED_RECEIPT_FIELDS) {
      if (!(field in receipt) || receipt[field] === undefined || receipt[field] === null) {
        return {
          success: false,
          block: true,
          blockReason: `[SFLOW] Receipt integrity check: wave "${wave.id}" receipt is missing required field "${field}".`,
        };
      }
      // Check for empty string values on base/head
      if ((field === 'base' || field === 'head') && receipt[field] === '') {
        return {
          success: false,
          block: true,
          blockReason: `[SFLOW] Receipt integrity check: wave "${wave.id}" receipt has empty "${field}" commit hash.`,
        };
      }
    }

    // RR-4: Commit hash revalidation via git rev-parse --verify
    try {
      const { execSync } = await import('child_process');
      // First check if this is a git repo
      try {
        execSync('git rev-parse --git-dir', {
          cwd: changeDir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      } catch {
        // Not a git repo — skip commit validation gracefully
        continue;
      }

      const baseHash = String(receipt.base);
      const headHash = String(receipt.head);

      if (baseHash) {
        try {
          execSync(`git rev-parse --verify "${baseHash}"`, {
            cwd: changeDir,
            encoding: 'utf8',
            stdio: 'pipe',
          });
        } catch {
          return {
            success: false,
            block: true,
            blockReason: `[SFLOW] Receipt integrity check: wave "${wave.id}" receipt has invalid base commit hash "${baseHash}". Hash not found in git history.`,
          };
        }
      }

      if (headHash) {
        try {
          execSync(`git rev-parse --verify "${headHash}"`, {
            cwd: changeDir,
            encoding: 'utf8',
            stdio: 'pipe',
          });
        } catch {
          return {
            success: false,
            block: true,
            blockReason: `[SFLOW] Receipt integrity check: wave "${wave.id}" receipt has invalid head commit hash "${headHash}". Hash not found in git history.`,
          };
        }
      }
    } catch {
      // Non-git repo or git not available — skip commit validation gracefully
    }
  }

  return { success: true };
}

// ─── Wave W5: checkClosingGate ────────────────────────────────────────────────

/**
 * CG-1/CG-3/CG-4: Check closing gate — all review receipts must have status=pass
 * before transitioning to closing state.
 * - If no execution-plan.json exists → skip (backward compatible)
 * - Read all review receipts from .sflow/reviews/
 * - Check that ALL receipts have status='pass'
 * - If any receipt has status='fail' or is missing → block transition to closing
 * Only applies for sflow workflow.
 * READ-ONLY (C4): never writes state.
 */
async function checkClosingGate(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // C7: Only apply for sflow workflow
  if (activeWorkflow !== 'sflow') return { success: true };

  // Read execution plan — skip if none exists (backward compatible, CG-4)
  const plan = await readExecutionPlanFeature(changeDir);
  if (!plan) return { success: true };

  const waves = plan.waves;
  if (!waves || waves.length === 0) return { success: true };

  for (const wave of waves) {
    const receiptPath = `${changeDir}/.sflow/reviews/${wave.id}.json`;
    const receiptExists = await fileExists(receiptPath);

    if (!receiptExists) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Closing gate: missing receipt for wave "${wave.id}". All waves must have review receipts before closing.`,
      };
    }

    const receipt = await readJsonFile<{ status?: string }>(receiptPath);
    if (!receipt) {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Closing gate: cannot read receipt for wave "${wave.id}".`,
      };
    }

    if (receipt.status !== 'pass') {
      return {
        success: false,
        block: true,
        blockReason: `[SFLOW] Closing gate: wave "${wave.id}" receipt has status "${receipt.status || 'unknown'}". All receipts must have status "pass" before closing.`,
      };
    }
  }

  return { success: true };
}

// ─── Wave W5: checkSpecsMerged ────────────────────────────────────────────────

/**
 * CG-6: Check if specs have been merged before closing (Issue #28).
 * - Check if .sflow/state.json has spec_merged: true
 * - If delta-specs directory exists (specs/delta/) and spec_merged is not true → block closing
 * - If no delta-specs directory → skip (backward compatible)
 * Only applies for sflow workflow.
 * READ-ONLY (C4): never writes state.
 */
async function checkSpecsMerged(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // C7: Only apply for sflow workflow
  if (activeWorkflow !== 'sflow') return { success: true };

  // Check if delta-specs directory exists
  const deltaSpecsPath = `${changeDir}/specs/delta`;
  const deltaSpecsExists = await directoryExists(deltaSpecsPath);
  if (!deltaSpecsExists) return { success: true };

  // Check if delta-specs directory has any .md files
  try {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(deltaSpecsPath);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    if (mdFiles.length === 0) return { success: true }; // Empty delta-specs dir, skip
  } catch {
    return { success: true }; // Can't read dir, skip
  }

  // Read state.json to check spec_merged
  const stateData = await readJsonFile<{ spec_merged?: boolean }>(`${changeDir}/${getStateFilePath('sflow')}`);
  if (!stateData || stateData.spec_merged !== true) {
    return {
      success: false,
      block: true,
      blockReason: `[SFLOW] Specs merged check: delta-specs exist in specs/delta/ but spec_merged is not true in state.json. Merge delta specs before closing.`,
    };
  }

  return { success: true };
}

// ─── Wave W6: checkGitBranchIsolation ────────────────────────────────────────

/**
 * GI-1: Warn when on main/master branch during execution.
 * Only applies for sflow workflow, during executing/debugging states,
 * and only warns when the agent is build-executor.
 * READ-ONLY (C4): never writes state.
 */
async function checkGitBranchIsolation(
  changeDir: string,
  data: Record<string, unknown> | undefined,
  activeWorkflow: 'iflow' | 'sflow' | 'none',
): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // C7: Only apply for sflow workflow
  if (activeWorkflow !== 'sflow') return { success: true };

  // Only warn during executing/debugging states
  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  const currentState = stateData?.state;
  if (currentState !== 'executing' && currentState !== 'debugging') return { success: true };

  // Only warn for build-executor agent
  const agent = data?.agent as string | undefined;
  if (agent !== 'build-executor') return { success: true };

  try {
    const { execSync } = await import('child_process');
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: changeDir,
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();

    if (branch === 'main' || branch === 'master') {
      return {
        success: true,
        warnings: [
          `[SFLOW] Git branch isolation: currently on "${branch}" branch. Consider switching to a feature branch for execution to avoid committing directly to the main branch.`,
        ],
      };
    }
  } catch {
    // Not a git repo or git not available — skip silently
  }

  return { success: true };
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
        const activeWorkflow = await detectActiveWorkflow(changeDir);

        const guards = [
          await checkArtifactAndPhaseConsistency(changeDir, activeWorkflow),
          await checkPresetUpgrade(changeDir, activeWorkflow),
          await checkContractStalenessGuard(changeDir, activeWorkflow),
          await checkTaskCompletion(changeDir, activeWorkflow),
          await checkWaveDependencies(changeDir, activeWorkflow),
          await checkReceiptIntegrity(changeDir, activeWorkflow),
          await checkClosingGate(changeDir, activeWorkflow),
          await checkSpecsMerged(changeDir, activeWorkflow),
          await checkGitBranchIsolation(changeDir, data, activeWorkflow),
          await checkDebuggingState(changeDir, context.action, data, activeWorkflow),
          await checkProgressAntiRepeatGuard(changeDir, data, activeWorkflow),
          await checkFileWriteGuard(changeDir, data, activeWorkflow),
          await checkReadFilesBoundary(changeDir, data, activeWorkflow),
          await checkGitCommitBoundary(changeDir, data, activeWorkflow),
          await checkLessonsGuard(changeDir, data, activeWorkflow),
          await checkOmoUsageGuard(changeDir, data, activeWorkflow),
          ...(await getIFlowGuards(changeDir, data, activeWorkflow)),
        ];

        const allWarnings: string[] = [];
        for (const g of guards) {
          if (g.warnings && g.warnings.length > 0) {
            allWarnings.push(...g.warnings);
          }
        }

        const blockingGuards = guards.filter((g) => g.block);
        if (blockingGuards.length > 0) {
          return {
            success: false,
            error: "Guard conditions not met",
            block: true,
            blockReason: blockingGuards.map((g) => g.blockReason).join("; "),
            warnings: allWarnings.length > 0 ? allWarnings : undefined,
          };
        }

        return {
          success: true,
          warnings: allWarnings.length > 0 ? allWarnings : undefined,
        };
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
async function checkArtifactAndPhaseConsistency(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // IFlow: use dedicated iFlow artifact consistency guard
  if (activeWorkflow === 'iflow') {
    return checkIFlowArtifactAndPhaseConsistency(changeDir);
  }

  const dirExists = await fileExists(changeDir);
  if (!dirExists) return { success: true };

  const stateData = await readJsonFile<{ state?: string; mode?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  const currentState = stateData?.state || "exploring";
  const mode = stateData?.mode;

    // Phase 1: Use shared checkArtifactPreflight — returns existence map to avoid redundant I/O
  const pf = await checkArtifactPreflight({ changeDir, targetState: currentState, fileExists, directoryExists, readJson: readJsonFile });
  if (!pf.passed) {
    // P3: pf.reason already includes the enhanced action hint from artifact-preflight.ts
    return { success: false, block: true, blockReason: pf.reason || '[SFLOW] Preflight gate: missing ' + pf.missing.join(', ') + '. Route to "' + findPreflightState(pf.missing) + '" first.' };
  }

  // Phase 2: Full mode consistency — use pf.existence directly, avoid redundant file I/O (P1)
  if (mode === "full" && currentState && currentState !== "exploring" && currentState !== "abandoned") {
    const ex = pf.existence || {};
    const inconsistencies: string[] = [];

    // Reuse existence map from Phase 1; only probe artifacts not in the map
    const checkFile = async (name: string): Promise<boolean> =>
      name in ex ? (ex[name] as boolean) : await fileExists(`${changeDir}/${name}`);
    const checkDir = async (name: string): Promise<boolean> =>
      name in ex ? (ex[name] as boolean) : await directoryExists(`${changeDir}/${name}`);

    const statesAfterSpec = ["bridging", "approved-for-build", "executing", "debugging", "closing"];
    const statesAfterExec = ["approved-for-build", "executing", "debugging", "closing"];

    if (!await checkFile('proposal.md')) inconsistencies.push("full workflow but proposal.md missing");
    if (statesAfterSpec.includes(currentState) && !await checkFile('design.md')) {
      inconsistencies.push("full workflow but design.md missing");
    }
    if (statesAfterSpec.includes(currentState) && !await checkFile('tasks.md')) {
      inconsistencies.push("full workflow but tasks.md missing");
    }
    if (statesAfterSpec.includes(currentState) && !await checkDir('specs')) {
      inconsistencies.push("full workflow but specs/ missing");
    }
    if (statesAfterExec.includes(currentState) && !await checkFile('execution-contract.md')) {
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
async function checkPresetUpgrade(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // IFlow has no hotfix/tweak mode — uses full-cycle only
  if (activeWorkflow === 'iflow') return { success: true };

  const stateData = await readJsonFile<{ state?: string; mode?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
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

  // C3: Use shared threshold constants from @opencode-flow-engine/core
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

async function checkContractStalenessGuard(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const hasContract = await fileExists(`${changeDir}/execution-contract.md`);
  if (!hasContract) return { success: true };

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

async function checkTaskCompletion(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  // IFlow uses PLAN.md (GSD-style) rather than SFlow's tasks.md
  if (activeWorkflow === 'iflow') return { success: true };

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

  // CG-3: Also check wave completion when execution-plan.json exists
  const plan = await readExecutionPlanFeature(changeDir);
  if (plan && plan.waves && plan.waves.length > 0) {
    const wavesMissingReceipts: string[] = [];
    for (const wave of plan.waves) {
      const receiptPath = `${changeDir}/.sflow/reviews/${wave.id}.json`;
      const receiptExists = await fileExists(receiptPath);
      if (!receiptExists) {
        wavesMissingReceipts.push(wave.id);
        continue;
      }
      const receipt = await readJsonFile<{ status?: string }>(receiptPath);
      if (!receipt || receipt.status !== 'pass') {
        wavesMissingReceipts.push(wave.id);
      }
    }
    if (wavesMissingReceipts.length > 0) {
      return {
        success: false,
        block: true,
        blockReason: `Wave completion check: ${wavesMissingReceipts.length} wave(s) lack passing receipts (${wavesMissingReceipts.join(', ')}). All waves must have passing review receipts before closing.`,
      };
    }
  }

  return { success: true };
}

/**
 * PROGRESS.md Anti-Repeat Guard — blocks approaches already excluded in PROGRESS.md.
 * Reads .sflow/progress.md and checks if the current operation (inferred from tool/agent/filePath)
 * matches any previously excluded approach.
 */
async function checkProgressAntiRepeatGuard(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  if (activeWorkflow === 'iflow') {
    return checkIFlowProgressAntiRepeatGuard(changeDir, data);
  }

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

  // P34: Also read current task description from subagent-progress.md for better keyword inference
  let taskKeywords: string[] = [];
  const sp = await readFile(changeDir + '/.sflow/subagent-progress.md').catch(() => null);
  if (sp) {
    const planMatch = sp.match(/\*\*Plan task\*\*:\s*(.+)/i);
    if (planMatch?.[1]) {
      const taskDesc = planMatch[1];
      // Extract file paths (backtick-wrapped) from task description
      const fileRefs = (taskDesc.match(/\x60([^\x60]+)\x60/g) || []).map(function(s) { return s.replace(/\x60/g, ''); });
      // Extract action words (4+ chars, non-stop words)
      const actionWords = taskDesc.split(/\s+/).filter((w: string) =>
        w.length >= 4 && !['the', 'and', 'for', 'with', 'this', 'that', 'from', '需要', '一个', '进行', '使用'].includes(w.toLowerCase())
      );
      taskKeywords = [...new Set([...fileRefs, ...actionWords])];
    }
  }

  const combinedKeywords = [...new Set([...fileKeywords, ...agentKeywords, ...taskKeywords])];

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
async function checkFileWriteGuard(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
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
      // P16: If no execution-contract.md found, block writes and require regeneration
      const contractExists = await fileExists(`${changeDir}/execution-contract.md`).catch(() => false);
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
/**
 * P39: Whitelist for read_files — common config files and directories
 * that should always be readable without triggering boundary warnings.
 * These are infrastructure/config files, not source code.
 */

async function checkReadFilesBoundary(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  const hasContract = await fileExists(`${changeDir}/execution-contract.md`);
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

  // Don't warn about reading artifacts or .sflow files
  if (isArtifactPath(filePath, changeDir) || filePath.includes('.sflow/')) return { success: true };

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
async function checkGitCommitBoundary(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  const hasContract = await fileExists(`${changeDir}/execution-contract.md`);
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
  // P17: changeDir may be under .sflow/changes/<id> (not the git root).
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
  const cc = await readFile(changeDir + '/execution-contract.md');
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
  const cc = await readFile(changeDir + '/execution-contract.md');
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
  const cc = await readFile(changeDir + '/execution-contract.md');
  if (!cc) return [];
  const parsed = parseFileBoundaryPatterns(cc);
  return parsed.globalPatterns;
}

/**
 * Debugging state check — blocks non-debugging operations from non-debugging agents.
 * Uses both action string (from tool.execute.before) and agent name (from context.data).
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

/**
 * P21: LESSONS.md Knowledge Base Guard — warns when starting a task
 * that matches an active lesson entry.
 *
 * Inspired by flow-kit R1.8: "每个 DEV 任务进入实现前必扫 LESSONS.md"
 * Only warns (does not block) — the AI must declare differences in the execution plan.
 */
async function checkLessonsGuard(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  if (activeWorkflow === 'iflow') {
    return checkIFlowLessonsGuard(changeDir, data);
  }

  const agent = (data.agent as string) || '';
  // P14: Extend to bug-investigator in debugging state
  const isDebuggingAgent = agent.includes('bug-investigator');
  const isBuildExecutor = agent.includes('build-executor');
  if (!isBuildExecutor && !isDebuggingAgent) return { success: true };

  // Read state to determine if we're in debugging
  let currentState = '';
  try {
    const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
    currentState = stateData?.state || '';
  } catch { /* ignore */ }
  const isDebuggingState = currentState === 'debugging';

  // Read subagent-progress.md once for keyword extraction
  const sp = await readFile(changeDir + '/.sflow/subagent-progress.md').catch(() => null);

  // For build-executor: check stage in subagent-progress.md
  // For bug-investigator in debugging: skip stage check, just extract keywords
  if (isBuildExecutor && !isDebuggingState) {
    if (!sp) return { success: true };

    const stageMatch = sp.match(/\*\*Stage\*\*:\s*(\S+)/i);
    const stage = stageMatch?.[1];

    // Only warn when entering implementing stage (not during review/fix)
    if (stage !== 'implementing') return { success: true };
  }

  // Extract task keywords from the plan task
  if (!sp) return { success: true };
  const planMatch = sp.match(/\*\*Plan task\*\*:\s*(.+)/i);
  const planTask = planMatch?.[1] || '';
  if (!planTask) return { success: true };

  // Extract keywords: file paths + action nouns
  const fileKeywords = planTask.match(/`([^`]+)`/g)?.map(s => s.replace(/`/g, '')) || [];
  const actionKeywords = planTask.split(/\s+/).filter((w: string) => w.length >= 4 && !['the', 'and', 'for', 'with', 'this', 'that', 'from'].includes(w.toLowerCase()));
  const keywords = [...new Set([...fileKeywords, ...actionKeywords])];

  if (keywords.length === 0) return { success: true };

  // Grep LESSONS.md
  const hits = await searchLessonsInFile(changeDir, keywords);

  if (hits.length > 0) {
    const hitList = hits.map(h => 'L-' + (h.entry.id || '???') + ': "' + h.entry.title + '" (matched: ' + h.matchedKeywords.join(', ') + ')').join('; ');
    return {
      success: true,
      warnings: ['[SFLOW] LESSONS guard: task matches ' + hits.length + ' active lesson(s): ' + hitList + '. Must declare difference in execution plan before proceeding.'],
    };
  }

  return { success: true };
}

async function checkDebuggingState(changeDir: string, action?: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const hasSflowState = await fileExists(`${changeDir}/${getStateFilePath('sflow')}`);
  if (!hasSflowState) return { success: true };

  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
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

/**
 * PXX: OMO usage guard — warns when sFlow uses read/grep in exploring phase
 * without first calling call_omo_agent when omo is available.
 */
async function checkOmoUsageGuard(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
  if (!changeDir || !data) return { success: true };

  if (activeWorkflow === 'iflow') {
    return checkIFlowOmoUsageGuard(changeDir, data);
  }

  const toolName = (data.toolName as string) || '';
  if (toolName !== 'read' && toolName !== 'grep') return { success: true };

  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/${getStateFilePath('sflow')}`);
  const currentState = stateData?.state || '';
  if (currentState !== 'exploring') return { success: true };

  const hasOmo = getHasOmoPlugin();
  if (!hasOmo) return { success: true };

  if (!_omoUsedInCurrentExploring) {
    return {
      success: true,
      warnings: ['[SFLOW] OMO guard: sFlow used read/grep in exploring phase without calling call_omo_agent first. When omo is available, you MUST use call_omo_agent for code exploration.'],
    };
  }

  return { success: true };
}

/**
 * Get IFlow guards — only active when .iflow/ directory exists.
 * This ensures IFlow guards never interfere with SFlow workflows.
 */
async function getIFlowGuards(changeDir: string, data?: Record<string, unknown>, activeWorkflow?: 'iflow' | 'sflow' | 'none'): Promise<HookResult[]> {
  if (!changeDir) return [];
  if (activeWorkflow === 'sflow') return [];
  if (activeWorkflow !== 'iflow') {
    const hasIflow = await iflowDirectoryExists(changeDir);
    if (!hasIflow) return [];
  }

  const iflowResult = await checkIFlowGuards(changeDir, data);
  return [iflowResult];
}



