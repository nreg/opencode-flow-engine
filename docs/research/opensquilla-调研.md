# OpenSquilla 项目调研报告

> 调研对象：`source/opensquilla`（v0.5.2，Apache-2.0）
> 调研日期：2026-08-06
> 目的：梳理 OpenSquilla 已实现的功能与优秀工程实践，评估可借鉴到本项目（opencode-flow-engine / sFlow + iFlow）的点
> 调研方式：5 个并行探索代理深度分析（模型路由 / Token 预算 / 记忆系统 / 安全沙箱 / 统一网关）+ 源码直读
>
> 5e8cfba1 on 2026/8/6 at 6:02

---

## 一、项目概述

OpenSquilla 是一个 **token 高效的微内核 AI Agent 运行时**（Python 3.12+，Starlette ASGI）。核心理念：*Same budget, more capability, better results*。

- **定位**：个人 Agent 运行时，覆盖 CLI、本地 Web UI、消息通道（Slack/Telegram/Discord/飞书/钉钉/企业微信/Matrix/QQ 等）
- **核心卖点**：
  - 本地模型路由（SquillaRouter：LightGBM + ONNX），按轮次路由到最便宜的能胜任的模型
  - 持久化记忆（SQLite FTS5 + sqlite-vec 混合检索，本地 ONNX 嵌入）
  - 分层沙箱（3 级策略 × 平台隔离后端）
  - 统一 TurnRunner：所有入口共享同一条 turn 循环
  - 工具结果压缩、上下文预算治理、prompt cache 连续性
- **对标**：OpenClaw / Hermes Agent（并内置了从两者迁移的工具）
- **基准**：PinchBench 1.2.1 平均 0.9251 分，总成本 $0.688（对比 OpenClaw $6.233，成本约为其 1/9）

技术栈：Python + asyncio + Starlette + SQLite(SQLModel/aiosqlite) + LightGBM/ONNX + Vue Web UI + Electron 桌面壳。

---

## 二、功能全景

### 2.1 产品表面（Surfaces）

| 表面 | 说明 |
|------|------|
| Web UI | 本地控制台 `/control/`，含设置向导、聊天、审批、日志、用量 |
| CLI chat | 交互式终端（含 OpenTUI 全屏前端 + Router HUD） |
| CLI agent | 单轮自动化、CI 式调用 |
| Gateway RPC | WebSocket RPC（127.0.0.1:18791） |
| Channels | Telegram/Slack/Discord/飞书/钉钉/企业微信/Matrix/QQ/终端/WebSocket，10+ 通道适配器 |

### 2.2 核心能力

- **SquillaRouter 本地模型路由**：4 层 tier（C0-C3），每轮按 390 维特征分类，选择最便宜的能胜任模型
- **20+ LLM Provider**：OpenRouter/OpenAI/Anthropic/Ollama/DeepSeek/Gemini/通义/Moonshot 等，主备回退
- **工具压缩**：大工具结果保留原始值 + 向模型投射紧凑预览（head 65% + tail 35%）
- **上下文预算治理**：ContextBudgetGovernor 从模型窗口推导所有字符上限，多级压缩阶梯（5 层）
- **持久化记忆**：MEMORY.md + 日期化 Markdown 笔记，混合检索（向量 + BM25 + 时间衰减 + MMR）
- **Meta-Skills**：可组合的重复工作流（多步技能编排，`/meta <name>` 启动）
- **按需 Skills + MCP**：15 个内置技能按需加载；既是 MCP client 也可作 MCP server
- **分层安全沙箱**：Standard/Strict/Locked 三级策略 × Linux Bubblewrap / macOS Seatbelt / Windows ACL
- **人工审批（HITL）**：敏感工具调用挂起等待人工决策；SQLite 持久化审批队列
- **拒绝账本**：连续拒绝自动暂停自主运行（阈值默认 3 次）
- **调度**：SchedulerEngine + 内置 cron 解析器（5 字段 + presets + 时区）
- **Durable Sessions**：SQLite 会话/转录/回放存储，可导出/重放/分支
- **用量与成本**：`opensquilla cost` 按会话/模型精确记账
- **诊断与回放**：decision log + turn replay（只读重放，不重跑工具）
- **迁移**：从 OpenClaw / Hermes 迁移记忆、persona、技能、MCP/通道配置
- **健康检查**：`opensquilla doctor` + `/health` `/healthz` `/ready` `/readyz`
- **隐私**：伪匿名遥测（install_id 单向哈希）、统一隐私开关

---

## 三、五大核心模块深度分析

### 3.1 SquillaRouter — 本地模型路由

**位置**：`src/opensquilla/squilla_router/`（v4.2 Phase 3）

#### 3.1.1 特征提取（390 维）

| 通道 | 维度 | 来源 |
|------|------|------|
| Hand-crafted 特征 | 51 | `features.py::extract_handcrafted`：长度/语言比例/代码信号/关键词/风险词/文件工具检测 |
| TF-IDF + TruncatedSVD | 102 | 词袋降维（默认 zero-pad） |
| Context 特征 | 10 | 对话上下文统计 |
| History 特征 | 16 | 历史轮次统计 |
| BGE 语义嵌入 ×3 | 192 | `v4_features.py::BGEChannelExtractor`：current_user / history_user / prev_assistant 三通道，各 PCA→64 维 |
| Assistant HC | 12 | 上一轮助手的澄清/拒绝/代码块/耗时等信号 |
| Continuation | 2 | 短续写提示检测（v4.2 Phase 3 新增） |
| Reasoning | 5 | 推理关键词/问号密度/prompt 长度对数（v4.2 Phase 3 新增） |

嵌入使用 `BAAI/bge-small-zh-v1.5`，ONNX INT8 量化，截断 510 tokens。

#### 3.1.2 双头推理 + 集成

`inference/core.py` → `heads.py` → `ensemble.py`：
- **主头**：LightGBM（390 维 → 4-class 概率）
- **辅助头**：ONNX MLP（1536 维原始 BGE 向量 → logits），temperature=0.809 校准后 softmax
- **融合**：`alpha * p_main + (1-alpha) * p_mlp`，per-class alpha = `[0.5, 0.05, 0.5, 0.85]`（R3 最依赖 MLP 校准）

#### 3.1.3 6 层后处理（防 under-routing）

`postprocess.py`：
1. **margin upgrade**：margin < 0.10 时升级（置信度不足不冒险降级）
2. **aux downgrade**：可选，aux 降级概率 > 0.55 且非 R0 时降 1 级
3. **R1 rescue**：仅 R0→R1（R1 概率差距 < 0.10），绝不降级 R2→R1
4. **flag overrides**：high_risk / debug+long_context → 至少 R2
5. **context rules**：turn_index ≥ 4 → 至少 R1
6. **sticky tier**：KV-cache 感知，上轮更高 tier 则保持（避免 cache 失效）

#### 3.1.4 后分类策略引擎（8 阶段）

`engine/routing/policy.py`：confidence_gate → complaint_upgrade → anti_downgrade → capability_gate → bind → large_context_floor → budget_gate。另有独立的 **provider mismatch veto**（将 tier 重新绑定到匹配 provider 的最近 tier）。

#### 3.1.5 自适应推理与提示

`controller.py`：
- **Thinking Mode T0-T3**：按 tier + margin 决定推理强度
- **Prompt Policy P0-P2**：P0 压缩提示注入 `[RESPONSE_POLICY: Answer directly...]`；P2 完整提示
- `normalize_decisions()` 禁止 T2/T3 + P0 矛盾组合

#### 3.1.6 3 层降级链（优雅降级）

```
V4Phase3Strategy (ML) → HeuristicRouterStrategy (纯规则) → _UnavailableV4Strategy (默认 C1)
```

启发式规则：`heavy(≥12000字符/≥3代码块)→C3`、`code_or_material→C2`、`short_plain(≤240字符)→C0`、`medium_plain→C1`。低置信度回退默认 tier。

**对本项目最有价值的点**：模型选择从"静态绑定"升级为"每任务按复杂度动态路由 + 规则兜底"。我们项目已有 `modelProfiles`（mechanical/standard/strong/review），可参照该架构实现"任务复杂度 → 模型档位"的动态路由，并配套观察模式（observe/prompt_only/full rollout）。

---

### 3.2 Token / Context 预算管理与工具压缩

#### 3.2.1 预算推导（ContextBudgetGovernor）

`src/opensquilla/context_budget.py`：
- `CHARS_PER_TOKEN = 4`、大上下文阈值 64k tokens、保留 floor 20k tokens
- 从 `context_window_tokens` + `max_output_tokens` + `thinking_budget_tokens` 推导：
  - `usable_tokens = context - (output_reserve + context_reserve)`
  - `provider_request_max_chars = usable * threshold(默认0.85) * 4`
  - 按工具类型分档：default/external/execution 各自独立的 argument / result 字符上限
- 大/小上下文窗口使用不同硬上限常量（大窗口 64k+ 才启用大上限）

#### 3.2.2 引擎层单一预算决策点

`engine/context_budget.py::coordinate_provider_context_budget()`：所有 provider 请求必须经此 proof/compact，返回 `ContextBudgetDecision(action: send|send_compacted|budget_limited|invalid_request)`。

#### 3.2.3 工具结果压缩（双层视图分离）

- **Runtime view**：原始结果经 `ToolResultStore` 持久化（content-addressed：`tr-<sha256[:32]>`，gzip 压缩，8MB/条、256MB 磁盘预算、7 天保留）
- **Provider view**：向模型投射紧凑预览，格式：
  ```
  [tool_result_projection] tool: ... original_chars: 50000
  sha256: ... tool_result_handle: tr-... omitted_chars: 48500
  head: ... (可选 tail)
  ```
- **截断策略**：`compact_tool_result_content()` head 65% + tail 35%；error 结果强制保留 ≥512 字符；`git_diff`/`read_file` 不压缩（语义关键）
- **TokenJuice reducer**：工具特定结构化投影（表格/日志/diff/JSON）

#### 3.2.4 5 级压缩阶梯（provider payload）

`provider/request_proof.py::prove_or_compact_provider_payload()`：
| Tier | 操作 | 保护 |
|------|------|------|
| 0 | 直接 proof | 最近 assistant 消息受保护 |
| 1 | 压缩工具 payload | 保护最近 2 条 tool result |
| 2 | 压缩 recent tail | 保护 error/unresolved 结果 |
| 3 | emergency 压缩当前轮 | 保护 active user |
| 4 | 硬截断 | 仅保留 active user + protected results，其余 `[opensquilla_compacted:...]` |

所有保护默认开启，`OPENSQUILLA_PROVIDER_COMPACTION_*` 环境变量可关闭；**never-worse 语义**（压缩后更大则保留原值）。

#### 3.2.5 Prompt Cache 连续性

- `engine/cache_break_monitor.py`：前后请求 hash 快照比对（system_hash/tools_hash/messages_prefix_hash），drop ≥2000 tokens 且 ratio ≥5% 判定 cache break
- `engine/steps/prompt_cache.py`：system prompt 拆 base + dynamic 两段，稳定部分放头部
- compaction 后 `notify_compaction()` 重置 baseline

#### 3.2.6 会话级 Compaction

- 触发：T3 升级 compaction + preflight compaction（每轮开始前）
- 保护 tail：默认最近 12 条消息 + 语义保护（最近 assistant、最后 2 条 tool result、error/unresolved 结果）
- 安全模式：`flush_receipt_allows_destructive_compaction()` 校验 6 项条件，不满足降级 emergency_ephemeral
- 隔离 compaction provider（独立 LLM 实例，避免状态泄漏）
- `engine/compaction_control.py`：compaction 后继续/重试/降级/阻塞的纯函数决策

**对本项目最有价值的点**：我们的子代理输出、长上下文会话同样面临 token 治理问题。可借鉴：① 单一预算决策点；② 原始结果保留 + 压缩投影（`ToolResultStore` 模式可用于子代理产物引用）；③ 保护式压缩阶梯（保护最近结果/error 结果）；④ never-worse 语义。

---

### 3.3 持久化记忆系统

**位置**：`src/opensquilla/memory/`（磁盘 Markdown + SQLite 索引双轨）

#### 3.3.1 架构

| 层级 | 组件 |
|------|------|
| 持久化源 | `MEMORY.md`、`memory/YYYY-MM-DD.md`、`memory/<name>.md` |
| 私有审计 | TurnCaptureService（写 `.opensquilla/turns/`，**不进入**记忆索引） |
| 索引层 | SQLite + FTS5 + sqlite-vec + embedding_cache |
| 门面 | MemoryManager（每 agent 一个） |

#### 3.3.2 嵌入层抽象（Protocol 驱动）

`embedding.py`：`EmbeddingProvider` Protocol（`embed_query`/`embed_batch`/`probe`）→ 4 实现：
- OpenAI（HTTP，指数退避重试）
- Ollama（HTTP）
- Local（ONNX INT8 BGE，double-checked locking 懒加载）
- Null（FTS-only）

`embedding_resolver.py` Auto 模式 **local-first**：本地 BGE 可用 → 本地；否则有 API key → OpenAI；否则降级 FTS-only。

#### 3.3.3 混合检索评分

`store.py` + `retrieval.py`：
- **向量分数**：`max(0, 1 - distance/2)`（sqlite-vec L2 距离转 [0,1]）
- **文本分数**：BM25 rank 转 `relevance/(1+relevance)`
- **合并**：`vector_weight * vscore + text_weight * tscore`
- **时间衰减**：`score * exp(-ln2/30days * age)`，MEMORY.md 与无日期文件 evergreen 豁免
- **MMR 重排**：`lam * score - (1-lam) * max_jaccard`（多样性）
- **来源权重**：sessions 0.92
- **Lexical guarantees**：FTS 命中但合并分未过阈值的条目二次放行（保留关键词召回）
- **Relaxed keyword match**：无结果时放宽阈值
- **L2 归一化双写**：写入 + 查询时均归一化（保证 cosine 等价）

#### 3.3.4 "Dream" 记忆整合（证据门控）

`scheduler/dream_handler.py` + `memory/dream/`：定期 cron 将分散日记提炼到 MEMORY.md：
1. 候选扫描（mtime > cursor）
2. 证据聚合（positive/correction/failure/manual 信号）
3. **确定性排名**：`0.35*frequency + 0.30*signal_balance + 0.20*source_confidence + 0.15*consolidation`
4. LLM 生成结构化补丁（仅 upsert/merge/skip 三类操作）
5. 应用补丁 + 备份（`.dream_backups/`）+ 回执

**关键设计**：先确定性过滤再 LLM 补丁，避免纯 LLM 幻觉；证据持久化到 `promotion_evidence.json`。

#### 3.3.5 与 Turn Loop 集成

- **写入**：turn 结束后 `_capture_turn_memory`（审计）；agent 主动 `memory_save` 工具（索引）；会话结束 `SessionFlushService` 蒸馏；会话 transcript 作为派生源（session_source.py）
- **读取**：`MemorySnapshot`（MEMORY.md + daily notes）被动注入 system prompt + `memory_search` 工具主动检索
- **同步**：6 类触发（session-start/search/watch/timer/session-delta/post-compaction），TTL 清理独立后台循环

**对本项目最有价值的点**：我们项目已有 `lessons.md`（失败经验记录）和 `subagent-progress.md`，但都是线性文件。可借鉴：① 混合检索让经验可查询；② 证据门控整合（将 lessons 自动提炼为长期规则）；③ embedding 抽象支持本地/远端切换；④ 时间衰减避免经验过时。

---

### 3.4 分层安全沙箱与权限

**位置**：`src/opensquilla/sandbox/` + `safety/`

#### 3.4.1 三级策略（SecurityLevel）

`types.py` + `policy.py`：`DISABLED < STANDARD < STRICT < LOCKED`（IntEnum，大小比较可用）
- **STANDARD**：workspace rw、tmp 可写、网络 NONE/PROXY_ALLOWLIST
- **STRICT**：session mounts 降级 ro、资源减半、require_approval
- **LOCKED**：workspace ro、无额外挂载、cpu/3 mem/4 pids=64、强制审批

`select_level()` 纯函数 + 规则表（偏升级：跨信任边界/高影响 → 升级），`build_policy()` 物化完整策略。

#### 3.4.2 权限矩阵与工具边界

- `safety/tool_tiers.py`：RiskTier（SAFE/CONFIRM/ADMIN_ONLY），`HARDCODED_ADMIN_ONLY` 不可覆盖（shell_exec/file_write/git_push 等），未声明默认 CONFIRM（fail-closed）
- `safety/permission_matrix.py`：通道类型 → 允许 tier 矩阵（webui 全量 / dm、group 无 ADMIN_ONLY），未知通道视为 dm（fail-closed）
- `tool_boundary.py`：ToolCall/ToolResult/ToolContinuation frozen dataclass；`origin_trace` 标记来源用于拒绝 `<untrusted>` 内的工具调用

#### 3.4.3 策略链（first denial wins）

`tools/policy/chain.py::POLICY_CHAIN`：
```
OwnerOnly → GuestSafe → DenyList → PrivateMemoryScope → AllowList → Profile → PermissionMatrix
```

#### 3.4.4 拒绝账本与自动暂停

`governance.py::DenialLedger`：
- 按 action 指纹（`action_kind+argv+cwd+PATH` 的 SHA256）计数
- 阈值（默认 3）→ `mark_paused()`（粘性，需人工 `clear_pause()`）
- **post-denial guard**：阻止对上次拒绝指纹的盲目重试，除非带 `lower_privilege`/`explain`/`narrower_approval` 标签
- 网络拒绝默认不计入暂停阈值

#### 3.4.5 Prompt 注入防护

`safety/injection_guard.py`：
- `xml_escape()` + `wrap_untrusted()`：外部内容包 `<untrusted source='...'>`（双层转义防标签注入）
- `classify_injection()`：prompt_override / role_hijack / exfiltration / invisible_char 正则分类
- 工具调用拒绝：`<untrusted>` 内的 `<tool_use`/`"tool":` 标记 → `InjectionRefused`

#### 3.4.6 人工审批（HITL）

- `sandbox/approval_runtime.py`：SuspendedToolRequest 状态机（suspended→approved→executing→completed/denied）
- `application/approval_queue.py`：SQLite 持久化审批队列（WAL），asyncio.Event 等待，deadline 自动过期，两阶段提交防竞态
- 会话内记忆拒绝（`_DENIED_SANDBOX_APPROVALS`）防重复请求

#### 3.4.7 平台隔离后端

- Linux：Bubblewrap（`--unshare-*` + `--cap-drop ALL` + 只读挂载系统 + 写挂载 workspace）
- macOS：Seatbelt `sandbox-exec`（deny-by-default SBPL 模板 + 动态渲染）
- Windows：ACL grants + capability SIDs + helper 子进程
- 后端选择：`select_backend()` auto 探测，不可用降级 UnavailableBackend

**对本项目最有价值的点**：我们的插件负责调用外部工具/子代理，可借鉴：① 策略链 first-denial-wins 模式（比串行 if 清晰）；② fail-closed 默认（未声明即 CONFIRM）；③ post-denial guard 防盲重试；④ `<untrusted>` 包装抵御注入（子代理输出、web 内容进入上下文前包装）。

---

### 3.5 统一网关与 TurnRunner

**位置**：`src/opensquilla/gateway/` + `engine/runtime.py` + `engine/turn_runner/`

#### 3.5.1 统一 TurnRunner（单一收敛点）

`runtime.py::TurnRunner`（行 2969）：Web UI / CLI / Channels 全部汇入同一条 turn 循环。

**入口统一**：
- Web UI：WebSocket RPC → `start_turn_via_runtime()` → TaskRuntime → TurnRunner.run()
- CLI/TUI：`standalone_runtime.py` → TurnRunner.run()（直连）
- Channels：`channel_dispatch.py` → `start_turn_via_runtime()`

#### 3.5.2 8 阶段 Stage 分解

`_run_turn()` 顺序执行 8 个 Stage，每个是独立类 + 窄 Protocol 端口 + frozen dataclass I/O：

```
InputStage → ProviderAndToolsStage → PromptAssemblerStage → AgentBootstrapStage
→ AttachmentStage → CompactionAndHistoryStage → StreamConsumerStage → TurnFinalizerStage
```

- `harness.py`：适配器类把 TurnRunner 方法绑定到 Protocol 端口（懒导入避免循环依赖）
- **关键工程价值**：单体 `_run_turn()` 拆为可单测的 Stage，每个 Stage 只依赖窄接口，可独立 mock

#### 3.5.3 通道适配器模式

`channels/`：`ManagedChannel` Protocol + `ChannelCapabilityProfile`（声明式能力元数据：STREAMING/GROUP_CHAT/ARTIFACT_DELIVERY 等）+ `run_channel_contract()` 契约校验。`ChannelManager` 统一接线（delivery store、outbox、工具注册、transport lease 防 split-brain）。

#### 3.5.4 其他工程亮点

- **WebSocket writer queue**：序列号在出队时铸造，lossy 事件（tick）丢弃不产生 seq 空洞
- **Durable ingress**：`turn_ingress.py` SHA-256 请求指纹 + 幂等接纳
- **ContextVar turn context**：`turn_context.py` 穿透异步链传播 turn 身份
- **Compaction singleflight**：同 session 并发 compaction 去重
- **SchedulerEngine**：5 字段 cron 解析器（POSIX DOW/DOM OR 规则）+ SQLite JobStore + handler 装饰器
- **健康模型**：HealthFinding（severity × readiness_impact）+ FixStep（可执行修复步骤）+ build_report 聚合

**对本项目最有价值的点**：① 8 阶段 Stage 分解模式可直接迁移到我们的子代理编排（当前 `call_flow_agent` 是单体）；② 通道适配器 + 能力契约模式可用于支持多 IDE/多入口；③ 持久化审批/回执模式可用于 AFK 无人值守的决策记录。

---

## 四、工程模式总览

| # | 模式 | OpenSquilla 实现 | 可借鉴到本项目 |
|---|------|-----------------|---------------|
| 1 | **Stage 分解** | TurnRunner 8 Stage + Protocol 端口 + frozen I/O | 子代理编排管线重构 |
| 2 | **优雅降级链** | ML → 启发式 → 默认 tier | 模型路由 / 子代理回退 |
| 3 | **单一预算决策点** | coordinate_provider_context_budget | 上下文/Token 治理 |
| 4 | **原始保留 + 压缩投影** | ToolResultStore + tool_result_handle | 子代理产物引用 |
| 5 | **保护式压缩** | 最近结果/error 结果默认保护 | 长会话压缩 |
| 6 | **never-worse 语义** | 压缩后更大则保留原值 | 任何压缩逻辑 |
| 7 | **fail-closed 默认** | 未声明工具 = CONFIRM；未知通道 = dm | 权限/路由默认值 |
| 8 | **策略链 first-denial-wins** | POLICY_CHAIN | 权限检查 |
| 9 | **post-denial guard** | 防盲重试 + 允许标签 | 调试/重试纪律 |
| 10 | **untrusted 包装** | `<untrusted>` 双层转义 | 外部内容注入防护 |
| 11 | **证据门控整合** | Dream：确定性过滤 → LLM 补丁 | 经验/教训自动提炼 |
| 12 | **混合检索记忆** | 向量 + BM25 + 时间衰减 + MMR | lessons.md 可查询化 |
| 13 | **能力契约校验** | run_channel_contract | 子代理输出契约 |
| 14 | **两阶段提交审批** | ApprovalQueue claim_resolution | 审批/决策持久化 |
| 15 | **KV-cache 感知** | sticky tier + anti_downgrade | 成本优化 |
| 16 | **rollout 观察模式** | observe/prompt_only/full | 新路由/策略灰度 |
| 17 | **健康 + 修复步骤** | HealthFinding + FixStep | doctor 式诊断 |
| 18 | **ContextVar 上下文穿透** | turn_context | 跨异步传播身份 |

---

## 五、对本项目（opencode-flow-engine）的具体借鉴建议

按优先级（P0 高价值 / P1 中价值 / P2 低价值）排列：

### P0 — 高价值，直接提升编排器质量

1. **子代理编排 Stage 化重构**
   - 现状：`call_flow_agent` 单体调度，子代理执行是黑盒
   - 借鉴：TurnRunner 8-Stage 模式，将子代理执行拆为 `input → provider/tools → prompt → bootstrap → stream → finalize`，每阶段窄 Protocol 端口 + frozen dataclass I/O + harness 适配器，配合我们已有的 notification-manager / subagent-store 形成完整管线

2. **上下文预算单一决策点**
   - 现状：子代理输出、通知、进度文件无预算治理
   - 借鉴：实现 `ContextBudgetGovernor` 等价物（从配置推导 usable budget），所有注入上下文的文本经单一 proof/compact 出口，带保护式压缩（保护最近消息/error 输出）+ never-worse 语义

3. **工具/子代理结果引用模式（ToolResultStore 等价物）**
   - 现状：子代理完整输出直接进上下文
   - 借鉴：大输出 content-addressed 落盘（`tr-<sha256>` handle），上下文只放 head/tail 投影，需要时按 handle 取回——直接解决长对话上下文膨胀

4. **模型档位动态路由 + 优雅降级链**
   - 现状：modelProfiles 静态绑定（mechanical/standard/strong/review）
   - 借鉴：按任务复杂度（文件数、跨模块、API 变更、DB schema）动态选档，规则启发式兜底，默认档位 fail-closed；新增 observe/prompt_only/full rollout 灰度

### P1 — 中价值，增强可靠性与体验

5. **lessons.md 记忆化**
   - 现状：`lessons.md` 线性文件，只在任务开始前扫描
   - 借鉴：SQLite + FTS 检索 + 时间衰减，教训可查询；Dream 式证据门控把重复教训自动提炼为长期规则（"这条教训 3 次出现 → 升级为团队规则"）

6. **策略链 first-denial-wins 重构权限/守卫检查**
   - 现状：guard hook 串联判断
   - 借鉴：有序策略链（OwnerOnly → GuestSafe → DenyList → ...），首个拒绝即终止，日志清晰

7. **untrusted 包装防注入**
   - 现状：子代理输出、web 内容直接进上下文
   - 借鉴：外部内容包 `<untrusted source='...'>` 双层 XML 转义 + origin_trace 拒绝机制

8. **post-denial guard 防盲重试**
   - 现状：AFK 模式自动重试无指纹去重
   - 借鉴：action 指纹（SHA256）+ 上次拒绝后禁止无标签重试，除非降权/解释/收窄

9. **失败经验结构化（决策日志 + 回放）**
   - 现状：bug-investigator 输出非结构化
   - 借鉴：PipelineStepRecord 式决策日志（每步 applied/fallback_reason），支持只读回放，诊断"为什么路由到这里"

### P2 — 低价值/长期愿景

10. **通道适配器 + 能力契约**（若未来支持多 IDE/多入口）
11. **持久化审批队列**（AFK 模式的决策留痕，两阶段提交）
12. **KV-cache 感知的提示组装**（稳定头部 + 易变尾部，省钱）
13. **健康模型 + FixStep**（`sflow doctor` 命令：状态 + 可执行修复步骤）
14. **SchedulerEngine 等价物**（cron 定时触发工作流状态推进）

---

## 六、附：关键文件索引

### 模型路由
- `src/opensquilla/squilla_router/models/v4.2_phase3_inference/runtime_src/src/router/features.py`
- `.../src/router/v4_features.py`
- `.../src/router/inference/{core,heads,ensemble,postprocess,artifacts}.py`
- `src/opensquilla/squilla_router/{v4_phase3,controller}.py`
- `src/opensquilla/router_tiers.py` / `router_control.py`
- `src/opensquilla/engine/routing/{policy,heuristic}.py`
- `src/opensquilla/engine/steps/squilla_router.py`

### Token 预算 / 压缩
- `src/opensquilla/context_budget.py`
- `src/opensquilla/engine/context_budget.py`
- `src/opensquilla/result_budget.py`
- `src/opensquilla/token_estimation.py`
- `src/opensquilla/provider/request_proof.py`
- `src/opensquilla/engine/tool_result_store.py`
- `src/opensquilla/engine/{agent,cache_break_monitor,compaction_control}.py`
- `src/opensquilla/session/compaction*.py`
- `src/opensquilla/tools/policy/finalize.py`

### 记忆
- `src/opensquilla/memory/{store,retrieval,manager,embedding,embedding_resolver,sync_manager,turn_capture,session_flush,retention}.py`
- `src/opensquilla/memory/dream/{runner,ranking,candidates,evidence,prompts,curated_apply}.py`
- `src/opensquilla/scheduler/dream_handler.py`

### 沙箱 / 权限
- `src/opensquilla/sandbox/{types,policy,policy_models,governance,approval_runtime,integration}.py`
- `src/opensquilla/sandbox/backend/{linux_bwrap,seatbelt,windows_default}.py`
- `src/opensquilla/safety/{tool_tiers,permission_matrix,injection_guard}.py`
- `src/opensquilla/tools/policy/chain.py`
- `src/opensquilla/application/approval_queue.py`
- `src/opensquilla/tool_boundary.py`

### 网关 / TurnRunner
- `src/opensquilla/engine/runtime.py`（TurnRunner，行 2969）
- `src/opensquilla/engine/turn_runner/{input_stage,provider_and_tools_stage,prompt_assembler_stage,agent_bootstrap_stage,attachment_stage,compaction_and_history_stage,stream_consumer_stage,turn_finalizer_stage,harness}.py`
- `src/opensquilla/gateway/{app,boot,websocket,turn_ingress,channel_dispatch}.py`
- `src/opensquilla/channels/{types,registry,manager,contract}.py`
- `src/opensquilla/session/{manager,storage,models,turn_context}.py`
- `src/opensquilla/scheduler/{engine,parser,persistence}.py`
- `src/opensquilla/observability/{bundle,replay,usage_telemetry}.py`
- `src/opensquilla/health/{evaluator,model}.py`

### 设计文档
- `docs/features/squilla-router.md` / `LLM-ensemble-design.md`
- `docs/features/tool-compression.md` / `compaction-and-cache.md`
- `docs/features/memory.md`
- `docs/sandbox-security.md` / `tools-and-sandbox.md` / `approvals-and-permissions.md`
- `docs/scheduling.md` / `diagnostics-and-replay.md` / `usage-and-cost.md`
- `docs/features/meta-skills.md`
