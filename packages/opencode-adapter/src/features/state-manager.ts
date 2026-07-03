import type { FeatureConfig, FeatureResult } from './types.js';
import { createWorkflowManager } from './workflow-manager.js';
import { fileExists, readJsonFile, writeJsonFile, ensureDir, readFile, writeFile } from '@opencode-sflow/shared';

const BOULDER_STATE_FILE = '.sflow/boulder-state.json';

type WorkflowManager = ReturnType<typeof createWorkflowManager>;

/**
 * Creates a state manager with boulder-state cross-session persistence.
 *
 * Boulder state stores the workflow context so that when OpenCode restarts,
 * the sFlow workflow can be recovered and continued from where it left off.
 *
 * Inspired by oh-my-openagent's boulder-state pattern:
 * - State is persisted to .sflow/boulder-state.json
 * - On session start, the state is recovered and injected into the workflow
 * - Key lifecycle events are recorded for audit trail
 */
export function createStateManager(
  config: FeatureConfig = { enabled: true },
  workflowManager?: WorkflowManager
) {
  const wf = workflowManager || createWorkflowManager(config);

  return {
    name: 'state_manager',
    config,
    getWorkflowManager: () => wf,

    async initialize(): Promise<FeatureResult> {
      if (!config.enabled) {
        return { success: true, data: { message: 'State manager disabled' } };
      }
      console.log('State manager initialized');
      return { success: true };
    },

    /**
     * Restore workflow state from boulder state file.
     * Called on session_start to recover cross-session workflow context.
     */
    async restoreState(changeDir: string): Promise<FeatureResult> {
      try {
        const boulderPath = `${changeDir}/${BOULDER_STATE_FILE}`;
        const exists = await fileExists(boulderPath);
        if (!exists) {
          return { success: true, data: { restored: false, reason: 'No boulder state found' } };
        }

        const boulderState = await readJsonFile<Record<string, unknown>>(boulderPath);
        if (!boulderState) {
          return { success: true, data: { restored: false, reason: 'Empty boulder state' } };
        }

        // Write recovered state to .sflow/state.json
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
            state: boulderState.state,
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

    /**
     * Persist current workflow state to boulder state file.
     * Called on session_end to enable cross-session recovery.
     */
    async persistState(changeDir: string): Promise<FeatureResult> {
      try {
        const statePath = `${changeDir}/.sflow/state.json`;
        const stateExists = await fileExists(statePath);
        if (!stateExists) {
          return { success: true, data: { persisted: false, reason: 'No workflow state to persist' } };
        }

        const state = await readJsonFile<Record<string, unknown>>(statePath);
        if (!state) {
          return { success: true, data: { persisted: false, reason: 'Empty workflow state' } };
        }

        // Write to boulder state file with persistence metadata
        const boulderPath = `${changeDir}/${BOULDER_STATE_FILE}`;
        await writeJsonFile(boulderPath, {
          ...state,
          persistedAt: new Date().toISOString(),
          version: 1,
          artifacts_hash: state.artifacts_hash || '',
          contract_hash: state.contract_hash || '',
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
        return await wf.transitionState(changeDir, updates.state as string || 'exploring');
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
        const result = await wf.transitionState(changeDir, 'approved-for-build');
        // Persist after state change
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

    async isContractStale(changeDir: string): Promise<FeatureResult> {
      try {
        const stateExists = await fileExists(`${changeDir}/.sflow/state.json`);
        const contractPath = `${changeDir}/execution-contract.md`;
        const contractExists = await fileExists(contractPath);

        if (!stateExists || !contractExists) {
          return { success: true, data: { stale: false } };
        }

        const { stat } = await import('fs/promises');
        const stateStats = await stat(`${changeDir}/.sflow/state.json`);
        const contractStats = await stat(contractPath);

        const stale = contractStats.mtimeMs > stateStats.mtimeMs;
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