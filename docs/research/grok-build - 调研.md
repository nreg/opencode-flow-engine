# Grok-Build Agent 工作流程分析

---

## 一、整体架构

经过对 `source/grok-build` 的结构与文档梳理，grok-build 的 agent 不是一个写在单一文件里的循环流程，而是一个由**多 crate 协作、围绕 Agent 对象构建**的运行时。同时它把"agent 定义"做成了**可插拔的 Markdown+YAML 文件**，由 `xai-grok-agent` 这个 crate 总管。

### 核心理念：Agent 是一等公民

`xai-grok-agent` 的 README 一句话点明：

> An Agent bundles tools, system prompt, system-reminder policy, compaction policy, and model configuration into a single, portable object.

也就是说，agent 不是 TUI 里的"循环体"，而是一个**可被多种宿主消费的便携对象**。`xai-grok-shell`（TUI/headless/ACP stdio）只是它的一种宿主，无论是 batch、ACP 客户端、还是测试 harness，都可以消费同一个 Agent。

---

## 二、工作流（自顶向下 6 层）

### 1. 入口层（`xai-grok-shell`）

3 种入口，同一份 agent 运行时：

| 入口 | 命令 | 用途 |
|------|------|------|
| TUI | `grok` | 交互式全屏终端，多 turn |
| Headless | `grok -p "..."` | 单 turn、CI/脚本、可输出 plain/json/streaming-json |
| ACP stdio | `grok agent stdio` | JSON-RPC over stdio，给 IDE/编辑器接 |

`xai-grok-agent` 负责构建 Agent；`xai-grok-shell` 在 session 创建阶段调用 `AgentBuilder`。

### 2. Agent 定义层（`xai-grok-agent`）

定义文件格式：Markdown + YAML frontmatter，后缀 `.md`，存放在：

1. `.grok/agents/*.md`（项目级，向 git 根遍历就近优先）
2. `~/.grok/agents/*.md`（用户级）
3. 兼容目录
4. 内置：`grok-build`（extend）、`browser-use`（full）

完整 frontmatter 字段（camelCase）：

| 类别 | 字段 |
|------|------|
| 标识 | `name`, `description` |
| 提示词模式 | `promptMode: extend | full` |
| 工具 | `tools`（allowlist）, `disallowedTools`（denylist，优先） |
| 权限 | `permissionMode: default / acceptEdits / dontAsk / plan` |
| 上下文加载 | `skills`, `agentsMd`, `outputFormat` |
| Bash 调参 | `bash.{timeoutSecs, outputByteLimit, cmdPrefix}` |
| 工具重命名 | `toolNameOverrides`, `paramNameOverrides` |
| 完成强制 | `completionRequirement.{tool, reminder, recovery}` |
| 工具级配置 | `toolConfig.<tool>.retry` 等 |

### 3. 提示词组装（与 OpenCode SFlow/iFlow 的关键差异）

`xai-grok-agent/src/prompt/` 用 MiniJinja 模板引擎，且用了 `promptMode` 二选一模式：

| extend 模式 | full 模式 |
|-------------|-----------|
| 1. Base template（MiniJinja）— tool conventions, formatting, user_info, background tasks | 1. Markdown body（MiniJinja, `${{ }}` / `{% %}`） |
| 2. Markdown body（appended raw） | 2. AGENTS.md section（if `agentsMd: true`） |
| 3. AGENTS.md section（if `agentsMd: true`） | 3. Skills section |
| 4. Skills section | — |

**要点：**

- **extend 模式**：作者只写真人设/角色内容，模板自动补齐工具调用约定、格式化规则、`<user_info>`、后台任务等。
- **full 模式**：作者自己写完整 system prompt，可通过 `${{ tools.xxx }}` / `{% if %}` 引用模板变量。
- 模板变量包括：`${{ os_name }}`, `${{ shell_path }}`, `${{ working_directory }}`, `${{ current_date }}`，以及每个工具的 resolved name（工具重命名后仍能正确反射）。
- AGENTS.md 发现：自动从 cwd 向 git 根遍历，按距离近者优先合并。
- 内置两个 agent 名：`grok-build`（默认软件工程 agent，extend 模式）、`browser-use`（full 模式）。

### 4. 能力装配层（`xai-grok-tools`）

每个 Agent 通过 `ToolBridge` + `ToolRegistry` + `ToolState` 装配工具集。`xai-grok-tools` 同时维护 `SystemReminderLayer`，提示词里的 `<system-reminder>` 块从这里插入。底层工具实现：

```
run_terminal_cmd  grep          read_file      search_replace   list_dir
web_search        web_fetch     todo_write     skill
update_plan       get_task_output              kill_task
Agent(...) / Task(...) [subagent/task tool]
```

工具调用 ID 与 `--tools` / `--disallowed-tools` CLI flag 对齐。`Agent(...)` 形式的 denylist 可以精细阻断子 agent 类型（`Agent`、`Agent(explore)`、`Agent(explore, plan)`）。

### 5. 协议与传输（`xai-tool-protocol` + `xai-tool-runtime`）

`xai-tool-runtime` 定义工具执行与调度，`xai-tool-protocol` 定义对外协议边界。ACP stdio 模式就是基于这套工具运行时，把消息通过 JSON-RPC/notification 推到客户端，包括：

- `agent_message_chunk`
- `agent_thought_chunk`
- `tool_call`（pending/result）
- `plan`

### 6. 策略装饰层

围绕 Agent 装配的过程中还有几个"横切"模块：

| Crate | 职责 |
|-------|------|
| `xai-grok-compaction` | CompactionPolicy：上下文压缩策略 |
| `xai-grok-hooks` | 项目级生命周期钩子 |
| `xai-grok-sandbox` | OS 级沙箱（filesystem/network） |
| `xai-grok-memory` | 跨会话记忆（实验性） |
| `xai-grok-subagent-resolution` | 子 agent 解析 |
| `xai-grok-agent-lifecycle` | agent 生命周期（创建/恢复/销毁） |
| `xai-agent-lifecycle` | 另一份生命周期 crate（命名重合，可能是迁移遗留） |

---

## 三、一个 turn 的内部流程（推断）

> 注：以下是基于 crate 切分反推的执行流，并非出自单一时序图。仅供参考。

```
[入口] TUI/Headless/ACP
   ↓
[xai-grok-shell] Session 创建
   ├─→ 加载 .grok/agents/*.md / ~/.grok/agents/*.md
   ├─→ xai-grok-agent::discovery::by_name_in_cwd()
   ├─→ AgentBuilder::new(cwd, ...).from_definition(def).build()
   │     ├─ 选 promptMode（extend/full）
   │     ├─ 渲染 MiniJinja → system_prompt()
   │     ├─ 注入 AGENTS.md、skills
   │     ├─ ToolRegistry 配 tools/disallowedTools/工具重命名
   │     ├─ completionRequirement（强制要求某个工具被调用）
   │     └─ SystemReminderLayer / CompactionPolicy / Model config
   ↓
[Run Loop] xai-tool-runtime
   ├─ 发送 system_prompt + 对话历史到模型
   ├─ 接收 thought / text / tool_call
   ├─ 工具派发 → xai-grok-tools（权限、bash 沙箱、审批 UI）
   ├─ 工具结果回填消息流
   ├─ SystemReminderLayer 周期注入提醒
   ├─ CompactionPolicy 触发时压缩历史
   └─ completionRequirement 检测：未满足 → 注入 reminder + 重试
   ↓
[退出条件] EndTurn / max-turns / 用户中断 / 完成要求满足
```

---

## 四、与 OpenCode iFlow/SFlow 的差异（关键）

| 维度 | Grok-Build Agent | iFlow | SFlow |
|------|------------------|-------|-------|
| 形态 | Rust crate 一等公民，Agent 对象 | OpenCode 内置 agent（插件脚本化） | OpenCode 子 agent，含 team-mode + coordinator |
| 定义方式 | Markdown + YAML frontmatter（`.grok/agents/`） | TaskDescription 风格 + YAML | proposal.md → design.md → specs/** → tasks.md |
| 阶段 | 单一 Agent + 表达层（`promptMode`） | discuss→research→plan→execute→verify→ship 6 态循环 | exploring→specifying→bridging→approved→executing→debugging→closing |
| 提示词 | MiniJinja 模板，extend/full 双模式 | 直接由 system prompt + skills 注入 | 用 design.md + specs/*.md 强制分解 |
| 验证 | 自带 identifier/test/clippy 链路 | 独立 verifier subagent，BLOCKER/WARNING | 需 `execution-contract.md` 通过 `validate_contract` |
| 强制完成 | `completionRequirement`（必须调用某工具才算 turn 结束） | 6-gate 串联，必须用户/验证确认 | execution-contract + delta-spec 校验 |
| 子 agent | `Agent(explore, plan, ...)` 类型分级 | 不强调；研究阶段可派 subagent | Team Mode：N 个 worker 并行 |
| 模型耦合 | 高度耦合 Grok 模型（grok-build + web_search 独立模型路由） | 模型无感，假设第三方推理 | 模型无感 |

---

## 五、一句话总结

grok-build 的 agent 工作流 = **"Agent 作为便携对象 + Markdown+frontmatter 定义 + MiniJinja 提示词组装 + 三种入口（TUI/Headless/ACP）共用同一运行时 + 系统化策略/沙箱/钩子/压缩/记忆"**。

它和 iFlow/SFlow 最大的区别是：**grok-build 把 agent 当作类型系统里的一等公民来设计**，而 iFlow/SFlow 是在 OpenCode 宿主里做编排流水线。

## 借鉴点

可借鉴 grok-build 的 7 个方向：

### 1. Agent 定义：从硬编码工厂函数 → Markdown+Frontmatter 文件

**现状（opencode-flow-engine）**：
每个 agent 是一个 TypeScript 工厂函数（`workflows/iflow/agents/iflow-discuss-planner.ts`），prompt 写在 .ts 里的字符串中，agent 名称/工具集/模型写在 `agent-builder.ts` 的 `AGENT_REGISTRY`/`DEFAULT_MODELS` 里。

**可借鉴（grok-build 做法）**：
Agent 定义是 `.grok/agents/*.md` 文件，YAML frontmatter 声明元数据，Markdown body 是 prompt。支持无代码新增 agent。

**为什么值得改**：

| 维度 | 现状（TS 硬编码） | 借鉴后（文件化） |
|------|-------------------|-----------------|
| 用户自定义 agent | 必须改源码/插件配置 | 只需在 `.flow-engine/agents/` 下放个 .md |
| 团队共享 | 无法简单 git 分享一个单文件 | .md 文件天然可分享 |
| 组合 prompt | 用 skillContent 手动拼接 | frontmatter 声明 skills: [xxx]，系统自动注入 |
| 工具集 | 固定的 AGENT_TOOLS 枚举 | frontmatter 中 tools / disallowedTools 声明 |

**升级路径**：仿 grok-build 的 `xai-grok-agent`，在 `packages/core/` 或 `packages/plugin-infra/src/agents/` 新增 `AgentDefinitionParser`，将 frontmatter 解析为现有的 `AgentConfig` 格式。工厂函数回归为"frontmatter 体的模板渲染器"。

### 2. Prompt 组装系统：引入双模式（extend / full）和模板变量

**现状**：每个 agent 的所有 prompt 是手写的完整字符串，`iflow-discuss-planner.ts` 里直接 `instructions: \`# Role\nYou are...\``。

**可借鉴**：`promptMode: extend | full` + MiniJinja 模板变量

**现状痛点**：
- 所有 agent 的 tool calling convention、user_info、格式化规则在每个 .ts 里硬复制
- 修改一个通用约定（比如"如何调用 search_replace"）要改 20+ 个文件
- 没有 OS/Shell/工作目录等上下文变量注入

**可借鉴模式**：

| 层 | 内容 |
|----|------|
| 1. Base template (MiniJinja) | 工具调用格式、通用规则 |
| 2. Agent-specific body | 各 agent 人设（附加/覆盖） |
| 3. AGENTS.md section | 项目级规则文件发现 |
| 4. Skills section | 技能注入 |

**可加的模板变量**：
- `${{ os_name }}` / `${{ shell_path }}` / `${{ working_directory }}` / `${{ current_date }}`
- `${{ tools.read_file }}` / `${{ tools.search_replace }}`（toolNameOverrides 后仍正确）

**升级路径**：在 `packages/plugin-infra/src/agents/` 新增 `prompt-assembler.ts`，参考 `xai-grok-agent/src/prompt/` 的 MiniJinja 渲染模式。`promptMode: extend` 的 agent 工厂函数只需返回"扩展段"内容，由 assembler 拼接。

### 3. 完成强制机制（completionRequirement）

**现状**：IFlow/SFlow 的状态流转依赖 guard hooks + subagent dp-* 记录。subagent 执行完不"汇报"时，没有回退机制。

**可借鉴**：completionRequirement 字段 + 系统提醒注入

```yaml
completionRequirement:
  tool: complete_task
  reminder: >
    You stopped without calling `complete_task`.
    Please continue and call it when done.
  recovery:
    maxRetries: 3
    baseDelayMs: 5000
    maxDelayMs: 30000
```

**为什么需要**：当前 iFlow subagent 可能跑偏、提前结束而不触发 `call_flow_agent` 回传结果。有了 completionRequirement，系统会在 subagent 的下一轮自动注入 reminder，并带指数退避重试。

**升级路径**：在 `call_flow_agent` 工具的后置处理中，检查该 agent 是否定义 completionRequirement；若检测到未执行指定工具就结束 turn，自动拼接 `<system-reminder>` 到下一轮系统提示。

### 4. 工具级执行配置（per-tool retry + naming）

**现状**：工具注册是固定的 `Record<string, ToolDefinition>`，没有 per-tool 的重试/超时/命名覆盖机制。

**可借鉴**：`toolConfig.<tool>.retry` + `toolNameOverrides` + `paramNameOverrides`

**实际场景**：
- iflow-researcher 调 web_fetch 经常超时 → 给它配 `retry: { maxRetries: 3, baseDelayMs: 2000 }`
- 用户统一把 `search_replace` 重命名为"编辑文件"（中文环境）
- iflow-plan-executor 的 bash 命令需要 5 分钟超时，其他人用默认 120s

**升级路径**：在 frontmatter 的 toolConfig 段添加解析，`packages/plugin-infra/src/tools/call-flow-agent.ts` 的 `validateAgent` 函数增加 per-agent tool override 入口，subagent session 创建时注入覆写。

### 5. 细粒度子 Agent 阻断（Agent(type) 语法）

**现状**：`call_flow_agent` 只做简单的 name validation。用户无法限制 iFlow 在特定阶段不能调用某些子 agent。

**可借鉴**：`--disallowed-tools "Agent(explore)"` 语法

```
Agent            → 禁全部
Agent(explore)   → 禁单个
Agent(explore, plan) → 禁多个
```

**opencode-flow-engine 可用场景**：
- 进入 executing 状态后禁止再调 iflow-researcher（不准回头调研）
- verifying 阶段禁止调 iflow-discuss-planner（不准改需求）
- 用户不想让计划执行器自动派 explore 子任务

**升级路径**：在 `packages/plugin-infra/src/tools/call-flow-agent.ts` 的 `validateAgent` 中，增加对当前 workflow state + disallowed-subagents 配置的交叉检测。配置可放在 `.flow-engine/config.toml` 或 agent frontmatter 中。

### 6. 跨会话记忆（cross-session memory）

**现状**：opencode-flow-engine 的持久化只有 state.json（当前工作流状态），没有跨会话的"知识留存"——用户在不同 session 里告诉 agent 的信息，下次 session 不记得。

**可借鉴**：grok-build 的 `xai-grok-memory` crate，支持：
- `/memory workspace <text>` — 写入 memory
- `/memory global <text>` — 全局记忆
- `/flush` — 立即持久化
- `--experimental-memory` — 开关

**为什么对 iFlow 尤其重要**：
- 用户在一个 cycle 里做了大量决策（如"这个模块名不要改"），下一个 cycle 又忘了
- 跨 project 的通用约定（如"前端用 Tailwind，后端用 Prisma"）
- research 阶段的发现可以持久化到 memory，下次 cycle 直接读

**升级路径**：新增 `packages/plugin-infra/src/features/memory.ts`，参考 grok-build 的实现模式：
- session_start hook 加载 memory 内容拼入 system prompt
- `/memory` slash command 写入
- memory 持久化到 `~/.flow-engine/memory/{workspace|global}.json`

### 7. 系统提醒层 + 上下文压缩

**现状**：opencode-flow-engine 只有基础的 `experimental.session.compacting`，把 state 拼成 compaction context。

**可借鉴**：grok-build 的 SystemReminderLayer —— 一个专门的层，在每个 turn 的 system prompt 末尾注入 `<system-reminder>` 块，用于：
- 提醒 agent 没有完成某任务
- 注入进度/时间
- 恢复打断的步骤

**实际价值**：当前 iFlow 的 subagent 在 compaction 后经常"失忆"——忘了当前在做哪一步。SystemReminderLayer 是独立的策略化注入，与 compaction 分离，可以确保关键约束在每个 turn 可见。

### 优先级建议

| 优先级 | 方向 | 工作量估计 | 影响面 |
|--------|------|-----------|--------|
| P0 | Agent 定义文件化（#1） | 中 | 核心架构变更，影响 agent 注册全流程 |
| P0 | Prompt 组装系统（#2） | 中 | 消除 20+ 文件的冗余，统一 prompt 管理 |
| P1 | 完成强制机制（#3） | 小 | call_flow_agent + tool.execute.after 钩子 |
| P1 | 跨会话记忆（#6） | 小 | 新增 feature 模块，不影响现有流程 |
| P2 | 工具级执行配置（#4） | 中 | 需要 tool registry 扩展 |
| P2 | 子 agent 阻断语法（#5） | 小 | 扩展 validateAgent + 配置解析 |
| P2 | 系统提醒层（#7） | 中 | 需要独立于 compaction 的注入机制 |

> *「小」= 1-2 个文件，纯新增不修改现有逻辑
