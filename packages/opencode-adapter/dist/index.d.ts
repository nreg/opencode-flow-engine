/**
 * sFlow OpenCode Plugin
 * Integrates OpenSpec planning engine with Superpowers execution discipline
 */
import type { PluginInput } from '@opencode-ai/plugin';
export { Validator } from '@opencode-sflow/core';
export type { Scenario, Requirement, Spec, DeltaOperationType, Rename, Delta, Change, WorkflowState, WorkflowMode, WorkflowStateFile, ValidationReport, ValidationIssue, VerificationReport, ConflictReport, } from '@opencode-sflow/core';
export { createSFlowAgent, createNeedExplorerAgent, createSpecWriterAgent, createContractBuilderAgent, createBuildExecutorAgent, createBugInvestigatorAgent, createCodeReviewerAgent, createReleaseArchivistAgent, createSpecMergerAgent, } from './agents/index.js';
export { createWorkflowRouterTool, createContractValidatorTool, createArtifactInspectorTool, } from './tools/index.js';
export { createStateTransitionHook, createArtifactValidationHook, createGuardHook, } from './hooks/index.js';
export { createWorkflowManager, createStateManager, } from './features/index.js';
export { deepMerge, fileExists, readFile, writeFile, listFiles } from '@opencode-sflow/shared';
/**
 * Plugin ID
 */
export declare const PLUGIN_ID = "opencode-sflow";
/**
 * Plugin version
 */
export declare const PLUGIN_VERSION = "0.1.0";
/**
 * Create the sFlow plugin
 */
export declare function createSFlowPlugin(ctx: PluginInput): {
    id: string;
    version: string;
    /**
     * Initialize the plugin
     */
    initialize(): Promise<{
        success: boolean;
    }>;
    /**
     * Get plugin info
     */
    getInfo(): {
        id: string;
        version: string;
        name: string;
        description: string;
        agents: string[];
        tools: string[];
        hooks: string[];
        features: string[];
    };
};
/**
 * Default export for OpenCode plugin system
 */
export default createSFlowPlugin;
//# sourceMappingURL=index.d.ts.map