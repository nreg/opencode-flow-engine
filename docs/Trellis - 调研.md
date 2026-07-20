# Trellis 借鉴分析

> 来源：<https://github.com/mindfold-ai/Trellis>

---

## 一、架构全景对比：sFlow/IFlow vs Trellis

| 维度 | sFlow/IFlow (opencode-flow-engine) | Trellis |
|------|-------------------------------------|---------|
| 定位 | OpenCode 插件，嵌入 AI 编码工具 | 独立的通用工作流系统，跨平台 |
| 架构形态 | OpenCode Plugin (hooks + tools + agents) | CLI + Python 脚本 + Node.js Core SDK |
| 状态管理 | 文件状态机（`.sflow/state.json` / `.iflow/state.json`） | 文件状态机（`.trellis/tasks/<task>/task.json`）+ 运行时面包屑 |
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

**sFlow 做法**：状态存储在 `.sflow/state.json` / `.iflow/state.json` 中，agent 通过 `workflow_router` / `iflow_router` 工具检测。

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
| P1 | Spec 分层系统 | 建立 `.sflow/spec/<package>/<layer>/` 目录结构，动态注入到子代理 |
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
| 生命周期钩子     | 有借鉴意义，但ROI偏低，脚本执行失败可能卡住流程，调试困难    |

生命周期钩子：

Trellis 的 task.json 支持四个事件：
{
  "hooks": {
    "after_create":  ["python3 scripts/notify-slack.py"],
    "after_start":   ["python3 scripts/create-branch.py"],
    "after_finish":  ["python3 scripts/cleanup.py"],
    "after_archive": ["python3 scripts/archive-report.py"]
  }
}
事件	触发时机	适合做什么
after_create	任务目录创建后	创建关联分支、通知团队、初始化环境
after_start	任务状态变为 in_progress	锁定分支、创建开发环境、注册 CI 流水线
after_finish	任务完成（清除活跃指针）	清理临时文件、发送完成通知
after_archive	任务归档到 archive/	生成报告、更新索引、发送周报汇总

引入好处：

1. 自动创建分支 / 管理 Git
当前 sFlow 中，iflow-shipper 负责创建 PR，但分支管理是写死在 agent prompt 里的。有了钩子：
after_create → 自动创建 feature/xxx 分支
after_start  → 保护分支（禁止直接 push）
after_archive → 自动删除已合并的本地分支
2. 自动通知
after_create → 钉钉/飞书机器人："新任务开始：xxx"
after_archive → 邮件/消息："任务已完成：xxx"
3. 自动环境管理
after_start  → 自动部署开发环境 / 初始化数据库
after_finish → 自动销毁临时环境
after_archive → 自动清理测试数据
4. 自动生成报告
after_archive → 自动生成周报条目："本周完成：xxx"

弊端：
1. 执行失败的处理策略
钩子脚本失败怎么办？
阻止状态转移？（太严格——可能卡住流程）
忽略继续？（可能掩盖问题）
记录警告，让用户决定？（最佳路径，但需要额外交互）
2. 安全风险
用户配置的脚本可以执行任意命令。如果 .sflow/config.json 被提交到仓库，恶意 PR 可以在 CI 中执行恶意代码。需要脚本白名单或确认执行的机制。
3. 跨平台兼容
Windows 用户配置了 bash script.sh，macOS 用户配置了 pwsh script.ps1，sFlow 需要知道运行平台。当前 sFlow 没有平台检测机制。
4. 调试困难
钩子脚本失败时，用户很难知道是脚本本身的问题，还是环境问题，还是 sFlow 传参的问题。需要有清晰的错误日志。
