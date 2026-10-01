# 模型重试与 Fallback 机制

> 面向 opencode-flow-engine 维护者的机制参考文档。
> 最后更新：2026-10-01（第 2 轮增强：状态机收敛 / 冷缓存保护 / poll 恢复层 / 事件预降级）

---

## 一、概述

### 机制目标

本机制解决子代理调用 LLM 时的六类运行时故障场景：

1. **错误分类驱动**：依据 provider HTTP 状态码（非错误文案）对模型故障做三档分类，驱动差异化冷却策略
2. **显式降级链**：模型解析与换模候选完全依赖用户配置（modelProfiles / per-agent fallback_models），无内置默认链
3. **产出正向判定**：以"产出是否像真实完成"为判据（完成信号 / 结构化报告证据），而非枚举错误文案
4. **降级可观测**：每次故障转移写入 subagent-store `model_fallback` 事件与通知系统
5. **防重复重试**：`attemptedModels` + `MAX_MODEL_RETRIES` + 重复模型检测三重终止
6. **启动期对账**：插件加载时与 provider 实际可用模型列表对账，对不可用模型 warn + 标注

### 设计哲学

- **正向判定**：`hasRealOutput` 判断"像不像真实产出"（完成信号 / 报告关键词 / Markdown 标题行），不枚举错误文案——无穷无尽的 provider 报错措辞无法穷举
- **宁误报失败不误报成功**：无机器可读错误码且无完成信号的产出视为 `no-valid-output` 失败，原文保留供编排器参考，不拉黑不换模
- **码驱动而非文案驱动**：错误分类唯一判据是 HTTP 状态码（5 层提取），无码报错无法分类是可接受的已知限制

---

## 二、模型解析链

### resolveModelWithFallback 优先级管道

位置：`agents/agent-builder.ts:369-530`（`resolveModelWithFallbackCore`）

| 优先级 | 来源 | provenance 标签 | 说明 |
|--------|------|-----------------|------|
| 1 | programmatic override（`overrides?.[name]?.model`）| `override` | 运行时 API 传入 |
| 2 | `model` 参数 | `override` | 工具参数直传 |
| 3 | `modelType` tier 参数 → `modelProfiles[tier].model` | `profile` | 6-tier 系统（lite/quick/standard/deep/ultra/review） |
| 4 | per-agent config（`configOverrides?.[name]?.model`）| `config-override` | 用户 sflow.json 配置 |
| 5 | `AGENT_PROFILES[name]` 静态绑定 → 对应 tier 的 modelProfiles | `profile` | 如 `spec-writer → deep` |
| 6 | Fallback chain（per-agent config fallbacks → user tier fallbacks）| `provider-fallback` | 沿链找第一个 `isModelAvailable` 的模型 |
| 7 | 链耗尽 | `unconfigured` | `{ model: undefined }` |

**关键约束**：
- 优先级 1-5 的每个分支都检查 `isModelAvailable`（黑名单），不可用则 fall-through 到下一优先级
- **本项目有意无 UI 选择 / 硬编码链 / 系统默认**——所有模型完全来自用户配置，无配置时降级到 `unconfigured`
- `resolveModelWithFallback` 对外暴露的包装函数（:530+）增加 `validateConfiguredModels` 对账与 `unverifiedModels` 标注

### buildAgentFallbackChain

位置：`agents/agent-builder.ts:743-754`

构建顺序：per-agent config `fallback_models` → 对应 tier 的 `fallback_models` → 去重。供 `getAlternativeModel` 使用。

### getAlternativeModel

位置：`agents/agent-builder.ts:713-725`

在用户配置的 fallback 链内挑选第一个 ≠ currentModel 且通过黑名单检查的模型。无内置默认列表，用户未配置时返回 null。

---

## 三、错误分类

### classifyModelErrorByCode 三档分类

位置：`helpers/completion-detector.ts:227-271`

| 分类 | 状态码 | 语义 | 拉黑策略 |
|------|--------|------|----------|
| `non-transient` | 401/402/403/404 + 配额文本 type | 持久性错误（认证/配额/模型不存在） | 长冷却：重置时间 TTL 或默认 30min |
| `transient` | 429/408/409/5xx | 瞬时错误（限速/超时/服务端临时故障） | 5min 短冷却 |
| `none` | 400 等 / 无码 | 请求级错误 / 无法分类 | 不拉黑，走 fatal 或既有逻辑 |

### 5 层状态码提取

位置：`helpers/completion-detector.ts:199-209`

按优先级依次匹配：

1. **嵌入 code 字段**：`"code":"402"` / `"code":402`（`EMBEDDED_CODE_PATTERN`）
2. **HTTP 前缀**：`HTTP 402`（`HTTP_CODE_PATTERN`）
3. **括号形态**：`(code: 500)`（`PAREN_CODE_PATTERN`）
4. **status 字段**：`status: 429`（`STATUS_FIELD_PATTERN`）
5. **行首前缀码**：`401：Token refresh failed`（`LINE_PREFIX_CODE_PATTERN`）
6. **错误 type 字段**：`RateLimit` / `Quota` → 按 403 处理（`ERROR_TYPE_PATTERN`）
7. **入参 status**：函数参数兜底（message 无码时使用）

### resetAt 解析与冷却语义

位置：`helpers/completion-detector.ts:110-177`（`parseQuotaResetTime`）

- 优先匹配 `reset`/`重置` 关键词邻近的时间戳（多日期文本取对时间）
- 支持 UTC±n / GMT±n / ISO ±HH:MM 偏移
- 无时区标记按本地时间解释；裸 UTC/GMT（无偏移后缀）按 UTC+0
- NP-1：偏移量按「小时 + 分钟/60」解析为有限数值，杜绝 `Number("+08:00") → NaN`

### markModelUnavailable 单调合并

位置：`agents/agent-builder.ts:221-254`

- **单调合并语义**：同一模型多次 mark 时取更长 `expireAt`（`Math.max`），短冷却不覆盖长冷却
- **过期不拉黑**：解析出的 `resetAt` 已过去时，仅在无在效条目时删除（保守化，防裸 UTC 误落本地时区解释导致误删）
- **7 天封顶**：`MAX_QUOTA_COOLDOWN_TTL_MS = 7 * 24 * 3600_000`
- **NaN 防御**：非有限 `resetAt` 退化为默认 TTL（`NaN` 会使 `Math.max/比较` 失效导致永久拉黑）

### abort 错误名精确枚举

位置：`tools/call-flow-agent.ts:237-242`

```typescript
export const ABORT_ERROR_NAMES: string[] = ['MessageAbortedError', 'AbortError'];
```

- **精确相等**判定（`ABORT_ERROR_NAMES.includes(errName)`），禁止 `/abort/i` 包含式匹配
- 命中时**零降级**：不拉黑、不换模、不重发——用户主动中止的任务若被自动换模重发，违反用户意图且产生额外成本
- `MessageAbortedError` 来自 OpenCode SDK v2 的 `AssistantMessage.info.error.name` 联合枚举

---

## 四、产出正向判定

### hasRealOutput 判定链

位置：`helpers/completion-detector.ts:410-424`

```
hasRealOutput(output):
  1. 空 / 非字符串 / 仅空白 → false
  2. hasCompletionSignal → true
     - [TASK_COMPLETE]（大小写不敏感）
     - JSON code fence（```json ... ```）
     - Bare JSON object（{...}）
  3. hasStructuredReportEvidence → true
     - 报告关键词（Summary / 完成 / Test Results / Batch Status / Files）
     - "完成"命中否定形态时（COMPLETION_NEGATION_PATTERN）不计入证据
     - Markdown 标题行（#{1,6} ...）
  4. 其余 → false
```

### failureReason 枚举全集

位置：`tools/call-flow-agent.ts:247-258`（`RunFallbackResult.failureReason`）

| failureReason | 语义 | 拉黑 | 换模 |
|---------------|------|------|------|
| `exhausted` | fallback 链耗尽 / 无替代模型 / 重复模型 / 超上限 | ✅ | ✅（已耗尽） |
| `context-overflow` | ContextOverflowError | ❌ | ❌ |
| `fatal` | 请求级错误（400/无码 send 失败）| ❌ | ❌ |
| `invalid-model` | 模型字符串格式错误 | ❌ | ❌ |
| `no-valid-output` | 产出无完成信号且无错误码 | ❌ | ❌（原文保留） |
| `aborted` | 用户/系统取消（Abort） | ❌ | ❌（零降级） |
| `timeout-pending` | poll 窗口超时但会话仍在 busy/retry | ❌ | ❌（慢而健康） |

### 三路径判定顺序

#### sync 路径（runWithModelFallback）

位置：`tools/call-flow-agent.ts:274-501`

```
sendPromptOnce → 不 ok → classifyModelErrorByCode → 换模或 fatal
                → ok → poll → PROBE_PENDING → timeout-pending（不拉黑）
                             → null → readLastAssistantErrorName
                                     → ContextOverflowError → context-overflow
                                     → Abort → aborted（零降级）
                                     → 其余 → markModelUnavailable → 三重终止检测 → getAlternativeModel
                             → string → classifyModelErrorByCode → 换模或 hasRealOutput
                                                                → !hasRealOutput → no-valid-output
                                                                → hasRealOutput → success
```

#### watcher 路径（checkTasks）

位置：`tools/call-flow.ts:718-1132`

```
probeMode poll → PROBE_PENDING → 继续下一 tick
              → null → readLastAssistantErrorName → Abort → finalizeAbortedTask（零降级）
                                                    → 其余 → attemptWatcherFallback 循环
                                                            → reProbe → PROBE_PENDING → 交下轮 tick
                                                                     → null → 继续 fallback
                                                                     → string → classifyAsyncFailure → 继续 fallback
                                                                             → echoBaseline 回显 → 继续 fallback
                                                                             → !hasRealOutput → no-valid-output
                                                                             → hasRealOutput → completed
              → string → classifyAsyncFailure / echoBaseline / hasRealOutput 判定
```

#### pollAndComplete 路径（async 单次调度）

位置：`tools/call-flow-agent.ts:521-603`（`tryAsyncModelFallback`）+ pollAndComplete 主流程

```
poll → null → tryAsyncModelFallback → markModelUnavailable → getAlternativeModel
                                            → 三重终止 → exhausted
                                            → 有替代 → sendPromptOnce → ok → 保持 running
                                                                → 不 ok → retried: false
     → PROBE_PENDING → 不拉黑、不换模（与 sync timeout-pending 语义一致）
     → string → classifyAsyncFailure → 换模
                              → !hasRealOutput → no-valid-output
                              → hasRealOutput → completed
```

---

## 五、运行时故障转移

### sync runWithModelFallback 编排

位置：`tools/call-flow-agent.ts:274-501`

循环 `send → poll`，poll 返回 null 时为最强"该模型不可用"判据（OpenCode 已在同一模型重试 5 次后确认失败）。

关键设计决策：
- **D-3**：换模型只用 `getAlternativeModel`（禁用 `resolveModelWithFallback` 的无黑名单检查分支）
- **D-4**：三重终止 —— ① 无替代模型 ② 重复模型 ③ `attemptedModels.length > MAX_MODEL_RETRIES`
- **D-5**：同 session 换 model 重新 prompt，重试**原样重发** basePrompt（`buildAttemptPrompt` 直通），上下文由 session 承载
- **D-6**：ContextOverflowError 既不拉黑也不换模型
- **D-7**：前置校验失败（send 不 ok 且无错误码）直接终止，不拉黑不换模型
- **D-8**：模型故障 → `markModelUnavailable` 拉黑

**MAX_MODEL_RETRIES = 2** 语义：首模型 + 最多 2 次换模型 = 最多 3 次 prompt 调用。

### async tryAsyncModelFallback

位置：`tools/call-flow-agent.ts:521-603`

与 sync 不同：prompt 早已发出，只需在检测到 null 后换模型重 prompt。三重终止与拉黑逻辑同 sync。

状态双写：`taskModelAttempts`（模块级 Map）+ `registry.attemptedModels`（持久化条目）。

### timeout-pending 语义

位置：`tools/call-flow-agent.ts:373-387`

`PROBE_PENDING`（polling 层判定"窗口超时但会话仍在 busy/retry"）→ 编排器不拉黑、不换模、不重发。慢而健康的模型不因固定窗口超时定罪。session 仍在运行，编排器可稍后通过 `flowagent_output` 取结果。

### 防重复重试三重终止

| 终止条件 | 代码位置 | 说明 |
|----------|----------|------|
| ① 无替代模型 | `:470-481`（sync）/ `:551`（async） | `getAlternativeModel` 返回 null |
| ② 重复模型 | `:484-494`（sync）/ `:554`（async） | `attemptedModels.includes(next)` |
| ③ 超上限 | `:456-466`（sync）/ `:555`（async） | `attemptedModels.length > MAX_MODEL_RETRIES` |

### reserve-then-dispatch

位置：`tools/call-flow-agent.ts:1505-1527`

async 路径（`pollAndComplete`）在发送 prompt 前先 reserve registry 条目（写入 sessionID/resolvedModel），再 dispatch。消除"prompt 已发但 registry 未写入"的孤儿 session 竞态（5a0ebce 修复）。

---

## 六、启动期校验

### model-availability 状态机

位置：`agents/model-availability.ts:21-23`

```
cold ──refreshAvailableModels──→ ready（至少一个 provider 且模型集合非空）
   └──查询异常/超时──→ failed
   └──空数据──→ cold
```

- `cold`：未刷新 / provider 返回空数据
- `ready`：至少一个 provider 且模型集合非空
- `failed`：查询异常 / 超时

`cold`/`failed` 时 `isModelKnown` 返回 `undefined`（不下判断，调用方应静默跳过）。

### provider.list 3s 超时保护

位置：`agents/model-availability.ts:37-50`（`withTimeout`）

```typescript
const PROVIDER_LIST_TIMEOUT_MS = 3_000;
```

**背景**：`provider.list()` 是 HTTP API 调用。OpenCode 服务器尚未就绪时可能长时间挂起，不设超时会阻塞插件 server 函数返回，导致宿主启动卡死（e1ff0e5 修复的原始问题）。超时按 `failed` 处理，不抛出。

实现：`Promise.race` + `finally` 清理定时器，无泄漏。

### 三工厂接线

| 工厂 | 接线位置 | 说明 |
|------|----------|------|
| `sflow-plugin-factory.ts` | `:473` | `validateConfiguredModels(client, config)` |
| `iflow-plugin-factory.ts` | `:120` | 同上 |
| `combined-plugin-factory.ts` | `:216` | 5a0ebce 补接 |

三处均为 `try/catch` 包裹的 warn-only，不阻断插件注册。

### unverifiedModels 标注

位置：`agents/agent-builder.ts:306-311`

启动期对账后，若最终 model 不在已知列表中且状态为 `ready`，写入 `ModelResolutionResult.unverifiedModels`（独立字段，不复用 `fallbackAttempted`，后者有 `toEqual` 断言依赖）。

---

## 七、commit 清单

| commit | 首行摘要 |
|--------|----------|
| `ae34410` | fix(fallback): 产出改为完成信号正向判定，并分离 send 失败语义 |
| `f65d625` | fix(fallback): 区分用户取消与模型故障，并统一异步 re-poll 语义 |
| `1357a31` | feat(agents): 启动期校验配置模型是否在 provider 可用列表中 |
| `5e47b26` | fix(fallback): 补齐异步 re-poll 产出正向判定并统一重试语义 |
| `5a0ebce` | fix(fallback): 修复 sync 超时误拉黑、回显误判与孤儿 session 问题 |
| `e1ff0e5` | fix(agents): provider.list 增加超时保护，防止插件初始化阻塞宿主启动 |
| `b5e2da8` | fix(model-routing): 修复 model-error-code 测试配额重置时间炸弹 |

---

## 八、第 2 轮增强（R4 遗留修复 + omo 借鉴实现）

> 第 2 轮 7 个 commit（见 §八·7 清单），在保持「正向判定 / 码驱动 / abort 零降级」三原则不变的前提下，
> 收敛重复结构、收窄误判面、补齐冷缓存保护与 poll 恢复层，并引入事件驱动预降级。
> 全部 7 项均通过独立验收测试；验证基线由 2042 演进至 **2103 pass / 0 fail**。

### 1. 共享 FallbackState 状态机（W1，9a7faec）

位置：`helpers/fallback-state.ts`（纯重构，无行为变更，仅结构收敛）

收敛 `runWithModelFallback` / `tryAsyncModelFallback` / `checkTasks` 三处重复的
「拉黑 → 选候选 → 终止判定」结构；`attemptedModels` 成为单源真值，async 路径
废弃 `taskModelAttempts` Map，统一由 `recordAttempt` 单点写入 `registry.attemptedModels`。
（对应 P3-3 / P3-4 / omo-5）

导出 API：

| 函数 | 职责 |
|------|------|
| `createFallbackState(initialModel, fallbackChain)` | 初始化（首模型自动加入 `attemptedModels`，`attemptCount=1`） |
| `recordAttempt(state, model)` | 单点写入：记入 `attemptedModels`、递增 `attemptCount`、更新 provider/model |
| `getNextCandidate(state, isModelAvailable)` | 沿链选第一个未尝试且非黑名单的候选（见 §2 冷缓存保护） |
| `isExhausted(state, maxRetries)` | `attemptCount > maxRetries` 或全链已尝试 → 耗尽 |
| `canRecoverFromPollError(errorName)` | abort 类错误不可恢复，其余可恢复（见 §4） |
| `resolveProbeVerdict(probeResult, reProbe, registryEntry, readErrorName, readRecoverable?)` | 纯函数：返回 `'idle'\|'pending'\|'noSignal'\|'recoverable'\|'error'\|'abort'`，无副作用 |

`ProbeVerdict` 六值枚举取代散落三处的布尔/字符串判定，W4 在此落地 `recoverable` 分支。

### 2. 错误码分类前置守卫 shouldClassifyOutput（W2，91cc1f8）

位置：`helpers/completion-detector.ts`（`ERROR_CLASSIFY_MAX_LENGTH = 500` + `shouldClassifyOutput`）

对应 P2-1：错误码正则全文匹配会误伤「讨论错误码的正常产出」（如 code-reviewer 审查报告
引用 "HTTP 429" / `"status": 503`）。收窄判定面：

- 短文本（`<= ERROR_CLASSIFY_MAX_LENGTH`）→ 进入 `classifyModelErrorByCode`；
- 超长产出默认视为正常产出（交 `hasRealOutput` 正向判定），但**以错误行开头**（行首码形态，
  复用既有 `LINE_PREFIX_CODE_PATTERN`）仍进入分类——真实长错误报文不应被长度上限挡在分类外。

约束：判据仅长度 + 行首码形态，**不含任何错误文案匹配**（兼容 C-6）；分类器函数体不动
（兼容 C-1），本守卫只决定「是否调用」。仅收窄 **poll 产出**分类面：`send` 阶段错误通道
（`sendPromptOnce` 的 `throwOnError` + `cause.status` 提取）与 polling 层 retry 状态消息
不经过此守卫，错误通道判定不受影响。

### 3. 冷缓存保护（W3，cd61c29）

位置：`helpers/fallback-state.ts` 的 `getNextCandidate` + `model-availability.ts` 的 `getAvailabilityState`

对应 P2-2：可用性状态机与换模判定脱钩。`getNextCandidate` 接入 `getAvailabilityState()`：

- 当 `state === 'cold'`（未刷新/空）或 `'failed'`（provider.list 查询失败）时，可用性快照不可信，
  **跳过 `isModelAvailable` 黑名单过滤**直接沿用户配置链取候选 → 加速降级决策；
- 跳过同时置位 `state.availabilitySkipped` 标注（仅观测用，经 `warnAvailabilitySkippedOnce`
  一次性 warn，对齐 `model-availability` 的 `warnStatusOnce` 语义）；
- 候选仍**全部来自用户配置链**（黑名单失效≠拉黑失效）；abort 零降级 / timeout-pending 语义不受影响。

### 4. poll 失败结果恢复层（W4，8d57a80）

位置：`helpers/fallback-state.ts` 的 `extractLastAssistantText` + `resolveProbeVerdict` 的 `recoverable` 分支；
`call-flow-agent.ts` 在 poll 返回 null 路径调用 `extractLastAssistantText`（:251 处）。

对应 P2-3：poll 返回 null 时 session 里可能已有完整产出，原逻辑直接换模重发产生重复成本。恢复层：

- `extractLastAssistantText(messagesData)` 仅考察**最新一条** assistant 消息（严格最新消息守卫，
  对齐 omo `strictAbortRecovery`，不回溯更早消息避免陈旧产出掩盖失败）；
- 最新 assistant 带 `info.error` 或无可读 `text` part → 拒绝恢复（返回 null）；
- 仅拼接 `type === 'text'` part（不含 reasoning，比 omo 更保守，杜绝链式思考「假产出」通过
  `hasRealOutput`）；
- 提取结果须再由调用方过 `hasRealOutput` 正向判定，假产出不采纳；
- abort 优先：`canRecoverFromPollError` 判定 abort 类错误 `recoverable=false`，`resolveProbeVerdict`
  在 `readRecoverable?.()` 为真时返回 `'recoverable'`（不再走 noSignal 换模），否则维持 noSignal。

### 5. no-valid-output 通知补写（W5，875be0a）

位置：`tools/call-flow-agent.ts` 的 `finalizeAsyncNoSignal`（:921）+ `pollAndComplete` re-poll 路径（:2160 处）。

对应 P3-2：watcher 的 noSignal 终结分支原只写 registry，不像 completed/error 分支写通知。
现两条路径均补写 `NotificationManager.writeNotification`（`async_error` 类型，`failure_reason: 'no-valid-output'`，
`has_completion_signal: false`，附 `attemptedModels` 与 raw output 保留说明）：

- `finalizeAsyncNoSignal(taskId, baseEntry, output)`：watcher 终结路径（:1039-1047 / :1207 调用）；
- `pollAndComplete` re-poll 路径：换模后 re-poll 无完成信号 → 同构通知（:2152-2166）。

仅补充通知，**不改变 registry 写入行为**（不拉黑/不换模/不重发，原文保留）。

### 6. D1 工具描述降级提示（W6，5081ba5）

位置：`agents/model-availability.ts` 的 `buildChainUnavailableNotice` + `agents/agent-builder.ts` 的
`appendChainUnavailableNotice`；三工厂在 agent description 构造处接线（`sflow-` `iflow-` `combined-`）。

方案 B（仅事实陈述，不推荐替代模型、不引入硬编码链/默认模型、不做正则匹配，兼容 C-5/C-6）：

- `buildChainUnavailableNotice(chain, validation)`：仅在 `availabilityState === 'ready'`（cold/failed
  不加提示）、用户配置了模型（`chain.length > 0`）、且**全链不可用**（`chain.every(m => unavailable.has(m))`）
  时返回静态文案：`启动对账：配置的模型 X、Y 当前未在 provider 可用列表中确认。`；部分可用不加提示。
- `appendChainUnavailableNotice(baseDescription, name, config, validation)`：复用 `buildAgentFallbackChain`
  的候选来源（主模型 + 各级 fallback）构造 `chain`，命中则把提示追加到原 description（原样无提示时返回 base）。

三工厂接线点：在各自的 agent 描述组装处调用 `appendChainUnavailableNotice`（sflow-plugin-factory
约 :608、iflow-plugin-factory 约 :253/:292、combined-plugin-factory 约 :329），逐 agent 生效。

### 7. D2 session.error 事件驱动预降级（W7，7354e8b）

位置：`features/session-error-classifier.ts`（纯分类）+ `features/session-error-handler.ts`
（有状态 handler）；三工厂 `createSessionErrorHandler` 单例 + `session.error` 事件 hook 订阅。

事件驱动预降级：**在 SDK 推送 `session.error` 时即时预分类拉黑**，缩短故障转移延迟，
与既有轮询路径（pollAndComplete / BackgroundTaskWatcher）**幂等互补**
（`markModelUnavailable` 单调合并，不重复终结/重派任务，避免双路径竞态写 registry）。

**classifier（纯函数，无副作用、单测友好）：**

| 函数 | 职责 |
|------|------|
| `isAbortSessionError(error)` | abort 零降级优先：`error.name ∈ ABORT_ERROR_NAMES` → 返回 null（零动作） |
| `extractErrorName(error)` | 从 SDK error 对象取 `name` 字段（兼容顶层 `{name,message}` 包装） |
| `serializeErrorForClassifier(error)` | 仅转义结构化字段：`status: N`（命中 `STATUS_FIELD_PATTERN`）/ `type: name`，**绝不拼接 provider message 文案**（C-6） |
| `classifySessionError({sessionID, error, modelResolver})` | ① abort 跳过 ② `modelResolver` 反查模型（查不到返回 null）③ `classifyModelErrorByCode` 分类（none 返回 null）→ `{kind, model, info}` |

**handler（有状态，可注入副作用，便于单测）：**

- `createSessionErrorHandler({changeDir, modelResolver, sideEffects?, dedupWindowMs?})`；
- 处理链：`abort → 零动作` → `去重` → `预分类` → 拉黑（`non-transient` 长冷却 `MIN_QUOTA_COOLDOWN_TTL_MS` / `transient` 短冷却 `TRANSIENT_COOLDOWN_TTL_MS`）+ 通知（`async_error`，`subagent: 'session-error-hook'`，`failure_reason: 'quota-or-persistent'|'transient'`）+ subagent-store 事件流水；
- **3s 去重窗口** `SESSION_ERROR_DEDUP_WINDOW_MS = 3000`（`lastSeen` Map，事件层 + 轮询层幂等）；
- 返回枚举：`'aborted' | 'blacklisted' | 'deduped' | 'unclassified' | 'no-model'`。

**三工厂接线（modelResolver 反查 sessionID → resolvedModel）：**
`sflow-plugin-factory.ts`（:69 `sflowSessionErrorHandler`，`modelResolver` 遍历 `backgroundTaskRegistry`
匹配 `entry.sessionID`）、`iflow-plugin-factory.ts`（:57）、`combined-plugin-factory.ts`（:60）。
各工厂在 SDK 事件分发中 `event.type === 'session.error'` 分支调用 `handler.handle({sessionID, error})`
（sflow 约 :561、iflow 约 :197、combined 约 :285），并 `globalLogger.log` 记录「session.error event handled (pre-degradation)」。

### 8. 第 2 轮 commit 清单与测试基线

| Wave | commit | 首行摘要 | 验收测试数（基线演进） |
|------|--------|----------|------------------------|
| W1 | `9a7faec` | refactor(fallback): 提取共享 FallbackState 状态机与 resolveProbeVerdict 纯函数 | 2042 → 2062 |
| W2 | `91cc1f8` | fix(fallback): 缩小错误码分类判定面，避免误伤讨论错误码的正常产出 | 2062 → 2068 |
| W3 | `cd61c29` | feat(fallback): 可用性状态机接入换模判定，冷缓存期跳过黑名单检查 | 2068 → 2071 |
| W4 | `8d57a80` | feat(fallback): poll 失败时先从 session messages 抢救已完成产出 | 2071 → 2082 |
| W5 | `875be0a` | fix(fallback): no-valid-output 路径补写降级通知 | 2082 → 2086 |
| W6 | `5081ba5` | feat(agent): 全链不可用时工具描述追加降级提示 | 2086 → 2089+1 flaky |
| W7 | `7354e8b` | feat(hooks): session.error 事件驱动预降级 | 2089 → **2103 pass / 0 fail** |

> 已知 flaky：polling.test.ts（D4 满载偶发，单独重跑通过）；已知既有隔离性问题：call-flow-agent.test.ts（F-4
> 单文件跑失败，非本轮引入）。两者均不计入验收失败。

---

## 九、遗留项（已闭环记录）

> 以下问题由 R4 审查报告（REVIEW-20260930-1413-r4.md）摘录，**已于第 2 轮（§八）全部修复闭环**。

### P2（已修复）

- **P2-1 错误码误伤正常产出** → 修复于 W2（§八·2 `shouldClassifyOutput` 前置守卫）
- **P2-2 冷缓存无保护** → 修复于 W3（§八·3 `getNextCandidate` 接入 `getAvailabilityState`）
- **P2-3 poll 失败无恢复层** → 修复于 W4（§八·4 `extractLastAssistantText` + `recoverable` 分支）

### P3（已修复 / 仅记录）

- **P3-1 文件 I/O 无超时** → 仍仅记录（启动路径文件操作无超时，仅当 changeDir 在网络盘时有风险）
- **P3-2 no-valid-output 不写通知** → 修复于 W5（§八·5 双路径补写）
- **P3-3 知识重复 / 双写** → 修复于 W1（§八·1 `FallbackState` 单源 + 废弃 `taskModelAttempts`）
- **P3-4 watcher 偶然复杂** → 修复于 W1（§八·1 抽出 `resolveProbeVerdict` 纯函数）

---

## 十、测试

### 测试组织

主测试文件：`packages/plugin-infra/src/tools/__tests__/model-fallback-fix.test.ts`（2226 行）

测试组命名与覆盖范围：

| describe 块 | 覆盖项 |
|-------------|--------|
| `P0-2: 配额/频率限制错误分类` | `parseQuotaResetTime` 各时区格式 |
| `P0-2: 长冷却黑名单` | `markModelUnavailable` + `isModelAvailable` |
| `P0-2: 错误码驱动分类` | `classifyModelErrorByCode` 三档 + 5 层提取 |
| `P0-1: poll 返回错误文本不算成功` | sync 路径错误文本 → model-failure |
| `P0-4: 错误识别接入换模` | markModelUnavailable + getAlternativeModel |
| `P1-1: getAlternativeModel 读用户 fallback 链` | extraFallbacks 参数 |
| `P1-2: pollAndComplete 成功路径不触发 fallback` | output !== null 守卫 |
| `P1-3: resolveModelWithFallback 黑名单检查` | P1/P2/P7 分支 |
| `P1-3: Abort 零降级` | ABORT_ERROR_NAMES 精确枚举 |
| `P1-4: 启动期配置模型对账` | `validateConfiguredModels` + `unverifiedModels` |
| `R3-fix: provider.list 超时保护` | 3s 超时 + finally 清理 + 冷缓存不误报 |

其他相关测试文件：
- `agents/__tests__/model-availability.test.ts`：状态机 + 超时保护
- `helpers/__tests__/completion-detector.test.ts`：`hasRealOutput` / `hasStructuredReportEvidence` / `performCompletionRetry`
- `agents/__tests__/model-profiles.test.ts`：`resolveModelWithFallback` 完整优先级管道

### 当前基线

- **2103 pass / 0 fail**（`bun test packages/plugin-infra`，2026-10-01 第 2 轮收尾实测，跨 82 个测试文件）
- 测试基线演进：2042（R4 闭环）→ 2062（W1）→ 2068（W2）→ 2071（W3）→ 2082（W4）→ 2086（W5）→ 2089+1 flaky（W6）→ 2103（W7）
- 已知 flaky：polling.test.ts（满载偶发，单独重跑通过）；已知既有隔离性问题：call-flow-agent.test.ts（F-4 单文件跑失败，非本轮引入）
- 第 2 轮新增测试：
  - `helpers/__tests__/fallback-state.test.ts`：共享状态机 / `resolveProbeVerdict` / `extractLastAssistantText` / 冷缓存跳过
  - `__tests__/session-error.test.ts`：D2 事件预降级（6 条验收：abort 零降级 / 分类未命中 / 无模型 / 拉黑 / 去重 / 通知）
  - `model-fallback-fix.test.ts` 追加：P2-1 守卫（shouldClassifyOutput）、P3-2 双路径通知、D1 描述降级提示（appendChainUnavailableNotice）

### 测试范式约定

- **相对时间避免时间炸弹**：配额重置时间测试使用 `Date.now() + offsetMs` 而非写死未来绝对日期（b5e2da8 修复的原始问题）
- **advanceClock 辅助函数**：临时前进 `Date.now`，返回恢复函数
- **waitFor 辅助函数**：轮询等待条件成立（去除固定 sleep 的时序耦合，消除 flaky）
- **mock 注入**：`sendPromptOnce` / `pollSessionCompletion` / `client.session` 均通过 mock 注入，不依赖真实 API
