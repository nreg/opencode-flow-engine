/**
 * Workflow Manager feature - Manage workflow execution
 */
import type { FeatureConfig, FeatureResult } from './types.js';
/**
 * Create the workflow manager feature
 */
export declare function createWorkflowManager(config?: FeatureConfig): {
    name: string;
    config: FeatureConfig;
    initialize(): Promise<FeatureResult>;
    startWorkflow(changeDir: string): Promise<FeatureResult>;
    getState(changeDir: string): Promise<FeatureResult>;
    transitionState(changeDir: string, newState: string): Promise<FeatureResult>;
    completeWorkflow(changeDir: string): Promise<FeatureResult>;
};
