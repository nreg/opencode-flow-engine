/**
 * State manager factory function.
 * Extracted from index.ts to maintain pure re-export pattern.
 */

import type { FeatureConfig, FeatureResult } from "../types.js";
import { createWorkflowManager } from "../workflow-manager.js";
import { fileExists, readJsonFile, writeJsonFile, atomicWriteJsonFile, ensureDir, readFile, directoryExists, isContractStale as checkContractStale, writeFile } from "@opencode-flow-engine/shared";
import { parseLessonsMd, formatLessonEntry, searchLessonsInFile } from './lessons.js';
import { writeProgressFile, readProgressFile, detectProgressAntiRepeat } from './progress.js';
import { BOULDER_STATE_FILE, detectStateMismatch } from './state-detection.js';
import { artifactExists } from './artifact-paths.js';

type WorkflowManager = ReturnType<typeof createWorkflowManager>;

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

        // AFK: force deactivate if restoring from terminal state
        if (currentState === 'closing' || currentState === 'abandoned') {
          boulderState.afk = false;
          boulderState.afkTier = 0;
        }

        const statePath = `${changeDir}/.flow-engine/sflow/state.json`;
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
        const statePath = `${changeDir}/.flow-engine/sflow/state.json`;
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
        const statePath = `${changeDir}/.flow-engine/sflow/state.json`;
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
        const statePath = `${changeDir}/.flow-engine/sflow/state.json`;
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
        const statePath = `${changeDir}/.flow-engine/sflow/state.json`;
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

    // ─── LESSONS.md Methods ────────────────────────────────────────────────

    async grepLessons(changeDir: string, keywords: string[]): Promise<FeatureResult> {
      try {
        const hits = await searchLessonsInFile(changeDir, keywords);
        return { success: true, data: { hits } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async addLesson(changeDir: string, entry: import('./lessons.js').LessonEntry): Promise<FeatureResult> {
      try {
        const lessonsPath = changeDir + '/.flow-engine/sflow/lessons.md';
        const existing = await readFile(lessonsPath);
        const entries = existing ? parseLessonsMd(existing) : [];
        const nextIndex = entries.length + 1;

        // P35: Validate keywords — warn if too few or auto-generated
        if (entry.keywords.length < 3) {
          console.warn('[SFLOW] Lesson has fewer than 3 keywords. Consider adding more specific keywords for better searchability.');
        }
        const looksAutoGenerated = entry.keywords.length > 0 && entry.keywords.every(k =>
          k === k.toLowerCase() && /^[a-z\u4e00-\u9fff]+$/.test(k)
        );
        if (looksAutoGenerated) {
          console.warn('[SFLOW] Lesson keywords appear auto-generated. Consider manually specifying more descriptive keywords (e.g., technology names, error codes, file paths).');
        }

        // P13: Expand duplicate detection — also checks title + keyword overlap for partial matches
        const isDuplicate = entries.some((existingEntry: import('./lessons.js').LessonEntry) => {
          // Exact match: same problem and attempted approach
          if (existingEntry.problem === entry.problem && existingEntry.attempted === entry.attempted) return true;
          // Fuzzy match: same problem AND significant keyword overlap (70%+)
          if (existingEntry.problem === entry.problem) {
            const existingKeywords = new Set(existingEntry.keywords.map((k: string) => k.toLowerCase()));
            const newKeywords = entry.keywords.map((k: string) => k.toLowerCase());
            const overlap = newKeywords.filter((k: string) => existingKeywords.has(k)).length;
            const ratio = newKeywords.length > 0 ? overlap / newKeywords.length : 0;
            if (ratio >= 0.7) return true;
          }
          // Title match: same or highly similar title
          if (existingEntry.title.toLowerCase() === entry.title.toLowerCase()) return true;
          return false;
        });
        if (isDuplicate) {
          return {
            success: true,
            data: { added: false, reason: 'Duplicate lesson: same or highly similar entry already exists', id: null },
          };
        }

        const formatted = '\n\n' + formatLessonEntry(nextIndex, { ...entry, firstSeen: entry.firstSeen || new Date().toISOString(), lastReviewed: new Date().toISOString() });
        if (!existing) {
          const header = '# LESSONS — 跨任务失败知识库\n\n';
          await ensureDir(changeDir + '/.flow-engine/sflow');
          await writeFile(lessonsPath, header + formatted.trim());
        } else {
          await writeFile(lessonsPath, existing.replace(/\n*$/, '') + formatted);
        }
        return { success: true, data: { added: true, id: 'L-' + String(nextIndex).padStart(3, '0'), timestamp: new Date().toISOString() } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    // ─── PROGRESS.md Methods ───────────────────────────────────────────────

    async writeProgress(changeDir: string, data: import('./progress.js').ProgressData): Promise<FeatureResult> {
      try {
        await writeProgressFile(changeDir, data);
        return { success: true, data: { written: true, taskId: data.taskId, timestamp: new Date().toISOString() } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async readProgress(changeDir: string): Promise<FeatureResult> {
      try {
        const data = await readProgressFile(changeDir);
        return { success: true, data: data || null };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async checkProgressAntiRepeat(changeDir: string, plannedApproach: string): Promise<FeatureResult> {
      try {
        const result = await detectProgressAntiRepeat(changeDir, plannedApproach);
        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async writeProgressSnapshot(changeDir: string, data: { taskId?: string; currentState: string; nextStep?: string; excludedApproaches: import('./progress.js').ExcludedApproach[] }): Promise<FeatureResult> {
      try {
        const progressData: import('./progress.js').ProgressData = {
          taskId: data.taskId,
          pausedAt: new Date().toISOString(),
          trigger: 'Manual snapshot',
          completedSteps: [],
          currentState: data.currentState,
          nextStep: data.nextStep,
          excludedApproaches: data.excludedApproaches,
          pendingAssumptions: [],
          clues: [],
        };
        await writeProgressFile(changeDir, progressData);
        return { success: true, data: { written: true, timestamp: new Date().toISOString() } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },

    async addLessonsFromProgress(changeDir: string, taskId?: string): Promise<FeatureResult> {
      try {
        const progress = await readProgressFile(changeDir);
        if (!progress || progress.excludedApproaches.length === 0) {
          return { success: true, data: { nominated: 0, reason: 'No excluded approaches found in PROGRESS.md' } };
        }

        // Filter to approaches with actual failures
        const candidates = progress.excludedApproaches.filter((ex: import('./progress.js').ExcludedApproach) => ex.failCount >= 1);
        if (candidates.length === 0) {
          return { success: true, data: { nominated: 0, reason: 'No excluded approaches with failCount >= 1' } };
        }

        const nominatedIds: string[] = [];
        for (const ex of candidates) {
          const lessonEntry: import('./lessons.js').LessonEntry = {
            title: ex.approach.length > 80 ? ex.approach.slice(0, 80) + '...' : ex.approach,
            tags: ['proc'],
            keywords: ex.approach.split(/\s+/).filter((k: string) => k.length >= 3),
            taskId: taskId || progress.taskId,
            firstSeen: new Date().toISOString(),
            lastReviewed: new Date().toISOString(),
            status: 'active',
            problem: '任务执行中遇到方案失败',
            attempted: ex.approach,
            whyFailed: ex.reason || '未记录具体失败原因',
            recommendation: '参考 PROGRESS.md 中已排除方案的排除理由，选择其他方案',
            reevaluateWhen: '条件变化后可重新评估',
          };

          const result = await this.addLesson(changeDir, lessonEntry);
          const resultData = result.data as { id?: string } | undefined;
          if (result.success && resultData?.id) {
            nominatedIds.push(resultData.id);
          }
        }

        return {
          success: true,
          data: {
            nominated: nominatedIds.length,
            ids: nominatedIds,
            total: candidates.length,
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

    async clearProgressSnapshot(changeDir: string): Promise<FeatureResult> {
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(changeDir + '/.flow-engine/sflow/progress.md');
        return { success: true, data: { cleared: true, timestamp: new Date().toISOString() } };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // File not found is not an error
        if (msg.includes('ENOENT')) return { success: true, data: { cleared: true } };
        return { success: false, error: msg };
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
        const progressPath = changeDir + '/.flow-engine/sflow/subagent-progress.md';
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
        await ensureDir(changeDir + '/.flow-engine/sflow');
        await writeFile(progressPath, lines.join('\n'));
        return { success: true, data: { written: true, stage: checkpoint.stage, timestamp: now } };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async isContractStale(changeDir: string): Promise<FeatureResult> {
      try {
        const stateExists = await fileExists(`${changeDir}/.flow-engine/sflow/state.json`);
        const contractExists = await artifactExists(changeDir, 'execution-contract.md');

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
