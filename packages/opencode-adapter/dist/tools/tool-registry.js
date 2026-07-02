/**
 * Tool Registry - Manages tool registration and execution
 * Based on oh-my-openagent's tool registry pattern
 */
import { createWorkflowRouterTool, createContractValidatorTool, createArtifactInspectorTool, } from './index.js';
/**
 * Tool registry with factory functions
 */
const TOOL_REGISTRY = {
    workflow_router: createWorkflowRouterTool,
    contract_validator: createContractValidatorTool,
    artifact_inspector: createArtifactInspectorTool,
};
/**
 * Tool registry instance
 */
export class ToolRegistry {
    tools = new Map();
    disabledTools = new Set();
    /**
     * Initialize the tool registry
     */
    initialize() {
        for (const [name, factory] of Object.entries(TOOL_REGISTRY)) {
            const tool = factory();
            this.tools.set(name, tool);
        }
    }
    /**
     * Get a tool by name
     */
    getTool(name) {
        if (this.disabledTools.has(name)) {
            return undefined;
        }
        return this.tools.get(name);
    }
    /**
     * Execute a tool
     */
    async executeTool(name, params, context) {
        const tool = this.getTool(name);
        if (!tool) {
            return {
                success: false,
                error: `Tool not found or disabled: ${name}`,
            };
        }
        try {
            return await tool.execute(params, context);
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    /**
     * Disable a tool
     */
    disableTool(name) {
        this.disabledTools.add(name);
    }
    /**
     * Enable a tool
     */
    enableTool(name) {
        this.disabledTools.delete(name);
    }
    /**
     * Check if tool is enabled
     */
    isToolEnabled(name) {
        if (!this.tools.has(name))
            return false;
        return !this.disabledTools.has(name);
    }
    /**
     * Get all enabled tools
     */
    getEnabledTools() {
        return Array.from(this.tools.keys()).filter(name => !this.disabledTools.has(name));
    }
    /**
     * Get all disabled tools
     */
    getDisabledTools() {
        return Array.from(this.disabledTools);
    }
    /**
     * Get tool count
     */
    getToolCount() {
        return {
            total: this.tools.size,
            enabled: this.getEnabledTools().length,
            disabled: this.getDisabledTools().length,
        };
    }
}
/**
 * Create a tool registry instance
 */
export function createToolRegistry() {
    const registry = new ToolRegistry();
    registry.initialize();
    return registry;
}
/**
 * Get all tool names
 */
export function getToolNames() {
    return Object.keys(TOOL_REGISTRY);
}
/**
 * Check if tool exists
 */
export function toolExists(name) {
    return name in TOOL_REGISTRY;
}
//# sourceMappingURL=tool-registry.js.map