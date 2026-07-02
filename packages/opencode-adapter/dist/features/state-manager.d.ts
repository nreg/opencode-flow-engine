import type { FeatureConfig, FeatureResult } from './types.js';
import { createWorkflowManager } from './workflow-manager.js';
type WorkflowManager = ReturnType<typeof createWorkflowManager>;
export declare function createStateManager(config?: FeatureConfig, workflowManager?: WorkflowManager): {
    name: string;
    config: FeatureConfig;
    getWorkflowManager: () => {
        name: string;
        config: FeatureConfig;
        initialize(): Promise<FeatureResult>;
        startWorkflow(changeDir: string): Promise<FeatureResult>;
        getState(changeDir: string): Promise<FeatureResult>;
        transitionState(changeDir: string, newState: string): Promise<FeatureResult>;
        completeWorkflow(changeDir: string): Promise<FeatureResult>;
    };
    initialize(): Promise<FeatureResult>;
    getState(changeDir: string): Promise<FeatureResult>;
    updateState(changeDir: string, updates: Record<string, unknown>): Promise<FeatureResult>;
    isContractApproved(changeDir: string): Promise<FeatureResult>;
    approveContract(changeDir: string): Promise<FeatureResult>;
    isContractStale(changeDir: string): Promise<FeatureResult>;
};
export {};
