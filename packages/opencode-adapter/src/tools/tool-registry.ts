/**
 * Tool Registry - Manages tool registration and execution
 * Based on oh-my-openagent's tool registry pattern
 */

import type { ToolName, ToolDefinition, ToolContext, ToolResult } from './types.js';
import {
  createWorkflowRouterTool,
  createContractValidatorTool,
  createArtifactInspectorTool,
} from './index.js';

/**
 * Tool registry with factory functions
 */
const TOOL_REGISTRY: Record<ToolName, () => ToolDefinition> = {
  workflow_router: createWorkflowRouterTool,
  contract_validator: createContractValidatorTool,
  artifact_inspector: createArtifactInspectorTool,
};

/**
 * Tool registry instance
 */
export class ToolRegistry {
  private tools: Map<ToolName, ToolDefinition> = new Map();
  private disabledTools: Set<ToolName> = new Set();

  /**
   * Initialize the tool registry
   */
  initialize(): void {
    for (const [name, factory] of Object.entries(TOOL_REGISTRY)) {
      const tool = factory();
      this.tools.set(name as ToolName, tool);
    }
  }

  /**
   * Get a tool by name
   */
  getTool(name: ToolName): ToolDefinition | undefined {
    if (this.disabledTools.has(name)) {
      return undefined;
    }
    return this.tools.get(name);
  }

  /**
   * Execute a tool
   */
  async executeTool(
    name: ToolName,
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult> {
    const tool = this.getTool(name);
    if (!tool) {
      return {
        success: false,
        error: `Tool not found or disabled: ${name}`,
      };
    }

    try {
      return await tool.execute(params, context);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Disable a tool
   */
  disableTool(name: ToolName): void {
    this.disabledTools.add(name);
  }

  /**
   * Enable a tool
   */
  enableTool(name: ToolName): void {
    this.disabledTools.delete(name);
  }

  /**
   * Check if tool is enabled
   */
  isToolEnabled(name: string): boolean {
    if (!this.tools.has(name as ToolName)) return false;
    return !this.disabledTools.has(name as ToolName);
  }

  /**
   * Get all enabled tools
   */
  getEnabledTools(): ToolName[] {
    return Array.from(this.tools.keys()).filter(name => !this.disabledTools.has(name));
  }

  /**
   * Get all disabled tools
   */
  getDisabledTools(): ToolName[] {
    return Array.from(this.disabledTools);
  }

  /**
   * Get tool count
   */
  getToolCount(): { total: number; enabled: number; disabled: number } {
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
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.initialize();
  return registry;
}

/**
 * Get all tool names
 */
export function getToolNames(): ToolName[] {
  return Object.keys(TOOL_REGISTRY) as ToolName[];
}

/**
 * Check if tool exists
 */
export function toolExists(name: string): name is ToolName {
  return name in TOOL_REGISTRY;
}
