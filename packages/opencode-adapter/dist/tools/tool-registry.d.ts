/**
 * Tool Registry - Manages tool registration and execution
 * Based on oh-my-openagent's tool registry pattern
 */
import type { ToolName, ToolDefinition, ToolContext, ToolResult } from './types.js';
/**
 * Tool registry instance
 */
export declare class ToolRegistry {
    private tools;
    private disabledTools;
    /**
     * Initialize the tool registry
     */
    initialize(): void;
    /**
     * Get a tool by name
     */
    getTool(name: ToolName): ToolDefinition | undefined;
    /**
     * Execute a tool
     */
    executeTool(name: ToolName, params: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
    /**
     * Disable a tool
     */
    disableTool(name: ToolName): void;
    /**
     * Enable a tool
     */
    enableTool(name: ToolName): void;
    /**
     * Check if tool is enabled
     */
    isToolEnabled(name: string): boolean;
    /**
     * Get all enabled tools
     */
    getEnabledTools(): ToolName[];
    /**
     * Get all disabled tools
     */
    getDisabledTools(): ToolName[];
    /**
     * Get tool count
     */
    getToolCount(): {
        total: number;
        enabled: number;
        disabled: number;
    };
}
/**
 * Create a tool registry instance
 */
export declare function createToolRegistry(): ToolRegistry;
/**
 * Get all tool names
 */
export declare function getToolNames(): ToolName[];
/**
 * Check if tool exists
 */
export declare function toolExists(name: string): name is ToolName;
//# sourceMappingURL=tool-registry.d.ts.map