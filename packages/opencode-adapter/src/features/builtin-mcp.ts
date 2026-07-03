/**
 * Built-in validation tools for sFlow
 *
 * Rather than implementing a custom MCP protocol server (which would require
 * stdio JSON-RPC framing), validation logic is exposed as OpenCode ToolDefinition
 * objects registered through the standard tool registration path.
 *
 * This follows oh-my-openagent's principle: if a capability fits naturally as
 * a tool, serve it as a tool — not as an MCP server.
 */

import type { ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';
import { sharedValidator } from '@opencode-sflow/core';

/**
 * Create all built-in validation tool definitions.
 * These mirror the methods that were previously behind a custom MCP server.
 */
export function createValidatorTools(): Record<string, ToolDefinition> {
  return {
    validate_spec: {
      description: 'Validate a spec file content (Purpose section, requirements with SHALL/MUST, scenarios)',
      args: {
        name: z.string().describe('Spec name (e.g. "auth-service")'),
        content: z.string().describe('Full spec markdown content'),
      },
      execute: async (args: { name: string; content: string }) => {
        const report = sharedValidator.validateSpecContent(args.name, args.content);
        return {
          title: 'Spec Validation',
          output: JSON.stringify(report, null, 2),
        };
      },
    },

    validate_proposal: {
      description: 'Validate a proposal markdown content (Why section and What Changes section)',
      args: {
        content: z.string().describe('Full proposal markdown content'),
      },
      execute: async (args: { content: string }) => {
        const report = sharedValidator.validateChangeContent('proposal', args.content);
        return {
          title: 'Proposal Validation',
          output: JSON.stringify(report, null, 2),
        };
      },
    },

    validate_delta_spec: {
      description: 'Validate a delta spec (ADDED/MODIFIED/REMOVED/RENAMED operations with cross-section conflict detection)',
      args: {
        content: z.string().describe('Delta spec markdown content'),
        changeName: z.string().optional().describe('Change name for context'),
      },
      execute: async (args: { content: string; changeName?: string }) => {
        const report = sharedValidator.validateDeltaSpec(args.content, args.changeName || 'unnamed');
        return {
          title: 'Delta Spec Validation',
          output: JSON.stringify(report, null, 2),
        };
      },
    },

    validate_tasks: {
      description: 'Validate a tasks.md file for completeness and task definitions',
      args: {
        content: z.string().describe('Tasks markdown content'),
      },
      execute: async (args: { content: string }) => {
        const report = sharedValidator.validateTasks(args.content);
        return {
          title: 'Tasks Validation',
          output: JSON.stringify(report, null, 2),
        };
      },
    },

    validate_contract: {
      description: 'Validate an execution contract for required sections (Intent Lock, Approved Behavior, Design Constraints, Task Batches, Test Obligations)',
      args: {
        content: z.string().describe('Execution contract markdown content'),
      },
      execute: async (args: { content: string }) => {
        const report = sharedValidator.validateExecutionContract(args.content);
        return {
          title: 'Contract Validation',
          output: JSON.stringify(report, null, 2),
        };
      },
    },

    validate_design: {
      description: 'Validate a design.md file for required sections (Architecture Decision, Design Constraints, Implementation Approach)',
      args: {
        content: z.string().describe('Design markdown content'),
      },
      execute: async (args: { content: string }) => {
        const report = sharedValidator.validateDesign(args.content);
        return {
          title: 'Design Validation',
          output: JSON.stringify(report, null, 2),
        };
      },
    },

    validate_implementation: {
      description: 'Validate implementation against spec and design (Completeness, Correctness, Coherence dimensions)',
      args: {
        diffSummary: z.string().describe('Git diff or change summary of the implementation'),
        specContent: z.string().describe('Full spec content to validate against'),
        designContent: z.string().optional().describe('Design content for coherence check'),
      },
      execute: async (args: { diffSummary: string; specContent: string; designContent?: string }) => {
        const report = sharedValidator.validateImplementation(
          args.diffSummary,
          args.specContent,
          args.designContent || '',
        );
        return {
          title: 'Implementation Validation',
          output: JSON.stringify(report, null, 2),
        };
      },
    },

    detect_sync_conflicts: {
      description: 'Detect sync conflicts across multiple delta specs (requirements modified by multiple changes)',
      args: {
        deltaSpecs: z.string().describe('JSON array of { changeName: string, content: string } objects'),
      },
      execute: async (args: { deltaSpecs: string }) => {
        let deltaSpecs: Array<{ changeName: string; content: string }>;
        try {
          deltaSpecs = JSON.parse(args.deltaSpecs);
        } catch {
          return {
            title: 'Sync Conflict Detection',
            output: JSON.stringify({ hasConflicts: false, conflicts: [], error: 'Invalid JSON in deltaSpecs' }, null, 2),
          };
        }
        const report = sharedValidator.detectSyncConflicts(deltaSpecs);
        return {
          title: 'Sync Conflict Detection',
          output: JSON.stringify(report, null, 2),
        };
      },
    },
  };
}

/**
 * Builtin MCP registry (retained for backward compatibility)
 * Now wraps ToolDefinitions instead of a custom MCP protocol.
 */
export class BuiltinMcpRegistry {
  private tools: Record<string, ToolDefinition> = {};

  constructor() {
    this.tools = createValidatorTools();
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools[name];
  }

  getAllTools(): Record<string, ToolDefinition> {
    return { ...this.tools };
  }
}
