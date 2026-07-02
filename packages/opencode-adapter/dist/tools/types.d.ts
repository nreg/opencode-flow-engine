/**
 * Tool types for sFlow
 */
/**
 * Available tool names
 */
export type ToolName = 'workflow_router' | 'contract_validator' | 'artifact_inspector';
/**
 * Tool definition interface
 */
export interface ToolDefinition {
    name: ToolName;
    description: string;
    parameters: Record<string, unknown>;
    execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}
/**
 * Tool context
 */
export interface ToolContext {
    changeDir: string;
    stateFile: string;
    pluginRoot: string;
}
/**
 * Tool result
 */
export interface ToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
    suggestions?: string[];
}
