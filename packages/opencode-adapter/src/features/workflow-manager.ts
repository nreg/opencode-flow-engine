/**
 * Workflow Manager feature - Manage workflow execution
 */

import type { FeatureConfig, FeatureResult } from './types.js';
import { Validator } from '@opencode-sflow/core';
import { readJsonFile, writeJsonFile, ensureDir } from '@opencode-sflow/shared';
import { isValidTransition, getValidTransitions } from '@opencode-sflow/core';

/**
 * Create the workflow manager feature
 */
export function createWorkflowManager(config: FeatureConfig = { enabled: true }) {
  return {
    name: 'workflow_manager',
    config,
    
    /**
     * Initialize the workflow manager
     */
    async initialize(): Promise<FeatureResult> {
      if (!config.enabled) {
        return { success: true, data: { message: 'Workflow manager disabled' } };
      }

      console.log('Workflow manager initialized');
      return { success: true };
    },

    /**
     * Start a new workflow
     */
    async startWorkflow(changeDir: string): Promise<FeatureResult> {
      try {
        // Create change directory structure
        await createChangeDirectory(changeDir);
        
        // Initialize state file
        await initializeStateFile(changeDir);
        
        return {
          success: true,
          data: {
            changeDir,
            state: 'exploring',
            message: 'Workflow started',
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
     * Get current workflow state
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
     * Transition to new state
     */
    async transitionState(changeDir: string, newState: string): Promise<FeatureResult> {
      try {
        const currentState = await readStateFile(changeDir);

        if (!isValidTransition(currentState.state, newState)) {
          return {
            success: false,
            error: `Invalid transition from ${currentState.state} to ${newState}`,
          };
        }

        // Update state
        await updateStateFile(changeDir, {
          ...currentState,
          state: newState,
          updatedAt: new Date().toISOString(),
        });

        return {
          success: true,
          data: {
            from: currentState.state,
            to: newState,
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
     * Complete workflow
     */
    async completeWorkflow(changeDir: string): Promise<FeatureResult> {
      try {
        // Archive the change
        await archiveChange(changeDir);
        
        return {
          success: true,
          data: {
            changeDir,
            message: 'Workflow completed and archived',
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
const STATE_FILE = '.sflow/state.json';

async function createChangeDirectory(changeDir: string): Promise<void> {
  const stateDir = `${changeDir}/.sflow`;
  await ensureDir(stateDir);
  await writeJsonFile(`${changeDir}/${STATE_FILE}`, {
    state: 'exploring',
    mode: 'full',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

async function initializeStateFile(changeDir: string): Promise<void> {
  const stateFile = `${changeDir}/${STATE_FILE}`;
  const existing = await readJsonFile(stateFile);
  if (!existing) {
    await ensureDir(`${changeDir}/.sflow`);
    await writeJsonFile(stateFile, {
      state: 'exploring',
      mode: 'full',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

async function readStateFile(changeDir: string): Promise<{
  state: string;
  mode: string;
  updatedAt: string;
}> {
  const state = await readJsonFile<{ state: string; mode: string; updatedAt: string }>(`${changeDir}/${STATE_FILE}`);
  return state || { state: 'exploring', mode: 'full', updatedAt: new Date().toISOString() };
}

async function updateStateFile(changeDir: string, state: Record<string, unknown>): Promise<void> {
  await writeJsonFile(`${changeDir}/${STATE_FILE}`, state);
}

async function archiveChange(changeDir: string): Promise<void> {
  const archiveDir = `${changeDir}/.sflow/archive`;
  await ensureDir(archiveDir);
  await Bun.write(`${archiveDir}/archived-at.txt`, new Date().toISOString());
}
