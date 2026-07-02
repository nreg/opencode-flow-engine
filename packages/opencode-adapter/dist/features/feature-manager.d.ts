/**
 * Feature Manager - Manages all sFlow features
 */
import type { FeatureConfig, FeatureResult } from './types.js';
import { type Skill } from './skill-loader.js';
import { type McpManager } from './mcp-manager.js';
/**
 * Feature manager configuration
 */
export interface FeatureManagerConfig {
    workflowManager?: FeatureConfig;
    stateManager?: FeatureConfig;
    skillsDir?: string;
}
/**
 * Feature manager class
 */
export declare class FeatureManager {
    private workflowManager;
    private stateManager;
    private skillLoader;
    private mcpManager;
    private config;
    constructor(config?: FeatureManagerConfig);
    /**
     * Initialize all features
     */
    initialize(): Promise<FeatureResult>;
    /**
     * Get workflow manager
     */
    getWorkflowManager(): {
        name: string;
        config: FeatureConfig;
        initialize(): Promise<FeatureResult>;
        startWorkflow(changeDir: string): Promise<FeatureResult>;
        getState(changeDir: string): Promise<FeatureResult>;
        transitionState(changeDir: string, newState: string): Promise<FeatureResult>;
        completeWorkflow(changeDir: string): Promise<FeatureResult>;
    };
    /**
     * Get state manager
     */
    getStateManager(): {
        name: string;
        config: FeatureConfig;
        initialize(): Promise<FeatureResult>;
        getState(changeDir: string): Promise<FeatureResult>;
        updateState(changeDir: string, updates: Record<string, unknown>): Promise<FeatureResult>;
        isContractApproved(changeDir: string): Promise<FeatureResult>;
        approveContract(changeDir: string): Promise<FeatureResult>;
        isContractStale(changeDir: string): Promise<FeatureResult>;
    };
    /**
     * Get skill loader
     */
    getSkillLoader(): import("./skill-loader.js").SkillLoader;
    /**
     * Get MCP manager
     */
    getMcpManager(): McpManager;
    /**
     * Get all loaded skills
     */
    getSkills(): Skill[];
    /**
     * Get skill by name
     */
    getSkill(name: string): Skill | undefined;
    /**
     * Get feature status
     */
    getStatus(): Record<string, unknown>;
}
/**
 * Create a feature manager instance
 */
export declare function createFeatureManager(config?: FeatureManagerConfig): FeatureManager;
//# sourceMappingURL=feature-manager.d.ts.map