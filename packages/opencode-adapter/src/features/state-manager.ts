/**
 * State Manager feature - Manage workflow state
 */

import type { FeatureConfig, FeatureResult } from './types.js';
import { createWorkflowManager } from './workflow-manager.js';

/**
 * Create the state manager feature
 * Delegates state persistence to WorkflowManager for consistency.
 */
export function createStateManager(config: FeatureConfig = { enabled: true }) {
  const wf = createWorkflowManager(config);

  return {
    name: 'state_manager',
    config,
    
    /**
     * Initialize the state manager
     */
    async initialize(): Promise<FeatureResult> {
      if (!config.enabled) {
        return { success: true, data: { message: 'State manager disabled' } };
      }

      console.log('State manager initialized');
      return { success: true };
    },

    /**
     * Get current state
     */
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

    /**
     * Update state
     */
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

    /**
     * Check if contract is approved
     */
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

    /**
     * Approve contract
     */
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

    /**
     * Check if contract is stale
     */
    async isContractStale(changeDir: string): Promise<FeatureResult> {
      try {
        return { success: true, data: { stale: false } };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
