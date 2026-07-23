/**
 * SFlow Plugin Factory
 *
 * Creates an SFlow-only plugin with:
 * - SFlow agents (sFlow, need-explorer, spec-writer, contract-builder, build-executor,
 *   bug-investigator, code-reviewer, release-archivist, spec-merger, ui-director, ui-implementer)
 * - SFlow tools (workflow_router, contract_validator, artifact_inspector,
 *   call_flow_agent, flowagent_output, flowagent_cancel, agnes_* tools)
 * - SFlow hooks (state_transition, artifact_validation, guard, session_start,
 *   session_end, pre_process, post_process, continuation)
 */

import type { PluginInput, PluginOptions, Hooks, PluginModule, ToolDefinition } from '@opencode-ai/plugin';
import { z } from 'zod';

import type { SFlowClient, BackgroundTaskEntry, BackgroundTaskRegistry, AgentModelMap } from './types.js';
import { SFLOW_TOOLS, IFLOW_STATES, AGENT_COLORS, generateTaskId, formatToolError, detectOmoPlugin, detectAgnesProvider } from './types.js';

import { getAgentNames, getAgentMode, createAgent } from './agents/index.js';
import { createWorkflowRouterTool } from './tools/index.js';
import { createIFlowRouterTool } from './tools/iflow-router.js';
import { createCallFlowAgentTools } from './tools/call-flow-agent.js';

import { loadCascadedSFlowConfig, agentOverridesFromConfig } from './agents/config-loader.js';
import { createHookComposer } from './hooks/hook-composer.js';
import { createSkillLoader } from './features/skill-loader.js';
import type { HookContext } from './hooks/types.js';
import { ensureDir, writeJsonFile } from '@opencode-flow-engine/shared';
import { getStateFilePath } from './features/state-manager.js';
import { createCompactionContext } from '../../../workflows/shared/compaction-context.js';
import { createMcpManager, loadProjectMcpConfig } from './features/mcp-manager.js';
import { createValidatorTools, createWorkflowTools } from './features/builtin-mcp.js';
import { createCheckToolAvailableTool } from './features/tool-availability.js';
import { setHasOmoPlugin, setHasAgnesProvider } from './agents/agent-tools.js';
import { markOmoUsed, resetOmoTracking } from './hooks/guard.js';
import { createAgentSpecificGuards } from './hooks/guard/agent-guards.js';
import { clearFrontendCache } from './features/frontend-detector.js';
import { createTaskTracker } from './features/task-tracker.js';
import { pollSessionCompletion } from './helpers/polling.js';
import { IFLOW_AGENT_NAMES } from '../../../workflows/iflow/index.js';
import { SFLOW_AGENT_NAMES } from '../../../workflows/sflow/index.js';
import { SHARED_AGENT_NAMES } from '../../../workflows/shared/index.js';
import { registerFlowCommands } from '../../../workflows/shared/slash-commands.js';
import { createAgnesTools } from './agnes-tools.js';
import { getCurrentWorkflowState, executeContractValidator, executeArtifactInspector } from './sflow-tool-helpers.js';
import { createExecutionPlan, reviseExecutionPlan, readExecutionPlan, recordReviewReceipt } from './features/execution-plan.js';
import { fileExists, readJsonFile } from '@opencode-flow-engine/shared';
// ─── Background task registry (per-factory instance) ──────────────────────────

const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
let backgroundTaskCounter = { value: 0 };

// ─── Agent model map (populated during config hook) ───────────────────────────

const AGENT_MODEL_MAP: AgentModelMap = {};

// ─── SFlow tool sub-factories ──────────────────────────────────────────────

function createWorkflowRouterTools(client: SFlowClient): Record<string, ToolDefinition> {
  return {
    workflow_router: {
      description: 'Detect current workflow state and route to the appropriate agent. Supports GO.md-style intent matching.',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
        return createWorkflowRouterTool().execute({ ...args, changeDir: context.directory || '' }, context);
      },
    },

    iflow_router: {
      description: 'Detect current IFlow state from .flow-engine/iflow/ directory artifacts and route to the appropriate agent. Supports IFlow-specific intent patterns.',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
        return createIFlowRouterTool().execute({ ...args, changeDir: context.directory || '' }, context);
      },
    },
  };
}

function createContractTools(): Record<string, ToolDefinition> {
  return {
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
  };
}

function createExecutionPlanTools(): Record<string, ToolDefinition> {
  return {
    record_execution_plan: {
      description: 'Record or revise an execution plan for the current change. Validates contract existence, checks workflow state, and writes .flow-engine/sflow/execution-plan.json.',
      args: {
        mode: z.enum(['inline', 'batch-inline', 'sdd']).describe('Execution mode: inline (1-2 tasks), batch-inline (3-5 tasks), or sdd (complex with dependencies)'),
        waves: z.array(z.object({
          id: z.string().describe('Wave identifier (e.g. "W1")'),
          strategy: z.enum(['parallel', 'serial']).describe('Task scheduling strategy within the wave'),
          tasks: z.array(z.string()).describe('Task IDs belonging to this wave'),
          depends_on: z.array(z.string()).describe('Wave IDs this wave depends on'),
        })).describe('Ordered waves of tasks with dependency graph'),
        source: z.enum(['user-override', 'default']).describe('Whether the plan was auto-recommended or user-overridden'),
        rationale: z.string().describe('Rationale for the chosen execution mode'),
        override: z.boolean().optional().describe('Whether this is a user override of the recommended mode'),
      },
      execute: async (args, context) => {
        const changeDir = context.directory || '';
        const { mode, waves, source, rationale, override } = args;

        try {
          // REP-2: Validate contract existence
          const contractExists = await fileExists(changeDir + '/execution-contract.md');
          if (!contractExists) {
            return { title: 'Record Execution Plan', output: JSON.stringify({ success: false, error: 'execution-contract.md not found. Create a contract before recording an execution plan.' }, null, 2) };
          }

          // REP-3: Validate workflow state
          const currentState = await getCurrentWorkflowState(changeDir);
          const validStates = ['approved-for-build', 'executing'];
          if (!currentState || !validStates.includes(currentState)) {
            return { title: 'Record Execution Plan', output: JSON.stringify({ success: false, error: `Invalid state for recording execution plan: "${currentState}". Must be one of: ${validStates.join(', ')}` }, null, 2) };
          }

          const existingPlan = await readExecutionPlan(changeDir);
          let plan;

          if (currentState === 'approved-for-build' && !existingPlan) {
            plan = await createExecutionPlan(changeDir, { mode, source, rationale, waves });
          } else if (currentState === 'executing' && existingPlan) {
            plan = await reviseExecutionPlan(changeDir, { mode, source, rationale, waves });
          } else if (currentState === 'approved-for-build' && existingPlan) {
            plan = await reviseExecutionPlan(changeDir, { mode, source, rationale, waves });
          } else {
            plan = await createExecutionPlan(changeDir, { mode, source, rationale, waves });
          }

          return {
            title: 'Record Execution Plan',
            output: JSON.stringify({
              success: true,
              plan: {
                mode: plan.mode,
                revision: plan.revision,
                waves: plan.waves,
                hash: plan.hash,
              },
            }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Record Execution Plan',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    show_execution_plan: {
      description: 'Read and display the current execution plan from .flow-engine/sflow/execution-plan.json. Shows mode, waves, dependencies, review status, and plan hash.',
      args: {},
      execute: async (_args: Record<string, never>, context) => {
        const changeDir = context.directory || '';
        try {
          const plan = await readExecutionPlan(changeDir);
          if (!plan) {
            return { title: 'Show Execution Plan', output: JSON.stringify({ success: false, error: 'No execution plan found. Create one with record_execution_plan first.' }, null, 2) };
          }

          // Read review receipts for each wave
          const waveStatuses: Array<{ id: string; tasks: number; strategy: string; depends_on: string[]; review: string }> = [];
          for (const wave of plan.waves) {
            let reviewStatus = 'no receipt';
            const receiptPath = `${changeDir}/.flow-engine/sflow/reviews/${wave.id}.json`;
            try {
              const receipt = await (await import('@opencode-flow-engine/shared')).readJsonFile<{ status?: string }>(receiptPath);
              if (receipt) {
                reviewStatus = receipt.status === 'pass' ? '✅ pass' : '❌ fail';
              }
            } catch {
              // no receipt
            }
            waveStatuses.push({
              id: wave.id,
              tasks: wave.tasks.length,
              strategy: wave.strategy,
              depends_on: wave.depends_on,
              review: reviewStatus,
            });
          }

          const output = {
            success: true,
            plan: {
              mode: plan.mode,
              source: plan.source,
              rationale: plan.rationale,
              revision: plan.revision,
              hash: plan.hash,
              artifacts_hash: plan.artifacts_hash,
              contract_hash: plan.contract_hash,
              waves: waveStatuses,
            },
          };

          return { title: 'Show Execution Plan', output: JSON.stringify(output, null, 2) };
        } catch (error) {
          return {
            title: 'Show Execution Plan',
            output: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          };
        }
      },
    },

    record_review_receipt: {
      description: 'Record a review receipt for a wave. Validates wave existence in the execution plan and writes .flow-engine/sflow/reviews/<wave-id>.json.',
      args: {
        waveId: z.string().describe('The wave ID to record the receipt for (e.g. "W1")'),
        status: z.enum(['pass', 'fail']).describe('Review result: pass or fail'),
        base: z.string().describe('Git commit hash of the review base'),
        head: z.string().describe('Git commit hash of the review head'),
        report: z.string().describe('Review report content or path'),
      },
      execute: async (args, context) => {
        const changeDir = context.directory || '';
        const { waveId, status, base, head, report } = args;

        try {
          const receipt = await recordReviewReceipt(changeDir, waveId, { status, base, head, report });

          return {
            title: 'Record Review Receipt',
            output: JSON.stringify({
              success: true,
              receipt: {
                waveId,
                status: receipt.status,
                base: receipt.base,
                head: receipt.head,
                recorded_at: receipt.recorded_at,
              },
            }, null, 2),
          };
        } catch (error) {
          return {
            title: 'Record Review Receipt',
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

// ─── SFlow tool definitions ──────────────────────────────────────────────────

export function createSFlowTools(client: SFlowClient): Record<string, ToolDefinition> {
  const callFlowAgentTools = createCallFlowAgentTools({
    client,
    backgroundTaskRegistry,
    backgroundTaskCounter,
    agentModelMap: AGENT_MODEL_MAP,
    sessionLabelPrefix: 'sFlow',
    workflowName: 'SFlow',
    validateAgent: (subagentType) => {
      const sharedNames = SHARED_AGENT_NAMES as readonly string[];
      if (sharedNames.includes(subagentType as string)) return null;
      const validSFlowAgents = SFLOW_AGENT_NAMES as readonly string[];
      if (!validSFlowAgents.includes(subagentType as string)) {
        return `无效的 SFlow agent: "${subagentType}"。可用的 SFlow agent: ${validSFlowAgents.join(', ')}，共享 agent: ${sharedNames.join(', ')}`;
      }
      return null;
    },
  });

  const tools: Record<string, ToolDefinition> = {
    ...createWorkflowRouterTools(client),
    ...createContractTools(),
    ...createExecutionPlanTools(),
    ...callFlowAgentTools,
  };

  const agnesTools = createAgnesTools();
  Object.assign(tools, agnesTools);

  tools['check_tool_available'] = createCheckToolAvailableTool();

  return tools;
}

// ─── SFlow plugin module (default export)

/**
 * Create an SFlow PluginModule with the given plugin ID.
 * This is the server function wrapper that OpenCode uses.
 */
export function createSFlowPluginModule(pluginId: string = 'opencode-sflow'): PluginModule {
  return {
    id: pluginId,
    server: async (input: PluginInput, _options?: PluginOptions) => {
      const cascadedConfig = await loadCascadedSFlowConfig();
      const configOverrides = agentOverridesFromConfig(cascadedConfig);

      const workDir = input.directory;
      const sflowClient = input.client;

      const hookComposer = createHookComposer();
      const skillLoader = await createSkillLoader();
      const mcpManager = createMcpManager();
      const taskTracker = createTaskTracker(undefined, '.flow-engine/sflow/subagent-tracker.json');

      // Build tool definitions using @opencode-ai/plugin format
      const tools = createSFlowTools(sflowClient);
      const validatorTools = createValidatorTools();
      const workflowTools = createWorkflowTools();
      Object.assign(tools, validatorTools, workflowTools);

      return {
        dispose: async () => {
          for (const server of mcpManager.getRunningServers()) {
            try {
              await mcpManager.stopServer(server.name);
            } catch (err) {
              console.warn(`[sFlow] Failed to stop MCP server ${server.name}: `, err);
            }
          }
          // TaskTracker dispose
          if (taskTracker && taskTracker.dispose) {
            await taskTracker.dispose();
          }
          // Clear frontend detection cache on session end
          clearFrontendCache();
        },

        event: async (input) => {
          const event = input.event;
          if (event.type === 'session.created') {
            const sessionStartHook = hookComposer.getHook('session_start');
            if (sessionStartHook) {
              await sessionStartHook.execute({
                changeDir: workDir,
                stateFile: `${workDir}/${getStateFilePath('sflow')}`,
                pluginRoot: '',
                action: 'session.created',
              });
            }
          } else if (event.type === 'session.deleted') {
            const sessionEndHook = hookComposer.getHook('session_end');
            if (sessionEndHook) {
              await sessionEndHook.execute({
                changeDir: workDir,
                stateFile: `${workDir}/${getStateFilePath('sflow')}`,
                pluginRoot: '',
                action: 'session.deleted',
              });
            }
          }
        },

        config: async (cfg) => {
          // 注册 slash 命令
          registerFlowCommands(cfg);

          const hasOmo = detectOmoPlugin(cfg.plugin);
          setHasOmoPlugin(hasOmo);

          const hasAgnes = await detectAgnesProvider({ provider: cfg.provider as Record<string, unknown> | undefined, plugin: cfg.plugin });
          setHasAgnesProvider(hasAgnes);

          if (!cfg.agent) cfg.agent = {};

          // Register only SFlow agents
          for (const name of getAgentNames()) {
            if ((IFLOW_AGENT_NAMES as readonly string[]).includes(name)) continue;

            const override = configOverrides[name];
            const skill = skillLoader.getSkill(name);
            const agentCfg = await createAgent(name, undefined, undefined, skill?.content);

            const instructions = (typeof agentCfg.instructions === 'string' ? agentCfg.instructions : '') || (typeof agentCfg.prompt === 'string' ? agentCfg.prompt : '');
            const modelName = typeof agentCfg.model === 'string' ? agentCfg.model : undefined;
            const temperature = typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined;
            const agentTools = agentCfg.tools ?? undefined;

            cfg.agent[name] = {
              model: modelName,
              prompt: instructions,
              mode: getAgentMode(name),
              tools: agentTools,
              color: AGENT_COLORS[name],
              temperature: override?.temperature ?? temperature,
              description: (typeof agentCfg.id === 'string')
                ? `${agentCfg.id} agent from sFlow plugin`
                : undefined,
            };

            if (modelName) {
              AGENT_MODEL_MAP[name] = modelName;
            }
          }

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
                mcpManager.startServer(server.name, server).catch(err => {
                  console.warn(`[sFlow] Failed to start MCP server ${server.name}: ${err.message}`);
                  if (cfg.mcp) delete cfg.mcp[server.name];
                });
              }
            }
          }

          const projectMcpConfig = (await loadProjectMcpConfig()) as Record<string, { command: string | string[]; environment?: Record<string, string> }>;
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
                  if (cfg.mcp) delete cfg.mcp[name];
                });
              }
            }
          }
        },

        tool: tools,

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

        "tool.execute.before": async (input, output) => {
          const toolName = input.tool;
          const lowerTool = toolName?.toLowerCase();
          if (lowerTool === 'call_omo_agent') {
            markOmoUsed();
          }
          const filePath = (lowerTool === 'write' || lowerTool === 'edit')
            ? (((output.args ?? {}) as Record<string, unknown>).filePath
              ?? ((output.args ?? {}) as Record<string, unknown>).path
              ?? ((output.args ?? {}) as Record<string, unknown>).file_path
              ?? '') as string
            : '';
          const guardHook = hookComposer.getHook('guard');
          // Agent-specific guard chain — executed before generic guards
          // (more precise blocking conditions take priority)
          const agentGuardResult = await createAgentSpecificGuards(workDir, {
            toolName: lowerTool,
            agent: (input as Record<string, unknown>).agent,
            filePath,
          });
          if (agentGuardResult && agentGuardResult.block) {
            output.args = {
              ...(output.args ?? {}),
              _sflow_guard_blocked: true,
              _sflow_guard_reason: agentGuardResult.blockReason ?? 'Agent guard condition not met',
            };
            return;
          }
          if (guardHook) {
            const guardResult = await guardHook.execute({
              changeDir: workDir,
              stateFile: `${workDir}/${getStateFilePath('sflow')}`,
              pluginRoot: '',
              action: `tool:${toolName}`,
              data: {
                toolName: lowerTool,
                agent: (input as Record<string, unknown>).agent,
                filePath,
              },
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
          // TaskTracker: 记录子 agent 调用开始
          if (taskTracker && taskTracker.beforeHook) {
            await taskTracker.beforeHook(input);
          }
        },

        "tool.execute.after": async (input, output) => {
          const toolName = input.tool;
          if (!SFLOW_TOOLS.has(toolName)) return;

          const validationHook = hookComposer.getHook('artifact_validation');
          if (validationHook) {
            const currentState = await getCurrentWorkflowState(workDir);
            const validationCtx: HookContext = {
              changeDir: workDir,
              stateFile: `${workDir}/${getStateFilePath('sflow')}`,
              pluginRoot: '',
              action: `tool:${toolName}:after`,
              data: { newState: currentState },
            };
            const validationRes = await validationHook.execute(validationCtx);
            if (!validationRes.success && validationRes.block) {
              output.output = `[sFlow validation] ${validationRes.blockReason ?? validationRes.error ?? 'Artifact validation failed'}\n${output.output}`;
            }
          }

          const outputStr = output.output ?? '';
          // 优先使用 JSON.parse 提取顶层 state 字段
          let newState: string | undefined;
          try {
            const parsed = JSON.parse(outputStr);
            if (parsed && typeof parsed === 'object' && 'state' in parsed && typeof parsed.state === 'string') {
              newState = parsed.state;
            }
          } catch {
            // JSON.parse 失败，回退到增强正则（要求 state 位于顶层 JSON 开头）
            const stateMatch = outputStr.match(/\{\s*"state"\s*:\s*"(\w[\w-]*)"/);
            if (stateMatch) {
              newState = stateMatch[1];
            }
          }
          if (newState) {
            const isIFlowTool = toolName === 'iflow_router';
            const isIFlowState = newState && IFLOW_STATES.has(newState);
            if (isIFlowTool || (isIFlowState && !SFLOW_TOOLS.has(toolName))) {
              const iflowTransitionHook = hookComposer.getHook('iflow_state_transition');
              if (iflowTransitionHook) {
                const result = await iflowTransitionHook.execute({
                  changeDir: workDir,
                  stateFile: `${workDir}/${getStateFilePath('iflow')}`,
                  pluginRoot: '',
                  action: 'state-transition',
                  data: { newState },
                });

              } else {
                try {
                  await ensureDir(`${workDir}/.flow-engine/iflow`);
                  await writeJsonFile(`${workDir}/${getStateFilePath('iflow')}`, {
                    state: newState,
                    updatedAt: new Date().toISOString(),
                  });
                } catch {}
              }
              return;
            }
            const transitionHook = hookComposer.getHook('state_transition');
            if (transitionHook) {
              await transitionHook.execute({
                changeDir: workDir,
                stateFile: `${workDir}/${getStateFilePath('sflow')}`,
                pluginRoot: '',
                action: 'state-transition',
                data: { newState },
              });
            }
            if (newState !== 'exploring') {
              resetOmoTracking();
            }
          }

          const postProcessHook = hookComposer.getHook('post_process');
          if (postProcessHook) {
            const ppResult = await postProcessHook.execute({
              changeDir: workDir,
              stateFile: `${workDir}/${getStateFilePath('sflow')}`,
              pluginRoot: '',
              action: `tool:${toolName}:after`,
              data: { output: outputStr },
            });
            if (ppResult.success) {
              const ppData = ppResult.data as { stateTransitionSignal?: { from?: string; to: string } } | null;
              if (ppData?.stateTransitionSignal) {
                const transitionHook = hookComposer.getHook('state_transition');
                if (transitionHook) {
                  await transitionHook.execute({
                    changeDir: workDir,
                    stateFile: `${workDir}/${getStateFilePath('sflow')}`,
                    pluginRoot: '',
                    action: 'state-transition',
                    data: { newState: ppData.stateTransitionSignal.to },
                  });
                }
                if (ppData.stateTransitionSignal.to !== 'exploring') {
                  resetOmoTracking();
                }
              }
            }
          }
          // TaskTracker: 记录子 agent 调用结束
          if (taskTracker && taskTracker.afterHook) {
            await taskTracker.afterHook(input, output);
          }
        },

        "experimental.session.compacting": async (input, output) => {
          try {
            const stateFile = `${workDir}/${getStateFilePath('sflow')}`;
            const { readJsonFile } = await import('../../helpers/index.js');
            const state = await readJsonFile(stateFile) as Record<string, unknown> | null;
            if (!state || !state.state) return;
            const context = createCompactionContext('sFlow', state as never);
            if (context) {
              output.context.push(context);
            }
          } catch {
            // 静默降级：如果状态文件读取失败，不阻塞 compaction
          }
        },

        "experimental.compaction.autocontinue": async (input, output) => {
          const continuationHook = hookComposer.getHook('continuation');
          if (!continuationHook) return;
          const result = await continuationHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${getStateFilePath('sflow')}`,
            pluginRoot: '',
            action: 'autocontinue',
          });
          const shouldContinue = result.success && (result.data as { shouldContinue?: boolean })?.shouldContinue === true;
          output.enabled = shouldContinue;
        },
      };
    },
  };
}

// Default export: SFlow plugin module with backward-compatible ID
export default createSFlowPluginModule('opencode-sflow');
