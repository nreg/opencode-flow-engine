/**
 * Workflow Router tool - State detection and routing
 */
import type { ToolDefinition } from './types.js';
/**
 * Create the workflow router tool
 */
export declare function createWorkflowRouterTool(): ToolDefinition;
/**
 * Unified contract staleness check
 * Used by workflow-router, contract-validator, and guard hook
 */
export declare function checkContractStaleness(changeDir: string): Promise<boolean>;
