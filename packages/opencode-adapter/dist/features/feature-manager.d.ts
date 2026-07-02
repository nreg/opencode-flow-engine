/**
 * Feature Manager - Manages all sFlow features
 */
import type { FeatureConfig, FeatureResult } from './types.js';
import { type Skill, type SkillLoader } from './skill-loader.js';
import { type McpManager } from './mcp-manager.js';
export interface FeatureManagerConfig {
    workflowManager?: FeatureConfig;
    stateManager?: FeatureConfig;
    skillsDir?: string;
}
export declare class FeatureManager {
    private workflowManager;
    private stateManager;
    private skillLoader;
    private mcpManager;
    private config;
    private initialized;
    constructor(config?: FeatureManagerConfig);
    initialize(): Promise<FeatureResult>;
    private requireInitialized;
    getWorkflowManager(): {
        name: string;
        config: FeatureConfig;
        initialize(): Promise<FeatureResult>;
        startWorkflow(changeDir: string): Promise<FeatureResult>;
        getState(changeDir: string): Promise<FeatureResult>;
        transitionState(changeDir: string, newState: string): Promise<FeatureResult>;
        completeWorkflow(changeDir: string): Promise<FeatureResult>;
    };
    getStateManager(): {
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
    getSkillLoader(): SkillLoader | null;
    getMcpManager(): McpManager;
    getSkills(): Skill[];
    getSkill(name: string): Skill | undefined;
    getStatus(): Record<string, unknown>;
}
export declare function createFeatureManager(config?: FeatureManagerConfig): FeatureManager;
