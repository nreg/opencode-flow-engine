# IFlow 共享上下文

> 所有 IFlow 代理在开始工作前应先阅读并内化此文件。
> 包含 IFlow 状态机、代理映射和所有代理共享的核心原则。

## 状态机定义

IFlow 工作流有 6 个循环状态：

| # | 状态 | 说明 |
|---|------|------|
| 1 | **discussing** | 讨论/澄清需求，捕获用户决策 |
| 2 | **researching** | 研究技术方案，产出 CONTEXT.md |
| 3 | **planning** | 制定执行计划，产出 PLAN.md |
| 4 | **executing** | 执行实现，产出 SUMMARY.md |
| 5 | **verifying** | 对抗性验证，产出 VERIFICATION.md |
| 6 | **shipping** | 发布交付，产出 UAT.md |

## 状态转换规则

```
discussing ──→ researching
researching ──→ planning | discussing
planning ────→ executing | researching
executing ───→ verifying | planning
verifying ───→ shipping | executing
shipping ────→ discussing（下一轮迭代）
```

## 代理映射

| 状态 | 子代理 | 产出物 |
|------|--------|--------|
| discussing | iflow-discuss-planner | 已澄清需求、用户决策 |
| researching | iflow-researcher | CONTEXT.md |
| planning | iflow-discuss-planner | PLAN.md |
| executing | iflow-plan-executor | SUMMARY.md（含偏差记录） |
| verifying | iflow-verifier | VERIFICATION.md（BLOCKER/WARNING） |
| shipping | iflow-shipper | UAT.md、PR |

## 核心原则

### 1. 范围缩减禁止
禁止在计划或实现中使用以下语言模式减少需求范围：
- "v1"、"v2"、"简化版"、"静态版"、"硬编码版"
- "后续增强"、"占位符"、"基础版"、"最小实现"
- "后续接入"、"动态版留待后续"、"暂跳过"
- 任何将已声明的需求缩减为不完整实现的表述

如果需求说"从账单表计算成本并展示"，计划必须交付从账单表计算成本的逻辑，而不是"静态标签"。

### 2. 多重来源覆盖审计
最终确定任何规划前，对以下四类来源执行覆盖审计：
- **GOAL**: 用户想达成的目标
- **REQ**: 用户明确声明的需求
- **RESEARCH**: 研究员发现的技术方案
- **CONTEXT**: 已锁定的用户决策

每个来源的每项内容必须有对应任务覆盖。如有遗漏，不得静默关闭——必须向用户展示选项（新增任务/拆分阶段/延期确认）。

### 3. 对抗性验证立场
假设阶段目标**未达成**，直到代码库证据证明它已达成：

1. **什么必须为真？**（可观察的行为）
2. **什么必须存在？**（具体的文件路径）
3. **什么必须接入？**（组件间的连接）

分类：
- **BLOCKER**: 必须为真的事实被证伪；阶段目标未达成
- **WARNING**: 必须为真的情况不确定，或工件存在但接入不完整

### 4. 偏差规则（执行器使用）
执行计划时必须自动遵循以下规则：

| 规则 | 触发条件 | 操作 |
|------|----------|------|
| **规则 1** | 代码不能按预期工作 | 自动修复 bug，补充测试 |
| **规则 2** | 缺少关键功能（正确性/安全/基本操作） | 自动补全，不询问 |
| **规则 3** | 阻塞性问题（缺失依赖/类型错误/导入断裂） | 自动修复，继续执行 |
| **规则 4** | 需要架构变更（新表/重大模式变更/切换库） | STOP → 询问用户 |

### 5. 原子提交纪律
- 每个任务一个原子提交
- 按文件逐个 `git add`，禁止 `git add .`
- 提交格式：`{type}({scope}): {description}`
- 类型：feat（新功能）/ fix（修复）/ test（测试）/ refactor（重构）/ docs（文档）

### 6. 复杂性过载反馈
执行器可能返回过载信号。编排器应检测并路由回规划：

| 信号 | 操作 |
|------|------|
| `[IFLOW-OVERLOAD]` XL 任务 | 路由回 discuss-planner 重新规划 |
| `[IFLOW-COMPLEXITY]` L 检查点 | 检查检查点输出，继续或路由回验证 |
| `[IFLOW-COMPLEXITY-DRIFT]` M→L | 路由回 discuss-planner，复杂度被低估 |

同一范围连续 2 次过载→重新规划循环后，停止并向用户展示选项。
