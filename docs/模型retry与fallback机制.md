# 模型重试与 Fallback 机制

> 面向 opencode-flow-engine 维护者的机制参考文档。
> 最后更新：2026-09-30（Fix-Loop R4 闭环）

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

## 八、遗留项（P2/P3）

> 以下问题由 R4 审查报告（REVIEW-20260930-1413-r4.md）摘录，判定 PASS 后记录在案，**将由后续工作流处理**。

### P2（记录，近期迭代可修）

**P2-1 错误码正则可误伤"讨论错误码的正常产出"**
- 位置：`completion-detector.ts:199-209`（正则对全文匹配）+ `call-flow-agent.ts:393`（对完整 poll 产出分类）
- 场景：子代理正常产出中引用 "HTTP 429" 等错误码文本，被判为模型错误 → 拉黑 + 假性故障转移
- 修复方向：对 poll 产出分类加"错误形态前置约束"（短文本 / 错误行开头 / session 处于 error 终态）

**P2-2 无冷缓存保护：可用性状态机与换模判定脱钩**
- 位置：`agent-builder.ts:713-725`（`getAlternativeModel` 不读 model-availability 快照）
- 场景：provider.list 3s 超时 → state='failed'，换模仍照常进行，可能信息不全
- 修复方向：`getAlternativeModel` 在 `state==='failed'` 时跳过黑名单检查或返回 null 并标注

**P2-3 同步任务 poll 失败无"结果恢复"层**
- 位置：`call-flow-agent.ts:372-499`
- 场景：poll 返回 null 时 session 里可能已有完整产出，当前直接进入换模重发产生重复成本
- 修复方向：poll 返回 null 后先从 session messages 提取最后 assistant 文本，若 `hasRealOutput` 则直接采用

### P3（仅记录）

**P3-1 文件 I/O 无超时**：启动路径文件操作无超时，仅当 changeDir 在网络盘时有风险

**P3-2 no-valid-output 路径不写通知**：watcher 的 noSignalEntry 分支只写 registry，不像 completed/error 分支写 NotificationManager

**P3-3 知识重复**：async 路径 `taskModelAttempts` 与 `registry.attemptedModels` 双写同一状态，两处可能漂移；sync/async/watcher 三处重复"错误码→拉黑→换模→终止"结构

**P3-4 偶然复杂**：watcher `checkTasks` 单函数约 410 行，嵌套 4 层，认知过载高风险。建议拆出 `resolveProbeVerdict` 纯函数

---

## 九、测试

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

- **2042 pass / 0 fail**（`bun test packages/plugin-infra`，2026-09-30 实测）
- 跨 80 个测试文件

### 测试范式约定

- **相对时间避免时间炸弹**：配额重置时间测试使用 `Date.now() + offsetMs` 而非写死未来绝对日期（b5e2da8 修复的原始问题）
- **advanceClock 辅助函数**：临时前进 `Date.now`，返回恢复函数
- **waitFor 辅助函数**：轮询等待条件成立（去除固定 sleep 的时序耦合，消除 flaky）
- **mock 注入**：`sendPromptOnce` / `pollSessionCompletion` / `client.session` 均通过 mock 注入，不依赖真实 API
