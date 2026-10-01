/**
 * IFlow Plugin Factory
 *
 * Creates an IFlow-only plugin with:
 * - IFlow agents (iFlow, iflow-discuss-planner, iflow-plan-executor,
 *   iflow-verifier, iflow-researcher, iflow-shipper)
 * - IFlow tools (iflow_router, call_flow_agent, flowagent_output, flowagent_cancel)
 * - IFlow hooks (iflow_state_transition, iflow_guard, session_start, session_end)
 */

import type { Hooks, PluginInput, PluginModule, PluginOptions } from '@opencode-ai/plugin';
import { z } from 'zod';
import type { LocalToolDefinition } from './types/local-tool-definition.js';

import type {
  AgentModelMap,
  BackgroundTaskEntry,
  BackgroundTaskRegistry,
  SFlowClient,
} from './types.js';

type BuiltinAgentName = import('./agents/types.js').BuiltinAgentName;

import { ensureDir, writeJsonFile } from '@opencode-flow-engine/shared';
import { appendChainUnavailableNotice } from './agents/agent-builder.js';
import { setHasAgnesProvider } from './agents/agent-tools.js';
import { agentOverridesFromConfig, loadCascadedSFlowConfig } from './agents/config-loader.js';
import { createAgent, getAgentMode } from './agents/index.js';
import type { ModelValidation } from './agents/model-availability.js';
import { validateConfiguredModels } from './agents/model-availability.js';
import { getGlobalEventBus } from './features/event-bus.js';
import { handleSessionIdleEvent } from './features/event-hook-handler.js';
import { createMcpManager, loadProjectMcpConfig } from './features/mcp-manager.js';
import { PollingLogger } from './features/polling-logger.js';
import { sessionErrorModelForBlacklist } from './features/session-error-fence.js';
import {
  createSessionErrorHandler,
  type SessionErrorHandler,
} from './features/session-error-handler.js';
import { createSkillLoader } from './features/skill-loader.js';
import { getStateFilePath } from './features/state-manager.js';
import { pollSessionCompletion } from './helpers/polling.js';
import { resolveChangeDir } from './helpers/resolve-change-dir.js';
import { createHookComposer } from './hooks/hook-composer.js';
import type { HookContext } from './hooks/types.js';
import { createCallFlowAgentTools } from './tools/call-flow-agent.js';
import { createIFlowRouterTool } from './tools/iflow-router.js';
import {
  AGENT_COLORS,
  detectAgnesProvider,
  formatToolError,
  generateTaskId,
  IFLOW_STATES,
} from './types.js';
import { Logger } from './utils/logger.js';

// 全局 PollingLogger 实例（复用 polling.log）
const globalLogger = new PollingLogger();

import {
  type IFlowCheckpointFile,
  readIFlowCheckpoint,
  recoverIFlowState,
  saveIFlowCheckpoint,
} from '../../../workflows/iflow/iflow-state-manager.js';
import { IFLOW_AGENT_NAMES } from '../../../workflows/iflow/index.js';
import { SFLOW_AGENT_NAMES } from '../../../workflows/sflow/index.js';
import {
  type CompactionState,
  createCompactionContext,
} from '../../../workflows/shared/compaction-context.js';
import { SHARED_AGENT_NAMES } from '../../../workflows/shared/index.js';
import { registerFlowCommands } from '../../../workflows/shared/slash-commands.js';
import { createTaskTracker } from './features/task-tracker.js';

// ─── Background task registry (per-factory instance) ──────────────────────────

const backgroundTaskRegistry: BackgroundTaskRegistry = new Map();
let backgroundTaskCounter = { value: 0 };

// D2 / W7：session.error 事件驱动预降级 handler。
// 不能在模块顶层创建（曾写死 process.cwd()，P1-2）；改为按 workDir 惰性创建并缓存。
// modelResolver 内置 P1-1 护栏：已换模（attemptedModels>1）的 session 不再反查拉黑。
const iflowSessionErrorHandlers = new Map<string, SessionErrorHandler>();

// 导出 getter 与 handler 缓存 Map 作为测试钩子（P2-2′ / P3-8′）：
// 使「工厂传入 workDir 而非 process.cwd()」的接线可被测试观测。生产调用点不变。
export {
  getIflowSessionErrorHandler as getIflowSessionErrorHandlerForTest,
  iflowSessionErrorHandlers as iflowSessionErrorHandlersForTest,
};

function getIflowSessionErrorHandler(workDir: string): SessionErrorHandler {
  let handler = iflowSessionErrorHandlers.get(workDir);
  if (!handler) {
    handler = createSessionErrorHandler({
      changeDir: workDir,
      modelResolver: (sessionID) => {
        if (!sessionID) return undefined;
        for (const entry of backgroundTaskRegistry.values()) {
          if (entry.sessionID === sessionID) {
            return sessionErrorModelForBlacklist(entry);
          }
        }
        return undefined;
      },
    });
    iflowSessionErrorHandlers.set(workDir, handler);
  }
  return handler;
}

// ─── Agent model map (populated during config hook) ───────────────────────────

const AGENT_MODEL_MAP: AgentModelMap = {};

// ─── IFlow tool definitions ──────────────────────────────────────────────────

function createIFlowTools(
  client: SFlowClient,
  modelProfiles?: import('./agents/config-loader.js').ModelProfileConfig,
  configOverrides?: import('./agents/types.js').AgentOverrides,
): Record<string, LocalToolDefinition> {
  const sharedTools = createCallFlowAgentTools({
    client,
    backgroundTaskRegistry,
    backgroundTaskCounter,
    agentModelMap: AGENT_MODEL_MAP,
    sessionLabelPrefix: 'iFlow',
    workflowName: 'IFlow',
    modelProfiles,
    configOverrides,
    validateAgent: (subagentType, context) => {
      const sharedNames = SHARED_AGENT_NAMES as readonly string[];
      if (sharedNames.includes(subagentType as string)) return null;
      // F3: 按调用方 work flow 选择白名单 — sFlow orchestrator 调 sflow 子 agent 时
      // 不应被 IFlow 校验拒绝（环境仅加载 iFlow 插件提供 call_flow_agent 的场景）
      const caller = String((context as { agent?: string })?.agent ?? '').toLowerCase();
      const isSFlowCaller = caller === 'sflow' || caller.startsWith('sflow-');
      const agentNames = isSFlowCaller
        ? (SFLOW_AGENT_NAMES as readonly string[])
        : (IFLOW_AGENT_NAMES as readonly string[]);
      if (!agentNames.includes(subagentType as string)) {
        const workflowLabel = isSFlowCaller ? 'SFlow' : 'IFlow';
        return `无效的 ${workflowLabel} agent: "${subagentType}"。可用的 agent: ${agentNames.join(', ')}，共享 agent: ${sharedNames.join(', ')}`;
      }
      return null;
    },
  });

  return {
    iflow_router: {
      description:
        'Detect current IFlow state from .flow-engine/iflow/ directory artifacts and route to the appropriate agent. Supports IFlow-specific intent patterns.',
      args: {
        state: z.string().optional().describe('Optional state hint to override detection'),
      },
      execute: async (args, context) => {
        return createIFlowRouterTool().execute(
          { ...args, changeDir: resolveChangeDir(undefined, context.directory) },
          context,
        );
      },
    },

    ...sharedTools,
  };
}

// ─── IFlow plugin module (server function) ────────────────────────────────────

function createIFlowPluginServer(
  pluginId: string,
): (input: PluginInput, _options?: PluginOptions) => Promise<Hooks> {
  return async (input: PluginInput, _options?: PluginOptions) => {
    const cascadedConfig = await loadCascadedSFlowConfig();
    const configOverrides = agentOverridesFromConfig(cascadedConfig);

    const workDir = input.directory;
    // 初始化 Logger 日志路径（确保日志写入正确的项目目录）
    Logger.initialize(workDir);
    const sflowClient = input.client;

    // P1-4：启动期与 provider 实际可用列表对账（失败不阻断插件启动）
    // W6/D1：对账结果保留，供 description 降级提示使用（方案 B）
    let modelValidation: ModelValidation = { unknown: [], unconnected: [] };
    try {
      modelValidation = await validateConfiguredModels(sflowClient as never, cascadedConfig);
    } catch (err) {
      void Logger.warn(
        `[model-availability] 启动期模型校验失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const hookComposer = createHookComposer();
    const skillLoader = await createSkillLoader();
    const mcpManager = createMcpManager();
    const taskTracker = createTaskTracker(undefined, '.flow-engine/iflow/subagent-tracker.json');

    // Build IFlow tool definitions
    const tools = createIFlowTools(sflowClient, cascadedConfig.modelProfiles, configOverrides);

    return {
      dispose: async () => {
        for (const server of mcpManager.getRunningServers()) {
          try {
            await mcpManager.stopServer(server.name);
          } catch (err) {
            await Logger.warn(
              `[iFlow] Failed to stop MCP server ${server.name}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        if (taskTracker && taskTracker.dispose) {
          try {
            await taskTracker.dispose();
          } catch (err) {
            await Logger.warn(
              `[iFlow] Failed to dispose TaskTracker: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },

      // event hook: session lifecycle events
      event: async (input) => {
        const event = input.event;

        if (event.type === 'session.created') {
          const sessionStartHook = hookComposer.getHook('session_start');
          if (sessionStartHook) {
            await sessionStartHook.execute({
              changeDir: workDir,
              stateFile: `${workDir}/${getStateFilePath('iflow')}`,
              pluginRoot: '',
              action: 'session.created',
            });
          }
          try {
            await recoverIFlowState(workDir);
          } catch (err) {
            await Logger.warn(
              `[iFlow] Failed to recover state: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        } else if (event.type === 'session.deleted') {
          const sessionEndHook = hookComposer.getHook('session_end');
          if (sessionEndHook) {
            await sessionEndHook.execute({
              changeDir: workDir,
              stateFile: `${workDir}/${getStateFilePath('iflow')}`,
              pluginRoot: '',
              action: 'session.deleted',
            });
          }
        } else if (event.type === 'session.error') {
          // D2 / W7：session.error 事件驱动预降级
          const props = event.properties as { sessionID?: string; error?: unknown } | undefined;
          await getIflowSessionErrorHandler(workDir).handle({
            sessionID: props?.sessionID,
            error: props?.error as never,
          });
          await globalLogger.log('iFlow', 'session.error event handled (pre-degradation)');
        } else {
          // P1-2: 使用共享函数处理 session.idle 和 session.status 事件
          const handled = await handleSessionIdleEvent(event, 'iFlow');
          if (handled) {
            await globalLogger.log(
              'iFlow',
              'session.idle/status event handled and dispatched to event bus',
            );
          }
        }
      },

      // config hook: register IFlow agents only, MCP servers, detect plugins
      config: async (cfg) => {
        // 注册 slash 命令
        registerFlowCommands(cfg);

        const hasAgnes = await detectAgnesProvider({
          provider: cfg.provider as Record<string, unknown> | undefined,
          plugin: cfg.plugin,
        });
        setHasAgnesProvider(hasAgnes);

        if (!cfg.agent) cfg.agent = {};

        // Register only IFlow agents
        const iflowAgentNames = IFLOW_AGENT_NAMES as readonly string[];
        for (const name of iflowAgentNames) {
          const override = configOverrides[name as BuiltinAgentName];

          let skillContent = skillLoader.getSkill(name)?.content;
          if (name === 'iflow-plan-executor') {
            const uiSkill = skillLoader.getSkill('ui-implementer');
            if (uiSkill?.content) {
              skillContent = skillContent
                ? `${skillContent}\n\n---\n\n## Frontend UI Expertise\n\n${uiSkill.content}`
                : uiSkill.content;
            }
          }

          const agentCfg = await createAgent(
            name as BuiltinAgentName,
            undefined,
            undefined,
            skillContent,
            'iflow',
          );

          const instructions =
            (typeof agentCfg.instructions === 'string' ? agentCfg.instructions : '') ||
            (typeof agentCfg.prompt === 'string' ? agentCfg.prompt : '');
          const modelName = typeof agentCfg.model === 'string' ? agentCfg.model : undefined;
          const temperature =
            typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined;
          const agentTools = agentCfg.tools ?? undefined;

          cfg.agent[name] = {
            model: modelName,
            prompt: instructions,
            mode: getAgentMode(name as BuiltinAgentName),
            tools: agentTools,
            color: AGENT_COLORS[name],
            temperature: override?.temperature ?? temperature,
            description: appendChainUnavailableNotice(
              typeof agentCfg.id === 'string'
                ? `${agentCfg.id} agent from iFlow plugin`
                : undefined,
              name as BuiltinAgentName,
              cascadedConfig,
              modelValidation,
            ),
          };

          if (modelName) {
            AGENT_MODEL_MAP[name] = modelName;
          }
        }

        // Register shared agents (cross-workflow, standalone)
        // These are NOT bound to any IFlow workflow state (they don't participate
        // in the IFlow state machine), but they DO participate in tier-based model
        // resolution: passing 'iflow' enables AGENT_PROFILES tier resolution
        // (equivalent to how sflow-plugin-factory registers them with default 'sflow').
        // Do NOT pass 'none' here — that would skip tier resolution and diverge
        // from the sflow registration behavior.
        const sharedNames = SHARED_AGENT_NAMES as readonly string[];
        for (const name of sharedNames) {
          const override = configOverrides[name as BuiltinAgentName];
          const agentCfg = await createAgent(
            name as BuiltinAgentName,
            undefined,
            undefined,
            undefined,
            'iflow',
          );

          const instructions =
            (typeof agentCfg.instructions === 'string' ? agentCfg.instructions : '') ||
            (typeof agentCfg.prompt === 'string' ? agentCfg.prompt : '');
          const modelName = typeof agentCfg.model === 'string' ? agentCfg.model : undefined;
          const temperature =
            typeof agentCfg.temperature === 'number' ? agentCfg.temperature : undefined;
          const agentTools = agentCfg.tools ?? undefined;

          cfg.agent[name] = {
            model: modelName,
            prompt: instructions,
            mode: 'subagent',
            tools: agentTools,
            color: AGENT_COLORS[name],
            temperature: override?.temperature ?? temperature,
            description: appendChainUnavailableNotice(
              `${name} agent from iFlow plugin (shared, cross-workflow)`,
              name as BuiltinAgentName,
              cascadedConfig,
              modelValidation,
            ),
          };

          if (modelName) {
            AGENT_MODEL_MAP[name] = modelName;
          }
        }

        // 屏蔽 OpenCode 默认的 build 和 plan agents
        cfg.agent['build'] = { mode: 'subagent', hidden: true };
        cfg.agent['plan'] = { mode: 'subagent', hidden: true };

        // Register skill-embedded MCPs (Tier 3)
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
              mcpManager.startServer(server.name, server).catch(async (err) => {
                await Logger.warn(
                  `[iFlow] Failed to start MCP server ${server.name}: ${err.message}`,
                );
                if (cfg.mcp) delete cfg.mcp[server.name];
              });
            }
          }
        }

        // Register project-level MCPs (Tier 2)
        const projectMcpConfig = (await loadProjectMcpConfig()) as Record<
          string,
          { command: string | string[]; environment?: Record<string, string> }
        >;
        for (const [name, server] of Object.entries(projectMcpConfig)) {
          const srv = server as {
            command: string | string[];
            environment?: Record<string, string>;
          };
          if (srv && srv.command) {
            cfg.mcp[name] = {
              type: 'local',
              command: Array.isArray(srv.command) ? srv.command : [srv.command],
              environment: srv.environment,
            };
            const cmd = Array.isArray(srv.command) ? srv.command[0] : srv.command;
            const cmdArgs = Array.isArray(srv.command) ? srv.command.slice(1) : [];
            if (cmd) {
              mcpManager
                .startServer(name, { name, command: cmd, args: cmdArgs, env: srv.environment })
                .catch(async (err) => {
                  await Logger.warn(
                    `[iFlow] Failed to start project MCP server ${name}: ${err.message}`,
                  );
                  if (cfg.mcp) delete cfg.mcp[name];
                });
            }
          }
        }
      },

      // tool hook: register IFlow tools
      tool: tools,

      // command.execute.before hook — skill content injection
      'command.execute.before': async (input, output) => {
        const command = input.command;
        if (!command.startsWith('/')) return;
        const skillName = command.slice(1);
        const skill = skillLoader.getSkill(skillName);
        if (!skill) return;
        const skillContent = skill.content;
        if (!skillContent) return;
        output.parts.push({
          id: `iflow-skill-${Date.now()}`,
          sessionID: input.sessionID,
          messageID: '',
          type: 'text',
          text: skillContent,
        });
      },

      // tool.execute.before hook — IFlow guard
      'tool.execute.before': async (input, output) => {
        const toolName = input.tool;
        const lowerTool = toolName?.toLowerCase();

        // IFlow-specific guard logic
        const guardHook = hookComposer.getHook('guard');
        if (guardHook) {
          const guardResult = await guardHook.execute({
            changeDir: workDir,
            stateFile: `${workDir}/${getStateFilePath('iflow')}`,
            pluginRoot: '',
            action: `tool:${toolName}`,
            data: {
              toolName: lowerTool,
              agent: (input as Record<string, unknown>).agent,
            },
          });

          if (guardResult.block) {
            output.args = {
              ...(output.args ?? {}),
              _iflow_guard_blocked: true,
              _iflow_guard_reason:
                guardResult.blockReason ?? guardResult.error ?? 'IFlow guard condition not met',
            };
            return;
          }
        }
        // TaskTracker: 记录子 agent 调用开始
        if (taskTracker && taskTracker.beforeHook) {
          await taskTracker.beforeHook({ ...input, args: {} });
        }
      },

      // tool.execute.after hook — IFlow state transition
      'tool.execute.after': async (input, output) => {
        const toolName = input.tool;

        // IFlow state transition via hook
        const outputStr = output.output ?? '';
        const stateMatch = outputStr.match(/"state"\s*:\s*"(\w[\w-]*)"/);
        if (stateMatch) {
          const newState = stateMatch[1];
          const isIFlowState = newState && IFLOW_STATES.has(newState);
          if (isIFlowState) {
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
          }
        }
        // TaskTracker: 记录子 agent 调用结束，并落盘 checkpoint
        if (taskTracker && taskTracker.afterHook) {
          const record = await taskTracker.afterHook(input, output);
          if (record) {
            try {
              const iflowState = await recoverIFlowState(workDir);
              let parsed: { task_id?: string; subagent?: string; status?: string } = {};
              try {
                parsed = JSON.parse(output.output ?? '{}') as {
                  task_id?: string;
                  subagent?: string;
                  status?: string;
                };
              } catch {
                // output.output 非 JSON 时忽略，使用兜底值
              }
              const taskId = parsed.task_id || `${Date.now()}_${record.subagentType}`;
              const checkpoint: IFlowCheckpointFile = {
                taskId,
                state: iflowState.state,
                cycleNumber: iflowState.cycleNumber,
                subagentType: record.subagentType,
                inputSummary: record.inputSummary,
                outputSummary: record.outputSummary,
                startedAt: record.startedAt,
                completedAt: record.completedAt,
                durationMs: record.durationMs,
                // 异步模式下 call_flow_agent 立即返回 running 状态，checkpoint 应如实记录
                status: parsed.status === 'running' ? 'running' : record.status,
              };
              await saveIFlowCheckpoint(workDir, checkpoint);
            } catch (err) {
              Logger.warn(
                `[IFlow] checkpoint 写入失败: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }

        // flowagent_output 完成检测：异步模式下 call_flow_agent 写入的 checkpoint
        // 停留在 running 状态，需在 flowagent_output 返回 completed/error 时更新对应 checkpoint
        if (toolName === 'flowagent_output') {
          try {
            const parsed = JSON.parse(output.output ?? '{}') as {
              task_id?: string;
              status?: string;
              result?: unknown;
            };
            const taskId = parsed.task_id;
            const status = parsed.status;
            if (taskId && (status === 'completed' || status === 'error')) {
              const existing = await readIFlowCheckpoint(workDir, taskId);
              // 幂等性：仅当 checkpoint 存在且仍为 running 时更新
              // （避免重复写入，或覆盖同步模式已在 call_flow_agent after 中落盘的 completed）
              if (existing && existing.status === 'running') {
                const resultStr =
                  typeof parsed.result === 'string'
                    ? parsed.result
                    : JSON.stringify(parsed.result ?? '');
                const completedAt = new Date().toISOString();
                const startedAtTs = existing.startedAt
                  ? new Date(existing.startedAt).getTime()
                  : NaN;
                const durationMs = Number.isNaN(startedAtTs)
                  ? 0
                  : Math.max(0, new Date(completedAt).getTime() - startedAtTs);
                const updated: IFlowCheckpointFile = {
                  ...existing,
                  status: status === 'error' ? 'failed' : 'completed',
                  completedAt,
                  durationMs,
                  outputSummary: resultStr,
                };
                await saveIFlowCheckpoint(workDir, updated);
              }
            }
          } catch (err) {
            Logger.warn(
              `[IFlow] flowagent_output checkpoint 更新失败: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      },

      'experimental.session.compacting': async (input, output) => {
        try {
          const stateFile = `${workDir}/${getStateFilePath('iflow')}`;
          const { readJsonFile } = await import('@opencode-flow-engine/shared');
          const state = (await readJsonFile(stateFile)) as Record<string, unknown> | null;
          if (!state || !state.state) return;
          const context = createCompactionContext('iFlow', state as unknown as CompactionState);
          if (context) {
            output.context.push(context);
          }
        } catch {
          // 静默降级：如果状态文件读取失败，不阻塞 compaction
        }
      },

      'experimental.compaction.autocontinue': async (input, output) => {
        // IFlow: 默认允许自动继续
        output.enabled = true;
      },
    };
  };
}

// ─── IFlow plugin module ──────────────────────────────────────────────────────

export function createIFlowPluginModule(pluginId: string = 'opencode-iflow'): PluginModule {
  return {
    id: pluginId,
    server: createIFlowPluginServer(pluginId),
  };
}

// Default export: IFlow plugin module
export default createIFlowPluginModule('opencode-iflow');
