/**
 * Guard hook - Guard state transitions and block invalid operations
 */

import type { HookHandler, HookContext, HookResult } from "./types.js";
import { fileExists, readFile, readJsonFile, writeJsonFile, atomicWriteJsonFile, isContractStale, getContractStalenessReport } from "@opencode-sflow/shared";
import { sharedValidator } from "@opencode-sflow/core";

/**
 * Create the guard hook
 */
export function createGuardHook(): HookHandler {
  return {
    name: "guard",
    description: "Guard state transitions and block invalid operations",
    execute: async (context) => {
      const { changeDir } = context;

      try {
        const guards = [
          await checkArtifactExistence(changeDir),
          await checkPhaseConsistency(changeDir),
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

async function checkArtifactExistence(changeDir: string): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const dirExists = await fileExists(changeDir);
  if (!dirExists) return { success: true };

  const stateData = await readJsonFile<{ state?: string }>(`${changeDir}/.sflow/state.json`);
  const currentState = stateData?.state || "exploring";

  const artifactByState: Record<string, string[]> = {
    exploring: [],
    specifying: ["proposal.md"],
    bridging: ["proposal.md", "specs", "design.md", "tasks.md"],
    "approved-for-build": ["proposal.md", "specs", "design.md", "tasks.md", "execution-contract.md"],
    executing: ["proposal.md", "specs", "design.md", "tasks.md", "execution-contract.md"],
    debugging: ["proposal.md", "specs", "design.md", "tasks.md", "execution-contract.md"],
    closing: ["proposal.md", "specs", "design.md", "tasks.md", "execution-contract.md"],
    abandoned: [],
  };

  const requiredArtifacts = artifactByState[currentState] || [];
  const missingArtifacts: string[] = [];

  for (const artifact of requiredArtifacts) {
    const exists = await fileExists(`${changeDir}/${artifact}`);
    if (!exists) {
      missingArtifacts.push(artifact);
    }
  }

  if (missingArtifacts.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `Missing required artifacts: ${missingArtifacts.join(", ")}`,
    };
  }

  return { success: true };
}

async function checkPhaseConsistency(changeDir: string): Promise<HookResult> {
  if (!changeDir) return { success: true };

  const stateData = await readJsonFile<{ state?: string; mode?: string }>(`${changeDir}/.sflow/state.json`);
  const currentState = stateData?.state;
  const mode = stateData?.mode;

  if (!currentState || currentState === "exploring" || currentState === "abandoned") {
    return { success: true };
  }

  const inconsistencies: string[] = [];

  if (mode === "full") {
    const proposalExists = await fileExists(`${changeDir}/proposal.md`);
    const designExists = await fileExists(`${changeDir}/design.md`);
    const tasksExists = await fileExists(`${changeDir}/tasks.md`);
    const specsExists = await directoryExists(`${changeDir}/specs`);
    const contractExists = await fileExists(`${changeDir}/execution-contract.md`);

    if ((currentState === "specifying" || currentState === "bridging" || currentState === "approved-for-build" || currentState === "executing" || currentState === "debugging" || currentState === "closing") && !proposalExists) {
      inconsistencies.push("full workflow but proposal.md missing");
    }
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
  }

  if (inconsistencies.length > 0) {
    return {
      success: false,
      block: true,
      blockReason: `Phase consistency check failed: ${inconsistencies.join("; ")}`,
    };
  }

  return { success: true };
}

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

  const taskLines = tasksContent.split("\n").filter((line: string) => line.match(/^-\s*\[.\]\s+/));
  const taskCount = taskLines.length;

  const fileCount = await countChangedFiles(changeDir);

  const hasSchemaChange = taskLines.some((l: string) =>
    /schema|database|migrat|alter\s+table|ddl|create\s+table/i.test(l)
  );
  const hasApiChange = taskLines.some((l: string) =>
    /\bapi\b|endpoint|route|public\s+(method|function|api)|new\s+module|new\s+interface/i.test(l)
  );
  const hasCrossModule = taskLines.some((l: string) =>
    /cross.?(module|project|service)|multi.?(module|project|service)|coordination|interfaces/i.test(l)
  );

  const isHotfix = mode === "hotfix";
  const isTweak = mode === "tweak";

  const needsUpgrade =
    isHotfix && fileCount >= 3 ||
    isTweak && fileCount >= 5 ||
    isHotfix && taskCount > 2 ||
    isTweak && taskCount > 4 ||
    isHotfix && hasSchemaChange ||
    isTweak && hasSchemaChange ||
    isHotfix && hasApiChange ||
    isTweak && hasApiChange ||
    isTweak && hasCrossModule;

  if (needsUpgrade) {
    const statePath = `${changeDir}/.sflow/state.json`;
    const state = await readJsonFile<Record<string, unknown>>(statePath);
    if (state) {
      state.mode = "full";
      state.upgradedFrom = mode;
      state.upgradeReason = `scope exceeds ${mode} limits (${fileCount} files, ${taskCount} tasks)`;
      state.upgradedAt = new Date().toISOString();
      state.updatedAt = new Date().toISOString();
      await atomicWriteJsonFile(statePath, state);
    }

    return {
      success: false,
      block: true,
      blockReason: `[SFLOW] Preset upgrade: ${mode} -> full. Reason: scope exceeds preset limits (${mode}: ${fileCount} files, ${taskCount} tasks, schema=${hasSchemaChange}, api=${hasApiChange}, crossModule=${hasCrossModule}). State updated to mode=full. Route back to specifying to complete planning artifacts before resuming execution.`,
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

async function countChangedFiles(changeDir: string): Promise<number> {
  try {
    const { execSync } = await import("child_process");
    const output = execSync("git diff --name-only HEAD", { cwd: changeDir, encoding: "utf8" }).trim();
    if (!output) return 0;
    return output.split("\n").filter((line) => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const { stat } = await import("fs/promises");
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
