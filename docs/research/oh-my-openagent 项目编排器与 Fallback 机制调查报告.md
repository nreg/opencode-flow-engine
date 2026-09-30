oh-my-openagent 项目编排器与 Fallback 机制调查报告
项目性质：多 Agent 编排器，以 OpenCode / Claude Code 插件形式实现  
调查范围：E:\work\nreg\ai-agent\source\oh-my-openagent  
调查深度：非常彻底（very thorough）  
一、主编排器（Main Orchestrator）清单
1.1 核心 Orchestrator 概览
该项目的编排体系分为三个层级：主要编排器（primary orchestrator）、专业顾问（advisor）和执行代理（executor）。其中被设计为"主要编排器"的有两个：Sisyphus 和 Atlas。
#	编排器名称	模式（Mode）	文件路径	职责摘要
1	Sisyphus	primary	packages/omo-opencode/src/agents/sisyphus/（含9个模型变体）	多模型主编排器，负责任务分解、并行委派、代码探索、结果验证
2	Atlas	primary	packages/omo-opencode/src/agents/atlas/agent.ts	Todo List 编排大师，持续监控并驱动 Boulder 会话完成全部任务
3	Hephaestus	primary	packages/omo-opencode/src/agents/hephaestus/agent.ts	自主深度工作代理，目标导向的端到端实现（GPT 系列专属）
1.2 Sisyphus — 多模型主编排器
文件路径：
- 工厂：packages/omo-opencode/src/agents/sisyphus-agent-factory.ts
- 配置：packages/omo-opencode/src/agents/sisyphus-agent-config.ts
- 动态 Prompt：packages/omo-opencode/src/agents/sisyphus-dynamic-prompt.ts
- 变体目录：packages/omo-opencode/src/agents/sisyphus/（9个文件）
模型变体路由（sisyphus-agent-factory.ts:56-66）：
export function resolveSisyphusPromptFamily(model: string): SisyphusPromptFamily {
  if (isKimiK27Model(model)) return "kimi-k2-7"
  if (isKimiK2Model(model)) return "kimi-k2-6"
  if (isGpt5_5Model(model) || isGpt5_6Model(model)) return "gpt-5-5"
  if (isGptNativeSisyphusModel(model)) return "gpt-5-4"
  if (isClaudeFable5Model(model)) return "claude-fable-5"
  if (isClaudeOpus48Model(model)) return "claude-opus-4-8"
  if (isClaudeOpus47Model(model)) return "claude-opus-4-7"
  if (isGlmModel(model)) return "glm-5-2"
  return "fallback"  // 兜底：根据模型家族选择 GPT 或 Claude prompt 结构
}
职责描述：
- 分析用户意图，分类任务类型（研究/实现/调查/评估/修复/开放式）
- 在探索阶段并行启动 explore + librarian 子代理
- 将实现任务委托给合适的 category（如 deep、quick、visual-engineering 等）
- 对结果进行验证（lsp_diagnostics、测试运行）
- 管理 Todo/Task 生命周期（创建 → in_progress → completed）
1.3 Atlas — Todo List 编排大师
文件路径： packages/omo-opencode/src/agents/atlas/agent.ts
核心职责（agent.ts:4）：
"Orchestrates work via task() to complete ALL tasks in a todo list until fully done."
- 持续监控 Boulder 会话（session.idle 事件驱动）
- 当任务列表未完成时强制注入延续提示
- 负责会话生命周期管理和写/编辑策略强制
Atlas 模型变体路由（agent.ts:49-57）：
export function getAtlasPromptSource(model?: string): AtlasPromptSource {
  const variant = resolveVariant({
    agentName: "atlas",
    modelID: model,
    variants: atlasPromptVariants,
  })
  // 支持 7 种变体：default, gpt, gemini, kimi, kimi-k2-7, opus-4-7, glm
}
1.4 Hephaestus — 自主深度工作代理
文件路径： packages/omo-opencode/src/agents/hephaestus/agent.ts
约束（agent.ts:26-51）：
- 仅支持 GPT 系列模型：GPT-5.3 Codex、GPT-5.4、GPT-5.5、GPT-5.6
- 不进行进一步委派（无 call_omo_agent），自主完成端到端实现
1.5 其他 Specialist 子代理
代理名	文件路径	Mode	职责
Oracle	packages/omo-opencode/src/agents/oracle.ts	subagent	架构决策顾问，处理多系统权衡
Metis	packages/omo-opencode/src/agents/metis.ts	subagent	预规划顾问，在规划前识别隐藏需求
Prometheus	packages/omo-opencode/src/agents/prometheus/	subagent	战略规划师，输出 .omo/plans/*.md
Momus	packages/omo-opencode/src/agents/momus.ts	subagent	计划审核员，验证计划可执行性
Librarian	packages/omo-opencode/src/agents/librarian.ts	subagent	外部文档研究员
Explore	packages/omo-opencode/src/agents/explore.ts	subagent	代码库内部探索者
Sisyphus-Junior	packages/omo-opencode/src/agents/sisyphus-junior/agent.ts	subagent	分类任务执行器，不进一步委派
二、Fallback 机制详细说明
该项目的 fallback 机制分为四个层级，从编译期配置到运行时动态降级，覆盖模型调用、子代理委派、工作流状态恢复等场景。
2.1 Model Fallback Chain（模型降级链）—— 核心机制
2.1.1 定义位置
文件： packages/model-core/src/agent-model-requirements.ts（Agent 级）  
文件： packages/model-core/src/category-model-requirements.ts（Category 级）  
类型定义： packages/model-core/src/model-requirement-types.ts:1-10
// model-requirement-types.ts
export type FallbackEntry = {
  providers: string[];       // 提供者优先级列表
  model: string;             // 模型名称
  variant?: string;          // 变体（如 "max", "high", "medium"）
  reasoningEffort?: string;
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number };
};

export type ModelRequirement = {
  fallbackChain: FallbackEntry[];  // 降级链（有序数组）
  variant?: string;                // 默认变体
  requiresModel?: string;          // 前置模型要求
  requiresAnyModel?: boolean;      // 至少一个模型可用即可激活
  requiresProvider?: string[];     // 前置提供者要求
};
2.1.2 各 Agent/Category 的 FallbackChain
Sisyphus（agent-model-requirements.ts:4-31）：
1. anthropic/claude-opus-4-7 (variant: max)
2. opencode-go/kimi-k2.6
3. kimi-for-coding/k2p5
4. opencode/kimi-k2.5
5. openai/gpt-5.5 (variant: medium)
6. zai-coding-plan/glm-5
7. opencode/big-pickle
    → requiresAnyModel: true（至少一个可用即激活）
    Atlas（agent-model-requirements.ts:164-177）：
1. anthropic/claude-sonnet-4-6
2. opencode-go/kimi-k2.6
3. openai/gpt-5.5 (variant: medium)
4. opencode-go/minimax-m3
5. minimax-coding-plan/MiniMax-M3
6. opencode-go/minimax-m2.7
Hephaestus（agent-model-requirements.ts:32-47）：
1. openai/gpt-5.6-sol (variant: high)
2. openai/gpt-5.5 (variant: medium)
    → requiresProvider: ["openai", "github-copilot", "opencode", "vercel"]
    Sisyphus-Junior（agent-model-requirements.ts:178-192）：
1. anthropic/claude-sonnet-4-6
2. opencode-go/kimi-k2.6
3. openai/gpt-5.5 (variant: medium)
4. opencode-go/minimax-m3
5. minimax-coding-plan/MiniMax-M3
6. opencode-go/minimax-m2.7
7. opencode/big-pickle
部分 Category（category-model-requirements.ts）：
Category	FallbackChain 前几项
ultrabrain	gpt-5.6-sol(xhigh) → gpt-5.5(xhigh) → gemini-3.1-pro(high) → claude-opus-4-7(max) → glm-5.2
deep	gpt-5.6-terra(xhigh) → gpt-5.6-sol(high) → gpt-5.5(medium) → claude-opus-4-7(max) → gemini-3.1-pro(high) → kimi-k2.6 → glm-5.2
quick	gpt-5.4-mini → claude-haiku-4-5 → gemini-3-flash → minimax-m3 → minimax-m2.7 → gpt-5-nano
visual-engineering	gemini-3.1-pro(high) → glm-5 → claude-opus-4-7(max) → glm-5.2 → k2p5
2.2 Model Resolution Pipeline（模型解析管道）—— 编译期降级
2.2.1 核心文件
packages/model-core/src/model-resolution-pipeline.ts — 通用模型解析管道  
packages/omo-opencode/src/agents/builtin-agents/model-resolution.ts — Agent 工厂层的封装
2.2.2 降级顺序
resolveModelPipeline（model-resolution-pipeline.ts:75-259）按以下严格优先级解析模型：
Step 1: UI 选择的模型（uiSelectedModel）
   ↓ 失败
Step 2: 用户配置模型（userModel）
   ↓ 失败
Step 3: Category 默认模型（categoryDefaultModel）
   - 若用户显式配置了 category 的 model，直接返回
   - 否则通过 fuzzyMatchModel 在 availableModels 中匹配
   - 冷缓存时若提供者已连接，直接使用
   ↓ 失败
Step 4: 用户 fallback_models（userFallbackModels，来自配置）
   - 优先匹配已连接的提供者
   - 其次 fuzzy match availableModels
   ↓ 失败
Step 5: 硬编码 fallbackChain（硬编码 fallbackChain）
   - 按 FallbackEntry 顺序逐个尝试
   - 优先已连接的提供者，其次 fuzzy match
   ↓ 失败
Step 6: 系统默认模型（systemDefaultModel）
   ↓ 失败
Step 7: 返回 undefined（不注册该 Agent）
2.2.3 关键代码片段
冷缓存跳过逻辑（model-resolution-pipeline.ts:121-130）：
const connectedProviders = input.availableModels.size === 0 ? deps.connectedProviders : null

if (
  input.availableModels.size === 0 &&
  connectedProviders === null &&
  !deps.hasProviderModelsCache &&
  !deps.hasConnectedProvidersCache
) {
  return { skipped: true }  // 所有缓存为空，暂停降级等待缓存就绪
}
skipped 信号的用途：  
当 availableModels 和 connectedProviders 都为空时（首次运行无缓存），管道返回 {skipped: true}。调用方（如 delegate-task/model-selection.ts）收到此信号后不立即降级，而是等待模型缓存异步加载完成，避免在信息不全时做出错误选择。
2.2.4 First-Run 特殊处理
sisyphus-agent.ts:70-72：
if (isFirstRunNoCache && !sisyphusOverride?.model && !uiSelectedModel) {
  // 首次运行且无缓存：直接使用 fallbackChain 第一个条目，不等待缓存
  sisyphusResolution = getFirstFallbackModel(sisyphusRequirement)
}
hephaestus-agent.ts:69-71： 同理。
2.2.5 Agent 激活条件
sisyphus-agent.ts:49-60：
const meetsSisyphusAnyModelRequirement =
  !sisyphusRequirement?.requiresAnyModel ||    // 无 requiresAnyModel 要求
  hasSisyphusExplicitConfig ||                  // 用户显式配置
  isFirstRunNoCache ||                          // 首次运行
  isAnyFallbackModelAvailable(sisyphusRequirement.fallbackChain, availableModels)  // fallbackChain 至少有一个可用

if (!disabledAgents.includes("sisyphus") && !meetsSisyphusAnyModelRequirement) {
  log("[agent-registration] Agent skipped: no model in fallback chain is available")
}
结论： 如果 fallbackChain 中没有任何一个模型可用，该 Agent 根本不会被注册（返回 undefined）。
2.3 Runtime Model Fallback（运行时模型降级）—— 动态降级
2.3.1 文件位置
- Hook 入口： packages/omo-opencode/src/hooks/runtime-fallback/hook.ts
- 事件处理器： packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts
- 降级链迭代器： packages/omo-opencode/src/hooks/runtime-fallback/next-fallback.ts
- 错误分类器： packages/omo-opencode/src/hooks/runtime-fallback/error-classifier.ts
- Fallback 模型来源： packages/omo-opencode/src/hooks/runtime-fallback/fallback-models.ts
2.3.2 降级触发条件
当 session.error 事件发生时（event-handler.ts:170-276）：
session.error 事件
  → 提取 error 对象
  → 检查是否是 AbortError（用户取消/内部取消）
     是 → 清理状态，退出（不降级）
     否 → 继续
  → 检查是否有 retry in flight（防重复）
     是 → 跳过
     否 → 继续
  → classifyErrorType(error) → 是否是可重试错误？
     否 → 跳过（STOP errors：配额超限、余额不足、免费额度用完）
     是 → 继续
  → getFallbackModelsForSession() → 是否有配置 fallback_models？
     无 → 跳过
     有 → dispatchFallbackRetry() → 发送降级请求
可重试错误类型（error-classifier.ts:36-45 + model-core/src/model-error-classifier.ts）：
错误名称/模式	说明
ProviderModelNotFoundError	模型未找到
RateLimitError	速率限制
ModelUnavailableError	模型不可用
ProviderConnectionError	提供者连接错误
AuthenticationError	认证错误
HTTP 429 / 503 / 529	状态码触发
rate_limit / cooling down / retrying in	消息模式触发
STOP 错误（不降级，直接停止）：
- QuotaExceededError / InsufficientCreditsError / FreeUsageLimitError
- 消息包含：quota will reset after、in arrears、daily call limit、billing hard limit 等
2.3.3 Fallback 模型来源优先级
fallback-models.ts:39-86：
1. Session 对应的 category 的 fallback_models（通过 SessionCategoryRegistry 查找）
2. Agent 配置的 fallback_models
3. Agent 所属 category 的 fallback_models
4. 从 sessionID 解析 agent 名后查找该 agent 的 fallback_models
  → 都没有则返回 undefined（不降级）
  2.3.4 降级执行
  auto-retry-dispatch.ts:16-147：
  return async (sessionID, newModel, resolvedAgent, source) => {
    // 1. 构建 retryModelPayload（含 model + variant + reasoningEffort 等）
    // 2. 获取原始用户消息 parts（用于重建 retry 上下文）
    // 3. 通过 dispatchInternalPrompt 发送降级请求
    // 4. 若 session 处于 active 状态，延迟到合适时机再试
    // 5. 记录 sessionRetryInFlight 防止并发重试
  }
  降级后状态跟踪（chat-message-fallback-handler.ts:27-35）：
  // 降级成功后，修改输出的 model 字段
  output.message["model"] = {
    providerID: fallback.providerID,
    modelID: fallback.modelID,
  }
  // 弹出 Toast 通知用户
  toast({ title: "Model fallback", message: `Using ${provider}/${model}` })
  2.4 Sync Task Fallback（同步任务降级）—— 委派执行级
  2.4.1 文件位置
  packages/omo-opencode/src/tools/delegate-task/sync-task-fallback.ts  
  packages/omo-opencode/src/tools/delegate-task/sync-task-runner.ts
  2.4.2 Prompt 失败降级
  sync-task-runner.ts:104-144：
  while (true) {
    // 发送 prompt
    let promptError = await deps.sendSyncPrompt(...)
    if (promptError) {
    // Prompt 发送失败 → 尝试 fallback
    const promptResult = await retrySyncPromptWithFallbacks({
      sessionID, initialError: promptError,
      categoryModel: effectiveCategoryModel,
      fallbackChain,
      sendPrompt: async (fallbackModel) => deps.sendSyncPrompt(...)
    })
    if (promptResult.promptError) return promptResult.promptError  // 全部失败
    effectiveCategoryModel = promptResult.categoryModel  // 切换到 fallback 模型
    }

  // 轮询 session
  const pollError = await deps.pollSyncSession(...)
  if (pollError) {
    // 轮询失败 → 检查是否可重试
    if (shouldAttemptPollErrorRecovery(pollError)) {
      // 尝试从已完成的 session 中恢复结果
      const recovered = await deps.fetchSyncResult(...)
      if (recovered.ok) return recovered.textContent
    }

    // 可降级的轮询错误 → 创建新 session 并切换到 fallback 模型
    const nextFallbackModel = getNextSyncFallbackModel(activeSessionID, fallbackState)
    if (!nextFallbackModel) return pollError
    
    const retrySessionResult = await deps.createSyncSession(client, {
      categoryModel: nextFallbackModel,  // 使用 fallback 模型创建新 session
      ...
    })
    activeSessionID = retrySessionResult.sessionID
    continue  // 重新进入循环
  }

  // 成功 → 返回结果
  return result.textContent
}
2.4.3 Fallback 状态机
sync-task-fallback.ts:23-83：
export async function retrySyncPromptWithFallbacks(input) {
  const fallbackState: ModelFallbackState = {
    providerID: categoryModel.providerID,
    modelID: categoryModel.modelID,
    fallbackChain,
    attemptCount: 0,
    pending: true,
  }

  while (true) {
    const nextFallback = getNextReachableFallback(sessionID, fallbackState)
    if (!nextFallback) break  // fallbackChain 耗尽

    const promptError = await sendPrompt(fallbackModel)
    if (!promptError) {
      return { promptError: null, categoryModel: fallbackModel }  // 成功
    }
    
    if (isPromptGateReservedError(promptError)) break  // 保留错误，停止降级
    
    fallbackState.attemptCount++  // 推进到下一个 fallback
  }
  return { promptError: finalError }  // 全部降级失败
}
next-fallback.ts:32-83（Fallback 选择逻辑）：
export function getNextReachableFallback(sessionID, state) {
  while (state.attemptCount < state.fallbackChain.length) {
    const fallback = state.fallbackChain[state.attemptCount]
    state.attemptCount++

    // 跳过不可达的提供者（未连接）
    if (!isReachable(fallback)) continue
    
    // 跳过 no-op（fallback 模型与当前模型相同）
    if (isNoOpFallback) continue
    
    return { providerID, modelID, variant, ... }  // 返回下一个可用 fallback
  }
  return null  // 无更多 fallback
}
2.5 Subagent Fallback（子代理调用降级）
2.5.1 Delegate Task 模型解析
packages/omo-opencode/src/tools/delegate-task/subagent-model-resolution.ts：
export async function resolveSubagentModel(agentToUse, matchedAgent, executorCtx) {
  const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentConfigKey]

  // 使用 delegate-core 的 resolveModelForDelegateTask 进行多级降级
  const resolution = resolveModelForDelegateTask({
    userModel: agentOverride?.model ?? agentCategoryModel,
    userFallbackModels: flattenToFallbackModelStrings(normalizedAgentFallbackModels),
    categoryDefaultModel: matchedAgentModelStr,
    fallbackChain: agentRequirement?.fallbackChain,  // ← 使用 Agent 级 fallbackChain
    availableModels,
    systemDefaultModel: undefined,
  })

  // 解析成功后，将 fallbackChain 附加到结果中供 runtime 使用
  fallbackChain = configuredFallbackChain ?? agentRequirement?.fallbackChain
}
2.5.2 子代理调用错误处理
packages/omo-opencode/src/tools/delegate-task/subagent-resolver.ts:11-47：
export async function resolveSubagentExecution(args, executorCtx, parentAgent, ...) {
  try {
    const agentMatch = await resolveSubagentAgentMatch(agentToUse, executorCtx)
    if (agentMatch.kind === "error") return agentMatch.result

    const { categoryModel, fallbackChain } = await resolveSubagentModel(...)
    return { agentToUse, categoryModel, fallbackChain }
  } catch (error) {
    // 捕获异常，返回错误信息（不降级到其他模型，只报告错误）
    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Failed to delegate to agent "${agentToUse}": ${errorMessage}`,
    }
  }
}
子代理错误重试指引（delegate-core/src/retry-patterns.ts + retry-guidance.ts）：
// 检测到的 9 种错误模式
DELEGATE_TASK_ERROR_PATTERNS = [
  { pattern: "run_in_background", fixHint: "Add run_in_background=false/true" },
  { pattern: "load_skills", fixHint: "Add load_skills=[] parameter" },
  { pattern: "category OR subagent_type", fixHint: "Provide ONLY one of category or subagent_type" },
  { pattern: "Unknown category", fixHint: "Use a valid category from Available list" },
  { pattern: "Agent name cannot be empty", fixHint: "Provide a non-empty subagent_type" },
  { pattern: "Cannot call primary agent", fixHint: "Primary agents cannot be called via task" },
  // ...
]
2.6 工作流状态异常恢复
2.6.1 Poll 错误恢复
sync-session-poller.ts:10： ACTIVE_SESSION_STATUSES = {"busy", "retry", "running"}  
轮询逻辑（sync-session-poller.ts:167-237）：
if (isActiveSessionStatus(sessionStatus)) {
  inactiveStart = Date.now()  // 重置不活跃计时器
  continue  // 继续轮询
}

// 检测 session 是否完成
if (isSessionComplete(messages)) break

// 检测到 assistant 文本但无 finish 标记 → 视为完成（降级路径）
if (!lastAssistant?.info?.finish && hasAssistantText) {
  break  // fallback 完成路径
}

// 达到最大 assistant 轮次 → 中止（防无限循环）
if (assistantTurnCount >= maxTurns) {
  abortSyncSession(client, sessionID, "max_turns_exceeded")
}
sync-poll-error-recovery.ts:1-24（Poll 错误可恢复性判断）：
export function shouldAttemptPollErrorRecovery(pollError: string): boolean {
  // MessageAbortedError / DOMException AbortError / "the operation was aborted"
  // → 尝试从 session 中恢复已完成的结果
}
2.6.2 Session 状态 Hook（Atlas）
packages/omo-opencode/src/hooks/atlas/event-handler.ts：
- 监听 session.idle → 决定是否注入延续提示（boulder-continuation-injector）
- session.error → 如果不是 abort 错误，触发 Atlas 会话继续逻辑
- session.deleted / session.compacted → 清理 pending retry timer
2.7 配置缺失/插件未安装的默认行为
2.7.1 Agent 不注册
sisyphus-agent.ts:55-60、hephaestus-agent.ts:54-60：
// 如果 fallbackChain 中所有模型都不可用（且非首次运行、无显式配置）
// → 直接返回 undefined，该 Agent 不被注册
if (!meetsSisyphusAnyModelRequirement) return undefined
atlas-agent.ts:56-62：
if (!atlasResolution) {
  log("[agent-registration] Agent skipped: model resolution returned no result")
  return undefined  // Atlas 被跳过
}
2.7.2 冷缓存跳过（skipped 信号）
model-selection.ts:121-130：
// 首次运行、无 any 缓存时 → 返回 {skipped: true}
// 调用方收到此信号后不选择任何模型，等待缓存就绪
if (
  input.availableModels.size === 0 &&
  connectedProviders === null &&
  !deps.hasProviderModelsCache &&
  !deps.hasConnectedProvidersCache
) {
  return { skipped: true }
}
2.7.3 类别/子代理不存在
category-resolver.ts:73-101：
if (!categoryExists) {
  return categoryResolutionError(
    `Unknown category: "${categoryName}". Available: ${allCategoryNames}`
  )
}

// Category 有 requiresModel 要求但模型不可用时
if (categoryReq?.requiresModel && !isModelAvailable(categoryReq.requiresModel, availableModels)) {
  return categoryResolutionError(
    `Category "${categoryName}" requires model "${requirement.requiresModel}" which is not available.`
  )
}
三、Fallback 机制总结
3.1 触发条件汇总
场景	触发条件	文件
模型不可用（编译期）	fallbackChain 中模型 fuzzyMatch 失败	model-resolution-pipeline.ts
模型不可用（首次运行）	isFirstRunNoCache=true 且无显式配置	sisyphus-agent.ts:70-72
模型调用失败（运行时）	session.error + 可重试错误分类	event-handler.ts:170-276
Prompt 发送失败	sendSyncPrompt 返回错误	sync-task-runner.ts:104-144
轮询超时/失败	pollSyncSession 返回错误	sync-task-runner.ts:146-207
Abort/取消	isAbortError() 为 true	各处 abort handler
Agent 无可用模型	fallbackChain 全部不可用 + 无显式配置	sisyphus-agent.ts:55-60
3.2 降级顺序
主模型（用户配置/UI 选择）
  ↓ 失败
Category 默认模型
  ↓ 失败
用户 fallback_models（配置项）
  ↓ 失败
硬编码 fallbackChain（逐条尝试，跳过不可达提供者）
  ↓ 失败
系统默认模型
  ↓ 失败
返回 undefined / 抛出错误
3.3 恢复策略
策略	说明	关键函数
立即降级	同一请求内切换 fallback 模型重试	retrySyncPromptWithFallbacks
创建新 Session 重试	轮询失败后，用 fallback 模型创建新 session	sync-task-runner.ts:180-206
结果恢复	Abort 后尝试从 session messages 中提取已完成的结果	sync-poll-error-recovery.ts
状态重置	降级成功后重置 attemptCount，新错误重新开始	next-fallback.ts
Toast 通知	降级发生时向用户显示通知	chat-message-fallback-handler.ts
冷却/停止	STOP errors（配额耗尽）不降级，直接停止	model-error-classifier.ts:17-21
3.4 关键文件索引
功能	文件路径
FallbackChain 定义	packages/model-core/src/agent-model-requirements.ts
FallbackChain 定义	packages/model-core/src/category-model-requirements.ts
类型定义	packages/model-core/src/model-requirement-types.ts
模型解析管道	packages/model-core/src/model-resolution-pipeline.ts
Delegate 模型解析	packages/delegate-core/src/model-selection.ts
错误分类器	packages/model-core/src/model-error-classifier.ts
Agent 工厂降级逻辑	packages/omo-opencode/src/agents/builtin-agents/sisyphus-agent.ts
Agent 工厂降级逻辑	packages/omo-opencode/src/agents/builtin-agents/hephaestus-agent.ts
Agent 工厂降级逻辑	packages/omo-opencode/src/agents/builtin-agents/atlas-agent.ts
运行时降级 Hook	packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts
运行时降级 Hook	packages/omo-opencode/src/hooks/runtime-fallback/next-fallback.ts
同步任务降级	packages/omo-opencode/src/tools/delegate-task/sync-task-fallback.ts
同步任务降级	packages/omo-opencode/src/tools/delegate-task/sync-task-runner.ts
子代理模型解析	packages/omo-opencode/src/tools/delegate-task/subagent-model-resolution.ts
委派错误模式	packages/delegate-core/src/retry-patterns.ts
重试指引生成	packages/delegate-core/src/retry-guidance.ts
Poll 错误恢复	packages/omo-opencode/src/tools/delegate-task/sync-poll-error-recovery.ts
Atlas 会话 Hook	packages/omo-opencode/src/hooks/atlas/event-handler.ts