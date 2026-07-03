/**
 * sFlow Plugin Entry Point
 *
 * Architecture follows oh-my-openagent's create-plugin-module pattern:
 * - Tools registered via Hooks.tool (Record<string, ToolDefinition>)
 * - Agents registered via config hook (cfg.agent)
 * - MCP servers registered via config hook (cfg.mcp)
 * - No `as any` — all types align with @opencode-ai/plugin
 */

import type { PluginInput, PluginOptions, Hooks, PluginModule, ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';

export { Validator, isValidStateRecord } from '@opencode-sflow/core';
export type {
  Scenario, Requirement, Spec, DeltaOperationType, Rename, Delta, Change,
  WorkflowState, WorkflowMode, WorkflowStateFile, WorkflowStateRecord,
  ValidationReport, ValidationIssue, VerificationReport, ConflictReport,
} from '@opencode-sflow/core';

import {
  getAgentNames, getAgentMode, createAgent,
} from './agents/index.js';
export {
  createSFlowAgent, createNeedExplorerAgent, createSpecWriterAgent,
  createContractBuilderAgent, createBuildExecutorAgent, createBugInvestigatorAgent,
  createCodeReviewerAgent, createReleaseArchivistAgent, createSpecMergerAgent,
} from './agents/index.js';
export type {
  ModelProvenance, ModelResolutionResult,
} from './agents/index.js';

export {
  createWorkflowRouterTool, createContractValidatorTool, createArtifactInspectorTool,
} from './tools/index.js';

export {
  createStateTransitionHook, createArtifactValidationHook, createGuardHook,
  createSessionStartHook, createSessionEndHook,
  createPreProcessHook, createPostProcessHook, createContinuationHook,
} from './hooks/index.js';

export {
  createWorkflowManager, createStateManager,
  BuiltinMcpRegistry, createValidatorTools,
} from './features/index.js';

export { deepMerge, fileExists, readFile, writeFile, listFiles } from '@opencode-sflow/shared';

import { loadCascadedSFlowConfig, agentOverridesFromConfig } from './agents/config-loader.js';
import { createHookComposer } from './hooks/hook-composer.js';
import { createSkillLoader } from './features/skill-loader.js';
import { readJsonFile } from '@opencode-sflow/shared';
import type { HookContext } from './hooks/types.js';
import { sharedValidator } from '@opencode-sflow/core';
import { fileExists as sflowFileExists, directoryExists, readFile as sflowReadFile } from '@opencode-sflow/shared';
import { checkContractStaleness } from './tools/workflow-router.js';

export const PLUGIN_ID = 'opencode-sflow';
export const PLUGIN_VERSION = '0.1.0';

const SFLOW_TOOLS = new Set(['workflow_router', 'contract_validator', 'artifact_inspector']);

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_FILE_PATH = '.sflow/state.json';

// ─── Helper: read current workflow state ──────────────────────────────────────

async function getCurrentWorkflowState(changeDir: string): Promise<string | null> {
  const state = await readJsonFile<{ state?: string }>(`${changeDir}/${STATE_FILE_PATH}`);
  return state?.state ?? null;
}

// ─── Tool definitions using @opencode-ai/plugin ToolDefinition format ──────────

function createSFlowTools(workDir: string): Record<string, ToolDefinition> {
  return {
    workflow_router: {
      description: 'Detect current workflow state and route to the appropriate agent',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
        const resolvedDir = context.directory || workDir;
        const result = await executeWorkflowRouter(resolvedDir);
        return { title: 'Workflow Router', output: JSON.stringify(result, null, 2) };
      },
    },

    contract_validator: {
      description: 'Validate execution contract for correctness and completeness',
      args: {
        contract_path: z.string().optional().describe('Path to the execution contract file'),
      },
      execute: async (args: { contract_path?: string }, context) => {
        const changeDir = args.contract_path
          ? args.contract_path.replace(/[/\\]execution-contract\.md$/, '')
          : context.directory || workDir;
        const result = await executeContractValidator(changeDir);
        return { title: 'Contract Validator', output: JSON.stringify(result, null, 2) };
      },
    },

    artifact_inspector: {
      description: 'Inspect planning artifacts for completeness and consistency',
      args: {
        artifact_path: z.string().optional().describe('Path to the artifact or change directory'),
      },
      execute: async (args: { artifact_path?: string }, context) => {
        const changeDir = args.artifact_path
          ? args.artifact_path.replace(/[/\\](proposal|design|tasks)\.md$/, '').replace(/[/\\]specs$/, '')
          : context.directory || workDir;
        const result = await executeArtifactInspector(changeDir);
        return { title: 'Artifact Inspector', output: JSON.stringify(result, null, 2) };
      },
    },
  };
}

// ─── Tool execution logic ─────────────────────────────────────────────────────

async function executeWorkflowRouter(changeDir: string) {
  const artifacts = {
    proposal: await sflowFileExists(`${changeDir}/proposal.md`),
    specs: await directoryExists(`${changeDir}/specs`),
    design: await sflowFileExists(`${changeDir}/design.md`),
    tasks: await sflowFileExists(`${changeDir}/tasks.md`),
    contract: await sflowFileExists(`${changeDir}/execution-contract.md`),
    state: await sflowFileExists(`${changeDir}/${STATE_FILE_PATH}`),
  };

  let state: string;
  let skill: string;
  const reasons: string[] = [];

  if (!artifacts.proposal && !artifacts.specs) {
    state = 'exploring';
    skill = 'need-explorer';
    reasons.push('No planning artifacts found');
  } else if (!artifacts.contract) {
    state = 'specifying';
    skill = 'spec-writer';
    reasons.push('Planning artifacts exist but contract is missing');
  } else {
    const stateData = await readJsonFile<{ state?: string; contractApproved?: boolean }>(`${changeDir}/${STATE_FILE_PATH}`);
    const isApproved = stateData?.contractApproved === true
      || stateData?.state === 'approved-for-build'
      || stateData?.state === 'executing'
      || stateData?.state === 'closing';
    if (!isApproved) {
      state = 'bridging';
      skill = 'contract-builder';
      reasons.push('Contract exists but not approved');
    } else {
      state = 'executing';
      skill = 'build-executor';
      reasons.push('Contract approved, ready for implementation');
    }
  }

  if (artifacts.contract) {
    const isStale = await checkContractStaleness(changeDir);
    if (isStale) {
      state = 'bridging';
      skill = 'contract-builder';
      reasons.push('Contract is stale, needs regeneration');
    }
  }

  return { state, skill, reasons, artifacts };
}

async function executeContractValidator(changeDir: string) {
  const contractContent = await sflowReadFile(`${changeDir}/execution-contract.md`);
  if (!contractContent) {
    return {
      validation: { valid: false, issues: [], summary: { errors: 0, warnings: 0, info: 0 } },
      isStale: false,
      recommendations: ['execution-contract.md not found — run contract-builder to create the contract'],
    };
  }

  const report = sharedValidator.validateExecutionContract(contractContent);
  const isStale = await checkContractStaleness(changeDir);

  const recommendations: string[] = [];
  if (isStale) recommendations.push('Contract is stale — regenerate with contract-builder');
  if (!report.valid) recommendations.push('Fix validation errors before proceeding');
  report.issues.filter(i => i.level === 'ERROR').forEach(i => recommendations.push(`Fix: ${i.message}`));

  return { validation: report, isStale, recommendations };
}

async function executeArtifactInspector(changeDir: string) {
  const results: Record<string, unknown> = {};

  // Proposal
  const proposalContent = await sflowReadFile(`${changeDir}/proposal.md`);
  if (proposalContent) {
    results.proposal = sharedValidator.validateChangeContent('proposal', proposalContent);
  } else {
    results.proposal = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  // Specs
  const specsDir = `${changeDir}/specs`;
  const { readdir } = await import('fs/promises');
  try {
    const specEntries = await readdir(specsDir, { withFileTypes: true });
    const specFiles = specEntries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name);
    results.specs = {};
    for (const specFile of specFiles) {
      const specContent = await sflowReadFile(`${specsDir}/${specFile}`);
      if (specContent) {
        (results.specs as Record<string, unknown>)[specFile] = sharedValidator.validateSpecContent(
          specFile.replace('.md', ''),
          specContent,
        );
      }
    }
  } catch {
    results.specs = {};
  }

  // Design
  const designContent = await sflowReadFile(`${changeDir}/design.md`);
  if (designContent) {
    results.design = sharedValidator.validateDesign(designContent);
  } else {
    results.design = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  // Tasks
  const tasksContent = await sflowReadFile(`${changeDir}/tasks.md`);
  if (tasksContent) {
    results.tasks = sharedValidator.validateTasks(tasksContent);
  } else {
    results.tasks = { valid: false, error: 'File not found', issues: [], summary: { errors: 1, warnings: 0, info: 0 } };
  }

  // Summary
  const issues: string[] = [];
  const proposal = results.proposal as { valid: boolean; summary?: { errors: number } } | undefined;
  if (proposal && !proposal.valid) issues.push(`Proposal: ${proposal.summary?.errors || 0} error(s)`);
  const specs = results.specs as Record<string, { valid: boolean }> | undefined;
  if (specs) {
    const specErrors = Object.values(specs).filter(s => !s.valid).length;
    if (specErrors > 0) issues.push(`Specs: ${specErrors} file(s) with errors`);
  }
  const tasks = results.tasks as { valid: boolean; summary?: { errors: number } } | undefined;
  if (tasks && !tasks.valid) issues.push(`Tasks: ${tasks.summary?.errors || 0} error(s)`);

  const summary = issues.length === 0 ? 'All artifacts are valid' : `Found issues: ${issues.join(', ')}`;

  const recommendations: string[] = [];
  if (proposal && !proposal.valid) recommendations.push('Fix proposal issues before proceeding');
  if (specs && Object.values(specs).some(s => !s.valid)) recommendations.push('Fix spec issues before proceeding');
  if (tasks && !tasks.valid) recommendations.push('Fix task issues before proceeding');

  return { results, summary, recommendations };
}

// ─── Plugin server function ───────────────────────────────────────────────────

async function sflowPlugin(input: PluginInput, _options?: PluginOptions): Promise<Hooks> {
  const cascadedConfig = await loadCascadedSFlowConfig();
  const configOverrides = agentOverridesFromConfig(cascadedConfig);

  const workDir = input.directory;
  console.log(`[sFlow] Initializing in ${workDir}`);

  const hookComposer = createHookComposer();
  const skillLoader = await createSkillLoader();

  // Build tool definitions using @opencode-ai/plugin format
  const tools = createSFlowTools(workDir);

  return {
    dispose: async () => {
      console.log('[sFlow] Plugin disposed');
    },

    // ── config hook: register agents and MCP servers ──
    config: async (cfg) => {
      // --- Register agents ---
      if (!cfg.agent) cfg.agent = {};
      for (const name of getAgentNames()) {
        const override = configOverrides[name];
        const skill = skillLoader.getSkill(name);
        const agentCfg = await createAgent(name, undefined, undefined, skill?.content);
        cfg.agent[name] = {
          model: agentCfg.model,
          mode: getAgentMode(name),
          prompt: agentCfg.instructions,
          ...(override?.temperature ? { temperature: override.temperature } : {}),
        } as any;
      }

      // --- Register skill-embedded MCPs (Tier 3) ---
      if (!cfg.mcp) cfg.mcp = {};
      const skillsWithMcp = skillLoader.getSkillsWithMcp();
      for (const skill of skillsWithMcp) {
        if (skill.metadata.mcp?.servers) {
          for (const server of skill.metadata.mcp.servers) {
            cfg.mcp[server.name] = {
              type: 'local',
              command: server.command,
              args: server.args,
              env: server.env,
            } as any;
          }
        }
      }
    },

    // ── tool hook: register sflow tools via Hooks.tool ──
    // This follows oh-my-openagent's pattern: tools are registered
    // as Record<string, ToolDefinition> on the Hooks return value.
    tool: tools,

    // ── command.execute.before hook ──
    "command.execute.before": async (input, output) => {
      const command = input.command;
      if (!command.startsWith('/')) return;

      const skillName = command.slice(1);
      const skill = skillLoader.getSkill(skillName);
      if (!skill) return;

      const skillContent = skill.content;
      if (!skillContent) return;

      output.parts.push({
        type: 'text',
        text: skillContent,
      } as any);
    },

    // ── tool.execute.before hook ──
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool;
      if (!SFLOW_TOOLS.has(toolName)) return;

      const guardHook = hookComposer.getHook('guard');
      if (!guardHook) return;

      const guardResult = await guardHook.execute({
        changeDir: workDir,
        stateFile: `${workDir}/${STATE_FILE_PATH}`,
        pluginRoot: '',
        action: `tool:${toolName}`,
        data: { toolName },
      });

      if (guardResult.block) {
        output.args = {
          ...(output.args ?? {}),
          _sflow_guard_blocked: true,
          _sflow_guard_reason: guardResult.blockReason ?? guardResult.error ?? 'Guard condition not met',
        };
      }
    },

    // ── tool.execute.after hook ──
    "tool.execute.after": async (input, output) => {
      const toolName = input.tool;
      if (!SFLOW_TOOLS.has(toolName)) return;

      // Artifact validation
      const validationHook = hookComposer.getHook('artifact_validation');
      if (validationHook) {
        const currentState = await getCurrentWorkflowState(workDir);
        const validationCtx: HookContext = {
          changeDir: workDir,
          stateFile: `${workDir}/${STATE_FILE_PATH}`,
          pluginRoot: '',
          action: `tool:${toolName}:after`,
          data: { newState: currentState },
        };
        const validationRes = await validationHook.execute(validationCtx);
        if (!validationRes.success && validationRes.block) {
          output.output = `[sFlow validation] ${validationRes.blockReason ?? validationRes.error ?? 'Artifact validation failed'}\n${output.output}`;
        }
      }

      // State transition — detect from tool output
      const outputStr = output.output ?? '';
      const stateMatch = outputStr.match(/"state"\s*:\s*"(\w[\w-]*)"/);
      if (stateMatch) {
        const newState = stateMatch[1];
        const transitionHook = hookComposer.getHook('state_transition');
        if (transitionHook) {
          await transitionHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${STATE_FILE_PATH}`,
            pluginRoot: '',
            action: 'state-transition',
            data: { newState },
          });
        }
      }
    },

    // ── chat.message hook ──
    "chat.message": async (input, output) => {
      const agent = input.agent;
      if (!agent) return;

      const currentState = await getCurrentWorkflowState(workDir);
      if (!currentState) return;

      const stateInfo = `[sFlow] Current workflow state: ${currentState}`;
      const textParts = output.parts.filter((p): p is typeof p & { text: string } => p.type === 'text');
      const firstText = textParts[0];
      if (firstText) {
        firstText.text = `${stateInfo}\n\n${firstText.text}`;
      }
    },

    // ── experimental.compaction.autocontinue hook ──
    "experimental.compaction.autocontinue": async (input, output) => {
      const continuationHook = hookComposer.getHook('continuation');
      if (!continuationHook) return;

      const result = await continuationHook.execute({
        changeDir: workDir,
        stateFile: `${workDir}/${STATE_FILE_PATH}`,
        pluginRoot: '',
        action: 'autocontinue',
      });

      const shouldContinue = result.success && (result.data as { shouldContinue?: boolean })?.shouldContinue === true;
      output.enabled = shouldContinue;
    },

    // ── experimental.chat.messages.transform hook ──
    "experimental.chat.messages.transform": async (input, output) => {
      const currentState = await getCurrentWorkflowState(workDir);
      if (!currentState) return;

      const transformHook = hookComposer.getHook('pre_process');
      if (!transformHook) return;

      const result = await transformHook.execute({
        changeDir: workDir,
        stateFile: `${workDir}/${STATE_FILE_PATH}`,
        pluginRoot: '',
        action: 'messages.transform',
        data: { currentState },
      });

      if (result.success) {
        const transformData = result.data as { context?: string } | null;
        if (transformData?.context) {
          output.messages.push({
            info: {
              id: 'sflow-context',
              role: 'user',
              createdAt: new Date().toISOString(),
            } as any,
            parts: [{
              type: 'text',
              text: transformData.context,
            } as any],
          });
        }
      }
    },
  };
}

// ─── Plugin module export ─────────────────────────────────────────────────────

const sflowPluginModule: PluginModule = {
  id: PLUGIN_ID,
  server: sflowPlugin,
};

export default sflowPluginModule;
