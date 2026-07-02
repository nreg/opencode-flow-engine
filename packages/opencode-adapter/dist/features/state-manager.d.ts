/**
 * State Manager feature - Manage workflow state
 */
import type { FeatureConfig, FeatureResult } from './types.js';
/**
 * Create the state manager feature
 */
export declare function createStateManager(config?: FeatureConfig): {
    name: string;
    config: FeatureConfig;
    /**
     * Initialize the state manager
     */
    initialize(): Promise<FeatureResult>;
    /**
     * Get current state
     */
    getState(changeDir: string): Promise<FeatureResult>;
    /**
     * Update state
     */
    updateState(changeDir: string, updates: Record<string, unknown>): Promise<FeatureResult>;
    /**
     * Check if contract is approved
     */
    isContractApproved(changeDir: string): Promise<FeatureResult>;
    /**
     * Approve contract
     */
    approveContract(changeDir: string): Promise<FeatureResult>;
    /**
     * Check if contract is stale
     */
    isContractStale(changeDir: string): Promise<FeatureResult>;
};
//# sourceMappingURL=state-manager.d.ts.map