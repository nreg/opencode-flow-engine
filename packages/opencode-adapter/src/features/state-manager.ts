import type { FeatureConfig, FeatureResult } from './types.js';
import { createWorkflowManager } from './workflow-manager.js';
import { fileExists, readJsonFile } from '@opencode-sflow/shared';

type WorkflowManager = ReturnType<typeof createWorkflowManager>;

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
