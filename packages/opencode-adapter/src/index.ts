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
import type { Message, Part } from '@opencode-ai/sdk';
import { z } from 'zod';

type SFlowClient = PluginInput['client'];

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
import { isContractStale } from '@opencode-sflow/shared';
import { detectStateMismatch, simpleHash } from './features/state-manager.js';
import { createMcpManager, loadProjectMcpConfig } from './features/mcp-manager.js';
import { createValidatorTools, createWorkflowTools } from './features/builtin-mcp.js';

export const PLUGIN_ID = 'opencode-sflow';
export const PLUGIN_VERSION = '0.1.0';

const SFLOW_TOOLS = new Set(['workflow_router', 'contract_validator', 'artifact_inspector', 'validate_spec', 'validate_proposal', 'validate_delta_spec', 'validate_tasks', 'validate_contract', 'validate_design', 'validate_implementation', 'detect_sync_conflicts', 'record_decision_point', 'call_sub_agent', 'background_output', 'background_cancel']);

// Lightweight in-memory background task registry
// Maps taskId → { sessionID, status, result, error }
interface BackgroundTaskEntry {
  sessionID: string;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}
const backgroundTaskRegistry = new Map<string, BackgroundTaskEntry>();
let backgroundTaskCounter = 0;

function generateTaskId(): string {
  backgroundTaskCounter++;
  return `bg_${Date.now()}_${backgroundTaskCounter}`;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_FILE_PATH = '.sflow/state.json';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getCurrentWorkflowState(changeDir: string): Promise<string | null> {
  const state = await readJsonFile<{ state?: string }>(`${changeDir}/${STATE_FILE_PATH}`);
  return state?.state ?? null;
}

const SOURCE_CODE_PATTERNS = /\.(ts|js|tsx|jsx|mjs|cjs|mts|cts|py|java|kt|rs|go|rb|php|c|cpp|h|hpp|cs|swift|vue|svelte|css|scss|less)$/i;
const ARTIFACT_NAMES = new Set(['proposal.md', 'design.md', 'tasks.md', 'execution-contract.md']);

/** Promise-based sleep (cross-runtime compatible, replaces Bun.sleep) */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Format a tool error response */
function formatToolOutput(title: string, success: boolean, data: Record<string, unknown>): { title: string; output: string } {
  return { title, output: JSON.stringify({ success, ...data }, null, 2) };
}
function formatToolError(msg: string): { title: string; output: string } {
  return formatToolOutput('Error', false, { error: msg });
}

function isArtifactPath(filePath: string, changeDir: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const changeDirNorm = changeDir.replace(/\\/g, '/');

  if (normalized.includes('.sflow/') || normalized.endsWith('.sflow')) return true;
  const relative = normalized.startsWith(changeDirNorm)
    ? normalized.slice(changeDirNorm.length + 1)
    : normalized;
  const baseName = relative.split('/').pop() || '';
  if (ARTIFACT_NAMES.has(baseName)) return true;
  if (relative.startsWith('specs/') || relative === 'specs') return true;
  return false;
}

function isSourceCodePath(filePath: string): boolean {
  return SOURCE_CODE_PATTERNS.test(filePath);
}

// ─── Tool definitions using @opencode-ai/plugin ToolDefinition format ──────────

function createSFlowTools(client: SFlowClient): Record<string, ToolDefinition> {
  return {
    workflow_router: {
      description: 'Detect current workflow state and route to the appropriate agent',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
        const resolvedDir = context.directory || '';
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
          : context.directory || '';
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
          : context.directory || '';
        const result = await executeArtifactInspector(changeDir);
        return { title: 'Artifact Inspector', output: JSON.stringify(result, null, 2) };
      },
    },

    call_sub_agent: {
      description: 'Invoke a specialized sFlow subagent. Supports sync (run_in_background=false) and async (run_in_background=true) modes. Async mode returns a task_id; use background_output to retrieve results when complete.',
      args: {
        description: z.string().describe('Short (3-5 words) description of the task'),
        prompt: z.string().describe('The task for the subagent to perform'),
        subagent_type: z.string().describe('The subagent to invoke (e.g. build-executor, spec-writer)'),
        run_in_background: z.boolean().describe('true=async (returns task_id for background_output), false=sync (waits for completion)'),
        session_id: z.string().optional().describe('Existing session to continue (sync mode only)'),
      },
      execute: async (args, context) => {
        const changeDir = context.directory || '';
        const { subagent_type, prompt, run_in_background, session_id, description } = args;
        const sessionLabel = `sFlow → ${subagent_type}`;
        const MAX_WAIT_MS = 300_000;
        const POLL_INTERVAL_MS = 500;

        try {
          // Resolve the session to use
          let sessionID: string;
          let isNew = false;

          if (session_id) {
            if (run_in_background) {
              return await formatToolError('session_id is not supported in background mode. Use run_in_background=false to continue an existing session.');
            }
            sessionID = session_id;
          } else {
            const createResult = await client.session.create({
              body: {
                parentID: context.sessionID,
                title: sessionLabel,
                agent: subagent_type,
              },
              query: { directory: changeDir },
            });
            const id = createResult.data?.id;
            if (!id) {
              return await formatToolError('Failed to create subagent session');
            }
            sessionID = id;
            isNew = true;
          }

          // Send the prompt to the subagent
          await client.session.prompt({
            path: { id: sessionID },
            body: {
              agent: subagent_type,
              parts: [{ type: 'text', text: prompt }],
            },
          }).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Failed to send prompt: ${msg}`);
          });

          if (run_in_background) {
            // Async mode: register task and return immediately
            const taskId = generateTaskId();
            backgroundTaskRegistry.set(taskId, {
              sessionID,
              status: 'running',
              createdAt: Date.now(),
            });
            return {
              title: sessionLabel,
              output: JSON.stringify({
                success: true,
                task_id: taskId,
                session_id: sessionID,
                status: 'running',
                description,
                agent: subagent_type,
              }, null, 2),
            };
          }

          // Sync mode: poll for completion
          const startTime = Date.now();
          let lastMsgCount = 0;
          let stablePolls = 0;
          const STABLE_REQUIRED = 3;
          let sawActiveStatus = false;

          while (Date.now() - startTime < MAX_WAIT_MS) {
            await sleep(POLL_INTERVAL_MS);

            let sessionStatus: { type: string } | undefined;
            try {
              const statusResult = await client.session.status();
              const rawData = statusResult.data;
              // Normalize: handle both array and object formats
              if (Array.isArray(rawData)) {
                const found = (rawData as Array<{ id: string; type: string }>).find(s => s.id === sessionID);
                if (found) sessionStatus = { type: found.type };
              } else if (rawData && typeof rawData === 'object') {
                const obj = rawData as Record<string, { type: string }>;
                sessionStatus = obj[sessionID];
              }
            } catch {
              // status() might throw if session is not found; treat as idle
              break;
            }

            if (sessionStatus && sessionStatus.type !== 'idle') {
              sawActiveStatus = true;
              stablePolls = 0;
              lastMsgCount = 0;
              continue;
            }

            let currentMsgCount = 0;
            try {
              const messagesResult = await client.session.messages({ path: { id: sessionID } });
              const msgs = messagesResult.data as Array<unknown> | undefined;
              currentMsgCount = Array.isArray(msgs) ? msgs.length : 0;
            } catch {
              break;
            }

            if (isNew && !sawActiveStatus && currentMsgCount === 0) {
              continue;
            }

            if (currentMsgCount > 0 && currentMsgCount === lastMsgCount) {
              stablePolls++;
              if (stablePolls >= STABLE_REQUIRED) break;
            } else {
              stablePolls = 0;
              lastMsgCount = currentMsgCount;
            }
          }

          // Retrieve messages
          let lastOutput = '(no output)';
          try {
            const messagesResult = await client.session.messages({ path: { id: sessionID } });
            const messages = messagesResult.data as Array<{ parts: Array<{ type: string; text?: string }> }> | undefined;
            if (messages) {
              for (const msg of messages) {
                if (msg.parts) {
                  for (const part of msg.parts) {
                    if (part.type === 'text' && part.text) {
                      lastOutput = part.text;
                    }
                  }
                }
              }
            }
          } catch {
            // messages() might fail; return what we have
          }

          return {
            title: sessionLabel,
            output: JSON.stringify({
              success: true,
              subagent: subagent_type,
              sessionID,
              output: lastOutput,
            }, null, 2),
          };
        } catch (error) {
          return {
            title: sessionLabel,
            output: JSON.stringify({
              success: false,
              subagent: subagent_type,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    background_output: {
      description: 'Retrieve results from a background subagent task. Call this when a <system-reminder> notifies you that a background task completed. Use block=true to wait for completion (timeout: 120s).',
      args: {
        task_id: z.string().describe('The task ID returned by call_sub_agent (run_in_background=true)'),
        block: z.boolean().optional().describe('Wait for completion (default: false)'),
      },
      execute: async (args: { task_id: string; block?: boolean }, _context) => {
        const { task_id, block } = args;

        const waitForTask = async (): Promise<BackgroundTaskEntry | undefined> => {
          const timeout = 120_000;
          const start = Date.now();
          while (Date.now() - start < timeout) {
            const task = backgroundTaskRegistry.get(task_id);
            if (!task) return undefined;
            if (task.status !== 'running') return task;
            await sleep(500);
          }
          return backgroundTaskRegistry.get(task_id);
        };

        try {
          if (block) {
            const task = await waitForTask();
            if (!task) {
              return { title: 'Background Output', output: JSON.stringify({ success: false, error: `Task ${task_id} not found` }, null, 2) };
            }
            return {
              title: 'Background Output',
              output: JSON.stringify({
                success: task.status !== 'error',
                task_id,
                status: task.status,
                session_id: task.sessionID,
                result: task.result,
                error: task.error,
              }, null, 2),
            };
          }

          // Non-blocking: return current status
          const task = backgroundTaskRegistry.get(task_id);
          if (!task) {
            return { title: 'Background Output', output: JSON.stringify({ success: false, error: `Task ${task_id} not found` }, null, 2) };
          }
          return {
            title: 'Background Output',
            output: JSON.stringify({
              success: true,
              task_id,
              status: task.status,
              session_id: task.sessionID,
              result: task.result,
              error: task.error,
            }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Background Output',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    background_cancel: {
      description: 'Cancel a running background subagent task by task_id. Use this when you no longer need the result of a call_sub_agent call.',
      args: {
        taskId: z.string().describe('Task ID to cancel (required)'),
      },
      execute: async (args: { taskId: string }, _context) => {
        const { taskId } = args;
        try {
          const task = backgroundTaskRegistry.get(taskId);
          if (!task) {
            return { title: 'Background Cancel', output: JSON.stringify({ success: false, error: `Task ${taskId} not found` }, null, 2) };
          }
          if (task.status !== 'running') {
            return { title: 'Background Cancel', output: JSON.stringify({ success: true, message: `Task ${taskId} already in status: ${task.status}` }, null, 2) };
          }

          // Abort the session if possible
          try {
            await client.session.abort({ path: { id: task.sessionID } });
          } catch {
            // session.abort may not be available; mark cancelled anyway
          }

          backgroundTaskRegistry.delete(taskId);
          return { title: 'Background Cancel', output: JSON.stringify({ success: true, message: `Task ${taskId} cancelled and removed` }, null, 2) };
        } catch (error) {
          return {
            title: 'Background Cancel',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
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
    const isStale = await isContractStale(changeDir);
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
  const isStale = await isContractStale(changeDir);

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
  const sflowClient = input.client;
  console.log(`[sFlow] Initializing in ${workDir}`);

  const hookComposer = createHookComposer();
  const skillLoader = await createSkillLoader();
  const mcpManager = createMcpManager();

  // Build tool definitions using @opencode-ai/plugin format
  const tools = createSFlowTools(sflowClient);
  const validatorTools = createValidatorTools();
  const workflowTools = createWorkflowTools();
  Object.assign(tools, validatorTools, workflowTools);

  return {
    dispose: async () => {
      console.log('[sFlow] Plugin disposed');
      for (const server of mcpManager.getRunningServers()) {
        try {
          await mcpManager.stopServer(server.name);
        } catch (err) {
          console.warn(`[sFlow] Failed to stop MCP server ${server.name}: `, err);
        }
      }
    },

    // event hook: session lifecycle events (S14 fix)
    event: async (input) => {
      const event = input.event;
      if (event.type === 'session.created') {
        const sessionStartHook = hookComposer.getHook('session_start');
        if (sessionStartHook) {
          await sessionStartHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${STATE_FILE_PATH}`,
            pluginRoot: '',
            action: 'session.created',
          });
        }
      } else if (event.type === 'session.deleted') {
        const sessionEndHook = hookComposer.getHook('session_end');
        if (sessionEndHook) {
          await sessionEndHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${STATE_FILE_PATH}`,
            pluginRoot: '',
            action: 'session.deleted',
          });
        }
      }
    },

    // ── config hook: register agents and MCP servers ──
    config: async (cfg) => {
      if (!cfg.agent) cfg.agent = {};

      for (const name of getAgentNames()) {
        const override = configOverrides[name];
        const skill = skillLoader.getSkill(name);
        const agentCfg = await createAgent(name, undefined, undefined, skill?.content);

        // Type-safe extraction of AgentConfig fields
        const instructions = (typeof agentCfg.instructions === 'string' ? agentCfg.instructions : '') || (typeof agentCfg.prompt === 'string' ? agentCfg.prompt : '');
        const modelName = typeof agentCfg.model === 'string' ? agentCfg.model : undefined;
        const temperature = typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined;
        const tools = agentCfg.tools ?? undefined;

        cfg.agent[name] = {
          model: modelName,
          prompt: instructions,
          mode: getAgentMode(name),
          tools,
          temperature: override?.temperature ?? temperature,
          description: (typeof agentCfg.id === 'string')
            ? `${agentCfg.id} agent from sFlow plugin`
            : undefined,
        };
      }

      // --- Register skill-embedded MCPs (Tier 3) ---
      if (!cfg.mcp) cfg.mcp = {};
      const skillsWithMcp = skillLoader.getSkillsWithMcp();
      for (const skill of skillsWithMcp) {
        if (skill.metadata.mcp?.servers) {
          for (const server of skill.metadata.mcp.servers) {
            cfg.mcp[server.name] = {
              type: 'local',
              command: [server.command, ...(server.args || [])],
              environment: server.env,
            };
            // Start the MCP server process (S15 fix)
            mcpManager.startServer(server.name, server).catch(err => {
              console.warn(`[sFlow] Failed to start MCP server ${server.name}: ${err.message}`);
              // Rollback: remove from cfg.mcp so OpenCode doesn't try to connect to a dead server
              if (cfg.mcp) delete cfg.mcp[server.name];
            });
          }
        }
      }

      // --- Register project-level MCPs (Tier 2) (S15 fix) ---
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const projectMcpConfig = (await loadProjectMcpConfig()) as any;
      for (const [name, server] of Object.entries(projectMcpConfig)) {
        const srv = server as { command: string | string[]; environment?: Record<string, string> };
        if (srv && srv.command) {
          cfg.mcp[name] = {
            type: 'local',
            command: Array.isArray(srv.command) ? srv.command : [srv.command],
            environment: srv.environment,
          };
          const cmd = Array.isArray(srv.command) ? srv.command[0] : srv.command;
          const cmdArgs = Array.isArray(srv.command) ? srv.command.slice(1) : [];
          if (cmd) {
            mcpManager.startServer(name, { name, command: cmd, args: cmdArgs, env: srv.environment }).catch(err => {
              console.warn(`[sFlow] Failed to start project MCP server ${name}: ${err.message}`);
              // Rollback: remove from cfg.mcp so OpenCode doesn't try to connect to a dead server
              if (cfg.mcp) delete cfg.mcp[name];
            });
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
        id: `sflow-skill-${Date.now()}`,
        sessionID: input.sessionID,
        messageID: '',
        type: 'text',
        text: skillContent,
      });
    },

    // ── tool.execute.before hook ──
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool;
      const lowerTool = toolName?.toLowerCase();

      // Phase Guard: Intercept Write/Edit based on workflow state
      if (lowerTool === 'write' || lowerTool === 'edit') {
        const args = (output.args ?? {}) as Record<string, unknown>;
        const filePath = (args.filePath ?? args.path ?? args.file_path ?? '') as string;
        const state = await readJsonFile<{ state?: string; mode?: string }>(`${workDir}/${STATE_FILE_PATH}`);

        if (state?.state) {
          const isArtifact = isArtifactPath(filePath, workDir);
          const isSourceCode = !isArtifact && isSourceCodePath(filePath);

          // Blocking states: exploring, specifying, bridging — source code not allowed
          if (
            (state.state === 'exploring' || state.state === 'specifying' || state.state === 'bridging') &&
            isSourceCode
          ) {
            output.args = {
              ...(output.args ?? {}),
              _sflow_guard_blocked: true,
              _sflow_guard_reason: `[SFLOW] Write blocked: workflow is in "${state.state}" state. Planning phases do not allow source code changes. Complete planning artifacts first.`,
            };
            return;
          }

          // Terminal states: closing, abandoned — block all writes
          if (state.state === 'closing' || state.state === 'abandoned') {
            output.args = {
              ...(output.args ?? {}),
              _sflow_guard_blocked: true,
              _sflow_guard_reason: `[SFLOW] Write blocked: workflow is in terminal state "${state.state}". No further changes allowed.`,
            };
            return;
          }

          // C5: Debugging state — only allow Write/Edit for bug-investigator and build-executor
          if (state.state === 'debugging') {
            const currentAgent = (input as Record<string, unknown>).agent as string | undefined;
            const allowedAgents = ['bug-investigator', 'build-executor'];
            const isAllowed = currentAgent && allowedAgents.some(a => currentAgent.toLowerCase().includes(a));
            if (!isAllowed && isSourceCode) {
              output.args = {
                ...(output.args ?? {}),
                _sflow_guard_blocked: true,
                _sflow_guard_reason: `[SFLOW] Write blocked: workflow is in "debugging" state and current agent (${currentAgent || 'unknown'}) is not a debugging agent. Only bug-investigator and build-executor can modify source code during debugging.`,
              };
              return;
            }
          }

          // Illegal phase jump detection: full mode executing but missing design.md
          if (
            state.mode === 'full' &&
            state.state === 'executing' &&
            isSourceCode
          ) {
            const designExists = await sflowFileExists(`${workDir}/design.md`);
            if (!designExists) {
              output.args = {
                ...(output.args ?? {}),
                _sflow_guard_blocked: true,
                _sflow_guard_reason: `[SFLOW] Write blocked: illegal phase jump detected. Full workflow in "executing" but design.md is missing. Route back to specifying to complete planning artifacts.`,
              };
              return;
            }
          }
        }
      }

      // C18: Run guard on ALL direct tool invocations, not just sflow tools
      const guardHook = hookComposer.getHook('guard');
      if (guardHook) {
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
          return;
        }
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
              sessionID: '',
              role: 'user',
              time: { created: Date.now() },
              agent: 'sFlow',
              model: { providerID: '', modelID: '' },
            } satisfies Message,
            parts: [{
              id: `sflow-ctx-${Date.now()}`,
              sessionID: '',
              messageID: '',
              type: 'text',
              text: transformData.context,
            }] satisfies Part[],
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




