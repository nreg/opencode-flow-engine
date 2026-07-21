# Opencode-Flow-Engine — OpenCode 工作流编排插件

**English** | [**简体中文**](./README.zh.md)

OpenSpec 规划引擎 + Superpowers 执行纪律 + GSD 迭代循环，集成于 OpenCode 插件。

opencode-flow-engine 提供两种互补的工作流模式：

- **sFlow** — 线性工作流：需求 → 规划 → 实现 → 审查 → 调试 → 归档
- **iFlow** — 迭代工作流：GSD 循环：讨论 → 研究 → 规划 → 执行 → 验证 → 发布 → 循环

---

## 目录

- [快速开始](#快速开始)
- [工作流选择](#工作流选择)
- [sFlow 工作流](#sflow-工作流)
- [iFlow 工作流](#iflow-工作流)
- [智能体](#智能体)
- [前端 UI 设计系统](#前端-ui-设计系统)
- [工具](#工具)
- [执行模式](#执行模式)
- [执行纪律](#执行纪律)
- [功能特性](#功能特性)
- [配置](#配置)
- [项目结构](#项目结构)
- [致谢](#致谢)

---

## 快速开始

```bash
npm install -g opencode-flow-engine
```

在 `opencode.json` 中添加：

```json
{
  "plugin": ["opencode-flow-engine"]
}
```

然后开始对话：

```
"开始一个新功能"  → sFlow（线性、文档先行）
"开始一个迭代"    → iFlow（循环、快速迭代）
```

---

## 工作流选择

| 工作流 | 适用场景 | 形状 | 智能体颜色 |
|--------|---------|------|-----------|
| **sFlow** | 复杂功能、严格门禁、文档先行 | 线性（9 状态） | `#f8cd93` |
| **iFlow** | 快速迭代、研究驱动、持续交付 | 循环（6 状态） | `#FFB6C1` |

**选择建议**：复杂功能（3+ 文件、跨模块、DB schema）→ sFlow。快速修复、小功能 → iFlow。不确定 → 从 sFlow 开始。

---

## sFlow 工作流

9 个状态按顺序执行：

| # | 状态 | 子智能体 | 产物 | 关卡 |
|---|------|---------|------|------|
| 1 | **exploring**（探索） | need-explorer | 澄清的需求 | 用户确认 |
| 2 | **specifying**（规格说明） | spec-writer | proposal.md, specs/, design.md, tasks.md | 产物校验 |
| 3 | **ui-design**（UI 设计）* | **ui-director** | ui-design.md | UI Token 校验 |
| 4 | **bridging**（桥接） | contract-builder | execution-contract.md | 合约校验 |
| 5 | **approved-for-build**（批准构建） | — | 已批准的合约 | 用户批准 |
| 6 | **executing**（执行） | build-executor | 实现的代码 | 测试通过, 审查通过 |
| 7 | **debugging**（调试） | bug-investigator | Bug 报告, 修复 | 问题解决 |
| 8 | **closing**（关闭） | release-archivist | 验证报告 | 全部检查通过 |
| 9 | **abandoned**（废弃） | — | — | 终止状态 |

> \* ui-design 状态仅对前端项目自动启用。使用 **ui-director** 子智能体（而非 spec-writer）引导 7 步美学决策流程，内置 71 个品牌设计参考和 9 项前端技能。

### 自动状态修复

每次上下文恢复时，sFlow 检测产物/状态不一致并自动修复：

| 状态文件说 | 产物显示 | 自动修复 |
|-----------|---------|---------|
| `exploring` | proposal.md 存在 | → `specifying` |
| `specifying` | design.md + tasks.md 已生成 | → `bridging` |
| `bridging` | execution-contract.md 已批准 | → `approved-for-build` |
| `executing` | 所有任务已完成 | → `closing` |

---

## iFlow 工作流

6 个状态形成持续循环：

| # | 状态 | 子智能体 | 产物 | 关卡 |
|---|------|---------|------|------|
| 1 | **discussing**（讨论） | iflow-discuss-planner | 澄清的需求、用户决策 | 用户确认 |
| 2 | **researching**（研究） | iflow-researcher | CONTEXT.md（目标、约束、发现） | 研究完成 |
| 3 | **planning**（规划） | iflow-discuss-planner | PLAN.md（XML 任务、波次依赖） | 计划校验 |
| 4 | **executing**（执行） | iflow-plan-executor | 实现的代码 | 测试通过、偏差已处理 |
| 5 | **verifying**（验证） | iflow-verifier | VERIFICATION.md（BLOCKER/WARNING） | 全部检查通过 |
| 6 | **shipping**（发布） | iflow-shipper | UAT.md、PR/分支 | 发布完成，回到 discuss |

### 与 sFlow 的关键差异

| 维度 | sFlow | iFlow |
|------|-------|-------|
| 流程形状 | 线性（终止于 closed/abandoned） | 循环（回到 discuss） |
| 产物 | proposal, specs, design, tasks, contract | CONTEXT, PLAN, SUMMARY, VERIFICATION, UAT |
| 状态目录 | `.flow-engine/sflow/` | `.iflow/` |
| 方法论 | OpenSpec + Superpowers | GSD（Get Stuff Done） |
| 验证方式 | 基于合约的校验 | 对抗性验证 |
| 范围控制 | guard hook 强制 | agent prompt 声明 |

---

## 智能体

### sFlow 智能体（11 个）

| 智能体 | 模式 | 说明 |
|--------|------|------|
| **sFlow** | 主编排器 | 状态检测 → 子智能体路由，不写代码 |
| **need-explorer** | 子智能体 | 结构化提问澄清需求 |
| **spec-writer** | 子智能体 | 生成 proposal、specs、design、tasks |
| **ui-director** | 子智能体 | **前端项目**：7 步美学决策，71 品牌参考，产出 ui-design.md |
| **contract-builder** | 子智能体 | 创建执行合约，含边界控制、测试计划 |
| **build-executor** | 子智能体 | TDD/SDD 执行器，3 种执行模式（inline/batch-inline/SDD） |
| **bug-investigator** | 子智能体 | 系统化调试，根因分析，修复验证 |
| **code-reviewer** | 子智能体 | Spec 合规 + 代码质量审查。强制**最小化审查纪律**（5 道门禁） |
| **release-archivist** | 子智能体 | 验证、归档、关闭变更 |
| **spec-merger** | 子智能体 | 增量规格变更合并 |
| **ui-implementer** | 子智能体 | 前端 UI 实现专家 |

### iFlow 智能体（6 个）

| 智能体 | 模式 | 说明 |
|--------|------|------|
| **iFlow** | 主编排器 | 循环工作流总控，6 状态编排 |
| **iflow-discuss-planner** | 子智能体 | 讨论 + 规划：需求澄清、PLAN.md 生成 |
| **iflow-plan-executor** | 子智能体 | 4 条偏差规则执行器。可委托前端任务给 `ui-implementer` |
| **iflow-verifier** | 子智能体 | 对抗性验证：目标反向验证、BLOCKER/WARNING 分类 |
| **iflow-researcher** | 子智能体 | 技术研究：发现等级、工具优先级链、置信度标记 |
| **iflow-shipper** | 子智能体 | PR 创建、UAT.md 生成、分支生命周期管理 |

### 路由原则

- **NEVER** 自己实现代码 — 总是委托给子智能体
- **NEVER** 跳过状态 — 必须按顺序通过管线
- **NEVER** 自己批准自己的合约 — 用户必须批准
- **NEVER** 未经验证就关闭 — release-archivist 必须先验证

---

## 前端 UI 设计系统

opencode-flow-engine 内置了完整的前端 UI 设计系统，贯穿从美学方向到生产代码交付的全流程。

### ui-director：美学决策引擎

前端项目自动在 `specifying` 和 `bridging` 之间插入 `ui-director` 子智能体，引导 **7 步美学决策流程**：

```
Step 1: 调性确认        → 从 71 品牌参考或 9 抽象调性卡片中选择
Step 2: 4 问美学框架      → 目的、调性、约束、差异化
Step 3: Brownfield 对齐  → 提取现有视觉语汇（7 维度）
Step 4: 5 维决策矩阵      → 字体、颜色（OKLCH）、动效、空间、质感
Step 5: v0 草稿确认      → 用户确认后再写完整文档
Step 6: 写 ui-design.md  → 结构化输出，含 frontmatter tokens
Step 7: 反 AI-slop 检查  → 8 类 42 条规则
```

**71 品牌设计参考**：内置 Apple、Stripe、Linear、Notion、Claude、Ferrari 等 71 个品牌的完整设计系统。每个包含完整色板、字体层级和交互模式。用户选择参考品牌后自动继承设计 token，再在 Step 4 中微调。

### ui-implementer：9 项前端技能融合

`ui-implementer` 子智能体在运行时加载 9 项前端专业技能，每项提供领域特定的规则和模式：

| 阶段 | 加载技能 | 作用 |
|------|---------|------|
| 设计解读 | `taste-skill` | 美学方向、反 AI-slop、设计阅读 |
| 设计系统 | `shadcn-ui` + `ui-ux-pro-max` | 组件库主题、95+ 色板、56 字体配对 |
| 组件实现 | `frontend-design-pro` + `svg-architect` | 组件布局、SVG 图标设计 |
| 质量检查 | `polish` + `frontend-code-review` + `impeccable` + `frontend-performance-optimization` | 间距/对齐、代码审查、生产标准、Core Web Vitals |

**交付自检清单**：10 项提交前验证（console.log 清除、交互状态完备、无硬编码颜色、响应式适配、无障碍等）。

### UI 设计验证

`validate_ui_design` 工具检查 ui-design.md 的 7 项质量门禁：

| 检查 | 规则 | 严重度 |
|------|------|--------|
| V1 | 颜色格式（必须 OKLCH，不能纯 HEX） | ERROR |
| V2 | 字体合规（不能使用 AI 默认字体） | WARNING |
| V3 | 调性声明（frontmatter 必须指定 tone） | ERROR |
| V4 | 组件覆盖（≥5 类组件） | WARNING |
| V5 | 占位符策略章节存在 | ERROR |
| V6 | 反 AI-slop 覆盖（≥6/8 类） | WARNING |
| V7 | WCAG AA 无障碍指南 | ERROR |

---

## 工具

### 原生工具

| 工具 | 说明 |
|------|------|
| `workflow_router` / `iflow_router` | 状态检测和子智能体路由 |
| `call_flow_agent` | **核心**：向子智能体委派任务（同步/异步） |
| `flowagent_output` / `flowagent_cancel` | 异步任务管理 |
| `contract_validator` / `artifact_inspector` | 产物校验 |
| `record_decision_point` | 决策点记录（DP-0 至 DP-5） |
| `record_execution_plan` | 波次执行计划创建 |
| `record_review_receipt` | 波次审查结果持久化 |
| `validate_ui_design` | UI 设计质量验证（7 项检查） |

### 产物校验工具集

`validate_spec`、`validate_proposal`、`validate_delta_spec`、`validate_tasks`、`validate_contract`、`validate_design`、`validate_implementation`、`detect_sync_conflicts`

### oh-my-openagent 工具（可选集成）

当同时安装 oh-my-openagent 时，sFlow 自动启用：

| 工具 | 使用场景 |
|------|---------|
| `call_omo_agent` | 并行代码库探索（explore）+ 文档研究（librarian） |
| `task` | 基于类别的委托，带模型选择和技能注入 |

> 未安装 oh-my-openagent 时，sFlow 完全通过 `call_flow_agent` 正常工作，无需任何配置。

---

## 执行模式

`build-executor` 根据任务数量和依赖分析自动选择三种模式之一：

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| **Inline** | ≤3 任务，无跨模块依赖 | 当前 agent 直接实现（TDD 适用） |
| **Batch Inline** | 3-5 任务，同模块，无 API 变更 | 一次完成整个批次，每步 TDD |
| **SDD** | 6+ 任务、跨模块、或有依赖链 | 每任务子智能体 + 审查收据 + 最终审查 |

### 预设升级机制

执行过程中，sFlow 持续监控范围。超阈值时自动升级：

| 预设 | 降级条件 | 升级触发 |
|------|---------|---------|
| **hotfix** | ≤2 文件，无架构变更 | 3+ 文件、DB schema → 自动升级到 `full` |
| **tweak** | ≤4 配置文件，无代码变更 | 5+ 文件、跨模块 → 自动升级到 `full` |
| **full** | — | 标准流程 |

---

## 执行纪律

### TDD 铁律

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

| 阶段 | 操作 | 证据 |
|------|------|------|
| **RED** | 编写会失败的测试 | 运行测试，确认因预期原因失败 |
| **GREEN** | 编写最小生产代码 | 测试通过（所有其他测试仍通过） |
| **REFACTOR** | 在测试保持绿色时清理代码 | 完整测试套件仍然通过 |

### 文件边界控制

每个任务在执行合约中声明 `read_files`（参考边界）和 `write_files`（修改边界）。提交前自动执行 `git diff --name-only` 验证，防止范围蔓延。

### 失败经验记录

```
.flow-engine/sflow/lessons.md  — 每次调试退出时自动写入，每个任务开始前自动扫描
```

### 检查点与移交

```
.flow-engine/sflow/subagent-progress.md   — 节点状态（implementing/review/done）
.flow-engine/sflow/checkpoints/           — 结构化检查点，含提交证据
.flow-engine/sflow/handoffs/              — 跨会话移交合约
.flow-engine/sflow/progress.md            — 批次完成进度
```

### 执行控制平面

SDD 模式通过 `.flow-engine/sflow/execution-plan.json` 编排：

- **波次调度**：任务按波次分组，支持 serial/parallel 策略和 depends_on 依赖
- **波次依赖校验**：Guard 钩子在执行前检测循环依赖
- **审查收据**：持久化到 `.flow-engine/sflow/reviews/<wave-id>.json`，含提交范围证据
- **三重哈希校验**：content_hash + artifacts_hash + contract_hash 完整性检查
- **关闭门禁**：所有波次审查必须通过才能进入关闭状态

---

## 功能特性

### 工作流管理
- 9 状态 sFlow + 6 状态 iFlow，自动状态检测与路由
- 守卫条件防止非法状态转换
- 自动状态修复（artifact ↔ state 不一致时自动修复）
- 前后端项目自适应（前端自动插入 ui-design 状态）

### 增量规格管理
- 跟踪每个变更的 ADDED/MODIFIED/REMOVED/RENAMED 规格
- 自动检测跨变更的规格同步冲突
- spec-merger 在关闭时合并增量规格

### 钩子系统

| 钩子 | 触发时机 | 说明 |
|------|---------|------|
| `state_transition` | 状态转换时 | 记录转换日志 |
| `artifact_validation` | 工具执行后 | 校验产物完整性 |
| `guard` | 工具执行前 | 阻止非法操作 |
| `pre_process` | 消息处理前 | 注入上下文 |
| `post_process` | 工具执行后 | 检测状态转换信号 |
| `continuation` | 上下文压缩后 | 决定是否自动继续 |

### 模型 Profile

4 层模型解析：`override → config → profile → fallback → default`

| Profile | 用途 | 典型智能体 |
|---------|------|-----------|
| `mechanical` | 快速廉价 | release-archivist |
| `standard` | 均衡 | sFlow, need-explorer, ui-implementer |
| `strong` | 强力 | spec-writer, contract-builder, build-executor |
| `review` | 审查专用 | code-reviewer |

---

## 配置

### OpenCode 配置

```json
{
  "plugin": ["opencode-flow-engine"]
}
```

同时安装 oh-my-openagent：

```json
{
  "plugin": ["oh-my-openagent", "opencode-flow-engine"]
}
```

### 项目配置

```bash
# 项目级（推荐）
sflow init

# 用户级全局
sflow init --user
```

### 自定义智能体模型

```json
{
  "version": "0.1.0",
  "mode": "full",
  "agents": {
    "sFlow": { "model": "your-provider/glm-5.2", "temperature": 0.6 },
    "iFlow": { "model": "your-provider/deepseek-v4-flash", "temperature": 0.6 },
    "need-explorer": { "model": "your-provider/step-3.7-flash", "temperature": 0.6 },
    "spec-writer": { "model": "your-provider/glm-5.1", "temperature": 0.6 },
    "ui-director": { "model": "your-provider/glm-5.1", "temperature": 0.7 },
    "contract-builder": { "model": "your-provider/glm-5.1", "temperature": 0.6 },
    "build-executor": { "model": "your-provider/glm-5.1", "temperature": 0.7 },
    "bug-investigator": { "model": "your-provider/minimax-m2.7", "temperature": 0.6 },
    "code-reviewer": { "model": "your-provider/glm-5.1", "temperature": 0.6 },
    "release-archivist": { "model": "your-provider/glm-5.1", "temperature": 0.7 },
    "spec-merger": { "model": "your-provider/glm-5.1", "temperature": 0.7 },
    "ui-implementer": { "model": "your-provider/glm-5.1", "temperature": 0.6 },
    "iflow-discuss-planner": { "model": "your-provider/kimi-k2.6", "temperature": 0.6 },
    "iflow-plan-executor": { "model": "your-provider/glm-5.1", "temperature": 0.6 },
    "iflow-verifier": { "model": "your-provider/minimax-m2.7", "temperature": 0.6 },
    "iflow-researcher": { "model": "your-provider/glm-5.1", "temperature": 0.7 },
    "iflow-shipper": { "model": "your-provider/glm-5.1", "temperature": 0.6 }
  },
  "modelProfiles": {
    "mechanical": "your-provider/step-3.7-flash",
    "standard": "your-provider/glm-5.1",
    "strong": "your-provider/glm-5.1",
    "review": "your-provider/glm-5.1"
  }
}
```

配置加载优先级：项目级 `.flow-engine/sflow/config.json` → 用户级 `~/.config/opencode/opencode-flow-engine.json`

---

## 项目结构

```
opencode-flow-engine/
├── packages/
│   ├── core/                    # 模式、校验、解析引擎
│   ├── plugin-infra/            # 插件基础设施
│   │   └── src/
│   │       ├── agents/          # 构建器、类型、配置加载
│   │       ├── hooks/           # 6 类生命周期钩子 + 守卫
│   │       ├── tools/           # 工具定义和实现
│   │       ├── features/        # 工作流管理器、状态管理器、MCP
│   │       └── helpers/         # 辅助函数
│   └── shared/                  # 共享工具函数
├── workflows/
│   ├── sflow/                   # SFlow 工作流
│   │   ├── agents/              # 11 个 agent 工厂
│   │   ├── skills/              # 22 个技能定义（13 sFlow + 9 前端 UI）
│   │   └── templates/           # 产物模板（含 UI-DESIGN.md）
│   └── iflow/                   # IFlow 工作流
│       ├── agents/              # 6 个 agent 工厂
│       ├── skills/              # 技能定义
│       └── templates/           # 产物模板
├── sflow-plugin.ts              # SFlow 专属 PluginModule
├── iflow-plugin.ts              # IFlow 专属 PluginModule
├── shared-plugin.ts             # 组合 PluginModule（默认导出）
├── docs/                        # 技术文档
└── config.example.json          # 配置示例
```

---

## 致谢

- [OpenCode](https://github.com/anomalyco/opencode) — 运行平台、插件机制
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) — 规划引擎
- [Superpowers](https://github.com/obra/superpowers) — 执行纪律
- [GSD](https://github.com/telestrial-org/get-shit-done) — iFlow 迭代方法论来源
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) — 架构灵感 + 可选集成
- [spec-superflow](https://github.com/MageByte-Zero/spec-superflow) — 验证引擎移植来源
- [flow-kit](https://github.com/rihebty/flow-kit) — UI 设计方法论参考（2a-ui-design、反 AI-slop、brownfield 对齐）
- [grill-me](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling) — 需求澄清方法论
- [getdesign.md](https://getdesign.md) — 71 品牌设计系统参考