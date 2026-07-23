import { z } from 'zod';
import { execSync } from 'child_process';
import type { ToolDefinition } from '@opencode-ai/plugin';

export const TOOLS = ['jscpd', 'knip', 'depcheck', 'ts-prune'] as const;

export function checkToolAvailability(tools: string[]): Array<{ tool: string; status: 'available' | 'unavailable'; error?: string }> {
  return tools.map(tool => {
    try {
      execSync(`npx ${tool} --version`, { timeout: 10000, stdio: 'pipe' });
      return { tool, status: 'available' };
    } catch (e) {
      return { tool, status: 'unavailable', error: e instanceof Error ? e.message : String(e) };
    }
  });
}

export function createCheckToolAvailableTool(): ToolDefinition {
  return {
    description: 'Check if external CLI tools are available for execution',
    args: {
      tools: z.array(z.enum(TOOLS)).describe('List of tool names to check'),
    },
    execute: async (args) => {
      const results = checkToolAvailability(args.tools);
      return { title: 'Tool Availability Check', output: JSON.stringify(results, null, 2) };
    },
  };
}
