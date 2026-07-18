# oh-my-openagent 架构深度分析

---

## 1. PluginModule 结构

### 入口与核心工厂

oh-my-openagent 的插件入口极其精简：

```typescript
// packages/omo-opencode/src/index.ts
const pluginModule: PluginModule = createPluginModule()
export const omoPlugin = pluginModule.server
export default pluginModule
```

实际的插件初始化逻辑全部在 `createPluginModule()` 工厂中（`packages/omo-opencode/src/testing/create-plugin-module.ts`）。该工厂：

1. 接受 `Partial<PluginModuleDeps>` 覆盖参数（约 30 个可注入依赖），便于测试
2. 返回 `{ id: "oh-my-openagent", server: serverPlugin }`
3. `serverPlugin` 是一个 `async (input, options) => Hooks` 函数

### 7 步初始化流程

```
serverPlugin(input, options)
  1. installAgentSortShim()           # 修补 Array.prototype.sort 保证 agent 排序
  2. initConfigContext()              # 检测 opencode-vs-openagent 布局
  3. detectDuplicateOmoPlugin()       # 早期退出重复插件检测
  4. injectServerAuthIntoClient()     # 向共享 SDK client 注入 auth headers
  5. loadPluginConfig()               # JSONC 解析 → 多级合并 → Zod 校验 → 迁移
  6. initializeOpenClaw()             # 如果配置了 openclaw
  7. createManagers/Tools/Hooks/PluginInterface
```

### PluginModuleDeps DI 模式

工厂通过 `PluginModuleDeps` 接口声明所有依赖，默认绑定真实实现：

```typescript
// create-plugin-module.ts 关键片段
export function createPluginModule(overrides: Partial<PluginModuleDeps> = {}): PluginModule {
  const deps = { ...defaultPluginModuleDeps, ...overrides }
  const serverPlugin: Plugin = async (input, _options): Promise<Hooks> => {
    // ... staged init
    const hooks = deps.createHooks({ ctx, pluginConfig, ... })
    const pluginInterface = deps.createPluginInterface({ ctx, pluginConfig, managers, hooks, tools })
    return { ...pluginInterface, dispose: async () => { ... } }
  }
  return { id: "oh-my-openagent", server: serverPlugin }
}
```

**移植要点**：可以采用相同的"工厂 + DI 覆盖"模式，将插件初始化拆分为独立阶段，每个阶段通过 `PluginModuleDeps` 注入，便于单元测试。

---

## 2. Team Mode / 多智能体编排

### 架构概览

Team mode 是默认关闭的并行多智能体协调系统，modeled after Claude Code's Agent Teams。启用方式：

```json
{
  "team_mode": {
    "enabled": true,
    "max_parallel_members": 4,
    "max_members": 8,
    "tmux_visualization": false
  }
}
```

### 核心模块分布

- **OpenCode 适配层**：`packages/omo-opencode/src/features/team-mode/`（session spawning、hooks、tools）
- **领域原语层**：`packages/team-core/`（registry、mailbox、tasklist、state-store、worktree、tmux-layout）

### Team Spec 定义

Team 规格文件位于 `~/.omo/teams/{name}/config.json`（用户级）或 `<project>/.omo/teams/{name}/config.json`（项目级，优先级更高）：

```json
{
  "name": "ccapi-explorers",
  "description": "Explore the ccapi project structure.",
  "lead": { "kind": "subagent_type", "subagent_type": "sisyphus" },
  "members": [
    { "kind": "category", "name": "scout-1", "category": "deep", "prompt": "Scout the source directory for auth patterns." },
    { "kind": "subagent_type", "name": "scout-2", "subagent_type": "sisyphus-junior" }
  ]
}
```

### Agent 资格三级 Registry

`packages/team-core/src/types.ts` 定义了 `AGENT_ELIGIBILITY_REGISTRY`：

```typescript
export const AGENT_ELIGIBILITY_REGISTRY: Readonly<Record<string, {
  verdict: "eligible" | "conditional" | "hard-reject"
  rejectionMessage?: string
}>> = {
  sisyphus: { verdict: "eligible" },
  hephaestus: { verdict: "conditional", rejectionMessage: "..." },
  oracle: { verdict: "hard-reject", rejectionMessage: "Agent 'oracle' is read-only..." },
  librarian: { verdict: "hard-reject", rejectionMessage: "..." },
  explore: { verdict: "hard-reject", rejectionMessage: "..." },
  multimodal-looker: { verdict: "hard-reject", rejectionMessage: "..." },
  metis: { verdict: "hard-reject", rejectionMessage: "..." },
  momus: { verdict: "hard-reject", rejectionMessage: "..." },
  atlas: { verdict: "eligible" },
  prometheus: { verdict: "hard-reject", rejectionMessage: "..." },
  "sisyphus-junior": { verdict: "eligible" },
}
```

### Team 生命周期与运行时

`packages/omo-opencode/src/features/team-mode/team-runtime/create.ts` 中的 `createTeamRun()`：

```typescript
export async function createTeamRun(
  spec: TeamSpec,
  leadSessionId: string,
  ctx: ExecutorContext,
  config: TeamModeConfig,
  bgMgr: BackgroundManager,
  tmuxMgr?: TmuxSessionManager,
  options?: CreateTeamRunOptions,
): Promise<RuntimeState> {
  // 1. 检查是否已有活跃 runtime（幂等）
  const existingRuntime = await findExistingRuntime(spec, leadSessionId, config)
  if (existingRuntime) return existingRuntime

  // 2. 创建 runtime state
  let runtimeState = await createRuntimeState(spec, leadSessionId, source, config)
  registerTeamRunForSessionCleanup(runtimeState.teamRunId)

  // 3. 并行启动成员（受 max_parallel_members 限制）
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!failure) {
      const member = spec.members[memberIndex]
      const resolvedMember = await resolveMember(member, ctx, ...)
      const task = await bgMgr.launch({
        description: `Create team member ${spec.name}/${member.name}`,
        prompt: buildMemberPrompt(spec, member, runtimeState.teamRunId, config, worktreePath),
        agent: resolvedMember.agentToUse,
        teamRunId: runtimeState.teamRunId,
        onSessionCreated: async (sessionId) => {
          registerTeamSession(sessionId, {
            teamRunId: runtimeState.teamRunId,
            memberName: member.name,
            role: member.name === spec.leadAgentId ? "lead" : "member",
          })
        },
      })
      // ... 等待 sessionId、更新 runtime state
    }
  }))

  // 4. 激活 tmux layout（可选）
  createdLayout = await activateTeamLayout(launchedRuntimeState, config, ...)

  // 5. 转为 active 状态
  return await transitionRuntimeState(runtimeState.teamRunId, (s) => ({ ...s, status: "active" }), config)
}
```

### 12 个 Team 工具

`packages/omo-opencode/src/plugin/tool-registry-team-tools.ts` 在 `team_mode.enabled` 时注册：

```typescript
export function createTeamModeToolsRecord(args: { ... }): Record<string, ToolDefinition> {
  if (!pluginConfig.team_mode?.enabled) return {}
  return {
    team_create, team_delete, team_shutdown_request,
    team_approve_shutdown, team_reject_shutdown,
    team_send_message,
    team_task_create, team_task_list, team_task_update, team_task_get,
    team_status, team_list,
  }
}
```

### 存储布局

```
~/.omo/
├── teams/{name}/config.json                      # 声明式 team spec
├── .highwatermark                                # runtime 状态 parity marker
└── runtime/{teamRunId}/
    ├── state.json                                # durable runtime state
    ├── inboxes/{member}/{uuid}.json              # mailbox（原子 per-message 文件）
    ├── inboxes/{member}/.delivering-{uuid}.json  # 实时投递预留
    ├── inboxes/{member}/processed/               # 已确认消息
    └── tasks/{id}.json                           # 共享任务列表
```

**移植要点**：team mode 采用了"核心领域原语 + 多 harness 适配层"的架构。`team-core` 包是纯领域逻辑（Zod schema、文件锁、状态机），`omo-opencode` 和 `omo-senpi` 各自实现适配层。如果项目需要多平台支持，应抽取类似的 `*-core` 包。

---

## 3. 多种工作流 / Mode 类型

### 关键词检测器（Mode Router）

`packages/omo-opencode/src/hooks/keyword-detector/hook.ts` 实现了 `createKeywordDetectorHook()`，它在 `chat.message` 事件中扫描用户输入，检测以下 4 种 mode 类型：

```typescript
// packages/omo-opencode/src/config/schema/keyword-detector.ts
export const KeywordTypeSchema = z.enum(["ultrawork", "team", "hyperplan", "hyperplan-ultrawork"])
```

检测逻辑：

1. 提取用户消息文本 → 移除系统提醒 → 检测关键词
2. 过滤非 OMO agent（如 OpenCode 原生 Builder/Plan）
3. 过滤 planner agent（Prometheus 不接收 ultrawork 注入）
4. 对每个检测到的关键词，注入对应的 mode prompt 到 `output.parts[0].text`

```typescript
// keyword-detector/hook.ts 核心
const detectedKeywords = detectKeywordsWithType(cleanText, currentAgent, modelID, disabledKeywords, enabledExpansions)
detectedKeywords = suppressComboStandalones(detectedKeywords) // hyperplan-ultrawork 会抑制 ultrawork 和 hyperplan 单独注入

// 对每种 mode 显示 toast 通知
if (hasUltrawork) { /* show "Ultrawork Mode Activated" toast */ }
if (hasHyperplan) { /* show "Hyperplan Mode Activated" toast */ }

// 将所有 mode prompt 拼接到原始消息前
const allMessages = detectedKeywords.map((k) => k.message).join("\n\n")
output.parts[textPartIndex].text = `${allMessages}\n\n---\n\n${originalText}`
```

### 默认 Mode 自动激活

`packages/omo-opencode/src/config/schema/default-mode.ts`：

```typescript
export const DefaultModeConfigSchema = z.object({
  ultrawork: z.boolean().default(false),    // 会话启动自动注入 ultrawork prompt
  ralph_loop: z.boolean().default(false),   // 会话启动自动启动 ralph loop
})
```

当 `defaultMode.ultrawork` 为 true 且用户消息中未检测到关键词时，keyword-detector 会自动注入 ultrawork prompt 并显示 toast。

### Ultrawork 变体路由

`packages/omo-opencode/src/hooks/keyword-detector/ultrawork/` 目录根据 agent/model 路由到不同的 prompt：

- `planner.md` — Prometheus 等 planner agent
- `gpt.md` — GPT 系列模型
- `gemini.md` — Gemini 系列模型
- `default.md` — 其他情况

### Ralph Loop（自引用开发循环）

`packages/omo-opencode/src/hooks/ralph-loop/` 实现了 `/ralph-loop` 命令：

```typescript
// ralph-loop-hook.ts
export interface RalphLoopHook {
  event: (input) => Promise<void>   // session.idle handler
  startLoop: (sessionID, prompt, options?) => boolean
  cancelLoop: (sessionID) => boolean
  getState: () => RalphLoopState | null
}
```

循环直到检测到 `<promise>DONE</promise>` 或达到最大迭代次数，状态持久化到 `.omo/ralph-loop.local.md`。

### System Transform 路由

`packages/omo-opencode/src/plugin-interface.ts` 中的 `experimental.chat.system.transform` 处理器：

```typescript
"experimental.chat.system.transform": createSystemTransformHandler(
  pluginConfig.default_mode,   // default_mode 配置
  getUltraworkMessage,         // ultrawork prompt 路由器
),
```

**移植要点**：oh-my-openagent 的工作流模式不是通过独立的 "workflow engine" 实现的，而是通过 `keyword-detector` + `system-transform` + `default_mode` 三层协作完成。关键词检测 → 注入 mode prompt → system transform 应用。可以复用这种"关键词触发 + prompt 注入"的轻量模式路由机制。

---

## 4. Hook 系统

### 5-Tier 组合架构

`packages/omo-opencode/src/create-hooks.ts` 展示了完整的组合模式：

```typescript
export function createHooks(args) {
  const core = createCoreHooks({ ctx, pluginConfig, ... })           // Session + ToolGuard + Transform
  const continuation = createContinuationHooks({ ctx, pluginConfig, ... }) // Continuation
  const skill = createSkillHooks({ ctx, pluginConfig, ... })         // Skill

  const hooks = { ...core, ...continuation, ...skill }
  return { ...hooks, disposeHooks: () => disposeCreatedHooks(hooks) }
}
```

### Tier 详情

| Tier | Composer | 数量（默认） | 数量（+team-mode） | 事件源 |
|------|----------|-------------|-------------------|--------|
| Session | `create-session-hooks.ts` | 24 | 24 | session lifecycle + chat.params + chat.message |
| Tool Guard | `create-tool-guard-hooks.ts` | 17 | 18 | tool.execute.before/after |
| Transform | `create-transform-hooks.ts` | 4 | 6 | experimental.chat.messages.transform |
| Continuation | `create-continuation-hooks.ts` | 7 | 7 | session.idle/compacted/event |
| Skill | `create-skill-hooks.ts` | 2 | 2 | chat.message |

总计：54 个基础 hook，60 个启用 team-mode，62 个同时启用 team-mode + monitor。

### Safe Hook 包装器

`packages/omo-opencode/src/shared/safe-create-hook.ts`：

```typescript
export function safeCreateHook<T>(
  name: string,
  factory: () => T,
  options?: SafeCreateHookOptions,
): T | null {
  const enabled = options?.enabled ?? true
  if (!enabled) return factory() ?? null
  try {
    return factory() ?? null
  } catch (error) {
    log(`[safe-create-hook] Hook creation failed: ${name}`, { error })
    return null
  }
}
```

每个 tier composer 内部都使用 `safeHook()` 包装器：

```typescript
const safeHook = <T>(hookName: HookName, factory: () => T): T | null =>
  safeCreateHook(hookName, factory, { enabled: safeHookEnabled })

const ralphLoop = isHookEnabled("ralph-loop")
  ? safeHook("ralph-loop", () => createRalphLoopHook(ctx, { ... }))
  : null
```

### Hook 启用控制

- `disabled_hooks` 配置数组 → `isHookEnabled(hookName)` 过滤
- `experimental.safe_hook_creation` 开关（默认 true）控制是否包装异常
- 每个 tier 的 composer 根据 `isHookEnabled` 条件性创建 hook，返回 null 表示禁用

### Team Mode 条件性 Hooks

当 `team_mode.enabled` 时，额外注册：

| Hook | Tier | 位置 | 用途 |
|------|------|------|------|
| team-mode-status-injector | Transform | `create-transform-hooks.ts` | 注入 `<team_mode_status>` 块 |
| team-mailbox-injector | Transform | `create-transform-hooks.ts` | 拉取待处理 mailbox 消息到 agent context |
| team-tool-gating | Tool Guard | `create-tool-guard-hooks.ts` | 基于 member role + permissions 限制 team_* 工具 |
| team-idle-wake-hint | event | `plugin/event.ts` | 唤醒 idle team members |
| team-lead-orphan-handler | event | `plugin/event.ts` | 检测 lead 离开 → orphan members |
| team-member-error-handler | event | `plugin/event.ts` | 响应 member session 错误 |
| team-member-status-handler | event | `plugin/event.ts` | 跟踪 member 状态转换 |

**移植要点**：hook 系统采用 "5-tier 组合 + safeCreateHook 容错 + disabled_hooks 配置门控" 的设计。可以按 tier 组织 hook composer，每个 composer 返回一个 record，最终 spread 合并。关键设计决策：

1. 用 `safeCreateHook` 隔离单 hook 故障
2. 用 `isHookEnabled` + `disabled_hooks` 实现运行时开关
3. 条件性 hook 通过配置门控（如 `team_mode.enabled`）

---

## 5. Agent 注册

### 6-Phase Config Pipeline

`packages/omo-opencode/src/plugin-handlers/config-handler.ts` 实现了 `createConfigHandler()`，它是 OpenCode config hook 的处理函数：

```typescript
export function createConfigHandler(deps: ConfigHandlerDeps) {
  return async (config: Record<string, unknown>) => {
    applyProviderConfig({ config, modelCacheState, ... })               // Phase 1
    const pluginComponents = await loadPluginComponents(...)            // Phase 2
    applyHookConfig({ pluginComponents })                               // Phase 2b
    agentResult = await applyAgentConfig({ config, pluginConfig, ... }) // Phase 3
    applyToolConfig({ config, pluginConfig, agentResult })              // Phase 4
    await applyMcpConfig({ config, pluginConfig, ... })                 // Phase 5
    await applyCommandConfig({ config, pluginConfig, ... })             // Phase 6
  }
}
```

### Agent 注册流程（Phase 3）

`packages/omo-opencode/src/plugin-handlers/agent-config-handler.ts`：

```typescript
export async function applyAgentConfig(params: ApplyAgentConfigParams)
  : Promise<Record<string, unknown>> {
  // 1. 迁移旧 agent 名称
  const migratedDisabledAgents = params.pluginConfig.disabled_agents.map(
    (agent) => AGENT_NAME_MAP[agent.toLowerCase()] ?? agent,
  )

  // 2. 发现 skills
  const allDiscoveredSkills = await discoverAgentSkills(params)

  // 3. 加载自定义 agent 来源
  const sources = loadAgentSources(params)

  // 4. 创建 builtin agents（11 个）
  const builtinAgents = await createBuiltinAgents(
    migratedDisabledAgents,
    params.pluginConfig.agents,
    params.ctx.directory,
    currentModel,
    params.pluginConfig.categories,
    params.pluginConfig.git_master,
    allDiscoveredSkills,
    sources.customAgentSummaries,
    browserProvider,
    currentModel,
    disabledSkills,
    useTaskSystem,
    disableOmoEnv,
    params.pluginConfig.team_mode?.enabled ?? false,
  )

  // 5. 组装最终 agent map
  const { configuredDefaultAgent } = await assembleAgentConfig({
    config: params.config,
    pluginConfig: params.pluginConfig,
    builtinAgents,
    sources,
    currentModel,
    useTaskSystem,
    disabledAgentNames,
  })

  // 6. 最终化（设置 default_agent）
  return finalizeAgentConfig({ config, pluginConfig, configuredDefaultAgent })
}
```

### Builtin Agent 注册

`packages/omo-opencode/src/agents/builtin-agents.ts`：

```typescript
const agentSources: Record<BuiltinAgentName, AgentSource> = {
  sisyphus: createSisyphusAgent,
  hephaestus: createHephaestusAgent,
  oracle: createOracleAgent,
  librarian: createLibrarianAgent,
  explore: createExploreAgent,
  "multimodal-looker": createMultimodalLookerAgent,
  metis: createMetisAgent,
  momus: createMomusAgent,
  atlas: createAtlasAgent as AgentFactory,
  "sisyphus-junior": createSisyphusJuniorAgentWithOverrides as AgentFactory,
}

export async function createBuiltinAgents(...): Promise<Record<string, AgentConfig>> {
  const result: Record<string, AgentConfig> = {}

  // 按规范顺序创建：Sisyphus → Hephaestus → pending agents → Atlas
  const sisyphusConfig = maybeCreateSisyphusConfig({ ... })
  if (sisyphusConfig) result["sisyphus"] = sisyphusConfig

  const hephaestusConfig = maybeCreateHephaestusConfig({ ... })
  if (hephaestusConfig) result["hephaestus"] = hephaestusConfig

  for (const [name, config] of pendingAgentConfigs) {
    result[name] = config
  }

  const atlasConfig = maybeCreateAtlasConfig({ ... })
  if (atlasConfig) result["atlas"] = atlasConfig

  return result
}
```

### Agent 排序保障

`packages/omo-opencode/src/plugin-handlers/agent-priority-order.ts`：

```typescript
export const CANONICAL_CORE_AGENT_ORDER = DEFAULT_AGENT_ORDER
// ["sisyphus", "hephaestus", "prometheus", "atlas"]

export function reorderAgentsByPriority(
  agents: Record<string, unknown>,
  agentOrder?: readonly string[],
): Record<string, unknown> {
  const ordered: Record<string, unknown> = {}
  const seen = new Set<string>()
  const orderedDisplayNames = resolveAgentOrderDisplayNames(agentOrder)

  for (const [index, displayName] of orderedDisplayNames.entries()) {
    if (Object.prototype.hasOwnProperty.call(agents, displayName)) {
      ordered[displayName] = injectOrderField(agents[displayName], index + 1)
      seen.add(displayName)
    }
  }

  const nonCoreKeys = Object.keys(agents)
    .filter((key) => !seen.has(key))
    .sort((a, b) => a.localeCompare(b))

  for (const key of nonCoreKeys) {
    ordered[key] = agents[key]
  }
  return ordered
}
```

此外，`installAgentSortShim()` 在插件入口修补 `Array.prototype.sort/toSorted`，确保 OpenCode 的 `Agent.list()` 返回规范顺序（因为 OpenCode 1.4.x 忽略 agent order 字段，纯按名称排序）。

### Agent Mode 系统

`packages/omo-opencode/src/agents/types.ts` 定义了三种 mode：

- **primary** — 尊重用户在 UI 选择的模型（sisyphus, hephaestus, atlas, prometheus）
- **subagent** — 使用自身 fallback chain，忽略 UI 选择（oracle, librarian, explore, multimodal-looker, metis, momus, sisyphus-junior）
- **all** — 兼容类型，无内置 agent 使用

### Agent Config 缓存

`config-handler.ts` 实现了基于 `cacheKey` 的 agent config 缓存：

```typescript
const agentCacheKey = createAgentConfigCacheKey(config)
if (!pluginComponentsLoadFailed && agentConfigSnapshot?.cacheKey === agentCacheKey) {
  config.agent = cloneAgentConfig(agentConfigSnapshot.agents)  // 缓存命中
  replayAgentConfigSideEffects({ agentResult, ... })
} else {
  agentResult = await applyAgentConfig({ ... })  // 缓存未命中，重新计算
  agentConfigSnapshot = { cacheKey, agents: cloneAgentConfig(agentResult), ... }
}
```

**移植要点**：agent 注册采用了 "5 来源合并 + 规范顺序 + 缓存 + 回放 side effects" 的复杂流程。如果项目需要 agent 系统，应关注：

1. `createBuiltinAgents()` 的工厂模式（每个 agent 一个 `createXXXAgent` 函数）
2. `assembleAgentConfig()` 的合并顺序（builtin → custom sources → config agents）
3. `reorderAgentsByPriority()` + `installAgentSortShim()` 的排序保障双机制
4. `agentConfigSnapshot` 缓存避免重复计算

---

## 总结：核心架构模式

| 模式 | 实现位置 | 关键设计 |
|------|----------|----------|
| PluginModule 工厂 + DI | `src/testing/create-plugin-module.ts` | 30 个可注入依赖，staged init，测试友好 |
| 5-Tier Hook 组合 | `src/create-hooks.ts` + `src/plugin/hooks/create-*-hooks.ts` | Session/ToolGuard/Transform/Continuation/Skill，safeCreateHook 容错 |
| Team Mode 核心-适配分离 | `packages/team-core/` + `src/features/team-mode/` | 领域原语跨 harness，OpenCode 只负责 spawning/hooks/tools |
| Mode 路由（关键词注入） | `src/hooks/keyword-detector/` | keyword → mode prompt → system transform，支持 ultrawork/hyperplan/team |
| Agent 6-Phase Pipeline | `src/plugin-handlers/config-handler.ts` | provider → components → agents → tools → MCPs → commands |
| Agent 优先级保障 | `agent-priority-order.ts` + `agent-sort-shim.ts` | 对象 key 插入顺序 + Array.sort patch 双保险 |
| Tool 注册门控 | `src/plugin/tool-registry.ts` | 条件性合并 teamModeToolsRecord/taskToolsRecord/hashlineToolsRecord |
| Safe Hook 容错 | `src/shared/safe-create-hook.ts` | 单 hook 故障不影响整体，experimental.safe_hook_creation 开关 |
