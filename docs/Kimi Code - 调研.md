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
