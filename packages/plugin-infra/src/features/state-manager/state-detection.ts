/**
 * State detection functions for workflow state management.
 * Extracted from index.ts to maintain pure re-export pattern.
 */

import { fileExists, readJsonFile, directoryExists, isContractStale as checkContractStale } from "@opencode-flow-engine/shared";
import { resolveArtifactPath, readArtifactContent } from './artifact-paths.js';

export const BOULDER_STATE_FILE = ".flow-engine/sflow/boulder-state.json";

export function getStateFilePath(workflowType: 'sflow' | 'iflow'): string {
  return workflowType === 'iflow' ? '.flow-engine/iflow/state.json' : '.flow-engine/sflow/state.json';
}

export async function simpleHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ─── Workflow State Detection ────────────────────────────────────────────────

/**
 * Canonical detectWorkflowState — unified state detection result.
 * Replaces the three duplicate implementations in:
 *   - index.ts (executeWorkflowRouter)
 *   - tools/workflow-router.ts (artifact-based detection)
 *   - features/state-manager.ts (detectStateMismatch)
 *
 * Returns the detected state, recommended subagent, and routing info.
 * All three callers SHOULD delegate to this function.
 */
export interface WorkflowStateDetection {
  state: string;
  skill: string;
  mode: string;
  reasons: string[];
  artifacts: {
    proposal: boolean;
    specs: boolean;
    specsFileCount: number;
    design: boolean;
    tasks: boolean;
    contract: boolean;
    uiDesign: boolean;
    executionPlan: boolean;
  };
  isFrontend: boolean;
  isApproved: boolean;
}

/**
 * Ensure migration target directory exists.
 * Single responsibility: directory creation only.
 */
export async function ensureMigrateDir(changeDir: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  const sflowDir = `${changeDir}/.flow-engine/sflow`;
  await mkdir(sflowDir, { recursive: true });
}

/**
 * Migrate single artifact from src to dst.
 * Non-destructive: copies file, does not delete original.
 * Skips if dst already exists or src does not exist.
 */
export async function migrateSingleArtifact(srcPath: string, dstPath: string): Promise<void> {
  const { copyFile } = await import('node:fs/promises');
  
  const srcExists = await fileExists(srcPath);
  const dstExists = await fileExists(dstPath);
  
  if (srcExists && !dstExists) {
    try {
      await copyFile(srcPath, dstPath);
    } catch {
    }
  }
}

/**
 * Migrate legacy artifacts from root directory to .flow-engine/sflow/.
 * Coordinates migration using single-responsibility helpers.
 * Non-destructive: copies files, does not delete originals.
 * Uses migration marker to skip redundant migrations.
 */
export async function migrateLegacyArtifacts(changeDir: string): Promise<void> {
  const sflowDir = `${changeDir}/.flow-engine/sflow`;
  const markerPath = `${sflowDir}/.artifacts-migrated`;
  
  if (await fileExists(markerPath)) {
    return;
  }
  
  try {
    await ensureMigrateDir(changeDir);
  } catch {
    return;
  }
  
  const artifacts = ['proposal.md', 'design.md', 'tasks.md', 'execution-contract.md', 'ui-design.md'];
  
  for (const artifact of artifacts) {
    const legacyPath = `${changeDir}/${artifact}`;
    const newPath = `${sflowDir}/${artifact}`;
    await migrateSingleArtifact(legacyPath, newPath);
  }
  
  const legacySpecsDir = `${changeDir}/specs`;
  const newSpecsDir = `${sflowDir}/specs`;
  
  const legacySpecsExists = await directoryExists(legacySpecsDir);
  const newSpecsExists = await directoryExists(newSpecsDir);
  
  if (legacySpecsExists && !newSpecsExists) {
    try {
      const { readdir, mkdir } = await import('node:fs/promises');
      await mkdir(newSpecsDir, { recursive: true });
      const files = await readdir(legacySpecsDir);
      for (const file of files) {
        if (file.endsWith('.md')) {
          await migrateSingleArtifact(`${legacySpecsDir}/${file}`, `${newSpecsDir}/${file}`);
        }
      }
    } catch {
    }
  }
  
  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(markerPath, new Date().toISOString());
  } catch {
  }
}

/**
 * Read artifacts once and return a reusable map (avoids redundant I/O).
 * Uses dual-path compatibility: new path (.flow-engine/sflow/) preferred, legacy path fallback.
 */
export async function detectArtifactExistence(changeDir: string): Promise<{
  proposal: boolean; design: boolean; tasks: boolean; specs: boolean;
  specsFileCount: number; contract: boolean; uiDesign: boolean;
  executionPlan: boolean;
}> {
  await migrateLegacyArtifacts(changeDir).catch(() => {});
  
  const [hpNew, hpOld, hdNew, hdOld, htNew, htOld, hcNew, hcOld, huiNew, huiOld, hep] = await Promise.all([
    fileExists(changeDir + '/.flow-engine/sflow/proposal.md'),
    fileExists(changeDir + '/proposal.md'),
    fileExists(changeDir + '/.flow-engine/sflow/design.md'),
    fileExists(changeDir + '/design.md'),
    fileExists(changeDir + '/.flow-engine/sflow/tasks.md'),
    fileExists(changeDir + '/tasks.md'),
    fileExists(changeDir + '/.flow-engine/sflow/execution-contract.md'),
    fileExists(changeDir + '/execution-contract.md'),
    fileExists(changeDir + '/.flow-engine/sflow/ui-design.md'),
    fileExists(changeDir + '/ui-design.md'),
    fileExists(changeDir + '/.flow-engine/sflow/execution-plan.json'),
  ]);
  
  const hp = hpNew || hpOld;
  const hd = hdNew || hdOld;
  const ht = htNew || htOld;
  const hc = hcNew || hcOld;
  const hui = huiNew || huiOld;
  
  const specsDirNew = await directoryExists(changeDir + '/.flow-engine/sflow/specs');
  const specsDirOld = await directoryExists(changeDir + '/specs');
  const specsDir = specsDirNew || specsDirOld;
  const specsDirPath = specsDirNew 
    ? changeDir + '/.flow-engine/sflow/specs'
    : changeDir + '/specs';
  
  const specsFileCount = specsDir
    ? (await (await import('node:fs/promises')).readdir(specsDirPath)).filter(n => n.endsWith('.md')).length
    : 0;
  
  return {
    proposal: hp, design: hd, tasks: ht,
    specs: specsDir && specsFileCount > 0,
    specsFileCount, contract: hc, uiDesign: hui,
    executionPlan: hep,
  };
}

/**
 * Canonical workflow state detection — single source of truth.
 *
 * Artifact-first approach: inspects filesystem, then reads state.json for approval status.
 * Supports all 9 states including ui-design for frontend projects.
 *
 * @param changeDir - The project/change directory
 * @param artifactsOpt - Optional pre-fetched artifact existence map (avoids redundant I/O)
 */
export async function detectWorkflowState(
  changeDir: string,
  artifactsOpt?: WorkflowStateDetection['artifacts'],
): Promise<WorkflowStateDetection> {
  const artifacts = artifactsOpt ?? await detectArtifactExistence(changeDir);
  const stateData = await readJsonFile<{
    state?: string;
    mode?: string;
    contractApproved?: boolean;
    isFrontend?: boolean;  // P2-3: 语言继承 - 前端项目标记缓存
  }>(
    changeDir + '/.flow-engine/sflow/state.json',
  ).catch(() => null);

  const isApproved = (
    stateData?.contractApproved === true
    || stateData?.state === 'approved-for-build'
    || stateData?.state === 'executing'
    || stateData?.state === 'closing'
  );
  const mode = stateData?.mode || 'full';

  // Detect frontend — only for states that need ui-design check
  let isFrontend = false;
  const statesNeedingFrontend = ['specifying', 'ui-design', 'bridging', 'approved-for-build', 'executing', 'debugging'];

  // Check state.json cached flag first; fall back to heuristics only if absent
  if (stateData?.isFrontend === true || stateData?.isFrontend === false) {
    isFrontend = stateData.isFrontend === true;
  } else {
    const { detectFrontend } = await import('../workflow-manager.js');
    isFrontend = await detectFrontend(changeDir);
  }

  let state: string;
  let skill: string;
  const reasons: string[] = [];

  if (!artifacts.proposal && !artifacts.specs) {
    state = 'exploring';
    skill = 'need-explorer';
    reasons.push('No planning artifacts found');
  } else if (!artifacts.design || !artifacts.tasks) {
    state = 'specifying';
    skill = 'spec-writer';
    reasons.push(artifacts.proposal ? 'Proposal exists but design/tasks missing' : 'Specs exist but design/tasks missing');
  } else if (!artifacts.contract) {
    // Contract missing — check if we need ui-design or just need more planning
    if (isFrontend && !artifacts.uiDesign && artifacts.design && artifacts.tasks) {
      state = 'ui-design';
      skill = 'spec-writer';
      reasons.push('Frontend project needs ui-design.md before bridging');
    } else {
      state = 'specifying';
      skill = 'spec-writer';
      reasons.push(artifacts.specsFileCount > 0
        ? 'Specs exist but contract incomplete'
        : 'Planning artifacts exist but contract is missing');
    }
  } else if (!isApproved) {
    state = 'bridging';
    skill = 'contract-builder';
    reasons.push('Contract exists but not approved');
  } else {
    state = 'executing';
    skill = 'build-executor';
    reasons.push('Contract approved, ready for implementation');
  }

  // Contract staleness override — only applies to sFlow context
  if (artifacts.contract) {
    const hasSFlowDir = await directoryExists(`${changeDir}/.flow-engine/sflow`);
    if (hasSFlowDir) {
      try {
        const stale = await checkContractStale(changeDir);
        if (stale) {
          state = 'bridging';
          skill = 'contract-builder';
          reasons.push('Contract is stale, needs regeneration');
        }
      } catch { /* ignore staleness check failures */ }
    }
  }

  return {
    state, skill, mode, reasons,
    artifacts,
    isFrontend, isApproved,
  };
}

export async function detectStateMismatch(changeDir: string, currentState: string): Promise<string> {
  const artifacts = await detectArtifactExistence(changeDir);
  const hp = artifacts.proposal;
  const hd = artifacts.design;
  const ht = artifacts.tasks;
  const hsp = artifacts.specs;
  const hc = artifacts.contract;
  const hui = artifacts.uiDesign;
  const hep = artifacts.executionPlan;
  const pc = hp ? await readArtifactContent(changeDir, 'proposal.md') : null;
  const tc = ht ? await readArtifactContent(changeDir, 'tasks.md') : null;
  const inc = tc ? tc.split('\n').filter((l: string) => l.match(/^-\s*\[\s\]/)).length : 0;
  const allDone = tc ? tc.split('\n').filter((l: string) => l.match(/^-\s*\[.\]+\s/)).length > 0 && inc === 0 : false;
  if (hc && (currentState === 'approved-for-build' || currentState === 'executing')) {
    const sd = await readJsonFile<Record<string, unknown>>(changeDir + '/.flow-engine/sflow/state.json');
    const sh = (sd?.contract_hash as string) || '';
    if (sh) {
      const cc = await readArtifactContent(changeDir, 'execution-contract.md');
      const ch = await simpleHash(cc || '');
      if (ch !== sh) return 'bridging';
    }
  }
  if (hep && (currentState === 'executing' || currentState === 'debugging')) {
    const plan = await readJsonFile<Record<string, unknown>>(changeDir + '/.flow-engine/sflow/execution-plan.json');
    const planContractHash = (plan?.contract_hash as string) || '';
    if (planContractHash && hc) {
      const cc = await readArtifactContent(changeDir, 'execution-contract.md');
      const ch = await simpleHash(cc || '');
      if (ch !== planContractHash) return 'bridging';
    }
  }
  if (currentState === 'exploring' && hp && pc && pc.trim().length > 100) return 'specifying';
  if (currentState === 'specifying' && hd && ht && hsp) {
    return 'bridging';
  }
  if (currentState === 'ui-design' && hui) return 'bridging';
  if (currentState === 'ui-design' && (!hd || !ht || !hsp)) {
    if (hui) {
      try {
        const { unlink } = await import('node:fs/promises');
        const uiDesignPath = await resolveArtifactPath(changeDir, 'ui-design.md');
        await unlink(uiDesignPath);
      } catch { /* ignore */ }
    }
    return 'specifying';
  }
  if (currentState === 'bridging' && hc) return 'approved-for-build';
  if ((currentState === 'approved-for-build' || currentState === 'executing') && allDone) return 'closing';
  if (currentState === 'specifying' && !hp) return 'exploring';
  if (currentState === 'bridging' && (!hd || !ht || !hsp)) return 'specifying';
  if (currentState === 'approved-for-build' && !hc) return 'bridging';
  if (currentState === 'executing' && !hc) return 'bridging';
  if (currentState === 'debugging' && !hc) return 'bridging';
  return currentState;
}
