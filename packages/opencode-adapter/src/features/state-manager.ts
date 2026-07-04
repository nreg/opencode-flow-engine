import type { FeatureConfig, FeatureResult } from "./types.js";
import { createWorkflowManager } from "./workflow-manager.js";
import { fileExists, readJsonFile, writeJsonFile, atomicWriteJsonFile, ensureDir, readFile, directoryExists, isContractStale as checkContractStale } from "@opencode-sflow/shared";

const BOULDER_STATE_FILE = ".sflow/boulder-state.json";

type WorkflowManager = ReturnType<typeof createWorkflowManager>;


// -- Standalone helpers (exported for reuse by session.ts) --

export async function simpleHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/**
 * Canonical detectStateMismatch - single source of truth for state/artifact consistency.
 * Used by session.ts and state-manager.restoreState.
 */
export async function detectStateMismatch(changeDir: string, currentState: string): Promise<string> {
  const hp = await fileExists(changeDir + '/proposal.md');
  const hd = await fileExists(changeDir + '/design.md');
  const ht = await fileExists(changeDir + '/tasks.md');
  const hsp = await directoryExists(changeDir + '/specs');
  const hc = await fileExists(changeDir + '/execution-contract.md');
  const pc = hp ? await readFile(changeDir + '/proposal.md') : null;
  const tc = ht ? await readFile(changeDir + '/tasks.md') : null;
  const inc = tc ? tc.split('\n').filter((l: string) => l.match(/^-\s*\[\s\]/)).length : 0;
  const allDone = tc ? tc.split('\n').filter((l: string) => l.match(/^-\s*\[.\]+\s/)).length > 0 && inc === 0 : false;
  if (hc && (currentState === 'approved-for-build' || currentState === 'executing')) {
    const sd = await readJsonFile<Record<string, unknown>>(changeDir + '/.sflow/state.json');
    const sh = (sd?.contract_hash as string) || '';
    if (sh) {
      const cc = await readFile(changeDir + '/execution-contract.md');
      const ch = await simpleHash(cc || '');
      if (ch !== sh) return 'bridging';
    }
  }
  if (currentState === 'exploring' && hp && pc && pc.trim().length > 100) return 'specifying';
  if (currentState === 'specifying' && hd && ht && hsp) return 'bridging';
  if (currentState === 'bridging' && hc) return 'approved-for-build';
  if ((currentState === 'approved-for-build' || currentState === 'executing') && allDone) return 'closing';
  if (currentState === 'specifying' && !hp) return 'exploring';
  if (currentState === 'bridging' && (!hd || !ht || !hsp)) return 'specifying';
  if (currentState === 'approved-for-build' && !hc) return 'bridging';
  if (currentState === 'executing' && !hc) return 'bridging';
  if (currentState === 'debugging' && !hc) return 'bridging';
  return currentState;
}
export function createStateManager(
  config: FeatureConfig = { enabled: true },
  workflowManager?: WorkflowManager,
) {
  const wf = workflowManager || createWorkflowManager(config);

  return {
    name: "state_manager",
    config,

    getWorkflowManager: () => wf,

    async initialize(): Promise<FeatureResult> {
      if (!config.enabled) {
        return { success: true, data: { message: "State manager disabled" } };
      }
      console.log("State manager initialized");
      return { success: true };
    },

    async restoreState(changeDir: string): Promise<FeatureResult> {
      try {
        const boulderPath = `${changeDir}/${BOULDER_STATE_FILE}`;
        const exists = await fileExists(boulderPath);
        if (!exists) {
          return { success: true, data: { restored: false, reason: "No boulder state found" } };
        }

        const boulderState = await readJsonFile<Record<string, unknown>>(boulderPath);
        if (!boulderState) {
          return { success: true, data: { restored: false, reason: "Empty boulder state" } };
        }

        const currentState = (boulderState.state as string) || "exploring";
        const repairedState = await this.detectStateMismatch(changeDir, currentState);

        if (repairedState !== currentState) {
          console.log(`[SFLOW] Detected state mismatch: state=${currentState} but artifacts indicate ${repairedState}. Auto-repairing.`);
          boulderState.state = repairedState;
          boulderState.repairedFrom = currentState;
          boulderState.repairedAt = new Date().toISOString();
        }

        const statePath = `${changeDir}/.sflow/state.json`;
        await writeJsonFile(statePath, {
          ...boulderState,
          restoredAt: new Date().toISOString(),
          restoredFrom: BOULDER_STATE_FILE,
        });

        return {
          success: true,
          data: {
            restored: true,
            state: repairedState,
            repaired: repairedState !== currentState,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async detectStateMismatch(changeDir: string, currentState: string): Promise<string> {
      // R4-2: Delegate to canonical standalone function
      return detectStateMismatch(changeDir, currentState);
    },

    async persistState(changeDir: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const stateExists = await fileExists(statePath);
        if (!stateExists) {
          return { success: true, data: { persisted: false, reason: "No workflow state to persist" } };
        }

        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: true, data: { persisted: false, reason: "Empty workflow state" } };
        }

        const boulderPath = `${changeDir}/${BOULDER_STATE_FILE}`;
        await writeJsonFile(boulderPath, {
          ...state,
          persistedAt: new Date().toISOString(),
          version: 1,
          artifacts_hash: state.artifacts_hash || "",
          contract_hash: state.contract_hash || "",
          batches_completed: state.batches_completed || 0,
        });

        return {
          success: true,
          data: {
            persisted: true,
            state: state.state,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async getState(changeDir: string): Promise<FeatureResult> {
      try {
        return await wf.getState(changeDir);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async updateState(changeDir: string, updates: Record<string, unknown>): Promise<FeatureResult> {
      try {
        return await wf.transitionState(changeDir, (updates.state as string) || "exploring");
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async isContractApproved(changeDir: string): Promise<FeatureResult> {
      try {
        const state = await wf.getState(changeDir);
        if (!state.success) return state;
        return {
          success: true,
          data: { approved: (state.data as Record<string, unknown>)?.contractApproved || false },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async approveContract(changeDir: string): Promise<FeatureResult> {
      try {
        const current = await wf.getState(changeDir);
        if (!current.success) return current;
        const result = await wf.transitionState(changeDir, "approved-for-build");
        if (result.success) {
          await this.persistState(changeDir);
        }
        return {
          success: result.success,
          data: { approved: true, timestamp: new Date().toISOString() },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async upgradeMode(changeDir: string, newMode: string, reason: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: false, error: "State file not found" };
        }

        const previousMode = state.mode;
        state.mode = newMode;
        state.updatedAt = new Date().toISOString();
        state.upgradedFrom = previousMode;
        state.upgradeReason = reason;
        state.upgradedAt = new Date().toISOString();

        await atomicWriteJsonFile(statePath, state);

        await this.persistState(changeDir);

        return {
          success: true,
          data: {
            upgraded: true,
            from: previousMode,
            to: newMode,
            reason,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async setBuildPause(changeDir: string, pauseType: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: false, error: "State file not found" };
        }
        state.build_pause = pauseType;
        state.buildPauseSetAt = new Date().toISOString();
        state.updatedAt = new Date().toISOString();
        await atomicWriteJsonFile(statePath, state);
        return { success: true, data: { build_pause: pauseType, timestamp: new Date().toISOString() } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async clearBuildPause(changeDir: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: false, error: "State file not found" };
        }
        state.build_pause = null;
        state.buildPauseClearedAt = new Date().toISOString();
        state.updatedAt = new Date().toISOString();
        await atomicWriteJsonFile(statePath, state);
        return { success: true, data: { build_pause: null, timestamp: new Date().toISOString() } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    
    async updateSubagentProgress(
      changeDir: string,
      checkpoint: {
        planTask: string;
        specTask?: string;
        stage: 'implementing' | 'spec-review' | 'quality-review' | 'checkoff' | 'done' | 'blocked' | 'final-review' | 'final-fix';
        reviewFixRound?: number;
        commitHash?: string;
        changedFiles?: string[];
        redEvidence?: string;
        greenEvidence?: string;
        specCompliance?: 'pending' | 'pass' | 'fail';
        qualityStatus?: 'pending' | 'pass' | 'fail';
        unresolvedFeedback?: string[];
      },
    ): Promise<FeatureResult> {
      try {
        const progressPath = changeDir + '/.sflow/subagent-progress.md';
        const now = new Date().toISOString();
        const lines: string[] = [];
        lines.push('# Subagent Progress Checkpoint', '');
        lines.push('## Current Task');
        lines.push('- **Plan task**: ' + checkpoint.planTask);
        if (checkpoint.specTask) lines.push('- **Mapped spec task**: ' + checkpoint.specTask);
        lines.push('- **Stage**: ' + checkpoint.stage);
        if (checkpoint.reviewFixRound !== undefined) lines.push('- **Review-fix round**: ' + checkpoint.reviewFixRound);
        lines.push('', '## Implementation');
        if (checkpoint.commitHash) lines.push('- **Commit**: ' + checkpoint.commitHash);
        if (checkpoint.changedFiles) lines.push('- **Changed files**: ' + checkpoint.changedFiles.join(', '));
        if (checkpoint.redEvidence) lines.push('- **RED evidence**: ' + checkpoint.redEvidence);
        if (checkpoint.greenEvidence) lines.push('- **GREEN evidence**: ' + checkpoint.greenEvidence);
        lines.push('', '## Review Status');
        lines.push('- **Spec compliance**: ' + (checkpoint.specCompliance || 'pending'));
        lines.push('- **Code quality**: ' + (checkpoint.qualityStatus || 'pending'));
        if (checkpoint.unresolvedFeedback && checkpoint.unresolvedFeedback.length > 0) {
          lines.push('- **Unresolved feedback**: ' + checkpoint.unresolvedFeedback.join('; '));
        }
        lines.push('', '_Updated: ' + now + '_');
        await ensureDir(changeDir + '/.sflow');
        const { writeFile } = await import('fs/promises');
        await writeFile(progressPath, lines.join('\n'), 'utf-8');
        return { success: true, data: { written: true, stage: checkpoint.stage, timestamp: now } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
async isContractStale(changeDir: string): Promise<FeatureResult> {
      try {
        const stateExists = await fileExists(`${changeDir}/.sflow/state.json`);
        const contractPath = `${changeDir}/execution-contract.md`;
        const contractExists = await fileExists(contractPath);

        if (!stateExists || !contractExists) {
          return { success: true, data: { stale: false } };
        }

        const stale = await checkContractStale(changeDir);
        return { success: true, data: { stale } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
},
  };
}

async function simpleHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
