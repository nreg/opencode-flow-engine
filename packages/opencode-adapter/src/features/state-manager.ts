/**
 * State Manager feature - Manage workflow state
 */

import type { FeatureConfig, FeatureResult } from './types.js';
import { readJsonFile, writeJsonFile, ensureDir, fileExists } from '@opencode-sflow/shared';

/**
 * Create the state manager feature
 */
export function createStateManager(config: FeatureConfig = { enabled: true }) {
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
        const state = await readStateFile(changeDir);
        return {
          success: true,
          data: state,
        };
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
        const currentState = await readStateFile(changeDir);
        const newState = { ...currentState, ...updates, updatedAt: new Date().toISOString() };
        
        await writeStateFile(changeDir, newState);
        
        return {
          success: true,
          data: newState,
        };
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
        const state = await readStateFile(changeDir);
        return {
          success: true,
          data: {
            approved: state.contractApproved || false,
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
     * Approve contract
     */
    async approveContract(changeDir: string): Promise<FeatureResult> {
      try {
        const state = await readStateFile(changeDir);
        const newState = {
          ...state,
          contractApproved: true,
          contractApprovedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        
        await writeStateFile(changeDir, newState);
        
        return {
          success: true,
          data: {
            approved: true,
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
     * Check if contract is stale
     */
    async isContractStale(changeDir: string): Promise<FeatureResult> {
      try {
        // TODO: Implement staleness detection
        // Compare proposal scope vs contract intent lock
        return {
          success: true,
          data: {
            stale: false,
          },
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

// Helper functions
const STATE_FILE_NAME = '.sflow/state.json';

async function readStateFile(changeDir: string): Promise<Record<string, unknown>> {
  const existing = await readJsonFile<Record<string, unknown>>(`${changeDir}/${STATE_FILE_NAME}`);
  if (existing) return existing;
  return {
    state: 'exploring',
    mode: 'full',
    contractApproved: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function writeStateFile(changeDir: string, state: Record<string, unknown>): Promise<void> {
  await ensureDir(`${changeDir}/.sflow`);
  const ok = await writeJsonFile(`${changeDir}/${STATE_FILE_NAME}`, state);
  if (!ok) throw new Error(`Failed to write state file: ${changeDir}/${STATE_FILE_NAME}`);
}
