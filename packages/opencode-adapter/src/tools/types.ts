/**
 * Tool types for sFlow
 * Aligned with @opencode-ai/plugin ToolDefinition
 */

import { z } from 'zod';

/**
 * Available tool names
 */
export type ToolName =
  | 'workflow_router'
  | 'contract_validator'
  | 'artifact_inspector';

/**
 * Tool context — aligned with @opencode-ai/plugin ToolContext
 */
export interface ToolContext {
  sessionID: string;
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): void;
}

/**
 * Tool result — aligned with @opencode-ai/plugin ToolResult
 * Uses a permissive type to support both the new format (title/output/metadata)
 * and the legacy format (success/data/error) from internal tools.
 */
import type { ToolResult as OpenCodeToolResult } from '@opencode-ai/plugin';

export type ToolResult = OpenCodeToolResult;

/**
 * Internal tool definition (before conversion to OpenCode ToolDefinition)
 */
export interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}
