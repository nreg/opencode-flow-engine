/**
 * Guard hook - Guard state transitions and block invalid operations
 * READ-ONLY: This hook NEVER writes state or artifacts. It only detects and reports.
 * State mutations (upgrades, repairs) happen through state-manager or workflow-manager.
 */

import type { HookHandler, HookContext, HookResult } from "./types.js";
import { fileExists, readFile, readJsonFile, directoryExists, isContractStale, getContractStalenessReport } from "@opencode-sflow/shared";
import { sharedValidator, HOTFIX_UPGRADE_THRESHOLDS, TWEAK_UPGRADE_THRESHOLDS } from "@opencode-sflow/core";

/**
 * Create the guard hook
 */
export function createGuardHook(): HookHandler {
  return {
    name: "guard",
    description: "Guard state transitions and block invalid operations (read-only)",
    execute: async (context) => {
      const { changeDir } = context;

      try {
        const guards = [
          await checkArtifactAndPhaseConsistency(changeDir),
          await checkPresetUpgrade(changeDir),
          await checkContractStalenessGuard(changeDir),
          await checkTaskCompletion(changeDir),
          await checkDebuggingState(changeDir, context.action),
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

  // Phase 1: Basic artifact existence by state
  const missingArtifacts: string[] = [];

  if (currentState !== "exploring" && currentState !== "abandoned") {
    const proposalExists = await fileExists(`${changeDir}/proposal.md`);
    if (!proposalExists) {
      missingArtifacts.push("proposal.md");
    }
  }
  if (currentState === "bridging" || currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") {
    const designExists = await fileExists(`${changeDir}/design.md`);
    if (!designExists) missingArtifacts.push("design.md");
    const tasksExists = await fileExists(`${changeDir}/tasks.md`);
    if (!tasksExists) missingArtifacts.push("tasks.md");
    const specsExists = await directoryExists(`${changeDir}/specs`);
    if (!specsExists) missingArtifacts.push("specs/");
  }
  if (currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") {
    const contractExists = await fileExists(`${changeDir}/execution-contract.md`);
    if (!contractExists) missingArtifacts.push("execution-contract.md");
  }

  if (missingArtifacts.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `Missing required artifacts for state "${currentState}": ${missingArtifacts.join(", ")}`,
    };
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
      const ref = (m[1] || m[2]).trim();
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

async function checkDebuggingState(changeDir: string, action?: string): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/.sflow/state.json`);
  if (stateData?.state === "debugging") {
    const isDebugAction =
      action?.includes("bug-investigator") ||
      action?.includes("debugging") ||
      action?.includes("tool:workflow_router") ||
      action?.includes("build-executor");
    if (!isDebugAction) {
      return {
        success: false,
        block: true,
        blockReason:
          "Workflow is in debugging state. Only bug-investigator and build-executor (for fix verification) can operate. Fix the bug and transition back to executing before continuing.",
      };
    }
  }
  return { success: true };
}


