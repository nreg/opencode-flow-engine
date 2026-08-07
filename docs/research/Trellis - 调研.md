# Trellis 借鉴分析

> 来源：<https://github.com/mindfold-ai/Trellis>
>
> 提交截止：2d638230 on 2026/7/22 at 16:01

---

## 一、架构全景对比：sFlow/IFlow vs Trellis

| 维度 | sFlow/IFlow (opencode-flow-engine) | Trellis |
|------|-------------------------------------|---------|
| 定位 | OpenCode 插件，嵌入 AI 编码工具 | 独立的通用工作流系统，跨平台 |
| 架构形态 | OpenCode Plugin (hooks + tools + agents) | CLI + Python 脚本 + Node.js Core SDK |
| 状态管理 | 文件状态机（`.flow-engine/sflow/state.json` / `.flow-engine/iflow/state.json`） | 文件状态机（`.trellis/tasks/<task>/task.json`）+ 运行时面包屑 |
| 工作流模式 | 线性（SFlow 9 态）/ 循环（IFlow 6 态） | 3 阶段线性（Plan → Execute → Finish） |
| 子代理机制 | OpenCode 子会话（`call_flow_agent`） | 通道（Channel）事件系统 + 工作线程 |
| 核心 SDK | 自定义 TypeScript 包 | `@mindfoldhq/trellis-core` (TypeScript) |
| 领域划分 | 后端/前端分离（`build-executor` / `ui-implementer`） | 层/包驱动的 spec 体系 |

---

## 二、Trellis 优秀设计 — sFlow 可借鉴点

### 1. 通道（Channel）事件系统 — 最值得借鉴

**Trellis 做法**：有一个完整的 Channel Event System，包含：

- 事件类型体系（Create, Message, Thread, Context, Spawned, Killed, Done, Error, Progress, Interrupt...）
- 收件箱（Inbox）系统，带投递模式（Delivery Mode）
- 工作线程生命周期管理（Worker Lifecycle + Worker Registry）
- 事件过滤（Watch/Filter）和分页读取
- 线程（Thread）状态管理

**sFlow 做法**：`call_flow_agent` 直接创建子会话（sub-session），通过 `backgroundTaskRegistry` 管理异步任务。没有结构化的事件流。

**借鉴价值：高。** Trellis 的 Channel 系统提供了：

- 子代理间的结构化通信协议（而非黑箱 prompt）
- 进度/错误/中断信号标准化（sFlow 目前没有）
- 事件持久化，可审计和回溯
- 工作线程 OOM 保护（`channel.worker_guard.idle_timeout: 5m, max_live_workers: 6`）

### 2. Spec 系统 — 包/层驱动的编码指南

**Trellis 做法**：`.trellis/spec/<package>/<layer>/` 目录结构：

```
.trellis/spec/
├── cli/backend/
│   ├── index.md               ← 入口，列出所有规范文件
│   ├── error-handling.md
│   └── conventions.md
└── guides/
    └── index.md               ← 跨包思维指南
```

- 通过 `get_context.py --mode packages` 自动发现
- 子代理通过 JSONL 文件（`implement.jsonl` / `check.jsonl`）加载需要的 spec
- 每个 spec 文件有 Pre-Development Checklist + Quality Check

**sFlow 做法**：没有类似的 spec 体系。子代理的编码标准嵌入在 agent 的 prompt 中，无法按包/层粒度动态加载。

**借鉴价值：高。** sFlow 可以借鉴：

- 分层 spec 目录，按包/层组织编码规范
- 动态注入：根据当前任务涉及的包/层，自动选取相关 spec 注入到子代理
- 增量学习：每次任务后 `trellis-update-spec` 将新发现写入规范

### 3. 任务系统 — 结构化记录 + 生命周期钩子

**Trellis 做法**：`task.json` 有 24 个规范字段：

```json
{
  "id", "name", "title", "description", "status", "dev_type",
  "scope", "package", "priority", "creator", "assignee",
  "createdAt", "completedAt", "branch", "base_branch",
  "worktree_path", "commit", "pr_url", "subtasks", "children",
  "parent", "relatedFiles", "notes", "meta"
}
```

- 生命周期钩子：`after_create` / `after_start` / `after_finish` / `after_archive`
- 目录命名 `MM-DD-slug`，自动归档到 `archive/`
- 父子任务树（parent / children / subtasks）

**sFlow 做法**：每个子代理产出独立文件（`proposal.md`、`specs/`、`design.md`、`tasks.md`、`execution-contract.md`），但没有统一的任务记录结构。

**借鉴价值：中高。** sFlow 可以借鉴：

- 统一的任务记录格式（结构化字段替代自由格式 markdown）
- 生命周期钩子系统（task 创建/启动/完成/归档时自动执行脚本）
- 父子任务层级（处理复杂拆分的需求）



### 4. 面包屑状态标记（Workflow State Breadcrumb）

**Trellis 做法**：`workflow.md` 中嵌入 `[workflow-state:planning]` / `[workflow-state:in_progress]` 标记块，Hook 脚本自动解析并注入到每轮对话的头部。每次状态变更时自动更新。

**sFlow 做法**：状态存储在 `.flow-engine/sflow/state.json` / `.flow-engine/iflow/state.json` 中，agent 通过 `workflow_router` / `iflow_router` 工具检测。

**借鉴价值：中。** Trellis 的方式更"人机可读"，直接在 `workflow.md` 中可见，但 sFlow 的 JSON 方式更程序化。可以借鉴将状态标记嵌入到 agent system prompt 中，让 agent 始终知道当前状态（sFlow 已经在做，但可更系统化）。

### 5. 研究（Research）代理的严格证据要求

**Trellis 做法（`research.md`）**：

- 每个外部声明必须有 `file:lines` 的逐字代码片段引用
- 禁止："it basically does X"、"typically"、"seems to"
- 必须实际 `git clone` / `curl` / `npm pack` 到 `/tmp/`，而非仅搜摘要
- 自检清单：5 条检查确保研究质量

**sFlow 做法（`iflow-researcher`）**：有 Claim Provenance 和 Confidence Levels 系统（`[VERIFIED]` / `[CITED]` / `[ASSUMED]`），但缺乏"必须实际拉取源码"的强制要求。

**借鉴价值：高。** sFlow 的 researcher 可以直接复用 Trellis 的：

- 研究结果模板（必须包含 `file:lines` 引用）
- 自检清单（5 条检查确保质量）
- 禁止短语清单

### 6. 调试回溯（Debug Retrospective）

**Trellis 做法**：Phase 3.2 明确要求如果本次任务涉及重复调试，加载 `trellis-break-loop` 技能：

- 分类根因
- 解释为什么之前的修复失败
- 提出预防措施

**sFlow 做法**：SFlow 有 `bug-investigator` 子代理，但 IFlow 没有对应的"调试回溯"阶段。

**借鉴价值：中。** IFlow 可以增加一个"调试回顾"阶段或步骤，将知识沉淀到 spec 中。

### 7. 跨平台路径和哈希处理

**Trellis 做法（`architect.md`）**：

- 持久化的路径键使用 POSIX `/`
- 文件系统操作使用 OS 原生分隔符
- 哈希计算前先规范化换行符
- 帮助文本和文档不能假设 POSIX shell 语法

**sFlow 做法**：目前没有跨平台路径/哈希的规范。

**借鉴价值：中低。** 对于主要面向 Windows + OpenCode 的 sFlow 来说优先级较低，但如果要扩展到更多平台就值得借鉴。

---

## 三、Trellis 没有但 sFlow 已经做得更好的

| 领域 | sFlow 优势 | 说明 |
|------|------------|------|
| 范围缩减禁止 | 有明确禁止语言列表和 4 种合法拆分理由 | Trellis 没有类似机制 |
| 对抗性验证 | Goal-backward 验证，BLOCKER/WARNING 分类 | Trellis 的 check 偏重于代码质量 |
| 执行偏差处理 | 4 条自动规则（auto-fix bugs, auto-add missing, auto-fix blocking, ask about arch） | Trellis 没有类似的偏差规则系统 |
| 多源覆盖审计 | GOAL/REQ/RESEARCH/CONTEXT 四维覆盖检查 | Trellis 没有正式的多源审计 |
| 执行计划（Execution Plan） | 结构化 waves/tasks/dependencies 管理 | Trellis 的 `implement.md` 更自由 |
| UI 实现分离 | 前端/后端子代理分离（`ui-implementer` / `build-executor`） | Trellis 没有 UI 专属代理 |
| Plugin 架构 | 原生 OpenCode 插件，零外部依赖 | Trellis 需要安装 Python + Node.js |

---

## 四、综合建议 — 优先借鉴清单

按投入产出比排序：

| 优先级 | 借鉴点 | 建议实现方式 |
|--------|--------|-------------|
| P0 | Channel 事件系统 | 为子代理通信引入结构化事件类型 + 收件箱/投递模式 + 进度/中断信号 |
| P1 | Spec 分层系统 | 建立 `.flow-engine/sflow/spec/<package>/<layer>/` 目录结构，动态注入到子代理 |
| P1 | Research 证据要求 | 强化 researcher 的"必须拉取源码"规则 + 逐字引用模板 + 自检清单 |
| P2 | 统一任务记录 | 引入结构化任务记录（类似 Trellis 的 24 字段 `task.json`） |
| P2 | JSONL 上下文注入 | 面包屑状态标记：使用 `implement.jsonl` / `check.jsonl` 文件管理子代理上下文 |
| P3 | 生命周期钩子 | 任务创建/启动/完成/归档时自动执行脚本 |
| P3 | 调试回溯 | IFlow 增加"调试回顾"步骤，沉淀知识到 spec |
| P3 | 父子任务树 | 支持任务拆分和依赖关系管理 |

---

**总结**：Trellis 最值得 sFlow 借鉴的是 **Channel 事件系统**（结构化子代理通信）和 **Spec 分层系统**（动态编码规范注入）。sFlow 在范围缩减禁止、对抗性验证、执行偏差处理方面已经做得更好。两个系统在"文件状态机 + 子代理"的核心理念上高度一致，但实现的抽象层级不同。

## 五、决定不借鉴：

| 不借鉴点         | 不借鉴理由                                                   |
| ---------------- | ------------------------------------------------------------ |
| Channel 事件系统 | 架构级别比较大的改动，需要重写底层通信机制，及新增 事件类型系统 + 事件存储 + 收件箱 + 投递协议 |
| JSONL 上下文注入 | 多此一举，且低廉模型（小参数量的模型）驱动的 子agent 会误以为自己是主编排器 |
| 调试回溯         | IFlow 没有 spec 概念，IFlow 的设计本身就不支持跨迭代的知识沉淀 - 这是它的设计取舍，不是遗漏<br />SFlow 已有实现，不需要借鉴 |
| Spec分层系统     | Trellis 的动态 spec 系统（ spec 选择权 交给 agent）和 sFlow 的线性可控架构存在根本冲突 |
| 父子任务树       | sFlow 的 按合约进行 wave 分发，会多次调用 build-executor，而不是让 build-executor 一次性加载所有任务<br />因此 sFlow 本身实现已经足够优秀<br />引入 父子任务树 会让 sFlow 的复杂度 从水平 变成 垂直树形，N+1 状态跟踪 和 依赖管理容易出错 |
| 生命周期钩子     | 有借鉴意义，暂不实现                                         |

### 关于生命周期钩子

Trellis 的 task.json 支持四个事件：

```json
{
  "hooks": {
    "after_create":  ["python3 scripts/notify-slack.py"],
    "after_start":   ["python3 scripts/create-branch.py"],
    "after_finish":  ["python3 scripts/cleanup.py"],
    "after_archive": ["python3 scripts/archive-report.py"]
  }
}
```

| 事件 | 触发时机 | 适合做什么 |
|------|----------|-----------|
| after_create | 任务目录创建后 | 创建关联分支、通知团队、初始化环境 |
| after_start | 任务状态变为 in_progress | 锁定分支、创建开发环境、注册 CI 流水线 |
| after_finish | 任务完成（清除活跃指针） | 清理临时文件、发送完成通知 |
| after_archive | 任务归档到 archive/ | 生成报告、更新索引、发送周报汇总 |

#### 引入好处

**1. 自动创建分支 / 管理 Git**

当前 sFlow 中，iflow-shipper 负责创建 PR，但分支管理是写死在 agent prompt 里的。有了钩子：
- after_create → 自动创建 feature/xxx 分支
- after_start → 保护分支（禁止直接 push）
- after_archive → 自动删除已合并的本地分支

**2. 自动通知**
- after_create → 钉钉/飞书机器人："新任务开始：xxx"
- after_archive → 邮件/消息："任务已完成：xxx"

**3. 自动环境管理**
- after_start → 自动部署开发环境 / 初始化数据库
- after_finish → 自动销毁临时环境
- after_archive → 自动清理测试数据

**4. 自动生成报告**
- after_archive → 自动生成周报条目："本周完成：xxx"

#### 弊端

**1. 执行失败的处理策略**

钩子脚本失败怎么办？
- 阻止状态转移？（太严格——可能卡住流程）
- 忽略继续？（可能掩盖问题）
- 记录警告，让用户决定？（最佳路径，但需要额外交互）

**2. 安全风险**

用户配置的脚本可以执行任意命令。如果 `.flow-engine/sflow/config.json` 被提交到仓库，恶意 PR 可以在 CI 中执行恶意代码。需要脚本白名单或确认执行的机制。

**3. 跨平台兼容**

Windows 用户配置了 bash script.sh，macOS 用户配置了 pwsh script.ps1，sFlow 需要知道运行平台。当前 sFlow 没有平台检测机制。

**4. 调试困难**

钩子脚本失败时，用户很难知道是脚本本身的问题，还是环境问题，还是 sFlow 传参的问题。需要有清晰的错误日志。

# ee4bffcc - ca92175f 演进分析

> **范围**：`ee4bffcc`（2026-07-23）→ `ca92175f`（2026-08-06），共 **60 个提交**，衔接上次调研截止点 `2d638230`（2026-07-22）。
> **版本跨度**：0.6.9 → 0.6.10 → 0.6.11 → 0.6.12 → 0.6.13 → 0.6.14（另含 0.7.0-beta.2 manifest backfill）。
> **主线**：本阶段聚焦三件事 —— ① 工作流变体选择（per-task workflow）；② 记忆系统全量恢复（mem recall 越过 compaction）+ 新平台适配；③ 跨 21 平台的 session 身份（session identity）工程化。另有大量 hook/CLI 健壮性修复。

---

## 一、本阶段主要功能演进

### 1. Per-Task 工作流变体选择（c3596dd9, #467）— 本阶段最大功能

**Trellis 做法**：一个仓库不再只有一份 `.trellis/workflow.md`，而是支持"任务级工作流选择"：

- 任务在 `task.json` 里通过 `"workflow": "<id>"` 字段 pin 一个工作流变体
- 变体文件存在用户管理的库目录 `.trellis/workflows/<id>.md`（复数 `workflows`，刻意避开单数 `workflow/` 的 YAML-manifest 迁移保留位）
- 解析规则单一事实来源（`workflow_selection.py`，所有消费者共用）：
  - 活跃任务的 `task.json` 有非空 `workflow` 字段 + id 匹配 `[A-Za-z0-9_-]+` + `.trellis/workflows/<id>.md` 存在 → 用该变体
  - id 非法或文件缺失 → stderr 打一行警告，回退全局 `.trellis/workflow.md`
  - 无任务 / 无字段 / 任何不可读情况 → 回退全局 workflow.md
  - **永不抛异常**（Never raises）——容错降级是 Trellis 全代码库的普遍原则
- 新增 `trellis workflow` CLI 命令（`workflow.ts`，150 行）：`--list`（列出 bundled/marketplace 模板 + 磁盘库中已保存的 id）、`--save <id>`（把模板写入库目录，不动活跃 workflow.md）、`--create-new`（写 `.workflow.md.new` 而不触碰原文件）、`--force`
- 与 `template-hashes.json` 的边界契约：写入原生内容后刷新 hash 条目，写非原生内容后删除条目，防止 `trellis update` 静默用原生字节覆盖用户选中的变体
- 修改保护：磁盘 workflow 被编辑过（hash 不匹配且非字节一致）→ 交互模式询问，非交互模式失败（除非 `--force` / `--create-new`）

**借鉴价值：高。** 对应到 sFlow/IFlow：目前 sFlow 是全局单一工作流（线性 9 态），IFlow 是全局单一循环（6 态），不支持"某个 change/task 用不同工作流"。《五、决定不借鉴》里恰好有一条 `c143c260 revert: keep per-task workflow selection on beta`——注意：该 revert **不是**放弃此功能，而是从 beta 默认流回退到仅限用户显式选择（0.6.11 的调整，见下）。其安全设计（id 白名单正则防路径逃逸、stderr 警告 + 静默回退、hash 边界防止 update 覆盖用户内容）非常值得 sFlow 的 `.flow-engine/sflow/` 状态文件管理借鉴。

### 2. 记忆系统全量恢复 + Grok 适配器（08d43351, 0.6.14）

**Trellis 做法**：`trellis mem` 长期存在一个缺陷——会话被 compact 后，`mem extract` 只返回残缺的几轮（实测 `019fd5a3`：rollout 有 457 个事件、文件里有 27 条真实对话轮次，compact 规则丢弃 14 条，工具只返回 5 轮，导致其消费者研究 agent 放弃工具、直接读原始 rollout）。一次任务修三个问题：

- **Problem 1 — compaction 丢弃可恢复历史（全平台）**：四个适配器（codex `compacted` 事件、claude `isCompactSummary`、pi compaction entry、zcode compaction markers）都"遇到 compaction 就清空已收集的 turns"。原设计理由对**搜索评分**成立（同一主题在 compact 前后各计一次会虚高），但对**召回**是错误的——用户要的就是整段对话，而对话就在文件里。**决策：文件中每一条真实对话轮次都进入共享池，包括 compact 前的轮次**。compaction 边界渲染为输出中的标记（而非替换），让读者看到模型自身上下文在哪被切断；清洗规则不变（reasoning/tool_call/token_count 等噪声事件仍不成为 turns）；搜索评分显式去重（compaction summary 与它概括的轮次都在池里，需防止同一主题计两次）。
- **Problem 2 — 多 agent 会话丢失整个用户侧**：Codex 多 agent 会话中用户指令以 `agent_message` 事件（`Message Type: NEW_TASK | MESSAGE ...`）到达，适配器只认 `payload.type === "message"`，导致 457 个事件里只有 1 条 `message/user`；而 assistant 轮次会以 `agent_message` 和 `message/assistant` **双重出现**，按内容去重。此问题独立于 compaction。
- **Problem 3 — 无 Grok 适配器**：`~/.grok/sessions/<url-encoded-cwd>/<session-id>/chat_history.jsonl`，cwd URL 编码在目录名里（正好服务项目范围过滤）。`session_search.sqlite` 只是搜索索引，**刻意忽略**——教训：OpenCode reader 曾在 0.6.0-beta.4 因原生 SQLite 依赖破坏 Windows 安装而被 revert，因此 Grok 适配器零数据库依赖，`mem/internal/sqlite-readonly.ts`（纯 TS 读取器）已存在以备将来。

**借鉴价值：高。** 三个洞见对 sFlow 都直接有用：
- "召回正确性优先于评分纯净性，但通过显式去重和边界标记两者兼得"——对应 IFlow researcher / test-engineer 对历史会话、研究记录的读取策略。
- "消费者绕开工具（读原始 rollout）是工具失败的信号"——值得 sFlow 对子代理输出做此类的信号检测。
- "原生依赖破坏 Windows 安装 → 用纯 TS 读取器替代 SQLite"——sFlow 同为 OpenCode 插件，应坚持零原生依赖。

### 3. Shell-Ticket：六平台 session 身份桥接（2e90b149）

**Trellis 做法**：审计发现**没有任何平台把 session id 导出到 shell 工具的子进程**，但每个 hook 平台都会把 session id 放在 hook stdin 上。于是：预 shell 钩子（Cursor `beforeShellExecution`、Claude `PreToolUse`、Gemini `BeforeTool`……）在侦测到待执行命令会调用 `task.py start/current/finish` 时，写入一个**短生命周期票据**（`<root>/.trellis/.runtime/shell-tickets/`，TTL 30 秒），task 脚本在没有原生 session 环境变量时消费它。代码要点：

- `_pending_shell_command()` 用"有序回退"而非"平台分支"解析 payload 形态（顶层 `command` 或嵌套 `tool_input.command`），第三种 payload 形态扩展同一函数
- Cursor 类 shell 事件返回 `{"permission": "allow"}` 防止主机对 Trellis 自己发起的命令二次询问；tool-call 类主机读取不同响应 schema，则不给应答
- 票据短 TTL（30s）本身就是安全边界：过期即失效，防误用
- 配套：`cb3d0396` 在 21 个平台做 session identity 审计（PRD 178 行 + 3 份研究文档），`8ab47a77` 删除凭空发明的 session 环境变量名（"drop invented platform session env var names"），`c5465d04` 修复 env 文件膨胀并暴露更新提醒

**借鉴价值：中高。** sFlow 的 `call_flow_agent` 子会话身份传播目前依赖 OpenCode 原生会话机制；但"宿主不导出 session id 到子进程、用 hook stdin + 短 TTL 票据桥接"这一模式，对 sFlow 未来在非 OpenCode 宿主（CLI 直调、CI 环境）上运行时是现成的跨进程身份传递方案。

### 4. Trusted Context Dirs：符号链接工作区安全（530d2091, #414）

**Trellis 做法**：用户把 `.trellis/tasks` / `.trellis/workspace` 符号链接到外部目录后，channel 上下文加载的 cwd-only 监禁（jail）会拒绝合法上下文文件。新增 `context-trust.ts`（157 行）：从 `.trellis/config.yaml` 的 `channel.trusted_context_dirs` 解析额外可信 realpath 根，加上**窄自动信任**（`.trellis/tasks` / `.trellis/workspace` 本身是顶层 symlink 时自动信任其指向），在**不把 containment 检查弱化为词法匹配**的前提下放行这些根。实现要点：解析 config 用轻量 line-scanner（无 YAML 依赖，与 `guard.ts` 的 `loadWorkerGuardConfig` 同风格）；安全说明落在 `spec/cli/backend/filesystem-safety.md §2`。

**借鉴价值：中。** sFlow 状态文件（`.flow-engine/sflow/`）若支持符号链接工作区/外部存储，需要同样的"显式可信根 + 窄自动信任"设计，避免路径安全检查被绕过。

### 5. 新平台 Snow CLI + 平台模板收敛（3dc7ba07 #443、6ddd9412、7b17052d）

- `3dc7ba07`：Snow CLI 成为 class-1 Trellis 平台（完整模板：3 个 agent md + 3 个 hook json + 644 行 `write-trellis-context.py`）
- `6ddd9412`（refactor）：「每个平台的文件集只描述一次」（configurator 共享化），并大改 spec（`platform-integration.md` +464 行、`script-conventions.md` +433 行、`configurator-shared.md` +217 行）——单一事实来源，防止 21 平台模板漂移
- `7b17052d`：dogfood 从模板重新生成平台配置（0.6.2 → 0.6.12），验证收敛有效性

**借鉴价值：低-中。** sFlow 目前只服务 OpenCode 单一宿主，模板收敛问题尚不紧迫；但"平台文件集单一事实来源"是将来多宿主扩展的必做重构。

### 6. Journal Merge=union + index.md 冲突指导（a5374864, #415）

**Trellis 做法**：`.gitattributes` 中 `.trellis/workspace/*/journal-*.md merge=union` ——开发日志是 append-only（每个 session 只追加一个块），并行 session/worktree 下**没有真正可冲突的内容**，union 直接合并。配套的 `add_session.py` 增强（branch 解析顺序：CLI 参数 → task.json branch → git branch 自动检测 → 优雅省略）。明确的边界声明：**不要**为 `workspace/*/index.md` 加规则——它每个 session 全量重新生成，真冲突是预期且安全的（任选一边即可，任务状态在 task.json 而非 index.md）。

**借鉴价值：高（低成本）。** sFlow 的 `.flow-engine/sflow/` 状态文件、`docs/research/` 调研文档在并行开发下同样会遇到合并冲突。append-only 文件加 `merge=union`、每次全量重生成的文件明确"冲突任选一边"的策略可直接复制。

---

## 二、本阶段修复类提交汇总（含值得注意的 bug）

| 提交 | 内容 | 对 sFlow 的启示 |
|------|------|----------------|
| `c143c260` | revert：per-task workflow selection 从 beta 默认流**退回到仅用户显式选择**（#504） | 大功能分阶段放量（beta 默认 → 显式 opt-in）是安全发布策略 |
| `a1d2ae75` | hook matcher `"Task"` 不匹配 `"task"` 导致宿主被误判为 claude | **Trellis 自己的 hook 都踩大小写坑**——sFlow 的 hook matcher 设计应显式规范大小写 |
| `58f51a04` | pi：按原生 session 隔离 Trellis 上下文（#513） | 多 session 并发时上下文必须按 session 隔离，不能共享 |
| `a5f81d9a` | pi：子代理支持 `max` thinking 档（原仅 off/minimal/low/medium/high/xhigh） | 子代理模型档位是可扩展的显式枚举 |
| `6d8bd3c0` | pi：子代理继承父模型（#494） | 子代理模型默认继承父级，避免配置漂移 |
| `bc36a0ed` | cli：**上限** OpenCode 子代理上下文注入量（#441 follow-up, #456） | 上下文注入必须有预算上限（呼应 sFlow 对低参模型的上下文保护） |
| `f7d8c32f` | cli：跳过二进制上下文文件（#471） | 上下文扫描要过滤二进制文件 |
| `e3c91ba0` | cli：校验归档任务上下文路径（#519） | 归档路径校验防路径穿越 |
| `c41c8bd7` | cli：检测 Trellis 自己拥有的平台配置（#501） | 工具不能覆盖它自己生成的文件 |
| `c5465d04` | hooks：停止 env 文件膨胀 + 暴露更新提醒 | 每 session 一次性提示 vs 每次注入 |
| `e4ed585e` | hooks：stdin 按 UTF-8 解码 | Windows/非 UTF-8 locale 下 hook stdin 需显式 reconfigure |
| `aef8ea56` | scripts：约束 polyrepo Git 上下文扫描范围（#497） | 跨仓库扫描要有边界 |
| `5ba35f68` | channel：完成的轮次后强制 idle timeout（#496） | 完成态也要有超时，防僵尸 worker |
| `13862313` | channel：暴露 Codex turn 失败（#495） | 子代理失败信号必须透传，不能静默 |
| `7df965f0` | kimi：研究通过 coder 子代理持久化（#457） | 研究结果要跨子代理传递并落盘 |

---

## 三、本阶段值得 sFlow 借鉴的清单

按投入产出比排序（承接上文的「四、综合建议」）：

| 优先级 | 借鉴点 | 对应 Trellis 提交 | sFlow 落地方式 |
|--------|--------|-------------------|----------------|
| P0 | **召回完整性原则**：文件里存在的真实数据都应进入共享池，用边界标记而非丢弃 | `08d43351` | IFlow researcher / test-engineer 读取历史会话时，compaction/摘要不丢弃原始轮次，输出 compaction 边界标记 + 显式去重 |
| P0 | **容错降级**：一切解析失败 → stderr 警告 + 回退默认，永不抛异常 | `c3596dd9`（全代码库原则） | sFlow 的状态/配置解析统一"警告 + 回退"策略 |
| P1 | **Per-task 工作流变体库**：`.flow-engine/{sflow,iflow}/workflows/<id>.md` 用户库 + change 级 pin | `c3596dd9` | 按 change/task 选择 9 态线性或 6 态循环工作流；id 白名单正则防路径逃逸 |
| P1 | **append-only 文件 merge=union + 全量重生成文件冲突指导** | `a5374864` | `.flow-engine/**/journal-*.md`、调研文档加 `merge=union`；状态 JSON 说明"冲突任选一边，真相在变更集内" |
| P1 | **上下文注入上限 + 二进制过滤** | `bc36a0ed`、`f7d8c32f` | 子代理 prompt 注入设 token 预算，跳过二进制上下文文件 |
| P2 | **Hook matcher 大小写规范** | `a1d2ae75` | sFlow hook 的 matcher 规范化（Trellis 自己都踩坑） |
| P2 | **短 TTL 票据跨进程身份桥接** | `2e90b149` | 未来 CLI/CI 场景下传递 session 身份（30s TTL 即安全边界） |
| P2 | **符号链接可信根** | `530d2091` | `.flow-engine/` 支持链接工作区时的安全检查设计 |
| P3 | **子代理模型继承父级 + 枚举档位扩展** | `6d8bd3c0`、`a5f81d9a` | 子代理模型默认继承主会话配置 |
| P3 | **完成态超时 + 失败信号透传** | `5ba35f68`、`13862313` | 后台子代理完成后的闲置超时与错误上报 |

## 四、本阶段更新后的「决定不借鉴」复核

上文的「五、决定不借鉴」在本阶段后需复核：

- **「Channel 事件系统」不借鉴的结论维持**：本阶段 Trellis 在 channel 侧只做了增量加固（trusted dirs、idle timeout、turn 失败透传），没有引入新的架构级通信范式，不改变 sFlow 的决策。
- **「Spec 分层系统」不借鉴的结论维持**：`6ddd9412` 的重构本质是把 spec 文档本身组织得更好（单一事实来源），没有改变"sFlow 线性可控架构 vs 动态 spec 注入"的根本冲突。
- **Per-task workflow 变体**（本阶段新增，值得重新评估）：`c3596dd9` 的变体选择机制**不是**「Spec 分层系统」那样的动态注入——它是**任务级显式 pin + 白名单 + 静默回退**，与 sFlow 的线性可控架构**不冲突**，可列为 P1 借鉴项（见上表）。

