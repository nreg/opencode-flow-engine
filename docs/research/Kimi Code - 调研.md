# Kimi Code CLI Agent 工作流程分析

---

## 一、整体架构

kimi-cli 的 agent 系统是一个**单 agent 主循环 + 子 agent 委派**的架构，没有预设的固定状态机流转。

```
用户输入 → KimiCLI → KimiSoul.run() → _agent_loop() → 完成
                              ↑
                    ┌─────────┴──────────┐
                    │  Agent 工具 (委派)   │
                    │  coder/explore/plan │
                    └────────────────────┘
```

---

## 二、核心组件

| 组件 | 职责 |
|------|------|
| KimiSoul | 主循环引擎，驱动 LLM 调用 + 工具执行 |
| Agent Spec | YAML 定义 agent 的工具集、子 agent 类型、系统提示词 |
| Agent 工具 | 创建/恢复子 agent 实例，支持前台/后台运行 |
| LaborMarket | 子 agent 类型注册表 |
| Runtime | 运行时上下文，包含 config、session、LLM 等 |
| Toolset | 按 import path 加载工具，支持 MCP 工具 |
| Context | 对话历史 + 检查点管理 |
| Compaction | 上下文压缩（超过阈值时自动触发） |
| Approval | 工具调用审批（YOLO / AFK 模式） |
| DenwaRenji (D-Mail) | 时间旅行机制 — 基于检查点的上下文回退 |

---

## 三、Agent 主循环（`_agent_loop`）

### 1. TURN INITIALIZATION

- 清理旧 steer 消息
- MCP 工具延迟加载

### 2. STEP LOOP（循环迭代）

```
├── 2a. Step Guard — 检查最大步数限制
├── 2b. Step Begin — 发送 StepBegin 事件
├── 2c. Context Compaction — 自动压缩上下文
├── 2d. Checkpoint — 持久化检查点
├── 2e. Step Execution
│   ├── 通知投递 (root agent 专用)
│   ├── 动态注入 (Plan模式提醒/AFK模式)
│   ├── 历史规范化
│   ├── LLM 调用 (带 tenacity 重试)
│   ├── 工具执行
│   └── 上下文增长
└── 2f. 结果处理
    ├── D-Mail 回退
    ├── Steer 注入
    └── 停止 / 继续
```

### 3. TURN RESOLUTION

返回 `TurnOutcome`。

---

## 四、子 Agent 系统

通过 Agent 工具委派工作，支持 3 种内置子 agent 类型：

| 类型 | 能力 | 工具限制 |
|------|------|----------|
| `coder` | 读写文件、执行命令、网络搜索 | 无 Agent/AskUser/Plan 工具 |
| `explore` | 只读代码探索 | 无 WriteFile/StrReplaceFile/Agent/Shell(写) |
| `plan` | 只读规划与架构设计 | 无 Shell/WriteFile/Agent 等 |

**特点：**

- 子 agent 拥有独立的 KimiSoul 实例和上下文历史
- 支持 `resume` 机制（通过 `agent_id` 恢复之前的工作）
- 运行模式：前台同步 / 后台异步
- 摘要延展：如果输出太短，自动追加一轮"继续完善摘要"
- 持久化：子 agent 实例元数据存储在 `session/subagents/<agent_id>/`

---

## 五、Plan Mode（规划模式）

- 通过 `/plan` 命令切换，或通过 `EnterPlanMode`/`ExitPlanMode` 工具
- 启用时：所有工具变更为只读，`WriteFile`/`StrReplaceFile` 仅允许写入 plan 文件
- 系统提示词中注入 PlanMode 提醒
- 自动分配 `plan_session_id` 和 plan 文件路径

---

## 六、Flow Skills（技能流）

支持 DAG 图的流程执行：

- 节点类型：`begin → task / decision → end`
- 在决策节点，LLM 输出 `<choice>...</choice>` 选择分支
- 支持 Ralph Loop：自动循环模式，直到 LLM 选择 `STOP`

---

## 七、对比 opencode-flow-engine 的 iFlow/SFlow

| 维度 | Kimi Code CLI | opencode-flow-engine (iFlow) | opencode-flow-engine (SFlow) |
|------|---------------|------------------------------|------------------------------|
| 工作流形态 | 自由循环 + 委派 | 6 状态严格状态机 | 提案→设计→执行→验证 |
| 状态固定 | 否，Agent 自行决定下一步 | 是，discuss→research→plan→execute→verify→ship | 是，proposal→spec→design→contract→delta |
| 子 agent | 3 种内置类型 (coder/explore/plan) | 6 种映射到状态 | 通过 spec 定义 |
| 工件驱动 | 弱（仅 plan 文件） | 强（CONTEXT.md/PLAN.md/VERIFICATION.md/UAT.md） | 强（proposal/spec/design/contract/delta） |
| 验证机制 | 无内置验证 | 对抗性验证（BLOCKER/WARNING） | 验证工具链（`validate_*`） |
| 范围缩减保护 | 无 | 严格禁止缩减需求 | 无 |
| 上下文压缩 | 有（自动+手动） | 无 | 无 |
| 审批系统 | YOLO/AFK 模式 | 无 | 无 |
| 时间旅行 | D-Mail 机制 | 无 | 无 |
| Flow 技能 | `DAG 图流程` | 线性状态机 | 线性流程 |
| LLM 框架 | kosong（自研） | 未限定 | 未限定 |
| 语言 | Python | TypeScript | TypeScript |
| 配置格式 | YAML agent spec | 代码配置 | 代码配置 |

---

## 八、关键差异总结

1. **状态机 vs 自由循环**：iFlow 有严格的 6 状态流转，kimi-cli 是单循环 + 子 agent 委派，agent 自己决定何时做什么
2. **工件驱动**：iFlow/SFlow 通过工件（CONTEXT.md/PLAN.md 等）驱动流程，kimi-cli 没有严格的工件要求
3. **验证强度**：iFlow 有对抗性验证（adversarial verification），kimi-cli 没有内置验证机制
4. **范围保护**：iFlow 明确禁止缩减需求，kimi-cli 依赖 agent 自身的判断
5. **基础设施**：kimi-cli 有更丰富的运行时基础设施（审批、上下文压缩、时间旅行、通知系统）

## 借鉴点

### 一、核心架构可借鉴

#### 1. YAML Agent Spec 系统 — 简化 agent 配置与扩展

kimi-cli 用 YAML 声明 agent（工具集、子 agent 类型、系统提示词），支持 extend 继承。当前 opencode-flow-engine 的 agent 定义硬编码在 TypeScript 中。

**借鉴收益**：用户/插件开发者可直接通过 YAML 文件定制 agent，无需改源码。

**建议**：

```yaml
extend: base-agent
tools:
  - kimi_cli.tools.file:ReadFile
  - kimi_cli.tools.file:WriteFile
  - kimi_cli.tools.shell:Shell
subagents:
  coder:
    path: ./coder.yaml
    description: "代码修改专用"
  plan:
    path: ./plan.yaml
    description: "只读规划"
```

#### 2. 动态注入系统 (Dynamic Injection) — 提升上下文质量

kimi-cli 在每步 LLM 调用前动态注入 PlanMode 提醒、AFK 状态等系统消息。opencode-flow-engine 当前需要 agent 在提示词中手工维护状态提醒。

**借鉴收益**：工作流状态提醒（如"当前是 verifying 阶段，不允许修改文件"）自动注入，不需要每个 agent 的 system prompt 里都写一遍。

**建议**：创建 InjectionProvider 接口：
- ScopeGuardInjection — 当前状态不允许的操作提醒
- CheckpointInjection — 恢复 session 时注入上下文摘要
- AntiRepeatInjection — 命中 lessons.md 排除方案时注入警告

#### 3. 子 Agent 持久化与 Resume 机制 — 跨 session 无缝恢复

kimi-cli 的 SubagentStore 持久化子 agent 完整上下文（元数据、对话历史、wire 日志）到 `session/subagents/<agent_id>/`，支持通过 `agent_id` 恢复。opencode-flow-engine 的 TaskTracker 仅记录调用元数据（谁、多久、成败），不含上下文恢复能力。

**借鉴收益**：长任务被中断后，子 agent 可精确恢复现场，而不是从头重跑。

**建议**：将 `agent-tracker.json` 升级为 `subagent-store/` 目录：

```
.flow-engine/iflow/subagent-store/
├── <agent_id>/
│   ├── meta.json       # 元数据、状态、类型
│   ├── prompt.md       # 原始 prompt
│   ├── output.md       # 输出摘要
│   └── wire.log        # 事件流日志
└── index.json          # agent_id 索引
```

#### 4. Approval 审批系统 — 安全性保障

kimi-cli 的 Approval 系统支持三种模式：
- **YOLO** — 自动批准所有操作
- **AFK** — 无人值守模式，自动批准 + 自动 dismiss 用户提问
- **Per-action** — 特定操作自动批准（如写 plan 文件）

opencode-flow-engine 当前无审批机制，所有操作由 agent 自行决定。

**借鉴收益**：在 verifying 阶段，写文件操作需要审批；在 discussing 阶段，跳过审批。

**建议**：

```typescript
interface ApprovalConfig {
  // 哪些状态下可跳过审批
  autoApproveStates: string[];
  // 哪些工具调用需要审批
  requireApproval: string[];
  // 审批渠道 (ask user / 默认批准)
  channel: 'ask-user' | 'auto' | 'yolo';
}
```

### 二、工作流增强可借鉴

#### 5. 上下文压缩 (Compaction) — 避免 token 溢出

kimi-cli 的 SimpleCompaction 在上下文超过阈值时自动压缩：保留最近的 N 轮对话，将历史总结为摘要。

**借鉴收益**：当 iFlow/SFlow 长时间运行 token 超限时自动压缩，避免 session 中断。

| 对比 | opencode-flow-engine | kimi-cli |
|------|---------------------|----------|
| 手动压缩 | 无 | `/compact` 命令 |
| 自动压缩 | 无 | 超过 compaction_trigger_ratio 自动触发 |
| 压缩策略 | 无 | 保留最近对话 + LLM 生成历史摘要 |

#### 6. Flow Skills (DAG 流程) — 可组合的多步骤工作流

kimi-cli 支持 DAG 图流程（begin → task → decision → end），可在决策节点让 LLM 选择分支 `<choice>...</choice>`，用于实现技能链。opencode-flow-engine 的 iFlow/SFlow 目前是线性状态机。

**借鉴收益**：实现可配置的"技能链"，如"研究 → 规划 → 执行 → 验证 → 修正 → 重新验证"的循环流程。

#### 7. Plan Mode（只读规划模式） — 降低意外风险

kimi-cli 的 `/plan` 模式让所有工具变只读，仅允许写 plan 文件。agent 在规划时不会"手滑"改代码。

**借鉴收益**：iFlow 的 planning 状态可自动启用只读模式，直到用户确认 plan。

#### 8. D-Mail / Time Travel 机制 — 更优雅的错误恢复

kimi-cli 的 DenwaRenji 允许"未来的 AI"发送消息回到检查点。当 agent 发现之前的操作有误时，可回退到检查点并注入修正指令。

**借鉴收益**：当 executor 执行出错或 verifier 发现 BLOCKER 时，可回退到上一个检查点，而不是从头开始。

### 三、基础设施可借鉴

#### 9. 子 Agent 输出摘要续写 — 确保信息完整

kimi-cli 的 `run_with_summary_continuation` 在子 agent 输出 < 200 字符时会自动追加一轮"请补充更详细的摘要"。

**借鉴收益**：iFlow 的子 agent（如 iflow-researcher、iflow-plan-executor）返回给主 agent 时自动保证摘要长度，避免"输出太少导致主 agent 无法决策"。

#### 10. 通知系统 (Notification Manager) — 异步事件传递

kimi-cli 的 NotificationManager 支持后台任务完成通知、MCP 连接状态变更等异步事件注入到 LLM 上下文。opencode-flow-engine 当前无类似机制。

**借鉴收益**：背景子 agent 完成后自动注入通知到主 agent 上下文。

#### 11. Kosong LLM 抽象层 — 解耦 LLM Provider

kimi-cli 的 kosong 包（Python）统一了消息格式、异步工具编排、多 provider 切换。opencode-flow-engine 当前依赖 OpenCode 内置的 LLM 调用，未做抽象。

**借鉴收益**：不一定要引入 kosong，但其设计理念（统一消息结构、工具编排、provider 解耦）值得参考。

### 四、建议优先级

| 优先级 | 建议 | 预期收益 |
|--------|------|----------|
| P0 | 子 Agent 持久化 + Resume | 解决"中断后重跑"痛点 |
| P1 | 上下文压缩 | 避免长 session token 溢出 |
| P1 | 动态注入系统 | 减少 agent system prompt 冗余 |
| P2 | 输出摘要续写 | 子 agent 通信质量保证 |
| P2 | Plan Mode 只读模式 | iFlow planning 阶段安全增强 |
| P3 | YAML Agent Spec | 可扩展性提升 |
| P3 | Approval 审批系统 | 安全性 |
| P4 | D-Mail 时间旅行 | 错误恢复 |
| P4 | DAG Flow Skills | 复杂工作流 |

**核心建议**：优先引入**子 Agent 持久化/Resume**和**上下文压缩**，这两项直接解决用户在使用 iFlow/SFlow 过程中遇到的实际痛点（中断恢复、token 超限），且与现有架构兼容性较高。
