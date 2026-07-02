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
    /**
     * Initialize the workflow manager
     */
    initialize(): Promise<FeatureResult>;
    /**
     * Start a new workflow
     */
    startWorkflow(changeDir: string): Promise<FeatureResult>;
    /**
     * Get current workflow state
     */
    getState(changeDir: string): Promise<FeatureResult>;
    /**
     * Transition to new state
     */
    transitionState(changeDir: string, newState: string): Promise<FeatureResult>;
    /**
     * Complete workflow
     */
    completeWorkflow(changeDir: string): Promise<FeatureResult>;
};
//# sourceMappingURL=workflow-manager.d.ts.map