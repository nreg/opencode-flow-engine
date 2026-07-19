# flow-kit Agent 工作流程分析

---

## 一、整体入口

```
@flow-kit/GO.md  (统一入口)
    │
    ├── 1. 读取 STATE.md（项目状态 / 中断任务）
    ├── 2. 解析用户意图 → 路由到对应阶段
    ├── 3. 老项目入场检测（brownfield → intel-scan）
    ├── 4. Artifact Preflight Gate（检查上游工件齐全）
    └── 5. 执行阶段 prompt
```

---

## 二、核心流程（9 阶段 · artifact-driven 流水线）

```
0-change → 1-requirement → 2-design → [2a-ui-design]* → 3-task
    → 4-dev (逐任务循环)
    → 5-test → 6-review → 7-integration → ARCHIVE
    ↓
回到 0-change (迭代循环)
```

---

## 三、各阶段详解

### 阶段 0：CHANGE — 模糊想法 → 变更提案

| 项目 | 内容 |
|------|------|
| 角色 | 产品/技术对接人 |
| 入口 | GO.md 路由到 `prompts/0-change.md` |
| 输入 | 用户一句话想法 |
| 核心动作 | ① 自动生成 change-id → ② 架构级变更检测（0.4）→ ③ 前端识别（0.5）→ ④ 视觉调性预选（0.6）→ ⑤ 反问澄清 → ⑥ 影响面判定 → ⑦ 写 CHANGE.md |
| 输出 | `.specs/<change-id>/CHANGE.md` |
| 门禁 | 不允许跳过反问直接出方案；不允许写实现细节 |

### 阶段 1：REQUIREMENT — 变更提案 → 可执行需求

| 项目 | 内容 |
|------|------|
| 角色 | 需求分析师 + 域语言守门员 |
| 输入 | CHANGE.md + CONTEXT.md |
| 核心动作 | ① 写用户故事 + AC（Given/When/Then）→ ② 范围切分 v1/v2/out → ③ 提取域语言到 CONTEXT.md |
| 输出 | `.specs/<change-id>/REQUIREMENT.md` + `.specs/CONTEXT.md` |
| 门禁 | 没有 CHANGE.md 不能进；AC 必须可验证 |

### 阶段 2：DESIGN — 技术设计 + ADR

| 项目 | 内容 |
|------|------|
| 角色 | Architect（红线：不写实现代码） |
| 输入 | REQUIREMENT.md + CONTEXT.md + ARCHITECTURE.md |
| 核心动作 | ① 架构级变更预检（0₋）→ ② 技术栈预选 5~6 卡片 → ③ 既有架构对齐（0.5，brownfield 护栏）→ ④ 技术决策 + ADR → ⑤ 数据流/架构图 → ⑥ 风险清单 → ⑦ §9 架构沉淀建议 |
| 输出 | `.specs/<change-id>/DESIGN.md` + N 个 `.specs/adr/<NNN>.md` |
| 门禁 | 每条决策给理由+取舍；禁止完整代码实现 |

### 阶段 2a：UI-DESIGN — 视觉美学方向（仅前端项目）

| 项目 | 内容 |
|------|------|
| 角色 | UI Director |
| 输入 | CHANGE.md + REQUIREMENT.md + DESIGN.md |
| 核心动作 | ① greenfield/brownfield 判定 → ② brownfield 视觉语汇对齐（1.5）→ ③ 美学期权决策（5 维度：字体/颜色/动效/空间/质感）→ ④ v0 草稿确认 → ⑤ Design Tokens（OKLCH）→ ⑥ 组件规约 → ⑦ 占位符策略 → ⑧ 反 AI-slop 自检 |
| 输出 | `.specs/<id>/UI-DESIGN.md` |
| 门禁 | 颜色必须 OKLCH；禁止编造数据；v0 必须经用户确认 |

### 阶段 3：TASK — 拆原子任务

| 项目 | 内容 |
|------|------|
| 角色 | Planner |
| 输入 | REQUIREMENT.md + DESIGN.md + CONTEXT.md |
| 核心动作 | ① 按文件冲突切（不按层）→ ② 每任务 7 字段：id/name/read_files/write_files/action/verify/done → ③ 波次划分（[P] 并行标记）→ ④ 依赖图 |
| 输出 | `.specs/<change-id>/TASK.md`（XML 格式任务块 + 波次图） |
| 门禁 | 每任务必须有可执行 verify；`write_files` 必须在 DESIGN 范围内 |

### 阶段 4：DEV — 执行单个任务（最密集的阶段）

| 项目 | 内容 |
|------|------|
| 角色 | Dev（每任务一个 fresh context） |
| 输入 | TASK.md 中的当前 task + DESIGN.md + CONTEXT.md + LESSONS.md |
| 核心动作（子步骤） | |
| 1.4 | 沿用既有抽象 grep（R6.4/B5 护栏）— 写代码前必 grep 同类抽象 |
| 1.5 | 扫 LESSONS 失败知识库（R1.8）— 避免重复踩坑 |
| 1.6 | UI 任务额外检查 — 读 UI-DESIGN.md + 反 AI-slop 清单 |
| 1.7 | Schema 变更检查（R4.5）— 生成迁移文件 + 检测 DB 凭据 |
| 1.8 | 破坏性变更协议（R4.6/B4 护栏）— 删 ≥5 行/改公共接口必 grep 引用图 + 问用户 |
| 2 | TDD 循环（RED → GREEN → REFACTOR） |
| 3 | 跑 verify |
| 4 | Self-review（6 维代码质量自查） |
| 5 | 提交前 diff 边界 verify（R6.5/B3 护栏）— 检查是否越界写文件 |
| 5.5 | 原子提交 |
| 6 | 写 SUMMARY.md |
| 输出 | 代码 + `.specs/<id>/<task-id>-SUMMARY.md` |
| 门禁 | verify 不过不能算完成；禁止越界改文件；禁止改 REQUIREMENT.md/DESIGN.md |

### 阶段 5：TEST — 五轮测试金字塔

| 项目 | 内容 |
|------|------|
| 角色 | Test Engineer |
| 输入 | REQUIREMENT.md + DESIGN.md + TASK.md + 各 SUMMARY.md |
| 核心动作 | ① 声明本 change 走哪几轮 → ② 功能测试（AC 映射 + 覆盖率）→ ③ 性能测试（Lighthouse/k6）→ ④ 安全测试（依赖/秘钥/SAST/OWASP）→ ⑤ 兼容性测试（跨浏览器/数据迁移）→ ⑥ 可观测性验证（日志/指标/告警） |
| 输出 | `.specs/<change-id>/TEST.md` |
| 门禁 | 不能跳过任何轮次却没有理由；AC 覆盖优先于行覆盖 |

### 阶段 6：REVIEW — 三轮审查

| 项目 | 内容 |
|------|------|
| 角色 | Reviewer（红线：不直接改代码） |
| 输入 | REQUIREMENT.md + DESIGN.md + TASK.md + TEST.md + git diff |
| 核心动作 | 第一轮：Spec 合规审查（AC 是否实现）→ 第二轮：代码质量 6 维衰退诊断（书本驱动）→ 第三轮：UI 视觉审查（前端项目）→ 第四轮可选：技术债评估 + 跨模型 spot-check |
| 输出 | `.specs/<change-id>/REVIEW.md` + 修复任务追加到 TASK.md |
| 门禁 | Critical 必须修复或人工接受；不允许笼统结论 |

### 阶段 7：INTEGRATION — 集成验证 + UAT + 归档

| 项目 | 内容 |
|------|------|
| 角色 | Verifier + Release |
| 输入 | 全部已有产物 |
| 核心动作 | ① 跑全量自动化 → ② 引导人工 UAT → ③ 失败诊断（最多 3 轮）→ ④ 提名 LESSONS → ⑤ 归档到 `.specs/archive/` → ⑥ 更新 CHANGELOG |
| 输出 | UAT.md + 归档产物 + 更新 CHANGELOG/STATE.md |
| 门禁 | UAT 失败最多重试 3 轮 |

---

## 四、与 OpenCode iFlow/SFlow 的关键差异

| 维度 | flow-kit | iFlow (OpenCode) |
|------|----------|-------------------|
| 本质 | 纯 markdown 文档方法论 | 代码化的子代理状态机 |
| 运行时 | 无，纯 @ 引用文件 | 有状态机 + 子代理调用 |
| 状态管理 | STATE.md + 工件文件 | 内置状态机（6 状态循环） |
| 子代理 | 同模型扮演不同角色（Architect/Dev/Reviewer） | 不同子代理（iflow-researcher/executor/verifier） |
| token 策略 | 每阶段 fresh context，靠 `.md` 传递状态 | 每个状态切换清窗，工件传递 |
| 护栏 | 9 条硬规则（R1-R8）+ 5 条老项目护栏（B1-B5） | Scope Reduction 禁止 + 偏差规则 |
| 入口 | `@GO.md` + 一句话意图 | `call_flow_agent` 工具调用 |
| 测试 | 5 轮金字塔（功能/性能/安全/兼容/可观测） | 单轮 adversary verification |
| 前端 | 专用 2a-ui-design 阶段 + 反 AI-slop 清单 | 无专门前端阶段 |

---

## 五、核心设计理念

1. **Artifact-first，not phase-gated** — 阶段可压缩，但 `.md` 工件不能缺席
2. **每个阶段一次 fresh context** — 靠文件传递状态，不靠对话堆叠
3. **任务必带 verify** — 每任务有可执行的验证命令
4. **审查至少两轮** — Spec 合规 + 代码质量
5. **失败是输入不是终点** — UAT 失败自动产 fix-plan，最多 3 轮
6. **老项目 5 道护栏（B1-B5）** — 防 AI 不按架构写、乱删代码、越界改文件

---

## 六、SFlow vs flow-kit 完整对比

### 1. 架构本质

| 维度 | SFlow | flow-kit |
|------|-------|----------|
| 本质 | TypeScript 插件，代码化工作流引擎 | 纯 markdown 文档方法论 |
| 运行时 | 依赖 OpenCode 插件运行时（hook/MCP/tool） | 无运行时，靠 AI IDE 的 @ 引用文件 |
| 执行保障 | 代码级强制（hook 拦截、guard 阻断） | 靠 AI 自觉遵守规则（无强制门禁） |
| 安装方式 | `npm install` + opencode.json 配置 | 复制文件夹到项目根目录 |
| IDE 兼容 | 仅 OpenCode 插件 | Windsurf/Cursor/Claude Code/Copilot/Codex 全部通用 |

### 2. 工作流状态对比

```
SFlow (9 状态)                           flow-kit (9 阶段)
========================                 ========================
exploring  ← 需求澄清                   0-change  ← 变更提案
    ↓                                       ↓
specifying ← 规格生成                   1-requirement ← 需求分析
    ↓                                       ↓
[ui-design] ← UI 设计 (前端)             2-design ← 技术设计
    ↓                                       ↓
bridging  ← 执行契约构建                   2a-ui-design ← UI 设计 (前端)
    ↓                                       ↓
approved-for-build ← 用户批准               3-task ← 任务拆解
    ↓                                       ↓
executing ← 执行实现                     4-dev ← 逐任务实现 (循环)
    ↓                                       ↓
debugging ← 调试模式                     5-test ← 五轮测试金字塔
    ↓                                       ↓
closing ← 关闭归档                       6-review ← 三轮审查
    ↓                                       ↓
abandoned ← 终止状态                     7-integration ← 集成+归档
                                             ↓
                                         回到 0-change (迭代)
```

**关键差异：**

- SFlow 有 `debugging` 和 `abandoned` 两个独立状态；flow-kit 没有，调试归入 4-dev 的失败诊断
- flow-kit 的 5-test 和 6-review 是独立阶段；SFlow 的测试和审查内嵌在 executing 的子代理循环中
- SFlow 有 `approved-for-build` 显式批准门禁；flow-kit 的批准隐含在用户确认 CHANGE.md/REQUIREMENT.md 中

### 3. 子代理 / 角色体系

| 维度 | SFlow | flow-kit |
|------|-------|----------|
| 子代理数 | 10 个独立 subagent | 0 个（同模型扮演不同角色） |
| 架构模式 | 工厂模式 `createXXXAgent()` | 角色切换（Architect/Dev/Reviewer） |
| 子代理列表 | need-explorer, spec-writer, contract-builder, build-executor, bug-investigator, code-reviewer, release-archivist, spec-merger, ui-implementer + sFlow 编排器 | 无子代理，同一模型依次扮演（Architect → UI Director → Planner → Dev → Reviewer → Verifier） |
| 调用方式 | `call_flow_agent` 工具 + 同步/异步模式 | 清窗 + 重新加载 `.md` 文件 |
| 上下文隔离 | 每个 subagent 独立 session | 每个阶段/任务 fresh context |

> **SFlow 优势**：真正的多代理并行，每任务可独立模型、独立 session
> **flow-kit 优势**：不依赖运行时，任何 AI IDE 都能用

### 4. 执行模式

| 维度 | SFlow | flow-kit |
|------|-------|----------|
| 执行模式 | 3 种：inline / batch-inline / SDD（子代理驱动） | 1 种：每任务 fresh context |
| 模式选择 | 自动推荐（任务数+依赖+风险）+ 用户覆盖 | 无自动选择，计划由人决定 |
| 波次 (Wave) | 正式执行计划结构，含 wave 依赖图 + 拓扑排序 | TASK.md 中有波次划分图，但无正式执行计划 |
| Review 收据 | `record_review_receipt` 工具持久化到 `.sflow/reviews/` | 无收据机制，review 结果在 REVIEW.md 中 |
| 预设升级 | hotfix/tweak 执行中超阈值自动升级到 full | 无预设模式概念 |

### 5. 门禁系统

| 门禁 | SFlow | flow-kit |
|------|-------|----------|
| 实现方式 | Hook 系统代码级拦截（tool.execute.before） | 靠 AI 自觉遵守的 RULES.md |
| Artifact Preflight | `checkArtifactAndPhaseConsistency` 自动检测 | R2.7 规则：进入阶段前必须检查 |
| 文件边界控制 | `checkFileWriteGuard` + `checkReadFilesBoundary` + `checkGitCommitBoundary`（代码级拦截越界写） | R6.5 + R7.3：提交前 diff 边界 verify |
| 契约过期检测 | `checkContractStalenessGuard`（哈希校验） | 无 |
| 反重复协议 | `checkProgressAntiRepeatGuard` | R1.5/R1.6 PROGRESS.md |
| LESSONS 检查 | `checkLessonsGuard` | R1.8 每个 DEV 任务前必扫 |
| OMO 使用检查 | `checkOmoUsageGuard` | 无 |
| 任务完成检查 | `checkTaskCompletion` | 无强制检查 |
| 调试状态检查 | `checkDebuggingState` | 无 |

> **SFlow 优势**：代码级强制保障，AI 无法绕过
> **flow-kit 优势**：轻量、跨平台，任何 AI 都能遵守

### 6. 测试体系

| 维度 | SFlow | flow-kit |
|------|-------|----------|
| 测试哲学 | TDD 铁律（RED→GREEN→REFACTOR），无生产代码无测试 | TDD 优先，但允许纯文档/配置跳过 |
| 测试范围 | 内嵌在 build-executor 的 per-task 循环中 | 独立 5-test 阶段，5 轮金字塔 |
| 测试金字塔 | 无正式金字塔概念 | 功能/性能/安全/兼容/可观测 5 轮 |
| 测试质量 | Code-reviewer 检查 | 6 维测试衰退风险自检（T1-T6） |
| UAT | 在 closing 阶段由 release-archivist 执行 | 在 7-integration 阶段，含人工引导 |

### 7. UI 设计流程

| 维度 | SFlow | flow-kit |
|------|-------|----------|
| 状态/阶段 | `ui-design` 状态（在 specifying 和 bridging 之间） | `2a-ui-design` 阶段（在 2-design 和 3-task 之间） |
| 检测方式 | 自动检测 frontend（package.json + 目录结构） | 关键词检测（0-change 步骤 0.5） |
| 输出 | `ui-design.md` | `UI-DESIGN.md` |
| 设计深度 | 基础 UI 设计规范 | 完整美学决策（5 维度 + design tokens + v0 草稿 + 占位符策略 + 反 AI-slop 自检） |
| 外部工具 | `ui-implementer` 子代理 | `ui-ux-pro-max` + `impeccable` 扩展 |

> flow-kit 的 UI 设计显著更完整，有 v0 草稿确认机制、brownfield 视觉语汇对齐、占位符策略等。

### 8. 横向命令 / 维护体系

| 命令 | SFlow | flow-kit |
|------|-------|----------|
| 项目扫描 | 无专有命令 | I-intel-scan — 老项目入场扫描 |
| 架构管理 | 无专有命令 | A-architect 项目级架构梳理 + A-evolve 增量同步 |
| 健康检查 | 无专有命令 | M-health — 周期性代码库巡检 |
| 换调性 | 无专有命令 | L-restyle — 一键换视觉调性 |

> flow-kit 拥有完整的横向命令体系，SFlow 没有等价功能。

### 9. Token 管理

| 维度 | SFlow | flow-kit |
|------|-------|----------|
| 预算控制 | 无正式 token 预算 | R1.9 严格预算：reference 首轮 ≤150 行 |
| 成本估计 | 无 | GO.md 中有完整 token 成本估算表 |
| 加载策略 | 无明确策略 | 三类文件（SPEC/REFERENCE/TEMPLATE）不同加载方式 |
| 路由声明 | 无 | 必须声明已加载/未加载/起止行 |

### 10. 相互借鉴来源

SFlow 已经借鉴了 flow-kit 的如下设计：

| 借鉴点 | 来源 | SFlow 实现位置 |
|--------|------|---------------|
| Artifact Preflight Gate | flow-kit R2.7 | `guard.ts` → `checkArtifactPreflight()` |
| 意图路由 | flow-kit GO.md | `workflow_router` 工具 |
| PROGRESS.md 反重复协议 | flow-kit R1.5/R1.6 | `state-manager.ts` → `checkProgressAntiRepeatGuard()` |
| LESSONS 知识库 | flow-kit R1.8 | `state-manager.ts` → `grepLessons()` |
| 文件边界控制 | flow-kit R7.3/R6.5 | `guard/boundary.ts` → `checkFileWriteGuard()` |
| 前端 UI 设计路径 | flow-kit 2a-ui-design | `ui-design` 状态 + 前端检测 |

---

## 七、总结：两者各自的定位

| flow-kit | SFlow |
|----------|-------|
| 轻量级文档方法论 | 重量级代码化引擎 |
| 跨 IDE 通用 | 仅 OpenCode |
| 靠规则约束 AI | 代码级强制保障 |
| 适合个人/小团队 | 适合团队/严肃工程 |
| 零安装成本 | 需 `npm install` + 配置 |
| token 预算精细化管控 | 无 token 管控 |
| 完整横向命令体系（I/A/M/L） | 无横向命令 |
| 更完善的 UI 设计流程 | 有 UI 设计但较简 |
| 5 轮测试金字塔 | 铁律 TDD 但无金字塔 |
| 无并行执行 | 3 种执行模式 + wave 分波 |
| 同模型角色切换 | 10 子代理独立 session |

> **核心差异一句话**：flow-kit 是"文档驱动"的轻量方法论，跨 IDE 通用但靠 AI 自觉；SFlow 是"代码驱动"的重型引擎，保障强但绑定 OpenCode 生态。