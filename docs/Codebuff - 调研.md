# Codebuff 调研 - 简述

---

## 一、Codebuff Agent 工作流程的 5 大核心特征

### 1. 扁平化 + 动态 spawn（无固定层级）

- **没有状态机**：不像 iFlow 那样有 discussing→researching→planning→executing→verifying→shipping 的固定阶段
- 主 agent（如 base2）通过 `spawn_agents` 工具在运行时动态派生子 agent
- 子 agent 可以并行运行、可以嵌套 spawn 子 agent
- 示例：`general-agent` 在每步前内联调用 `context-pruner` agent

### 2. handleSteps 生成器（最独特的设计）

- 在声明式 agent 定义中嵌入 TypeScript 生成器函数
- 通过 `yield` 控制执行：
  - `yield { toolName, input }` → 直接执行工具
  - `yield 'STEP'` → 执行一次 LLM 调用
  - `yield 'STEP_ALL'` → 执行到 LLM end_turn
- 函数被序列化存数据库，运行时通过 `eval` 反序列化
- 全局 Map `runIdToGenerator` 保存生成器状态

### 3. 完整调用链

```
CLI (index.tsx: TUI+React)
  → SDK (run.ts: 初始化 SessionState)
  → main-prompt.ts (选择 agent 类型：costMode 或 --agent)
  → loopAgentSteps (主循环)
      ├─ runProgrammaticStep (handleSteps 执行)
      ├─ token 计数检查
      ├─ runAgentStep (LLM 调用 + 工具执行)
      │   └─ spawn_agents → 子 agent 递归执行 loopAgentSteps
      └─ shouldEndTurn 检查
```

### 4. 28 个内置工具

| 分类 | 工具 |
|------|------|
| 文件 | `read_files`, `write_file`, `str_replace`, `apply_patch` |
| 终端 | `run_terminal_command` |
| Web | `web_search`, `read_docs`, `read_url` |
| Agent 管理 | `spawn_agents`（并行）, `spawn_agent_inline`, `lookup_agent_info` |
| 交互 | `ask_user`, `suggest_followups`, `render_ui` |
| 思考 | `think_deeply` |
| 扩展 | 原生支持 MCP + Composio |

### 5. 多模型路由

- 通过 OpenRouter 支持 50+ 模型
- 支持 provider 回退、价格排序、吞吐量/延迟排序
- `costMode` 映射：`free → base-free`, `lite → base-free`, `normal → base`, `max → base-max`, `experimental → base2`

---

## 二、与 iFlow/SFlow 的关键对比

| 维度 | Codebuff | iFlow/SFlow |
|------|----------|-------------|
| 架构 | 扁平 spawn，LLM 自主 | 严格状态机 6 阶段 |
| Agent 定义 | TypeScript 对象 + 生成器 | `.md` 声明式配置 |
| 质量门禁 | 隐式（LLM 自我修正） | 显式（DP-0~DP-5 + 验证器） |
| 状态管理 | 运行时 AgentState 对象 | 文件系统 `.flow-engine/sflow/` 制品 |
| 用户确认 | `ask_user` 工具（LLM 自决） | 决策点强制确认 |
| UI/SDK | React + OpenTUI + 完整 SDK | 纯 CLI |
| 并行性 | 一次 spawn 多个 agent 并行 | 固定 subagent 串行 |

---

## 三、值得借鉴的设计

1. **handleSteps 生成器**：程序化控制 + LLM 混合执行，精确把控流程
2. **并行子 agent**：单次 `spawn_agents` 调用即可并行多 agent，效率高
3. **MCP + OpenRouter**：原生集成，模型选择极其灵活
4. **TUI 体验**：React + OpenTUI 实时流式渲染

---

## 四、Codebuff 缺失的部分（iFlow 主战场）

- ❌ 无内置 verifying/release 阶段
- ❌ 无 `.flow-engine/iflow` 制品文件系统
- ❌ 无对抗性验证（BLOCKER/WARNING 分类）
- ❌ 无明确范围缩减禁令
- ❌ 无合约驱动的验收标准

# Codebuff 调研 - 详述

> 研究时间：2026-07-17
> 项目路径：`E:\work\nreg\ai-agent\source\codebuff`
> 研究方法：codegraph_explore + 关键文件阅读

---

## 1. GOALS

codebuff 是一个基于 Bun 的 TypeScript monorepo 编码助手 CLI 工具，其 agent 工作流程的设计目标：

- **可组合的 Agent 系统**：通过 `AgentDefinition` 接口定义 agent，支持动态加载和嵌套使用
- **程序化 + LLM 混合执行**：通过 `handleSteps` 生成器函数实现确定性流程 + LLM 驱动的工具调用
- **多模型路由**：通过 OpenRouter 支持 50+ 模型，支持 provider 回退和价格排序
- **子 Agent 并行**：`spawn_agents` 工具支持并行派生子 agent，结果汇总回父 agent
- **上下文管理**：基于 token 计数 + context-pruner agent 实现上下文窗口管理
- **TUI 交互**：基于 React + OpenTUI 构建终端 UI，支持实时流式响应

---

## 2. CONTEXT

### 项目结构

```
codebuff/
├── cli/                    # TUI 客户端入口
│   └── src/
│       ├── index.tsx       # 启动入口 (main 函数)
│       ├── app.tsx         # App 根组件
│       ├── chat.tsx        # 聊天界面组件
│       └── commands/
│           ├── router.ts   # 用户输入路由
│           └── command-registry.ts  # 命令注册表
├── agents/                 # Agent 定义文件
│   ├── types/              # 类型定义 (AgentDefinition, tools, etc.)
│   ├── base2/              # 主编码 agent 变体 (22个)
│   ├── general-agent/      # 通用深度思考 agent
│   ├── researcher/         # Web 搜索 agent
│   ├── librarian/          # GitHub 仓库克隆分析 agent
│   ├── reviewer/           # 代码审查 agent (12个变体)
│   ├── thinker/            # 深度推理 agent
│   ├── editor/             # 文件编辑 agent
│   ├── file-explorer/      # 文件发现 agent (7个)
│   ├── basher.ts           # 终端命令执行 agent
│   └── context-pruner.ts   # 上下文管理 agent (954行)
├── packages/
│   ├── agent-runtime/      # 核心运行时 (prompt, tool, stream)
│   └── llm-providers/      # LLM provider 适配层
├── common/src/
│   ├── tools/              # 工具定义
│   └── types/              # 共享类型
├── sdk/                    # 对外 SDK
│   └── src/
│       ├── run.ts          # 核心运行入口 (1106行)
│       └── agents/         # agent 加载逻辑
└── docs/agents-and-tools.md
```

### 入口链

```
package.json: "start-cli": "bun --cwd cli dev"       [CITED: package.json:20]
cli/src/index.tsx: main() → parseArgs() → initializeApp() → createRoot().render(<App/>)  [CITED: cli/src/index.tsx:79-406]
cli/src/app.tsx → <App/> → <Chat/>  (chat.tsx)
```

---

## 3. FINDINGS

### 3.1 Agent 体系结构

#### 核心类型定义

`AgentDefinition` 是 agent 的核心契约接口，定义在 `agents/types/agent-definition.ts`：

```typescript
interface AgentDefinition {
  id: string                    // 唯一标识符
  model: ModelName              // OpenRouter 模型名
  toolNames?: ToolName[]        // 可用工具列表
  spawnableAgents?: string[]    // 可派生子 agent 列表
  systemPrompt?: string         // 系统提示词
  instructionsPrompt?: string   // 每次用户输入后插入的指令
  stepPrompt?: string           // 每个 agent 步骤插入的提示
  handleSteps?: Generator<...>  // 程序化步骤生成器
  outputMode?: 'last_message' | 'all_messages' | 'structured_output'
  includeMessageHistory?: boolean  // 是否继承父 agent 对话历史
  inheritParentSystemPrompt?: boolean  // 是否继承父 agent 系统提示
  mcpServers?: Record<string, MCPConfig>  // MCP 服务器配置
  inputSchema?: { prompt?, params? }  // 输入参数 schema
  outputSchema?: JsonObjectSchema     // 结构化输出 schema
  spawnerPrompt?: string       // 描述何时/为何使用此 agent
}
```
[CITED: agents/types/agent-definition.ts:21-269]

#### 内置 Agent 清单

以下是 `agents/` 目录下定义的全部 agent 类型：

| Agent ID          | 文件                                    | 角色         | 模型                  | 工具数                                         |
| ----------------- | --------------------------------------- | ------------ | --------------------- | ---------------------------------------------- |
| `base2`           | `agents/base2/base2.ts`                 | 主编码 agent | gpt-5.4               | 含 spawn_agents                                |
| `base2-fast`      | `agents/base2/base2-fast.ts`            | 快速编码     | 多模型                | -                                              |
| `base2-free`      | `agents/base2/base2-free.ts`            | 免费编码     | 多模型                | -                                              |
| `base2-max`       | `agents/base2/base2-max.ts`             | 最大能力编码 | 多模型                | -                                              |
| `base2-plan`      | `agents/base2/base2-plan.ts`            | 计划模式     | 多模型                | -                                              |
| `base-chat`       | `agents/base-chat.ts`                   | 对话聊天     | DeepSeek V4 Flash     | spawn_agents, gravity_index, suggest_followups |
| `general-agent`   | `agents/general-agent/general-agent.ts` | 通用深度思考 | gpt-5.4 / opus-4.8    | 文件读写 + spawn_agents                        |
| `gpt-5-agent`     | `agents/general-agent/gpt-5-agent.ts`   | GPT-5 专用   | gpt-5.4               | 同上                                           |
| `opus-agent`      | `agents/general-agent/opus-agent.ts`    | Opus 专用    | opus-4.8              | 同上                                           |
| `researcher-web`  | `agents/researcher/researcher-web.ts`   | Web 搜索     | Gemini 3.1 Flash Lite | web_search, read_url                           |
| `researcher-docs` | `agents/researcher/researcher-docs.ts`  | 文档搜索     | -                     | read_docs                                      |
| `librarian`       | `agents/librarian/librarian.ts`         | 仓库分析     | minimax-m3            | run_terminal_command, set_output               |
| `code-reviewer`   | `agents/reviewer/code-reviewer*.ts`     | 代码审查     | 12种模型              | 文件读/写                                      |
| `thinker`         | `agents/thinker/thinker*.ts`            | 深度推理     | Gemini/GPT            | 思考                                           |
| `editor`          | `agents/editor/editor*.ts`              | 文件编辑     | GPT-5                 | 文件写操作                                     |
| `file-picker`     | `agents/file-explorer/file-picker.ts`   | 文件查找     | 轻量                  | find_files, read_subtree                       |
| `code-searcher`   | `agents/file-explorer/code-searcher.ts` | 代码搜索     | 轻量                  | code_search                                    |
| `basher`          | `agents/basher.ts`                      | 终端执行     | Gemini 3.1 Flash Lite | run_terminal_command                           |
| `context-pruner`  | `agents/context-pruner.ts`              | 上下文修剪   | claude-sonnet-4.6     | 消息管理                                       |
| `tmux-cli`        | `agents/tmux-cli.ts`                    | tmux 测试    | 轻量                  | 终端                                           |

[CITED: agents/ 目录结构, 各 agent 文件]

#### 模板类型（服务端运行时）

`common/src/types/session-state.ts` 定义了 AgentTemplateType 枚举，区分了服务端 agent 类型：

```typescript
const AgentTemplateTypeList = [
  'base', 'base_free', 'base_max', 'base_experimental',
  'claude4_gemini_thinking', 'superagent', 'base_agent_builder',
  'ask', 'planner', 'dry_run', 'thinker',
  'file_picker', 'file_explorer', 'researcher', 'reviewer',
  'agent_builder', 'example_programmatic',
]
```
[CITED: common/src/types/session-state.ts:79-104]

#### Agent 层级关系

**没有内置的层级结构**，codebuff 采用**扁平化 + 动态 spawn** 模式：

1. **主 agent**（如 base2）是用户交互的入口点
2. 主 agent 通过 `spawn_agents` 工具**动态派生**子 agent
3. 子 agent 在父 agent 的 `spawnableAgents` 列表中声明
4. 子 agent 可并行运行，结果返回父 agent
5. 子 agent 可以进一步 spawn 自己的子 agent

**示例**：general-agent 的 spawnableAgents 配置：

```typescript
spawnableAgents: buildArray(
  'researcher-web', 'researcher-docs', 'file-picker',
  'code-searcher', 'directory-lister', 'glob-matcher',
  'basher', 'context-pruner',
),
```
[CITED: agents/general-agent/general-agent.ts:52-61]

agent 还可以通过 `spawn_agent_inline` 工具在步骤间内联调用子 agent，如 general-agent 每步前调用 `context-pruner`：

```typescript
handleSteps: function* ({ params }) {
  // ... 先读取文件 ...
  while (true) {
    yield {  // 每步前调用 context-pruner
      toolName: 'spawn_agent_inline',
      input: { agent_type: 'context-pruner', params: params ?? {} },
      includeToolCall: false,
    } as any
    const { stepsComplete } = yield 'STEP'
    if (stepsComplete) break
  }
}
```
[CITED: agents/general-agent/general-agent.ts:75-99]

---

### 3.2 Agent 执行流程

#### 完整调用链

```
用户输入
  │
  ▼
cli/src/chat.tsx (Chat 组件)
  │ useSendMessage 钩子
  ▼
cli/src/commands/router.ts (routeUserPrompt)
  │ 检查 slash 命令 / 普通输入
  ▼
sdk/src/run.ts (run → runOnce)
  │ 初始化 SessionState, 创建 agent 上下文
  ▼
packages/agent-runtime/src/main-prompt.ts (mainPrompt → callMainPrompt)
  │ 根据 agentId 或 costMode 选择 agent 类型
  │ 调用 loopAgentSteps
  ▼
packages/agent-runtime/src/run-agent-step.ts (loopAgentSteps)
  │
  ├─ 1. 加载 agent 模板 (getAgentTemplate)
  │     优先: localAgentTemplates → 数据库缓存 → 数据库查询
  │
  ├─ 2. 构建系统提示词 (system prompt)
  │     含: 文件树, git 变更, 知识文件, 系统信息, 工具定义
  │
  ├─ 3. 如果有 handleSteps → 运行程序化步骤 (runProgrammaticStep)
  │     生成器 yield 控制:
  │     - { toolName, input } → 直接执行工具
  │     - 'STEP' → 执行一次 LLM 调用
  │     - 'STEP_ALL' → 执行 LLM 直到 end_turn
  │
  ├─ 4. 运行 LLM 步骤 (runAgentStep)
  │     ├─ getAgentStreamFromTemplate → 构建 AI SDK 流
  │     ├─ promptAiSdkStream → 调用 LLM API
  │     └─ processStream → 解析工具调用并执行
  │
  ├─ 5. 检查 shouldEndTurn
  │     - task_completed / end_turn 工具调用
  │     - 无工具调用且非 think-only 响应
  │     - 步骤数超限 (maxAgentSteps)
  │
  └─ 6. 循环步骤 3-5 直到 endTurn 或 abort
```

[VERIFIED: 阅读全套代码路径]

#### Agent 选择逻辑

在 `main-prompt.ts:96-116` 中，agent 选择由两个因素决定：

```typescript
// 1. 用户通过 --agent CLI 标志指定
if (agentId) {
  agentType = agentId  // 直接使用指定 agent
} else {
  // 2. 根据 costMode 映射
  agentType = {
    ask: 'ask',
    free: 'base-free',    // 免费模式
    lite: 'base-free',    // 精简模式
    normal: 'base',       // 正常模式
    max: 'base-max',      // 最大模式
    experimental: 'base2', // 实验模式
  }[costMode ?? 'normal'] ?? 'base2'
}
```
[CITED: packages/agent-runtime/src/main-prompt.ts:96-116]

#### Agent 注册表查找优先级

`getAgentTemplate` 使用三层查找：

1. **localAgentTemplates**（动态加载的 agent + 静态模板）
2. **databaseAgentCache**（数据库缓存，仅限特定版本）
3. **数据库查询**（publisher/agent-id 格式）
4. 若 agentId 没有 publisher 前缀，自动尝试 `codebuff/agentId`
[CITED: packages/agent-runtime/src/templates/agent-registry.ts:21-88]

#### handleSteps 程序化机制

`handleSteps` 是 codebuff 最独特的设计，它是一个生成器函数，让 agent 定义者可以精确控制执行流程：

```typescript
handleSteps: function* ({ agentState, prompt, params, logger }) {
  // 1. 直接执行工具
  const { toolResult } = yield { toolName: 'read_files', input: { paths: ['file1.txt'] } }

  // 2. 让 LLM 执行一步
  yield 'STEP'

  // 3. 让 LLM 执行到 end_turn
  yield 'STEP_ALL'

  // 4. 设置输出
  yield { toolName: 'set_output', input: { output: '完成' } }
}
```
[CITED: agents/types/agent-definition.ts:220-268]

关键实现细节：
- 生成器状态保存在 `runIdToGenerator` 全局 Map 中（`run-programmatic-step.ts:34`）
- `handleSteps` 函数被序列化为字符串存储在数据库，在运行时通过 `eval` 反序列化（`run-programmatic-step.ts:38-40`）
- `clearProgrammaticRunState` 在 abort/error 时清理生成器状态（`run-programmatic-step.ts:60-64`）
[CITED: packages/agent-runtime/src/run-programmatic-step.ts:34-64]

---

### 3.3 关键机制

#### 工具系统

**工具定义**：`agents/types/tools.ts` 定义了 28 个工具名称和参数类型：

| 工具分类   | 工具名称                                                     |
| ---------- | ------------------------------------------------------------ |
| 文件编辑   | `read_files`, `write_file`, `str_replace`, `apply_patch`, `propose_str_replace`, `propose_write_file` |
| 代码分析   | `code_search`, `find_files`, `read_subtree`, `list_directory`, `glob` |
| 终端       | `run_terminal_command`                                       |
| Web        | `web_search`, `read_docs`, `read_url`                        |
| Agent 管理 | `spawn_agents`, `spawn_agent_inline`, `lookup_agent_info`    |
| 输出控制   | `set_output`, `end_turn`, `task_completed`                   |
| 交互       | `ask_user`, `suggest_followups`, `render_ui`, `add_message`  |
| 思考       | `think_deeply`                                               |
| 其他       | `skill`, `gravity_index`, `write_todos`, `set_messages`      |

[CITED: agents/types/tools.ts:4-35]

**工具执行流程**：
1. LLM 流式响应 → `tool-stream-parser.ts` 解析工具调用
2. `tool-executor.ts` 执行工具调用
3. 工具结果返回给 LLM 作为下一轮输入
4. 特殊工具 `spawn_agents` 会触发嵌套 agent 运行

**MCP 工具支持**：通过 `packages/agent-runtime/src/mcp.ts` 和 `common/src/mcp/` 支持 MCP 服务器工具

#### 上下文管理

**上下文组成**（系统提示词）：
- 项目文件树（`{CODEBUFF_FILE_TREE_PROMPT}`）
- Git 变更状态（`{CODEBUFF_GIT_CHANGES_PROMPT}`）
- 知识文件内容（`{CODEBUFF_KNOWLEDGE_FILES_CONTENTS}`）
- 系统信息（`{CODEBUFF_SYSTEM_INFO_PROMPT}`）
- Agent 名称（`{CODEBUFF_AGENT_NAME}`）
- 用户 CWD（`{CODEBUFF_USER_CWD}`）
- 项目根目录（`{CODEBUFF_PROJECT_ROOT}`）
- 剩余步骤数（`{CODEBUFF_REMAINING_STEPS}`）

[CITED: packages/agent-runtime/src/templates/types.ts:14-36]

**Token 计数**：
- 付费模式：调用 Anthropic 的 `/api/v1/token-count` API
- 免费模式：本地估算（`countTokensMessages` + `countTokens` + `countTokensJson`）
- 上下文窗口管理通过 `should_auto_compact` 阈值判断

**上下文修剪**：
- `context-pruner` agent 在每步之间运行，压缩对话历史
- 支持 `/compact` 命令手动压缩
- 消息生命周期管理：`expireMessages` 根据标签（`userPrompt`, `agentStep`, `INSTRUCTIONS_PROMPT`）清理过期消息
- 消息 `timeToLive` 机制控制消息保留时间

#### 子 Agent 并行执行

`spawn_agents` 工具支持并行派生子 agent：

```typescript
// 一次调用 spawn 多个 agent
yield {
  toolName: 'spawn_agents',
  input: {
    agents: [
      { agent_type: 'researcher-web', prompt: '搜索最新 React 文档' },
      { agent_type: 'code-searcher', params: { pattern: 'useEffect' } },
      { agent_type: 'basher', params: { command: 'npm test' } },
    ],
  },
}
```
[CITED: agents/types/tools.ts:339-348]

子 agent 输出模式：
- `last_message`：最后一条消息（默认）
- `all_messages`：全部消息
- `structured_output`：JSON 结构化输出（需配合 `outputSchema`）

#### 用户交互

- 用户输入通过 TUI 的 ChatInputBar 组件收集
- 流式响应实时渲染（`MessageWithAgents` 组件）
- 支持 Markdown 渲染（`components/markdown-stream.ts`）
- `ask_user` 工具支持暂停执行等待用户选择
- 快捷键命令：`/compact`, `/export`, `/init`, `/help` 等
- 通过 `command-registry.ts` 注册和管理命令

---

### 3.4 与 iFlow/SFlow 对比

| 维度           | Codebuff                            | iFlow / SFlow                    |
| -------------- | ----------------------------------- | -------------------------------- |
| **架构模式**   | 扁平 spawn 模式，无固定层级         | 严格状态机，6 阶段流水线         |
| **Agent 定义** | 声明式 TypeScript 对象 + 生成器函数 | .md 文件，声明式配置             |
| **执行控制**   | LLM 驱动 + handleSteps 生成器       | 编排者（sFlow）驱动，严格阶段    |
| **子 Agent**   | 动态 spawn，可并行，可嵌套          | 固定 subagent 角色，按阶段调用   |
| **状态管理**   | 运行时 AgentState 对象              | 文件系统 .flow-engine/sflow/ 目录制品        |
| **质量门禁**   | 隐式（LLM 自我修正）                | 显式（DP-0~DP-5 决策点，验证器） |
| **上下文管理** | context-pruner agent + token 计数   | 合约驱动的上下文管理             |
| **模型路由**   | OpenRouter 50+ 模型，provider 回退  | 固定模型配置                     |
| **工具系统**   | 28 个内置工具 + MCP                 | 通过 subagent 工具调用           |
| **用户确认**   | ask_user 工具暂停执行               | 决策点（DP）要求用户确认         |
| **SDK**        | 完整的 JS/TS SDK (run.ts)           | 无独立 SDK                       |
| **UI**         | React + OpenTUI 终端 UI             | 纯 CLI 无 TUI                    |
| **入口**       | `bun --cwd cli dev`                 | 直接 CLI 命令                    |
| **测试**       | 无内置测试/验证阶段                 | 内置 verifying 阶段              |

**Codebuff 独特优势**：
1. **handleSteps 生成器**：在声明式 agent 定义中嵌入程序化逻辑，实现精确控制
2. **并行子 agent**：一次 spawn 多个 agent 并行执行，效率高
3. **模型多样性**：通过 OpenRouter 支持几乎所有主流模型
4. **TUI 体验**：React 驱动的终端 UI，交互丰富
5. **MCP 集成**：原生支持 MCP 服务器

**iFlow/SFlow 独特优势**：
1. **严格质量门禁**：每个阶段有验证器，决策点需要用户确认
2. **可追溯性**：.flow-engine/sflow/ 制品文件记录完整决策链
3. **确定性流程**：状态机确保不会跳过关键步骤
4. **合约驱动**：执行合约明确任务范围、测试计划和验收标准
5. **代码审查**：内置 code-reviewer 和 release-archivist 阶段

---

### 3.5 入口与配置

#### 启动入口

```
package.json → "start-cli": "bun --cwd cli dev"
cli/package.json → "dev": "bun ./src/index.tsx"
```
[CITED: package.json:20, cli/]

`cli/src/index.tsx:main()` 执行流程：
1. 解析命令行参数（`parseArgs`）
2. 初始化应用（`initializeApp`）
3. 初始化 agent 注册表（`initializeAgentRegistry`）
4. 初始化技能注册表（`initializeSkillRegistry`）
5. 创建 React TUI 渲染器（`createCliRenderer`）
6. 渲染 App 组件

#### CLI 参数

```
codebuff [prompt] [options]
  --agent, -a    指定 agent ID
  --continue, -c 继续上次对话
  --mode         模式 (ask/free/lite/normal/max/experimental)
  --cwd          工作目录
```

#### Agent 配置

Agent 通过 `.agents/` 目录中的 `.ts` 文件动态加载，支持三种位置：
- `{cwd}/.agents/`
- `{cwd}/../.agents/`
- `{homedir}/.agents/`

Agent 定义文件通过 `loadLocalAgents` 函数加载（`sdk/src/agents/load-agents.ts`），支持 `.ts`, `.tsx`, `.js`, `.mjs`, `.cjs` 格式，通过 Bun 原生 TypeScript 运行时直接 import。

---

## 4. CONFIDENCE LEVEL

| 发现                                                      | 置信度 | 证据                                                         |
| --------------------------------------------------------- | ------ | ------------------------------------------------------------ |
| Agent 定义基于 AgentDefinition 接口                       | HIGH   | [CITED: agents/types/agent-definition.ts:21-269]             |
| 执行流程入口链: CLI → SDK → mainPrompt → loopAgentSteps   | HIGH   | [CITED: cli/src/index.tsx → sdk/src/run.ts → packages/agent-runtime/src/main-prompt.ts → run-agent-step.ts] |
| handleSteps 生成器机制                                    | HIGH   | [CITED: agents/types/agent-definition.ts:220-268, run-programmatic-step.ts:34-64] |
| spawn_agents 并行子 agent 机制                            | HIGH   | [CITED: agents/types/tools.ts:339-348, general-agent.ts:52-61] |
| Agent 选择逻辑 (costMode → template)                      | HIGH   | [CITED: main-prompt.ts:96-116]                               |
| 上下文管理 (placeholders, token counting, context-pruner) | HIGH   | [CITED: templates/types.ts:14-36, system-prompt/prompts.ts, context-pruner.ts] |
| 工具系统 (28 个工具)                                      | HIGH   | [CITED: agents/types/tools.ts:4-35]                          |
| 无内置状态机，采用扁平 spawn 模式                         | HIGH   | [CITED: 全部代码阅读确认]                                    |
| Agent 注册表三层查找                                      | HIGH   | [CITED: agent-registry.ts:21-88]                             |
| 与 iFlow/SFlow 对比                                       | MEDIUM | 基于 iFlow 文档和 codebuff 代码的推断对比                    |

---

## 5. WORKFLOW（Agent 调用链 ASCII 流程图）

```
┌─────────────────────────────────────────────────────────────────┐
│                      用户输入 (TTY)                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  cli/src/commands/router.ts: routeUserPrompt()                   │
│  ├─ 检查 slash 命令 (/help, /compact, /init, /export 等)         │
│  └─ 普通输入 → sendMessage()                                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  sdk/src/run.ts: run() → runOnce()                               │
│  ├─ 初始化/复用 SessionState                                     │
│  ├─ 构建 fileContext (文件树, git 变更, 环境信息)                 │
│  └─ 调用 callMainPrompt()                                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  packages/agent-runtime/src/main-prompt.ts                       │
│  ├─ 选择 agent 类型 (costMode 或 --agent)                        │
│  ├─ 加载 agent 模板 (local → cache → DB)                        │
│  └─ 调用 loopAgentSteps()                                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  run-agent-step.ts: loopAgentSteps()  ◆ 主循环 ◆                 │
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  while (true) {                                          │   │
│  │                                                          │   │
│  │  ┌─ Step 1: 运行 handleSteps (程序化步骤)               │   │
│  │  │  runProgrammaticStep()                                │   │
│  │  │  ├─ yield { toolName, input } → 直接执行工具         │   │
│  │  │  ├─ yield 'STEP' → 执行一次 LLM 调用                 │   │
│  │  │  ├─ yield 'STEP_ALL' → 执行到 end_turn               │   │
│  │  │  └─ return → 结束当前 turn                           │   │
│  │  └──────────────────────────────────────────────────────   │   │
│  │                                                          │   │
│  │  ┌─ Step 2: 检查 token 计数和上下文窗口                  │   │
│  │  │  ├─ 付费: 调用 Anthropic token-count API              │   │
│  │  │  └─ 免费: 本地估算                                    │   │
│  │  └──────────────────────────────────────────────────────   │   │
│  │                                                          │   │
│  │  ┌─ Step 3: 运行 LLM 步骤                               │   │
│  │  │  runAgentStep() → runAgentStep()                      │   │
│  │  │  ├─ getAgentStreamFromTemplate() → 构建 AI SDK 流    │   │
│  │  │  ├─ promptAiSdkStream() → 调用 LLM API               │   │
│  │  │  └─ processStream() → 解析并执行工具调用              │   │
│  │  │     ├─ read_files / write_file / str_replace          │   │
│  │  │     ├─ run_terminal_command                           │   │
│  │  │     ├─ web_search / read_docs / read_url              │   │
│  │  │     ├─ spawn_agents → 派生子 agent (并行)             │   │
│  │  │     │   └─ 子 agent 递归执行 loopAgentSteps           │   │
│  │  │     ├─ ask_user → 暂停等待用户输入                    │   │
│  │  │     └─ end_turn / task_completed → 结束循环           │   │
│  │  └──────────────────────────────────────────────────────   │   │
│  │                                                          │   │
│  │  ┌─ Step 4: 检查 shouldEndTurn                           │   │
│  │  │  ├─ end_turn / task_completed 已调用?  → 退出循环     │   │
│  │  │  ├─ 无工具调用且非 think-only?        → 退出循环       │   │
│  │  │  ├─ 步骤超限?                        → 警告后退出     │   │
│  │  │  └─ 否则                            → 继续循环         │   │
│  │  └──────────────────────────────────────────────────────   │   │
│  │                                                          │   │
│  │  }  ← 循环                                               │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Step 5: 清理并返回                                          │
│  │  ├─ expireMessages (清理 USER_PROMPT 标签消息)               │
│  │  ├─ finishAgentRun (持久化运行记录)                          │
│  │  └─ 返回 AgentOutput 给调用方                                │
│  └─────────────────────────────────────────────────────────────── │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  sendAction (通过 action 通道发送响应)                           │
│  ├─ response-chunk (流式数据块)                                  │
│  ├─ prompt-response (最终响应)                                   │
│  └─ TUI 渲染器更新 UI                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. COMPARISON（Codebuff vs iFlow/SFlow 对比表）

```
┌──────────────────────┬────────────────────────────────┬──────────────────────────────────┐
│      维度            │           Codebuff              │         iFlow / SFlow             │
├──────────────────────┼────────────────────────────────┼──────────────────────────────────┤
│                      │                                │                                  │
│  架构模式             │ 扁平化 + 动态 spawn             │ 严格状态机 + 6 阶段流水线           │
│                      │ 无固定阶段/层级                  │ exploring→specifying→bridging→     │
│                      │                                │ executing→debugging→closing       │
│                      │                                │                                  │
│  Agent 定义           │ TypeScript 对象 + 生成器函数    │ .md 文件 (markdown 声明式)        │
│                      │ AgentDefinition 接口            │ proposal.md, specs/, design.md    │
│                      │ 导出 default 对象               │ tasks.md 等制品                   │
│                      │                                │                                  │
│  执行控制             │ 混合模式:                       │ 编排者驱动:                       │
│                      │ • LLM 自主决策 (默认)            │ • sFlow 路由器决定下一步           │
│                      │ • handleSteps 生成器 (程序化)    │ • 子 agent 按阶段严格调用          │
│                      │ • 'STEP' / 'STEP_ALL' 控制       │ • 不允许跳过阶段                   │
│                      │                                │                                  │
│  子 Agent             │ 动态 spawn，可并行，可嵌套       │ 固定 subagent 角色                │
│                      │ 一次 spawn 多个 agent 并行        │ 按阶段调用特定 subagent            │
│                      │ 结果汇总回父 agent               │ 每个阶段有指定 subagent 类型       │
│                      │                                │                                  │
│  状态管理             │ 运行时内存: AgentState 对象      │ 文件系统: .flow-engine/sflow/ 目录制品         │
│                      │ messageHistory + agentContext    │ proposal.md, specs, contract      │
│                      │ 持久化通过数据库/日志             │ 文件系统即状态                     │
│                      │                                │                                  │
│  质量门禁             │ 隐式:                           │ 显式:                             │
│                      │ • LLM 自我修正                   │ • DP-0~DP-5 决策点                 │
│                      │ • 工具执行结果验证                │ • 验证器 (validate_proposal 等)    │
│                      │ • context-pruner 质量检查        │ • 用户审批每个决策点               │
│                      │                                │                                  │
│  上下文管理           │ • context-pruner agent 修剪      │ • 合约驱动的上下文管理              │
│                      │ • Anthropic token-count API     │ • 文件系统制品作为上下文            │
│                      │ • 本地 token 估算 (免费模式)      │ • 自然语言描述                     │
│                      │ • 消息标签过期机制                │                                  │
│                      │                                │                                  │
│  模型路由             │ OpenRouter 50+ 模型              │ 固定模型配置 (deepseek-v4)         │
│                      │ 支持 provider 回退/排序/过滤      │ 子 agent 可配置不同模型            │
│                      │ 支持价格/吞吐量/延迟排序          │                                  │
│                      │                                │                                  │
│  工具系统             │ 28 个内置工具                    │ 通过 subagent 工具调用             │
│                      │ 原生 MCP 支持                    │ call_flow_agent 委托机制          │
│                      │ Composio 集成                   │                                  │
│                      │                                │                                  │
│  用户确认             │ ask_user 工具 (暂停等待输入)      │ 决策点要求用户确认                  │
│                      │ LLM 自主决定是否询问              │ 每个阶段结束强制确认                │
│                      │ /compact 手动压缩                 │                                  │
│                      │                                │                                  │
│  SDK                 │ 完整 JS/TS SDK (run.ts)          │ 无独立 SDK                        │
│                      │ CodebuffClient 类                │ 通过 OpenCode 插件集成             │
│                      │ 支持自定义 agent 定义             │                                  │
│                      │                                │                                  │
│  UI                  │ React + OpenTUI 终端 UI          │ 纯 CLI 终端                        │
│                      │ 流式文本渲染 + Markdown           │ 文本输出                           │
│                      │ 状态栏 + 进度指示                 │                                  │
│                      │                                │                                  │
│  入口                │ bun --cwd cli dev                │ CLI 直接命令                       │
│                      │ package.json 脚本                │ 通过 OpenCode 插件调用             │
│                      │                                │                                  │
│  测试验证             │ 无内置测试阶段                    │ 内置 verifying 阶段                │
│                      │ 依赖 LLM 自我验证                 │ code-reviewer 审查                 │
│                      │                                │ release-archivist 验证             │
│                      │                                │                                  │
│  知识管理             │ 知识文件 (knowledge.md)          │ CONTEXT.md 研究报告               │
│                      │ AGENTS.md / CLAUDE.md            │ .flow-engine/sflow/ 制品文件                   │
│                      │ Memento 风格笔记系统              │                                  │
│                      │                                │                                  │
│  可追溯性             │ 日志文件 + 数据库运行记录         │ 文件系统制品完整记录决策链           │
│                      │ TraceWriter 记录 agent 步骤      │ 每个阶段有明确制品                  │
│                      │ 但无结构化的决策记录              │ 决策点标注状态迁移                  │
│                      │                                │                                  │
└──────────────────────┴────────────────────────────────┴──────────────────────────────────┘
```

---

## 总结

Codebuff 采用**扁平化、可组合的 agent 架构**，核心设计理念是"agent 作为可组合的构建块"：

1. **Agent 定义**是声明式 TypeScript 对象 + 可选的 `handleSteps` 生成器函数
2. **执行循环**（`loopAgentSteps`）是 LLM 驱动 + 程序化控制的混合
3. **子 Agent 并行**通过 `spawn_agents` 工具实现，无固定层级
4. **上下文管理**通过 token 计数 + context-pruner agent + 消息标签过期机制
5. **工具系统**覆盖文件、终端、Web、Agent 管理、交互等 28 个工具

与 iFlow/SFlow 相比，codebuff 更灵活但缺乏结构化质量保证。iFlow 的严格状态机确保每个阶段都有验证和用户确认，而 codebuff 依赖 LLM 的自我修正能力。

可以从 codebuff 借鉴的设计：**handleSteps 生成器**（程序化 + LLM 混合控制）、**并行子 agent 机制**、**MCP 工具集成**、**OpenRouter 多模型路由**。
