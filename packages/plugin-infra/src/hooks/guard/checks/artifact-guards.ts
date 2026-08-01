/**
 * Artifact-related guard checks.
 * Extracted from guard.ts for maintainability.
 */

import type { HookResult } from "../../types.js";
import { fileExists, directoryExists, readJsonFile, readFile } from "@opencode-flow-engine/shared";
import { checkArtifactPreflight, findPreflightState } from "../../../features/artifact-preflight.js";
import { getStateFilePath } from "../../../features/state-manager.js";
import { sharedValidator, HOTFIX_UPGRADE_THRESHOLDS, TWEAK_UPGRADE_THRESHOLDS } from "@opencode-flow-engine/core";
import { isContractStale, getContractStalenessReport } from "@opencode-flow-engine/shared";
import { checkIFlowArtifactAndPhaseConsistency } from "../iflow-shared-guards.js";

/**
 * Combined artifact existence + phase consistency check.
 * Merges checkArtifactExistence (C6 dedup) and checkPhaseConsistency into one pass.
 * Covers both: "does the artifact exist at this state" and "full mode consistency".
 */
export async function checkArtifactAndPhaseConsistency(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
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
export async function checkPresetUpgrade(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
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

export async function checkContractStalenessGuard(changeDir: string, activeWorkflow: 'iflow' | 'sflow' | 'none'): Promise<HookResult> {
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
