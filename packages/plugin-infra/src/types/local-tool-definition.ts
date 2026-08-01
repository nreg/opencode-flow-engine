/**
 * Local ToolDefinition type to bypass zod v3/v4 type conflicts.
 *
 * Problem:
 * - Project uses zod 3.25.76
 * - @opencode-ai/plugin 1.17.x expects zod 4.x types (with _zod property)
 * - ToolDefinition.args expects ZodRawShape from zod v4, which requires _zod property
 * - zod v3 types don't have _zod property, causing TS2741 errors
 *
 * Solution:
 * - Define LocalToolDefinition with permissive args type (Record<string, unknown>)
 * - This maintains type safety for description and execute, while bypassing zod version conflict
 * - Runtime behavior unchanged: args are still validated by zod v3 at runtime
 */

import type { ToolContext, ToolResult } from '@opencode-ai/plugin';

/**
 * Local tool definition compatible with zod v3.
 * Use this instead of ToolDefinition from @opencode-ai/plugin to avoid _zod type errors.
 * 
 * IMPORTANT: We must use 'any' for args due to zod v3/v4 type incompatibility:
 * 
 * 1. @opencode-ai/plugin 1.17.x expects zod v4 types (with _zod property)
 * 2. This project uses zod 3.25.76 (without _zod property)
 * 3. Hooks.tool from @opencode-ai/plugin expects args: Readonly<{ [k: string]: $ZodType }>
 * 4. $ZodType requires _zod property which zod v3 types don't have
 * 5. Using Record<string, unknown> causes TS2322 errors in plugin factories
 * 
 * This is safe because:
 * - Runtime validation still happens via zod v3
 * - The execute function receives properly typed args via destructuring
 * - TypeScript still validates the execute function signature
 * - This is a well-documented workaround for zod version conflicts
 */
export interface LocalToolDefinition {
  description: string;
  args: any;  // MUST use 'any' - zod v3/v4 type incompatibility (see comment above)
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

/**
 * Helper type for tool factories that return multiple tools.
 */
export type ToolDefinitionMap = Record<string, LocalToolDefinition>;
