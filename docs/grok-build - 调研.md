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
