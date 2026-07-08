/**
 * Built-in validation and workflow tools for sFlow.
 *
 * Rather than implementing a custom MCP protocol server (which would require
 * stdio JSON-RPC framing), validation and state-tracking logic is exposed as
 * OpenCode ToolDefinition objects registered through the standard tool
 * registration path.
 *
 * This follows oh-my-openagent's principle: if a capability fits naturally as
 * a tool, serve it as a tool — not as an MCP server.
 *
 * All file-based tools accept file paths instead of content to avoid
 * wasting tokens on inline content. Tools read files from disk using
 * context.directory to resolve paths.
 */

import type { ToolDefinition, ToolContext } from '@opencode-ai/plugin';
import { z } from 'zod';
import { sharedValidator } from '@opencode-sflow/core';

async function readFileContent(filePath: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function resolvePath(context: ToolContext, filePath?: string, defaultRelative?: string): string {
  if (filePath) return filePath;
  const dir = (context && context.directory) || '';
  return defaultRelative ? `${dir}/${defaultRelative}` : dir;
}

/**
 * Create all built-in validation tool definitions.
 * All accept file paths (not content) to minimize token usage.
 */
export function createValidatorTools(): Record<string, ToolDefinition> {
  return {
    validate_spec: {
      description: 'Validate a spec file. Reads from <dir>/.sflow/specs/<name>.md by default. Pass spec_path to use a different location.',
      args: {
        name: z.string().describe('Spec name (e.g. "auth-service")'),
        spec_path: z.string().optional().describe('Path to the spec markdown file. Defaults to <changeDir>/.sflow/specs/<name>.md'),
      },
      execute: async (args: { name: string; spec_path?: string }, context: ToolContext) => {
        const filePath = resolvePath(context, args.spec_path, `.sflow/specs/${args.name}.md`);
        const content = await readFileContent(filePath);
        if (content === null) {
          return { title: 'Spec Validation', output: JSON.stringify({ valid: false, issues: [{ level: 'ERROR', path: 'file', message: `Spec file not found: ${filePath}` }], summary: { errors: 1, warnings: 0, info: 0 } }, null, 2) };
        }
        const report = sharedValidator.validateSpecContent(args.name, content);
        return { title: 'Spec Validation', output: JSON.stringify(report, null, 2) };
      },
    },

    validate_proposal: {
      description: 'Validate a proposal file (Why section and What Changes section). Reads from <dir>/.sflow/proposal.md by default.',
      args: {
        proposal_path: z.string().optional().describe('Path to the proposal markdown file. Defaults to <changeDir>/.sflow/proposal.md'),
      },
      execute: async (args: { proposal_path?: string }, context: ToolContext) => {
        const filePath = resolvePath(context, args.proposal_path, '.sflow/proposal.md');
        const content = await readFileContent(filePath);
        if (content === null) {
          return { title: 'Proposal Validation', output: JSON.stringify({ valid: false, issues: [{ level: 'ERROR', path: 'file', message: `Proposal file not found: ${filePath}` }], summary: { errors: 1, warnings: 0, info: 0 } }, null, 2) };
        }
        const report = sharedValidator.validateChangeContent('proposal', content);
        return { title: 'Proposal Validation', output: JSON.stringify(report, null, 2) };
      },
    },

    validate_delta_spec: {
      description: 'Validate a delta spec file (ADDED/MODIFIED/REMOVED/RENAMED operations with cross-section conflict detection). Pass delta_spec_path or changeName (reads from <dir>/.sflow/delta-specs/<changeName>.md).',
      args: {
        delta_spec_path: z.string().optional().describe('Path to the delta spec markdown file. Defaults to <changeDir>/.sflow/delta-specs/<changeName>.md'),
        changeName: z.string().optional().describe('Change name (used to resolve default path). Required if delta_spec_path not provided.'),
      },
      execute: async (args: { delta_spec_path?: string; changeName?: string }, context: ToolContext) => {
        const defaultRelative = args.changeName ? `.sflow/delta-specs/${args.changeName}.md` : undefined;
        const filePath = resolvePath(context, args.delta_spec_path, defaultRelative);
        const content = await readFileContent(filePath);
        if (content === null) {
          return { title: 'Delta Spec Validation', output: JSON.stringify({ valid: false, issues: [{ level: 'ERROR', path: 'file', message: `Delta spec file not found: ${filePath}` }], summary: { errors: 1, warnings: 0, info: 0 } }, null, 2) };
        }
        const report = sharedValidator.validateDeltaSpec(content, args.changeName || 'unnamed');
        return { title: 'Delta Spec Validation', output: JSON.stringify(report, null, 2) };
      },
    },

    validate_tasks: {
      description: 'Validate a tasks.md file for completeness and task definitions. Reads from <dir>/.sflow/tasks.md by default.',
      args: {
        tasks_path: z.string().optional().describe('Path to the tasks markdown file. Defaults to <changeDir>/.sflow/tasks.md'),
      },
      execute: async (args: { tasks_path?: string }, context: ToolContext) => {
        const filePath = resolvePath(context, args.tasks_path, '.sflow/tasks.md');
        const content = await readFileContent(filePath);
        if (content === null) {
          return { title: 'Tasks Validation', output: JSON.stringify({ valid: false, issues: [{ level: 'ERROR', path: 'file', message: `Tasks file not found: ${filePath}` }], summary: { errors: 1, warnings: 0, info: 0 } }, null, 2) };
        }
        const report = sharedValidator.validateTasks(content);
        return { title: 'Tasks Validation', output: JSON.stringify(report, null, 2) };
      },
    },

    validate_contract: {
      description: 'Validate an execution contract file. Reads from <dir>/.sflow/execution-contract.md by default.',
      args: {
        contract_path: z.string().optional().describe('Path to the execution contract file. Defaults to <changeDir>/.sflow/execution-contract.md'),
      },
      execute: async (args: { contract_path?: string }, context: ToolContext) => {
        const filePath = resolvePath(context, args.contract_path, '.sflow/execution-contract.md');
        const content = await readFileContent(filePath);
        if (content === null) {
          return { title: 'Contract Validation', output: JSON.stringify({ valid: false, issues: [{ level: 'ERROR', path: 'file', message: `Contract file not found: ${filePath}` }], summary: { errors: 1, warnings: 0, info: 0 } }, null, 2) };
        }
        const report = sharedValidator.validateExecutionContract(content);
        return { title: 'Contract Validation', output: JSON.stringify(report, null, 2) };
      },
    },

    validate_design: {
      description: 'Validate a design.md file for required sections (Architecture Decision, Design Constraints, Implementation Approach). Reads from <dir>/.sflow/design.md by default.',
      args: {
        design_path: z.string().optional().describe('Path to the design markdown file. Defaults to <changeDir>/.sflow/design.md'),
      },
      execute: async (args: { design_path?: string }, context: ToolContext) => {
        const filePath = resolvePath(context, args.design_path, '.sflow/design.md');
        const content = await readFileContent(filePath);
        if (content === null) {
          return { title: 'Design Validation', output: JSON.stringify({ valid: false, issues: [{ level: 'ERROR', path: 'file', message: `Design file not found: ${filePath}` }], summary: { errors: 1, warnings: 0, info: 0 } }, null, 2) };
        }
        const report = sharedValidator.validateDesign(content);
        return { title: 'Design Validation', output: JSON.stringify(report, null, 2) };
      },
    },

    validate_implementation: {
      description: 'Validate implementation against spec and design (Completeness, Correctness, Coherence dimensions). Reads spec and design from file paths.',
      args: {
        diffSummary: z.string().describe('Git diff or change summary of the implementation'),
        spec_path: z.string().optional().describe('Path to the spec file. Defaults to <changeDir>/.sflow/specs/<spec_name>.md.'),
        spec_name: z.string().optional().describe('Spec name used to resolve default spec path. Required if spec_path not provided.'),
        design_path: z.string().optional().describe('Path to the design file. Defaults to <changeDir>/.sflow/design.md'),
      },
      execute: async (args: { diffSummary: string; spec_path?: string; spec_name?: string; design_path?: string }, context: ToolContext) => {
        const specDefault = args.spec_name ? `.sflow/specs/${args.spec_name}.md` : undefined;
        const specFilePath = resolvePath(context, args.spec_path, specDefault);
        const specContent = await readFileContent(specFilePath) || '';

        const designFilePath = resolvePath(context, args.design_path, '.sflow/design.md');
        const designContent = await readFileContent(designFilePath) || '';

        const report = sharedValidator.validateImplementation(args.diffSummary, specContent, designContent);
        return { title: 'Implementation Validation', output: JSON.stringify(report, null, 2) };
      },
    },

    detect_sync_conflicts: {
      description: 'Detect sync conflicts across multiple delta specs (requirements modified by multiple changes). Pass delta spec paths as JSON array.',
      args: {
        delta_specs_json: z.string().describe('JSON array of { changeName: string, deltaSpecPath: string } objects'),
      },
      execute: async (args: { delta_specs_json: string }, context: ToolContext) => {
        let entries: Array<{ changeName: string; deltaSpecPath: string }>;
        try {
          entries = JSON.parse(args.delta_specs_json);
        } catch {
          return { title: 'Sync Conflict Detection', output: JSON.stringify({ hasConflicts: false, conflicts: [], error: 'Invalid JSON' }, null, 2) };
        }
        const resolved: Array<{ changeName: string; content: string }> = [];
        for (const entry of entries) {
          const filePath = resolvePath(context, entry.deltaSpecPath, `.sflow/delta-specs/${entry.changeName}.md`);
          const content = await readFileContent(filePath);
          if (content !== null) {
            resolved.push({ changeName: entry.changeName, content });
          }
        }
        const report = sharedValidator.detectSyncConflicts(resolved);
        return { title: 'Sync Conflict Detection', output: JSON.stringify(report, null, 2) };
      },
    },
  };
}

/**
 * Built-in workflow tools: state mutation operations.
 */
export function createWorkflowTools(): Record<string, ToolDefinition> {
  return {
    record_decision_point: {
      description: 'Record a decision point (DP-0 .. DP-5) in the workflow state',
      args: {
        dp_id: z.enum(['dp-0', 'dp-1', 'dp-2', 'dp-3', 'dp-4', 'dp-5']).describe('Decision point identifier'),
        state: z.enum(['exploring', 'specifying', 'bridging', 'approved-for-build', 'executing', 'debugging', 'closing', 'abandoned']).describe('Current workflow state when the decision was confirmed'),
        target_state: z.enum(['exploring', 'specifying', 'bridging', 'approved-for-build', 'executing', 'debugging', 'closing', 'abandoned']).describe('State the workflow will transition to after confirmation'),
        metadata: z.string().optional().describe('Optional JSON-encoded metadata (e.g. {"notes": "..."})'),
        change_dir: z.string().optional().describe('Absolute path to the change directory (project root). Defaults to the current working directory.'),
      },
      execute: async (args: { dp_id: string; state: string; target_state: string; metadata?: string; change_dir?: string }, context) => {
        let parsedMeta: Record<string, unknown> | undefined;
        if (args.metadata) {
          try {
            parsedMeta = JSON.parse(args.metadata);
          } catch {
            return {
              title: 'Record Decision Point',
              output: JSON.stringify({ success: false, error: 'Invalid JSON in metadata' }, null, 2),
            };
          }
        }

        const changeDir = args.change_dir || context.directory || '';
        if (!changeDir) {
          return {
            title: 'Record Decision Point',
            output: JSON.stringify({ success: false, error: 'sFlow change directory not detected. Pass change_dir explicitly.' }, null, 2),
          };
        }

        const { readJsonFile, writeJsonFile, ensureDir, stateFileMutex } = await import('@opencode-sflow/shared');

        const statePath = `${changeDir}/.sflow/state.json`;
        await ensureDir(`${changeDir}/.sflow`);

        try {
          const result = await stateFileMutex.runExclusive(async () => {
            const state = await readJsonFile<Record<string, unknown>>(statePath) || {};
            const dps = (state.decisionPoints as Array<Record<string, unknown>> || []);
            const record = {
              id: args.dp_id,
              confirmedInState: args.state,
              targetState: args.target_state,
              timestamp: new Date().toISOString(),
              metadata: parsedMeta,
            };
            dps.push(record);
            await writeJsonFile(statePath, { ...state, decisionPoints: dps });
            return { record, total: dps.length };
          });
          return {
            title: 'Record Decision Point',
            output: JSON.stringify({ success: true, dp: result.record, totalDPs: result.total }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Record Decision Point',
            output: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2),
          };
        }
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
    this.tools = { ...createValidatorTools(), ...createWorkflowTools() };
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools[name];
  }

  getAllTools(): Record<string, ToolDefinition> {
    return { ...this.tools };
  }
}
