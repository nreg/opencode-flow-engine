# flow-kit 借鉴说明

> 源仓库：<https://github.com/rihebty/flow-kit>（9b5dda72 on 2026/5/13 at 15:25）
> 本文档记录 opencode-flow-engine 从 flow-kit 借鉴了哪些设计、当前实现状态、以及尚未借鉴的有价值功能。

---

## 一、已借鉴并实现的功能

### 1. Artifact Preflight Gate — 工件前置检查门 ⭐⭐⭐⭐⭐

**flow-kit 做法**：进入任意阶段前，必须检查上游工件是否存在，缺失则回退补齐。

| 目标阶段 | 必须已有的上游工件 |
|----------|-------------------|
| 1-requirement | CHANGE.md |
| 2-design | CHANGE.md + REQUIREMENT.md |
| 3-task | REQUIREMENT.md + DESIGN.md（前端还要 UI-DESIGN.md） |
| 4-dev | TASK.md 或用户显式提供的临时最小 TASK |

**SFlow 实现**：

- `packages/plugin-infra/src/features/artifact-preflight.ts` → `checkArtifactPreflight()` + `findPreflightState()`
- `packages/plugin-infra/src/hooks/guard.ts` → 在 `tool.execute.before` 中调用 `checkArtifactPreflight()`
- 每个状态维护一张"进入前必须存在的工件"映射表，缺失时自动给出回退指引

| 目标状态 | 必须已有 |
|----------|----------|
| exploring | 无 |
| specifying | proposal.md |
| bridging | proposal.md + specs/ + design.md + tasks.md |
| approved-for-build | 全部 + execution-contract.md |

**借鉴演化**：从纯规则（R2.7）→ 代码级 hook 强制执行，且增加了自动回退状态指引。

---

### 2. GO.md 统一入口 + 意图路由 ⭐⭐⭐⭐⭐

**flow-kit 做法**：用户只需 `@flow-kit/GO.md` + 一句话意图，AI 自动检测 state、匹配意图、路由到对应阶段。

**SFlow 实现**：

- `packages/plugin-infra/src/tools/workflow-router.ts` → `workflow_router` 工具
- `packages/plugin-infra/src/tools/iflow-router.ts` → `iflow_router` 工具（iFlow 专用）
- `workflows/shared/horizontal-commands.ts` → `HORIZONTAL_COMMANDS` 表 + `matchHorizontalCommand()` 函数
- 支持自然语言意图匹配：全面test → test-engineer，全面review → review-engineer，同步架构 → flow-evolve 等

**借鉴演化**：从 markdown 文件路由 → TypeScript 代码化路由，且扩展为双工作流（SFlow + iFlow）共享的横向命令体系。

---

### 3. PROGRESS.md + 反重复协议（R1.5/R1.6）⭐⭐⭐⭐⭐

**flow-kit 做法**：清窗前必须写 PROGRESS.md，核心是「已排除方案」段，恢复后第一步检查新方案不在已排除清单中。

| # | 方案 | 排除理由 | 失败次数 |
|---|------|----------|----------|
| X-1 | 用 useEffect 同步 localStorage | 首次渲染闪一下 | 1 |
| X-2 | 服务端渲染 + cookie | 纯 SPA 范围超标 | 1 |

**SFlow 实现**：

- `packages/plugin-infra/src/features/state-manager.ts` → `writeProgressSnapshot()` / `clearProgressSnapshot()` / `checkProgressAntiRepeat()`
- `workflows/sflow/skills/build-executor/SKILL.md` → "Anti-Repeat Protocol" 章节（含 context resume 反重复检查）
- `packages/plugin-infra/src/hooks/guard.ts` → `checkProgressAntiRepeatGuard()`

**借鉴演化**：从纯规则 + 手写文件 → 代码级 guard 自动拦截 + 结构化 checkpoint 文件。

---

### 4. LESSONS.md — 跨任务失败知识库 ⭐⭐⭐⭐⭐

**flow-kit 做法**：项目级常驻文件 `.specs/LESSONS.md`，每个 DEV 任务进入实现前必扫，任务完成后按提名条件决定是否新增。

**SFlow 实现**：

- `packages/plugin-infra/src/features/state-manager.ts` → `grepLessons()` / `addLesson()`
- `packages/plugin-infra/src/hooks/guard.ts` → `checkLessonsGuard()`
- `workflows/sflow/skills/build-executor/SKILL.md` → "LESSONS Knowledge Base Check" 章节
- 每个 task 开工前自动 grep，调试退出时自动追加经验教训，带标签索引和关键词匹配
- 文件路径：`.flow-engine/sflow/lessons.md`

**借鉴演化**：从纯规则（R1.8）→ 代码级 guard 自动检查 + 结构化条目管理。

---

### 5. 文件边界控制 — read_files / write_files（B3 护栏 + R6.5）⭐⭐⭐⭐⭐

**flow-kit 做法**：每个 TASK 中的任务必须声明两组路径，提交前用 `git diff --name-only` 比对 write_files，越界则停下。

```xml
<read_files>
  src/features/*
  src/lib/api-client.ts
</read_files>
<write_files>
  src/features/NotificationCenter.tsx
  src/features/__tests__/*
</write_files>
```

**SFlow 实现**：

- `packages/plugin-infra/src/hooks/guard/boundary.ts` → `parseFileBoundaryPatterns()` / `matchesBoundary()` / `getActiveTaskId()`
- `packages/plugin-infra/src/hooks/guard.ts` → `checkFileWriteGuard()` / `checkReadFilesBoundary()` / `checkGitCommitBoundary()`
- `workflows/sflow/skills/build-executor/SKILL.md` → "File Boundary Control" 章节（含 task-level 边界隔离 + 缓存）
- 支持 XML 格式、表格格式、全局格式三种边界定义方式
- 支持 task-level 隔离（Task A 不能写 Task B 的文件）

**借鉴演化**：从纯规则（R7.3/R6.5）→ 代码级写入拦截 + task 级隔离 + 边界缓存（LRU）。此外，SFlow 还增加了 `checkReadFilesBoundary`（读文件边界）作为 flow-kit 没有的扩展。

**SFlow 对 flow-kit 的增强——三层防护**：

| 层级 | 机制 | flow-kit | SFlow |
|------|------|----------|-------|
| 写入拦截 | 写文件时检查边界 | ❌ 无（AI 自觉） | ✅ `checkFileWriteGuard()` 阻断越界写入 |
| 提交拦截 | git commit 时检查边界 | ❌ 无 | ✅ `checkGitCommitBoundary()` 阻断越界提交 |
| 自检 | 提交流程中要求 AI 自查 | ✅ 4-dev 步骤 5 | ✅ implementer-prompt.md + SKILL.md 双份 |

`checkGitCommitBoundary()` 实现细节（`packages/plugin-infra/src/hooks/guard.ts:1099`）：

1. 拦截 `git commit` 命令（正则匹配）
2. 通过 `git diff --cached --name-only` 获取 staged 文件
3. 从 `execution-contract.md` 解析当前 task 的 `write_files`
4. 比对：越界文件 → 阻断提交并返回阻断原因
5. 支持 task-level 边界隔离（Task A 不能提交 Task B 的文件）

---

### 6. 前端 UI 设计路径（2a-ui-design）⭐⭐⭐⭐⭐

**flow-kit 做法**：前端项目在 DESIGN 和 TASK 之间插入 `2a-ui-design` 阶段，产出 UI-DESIGN.md（含调性、design tokens、反 AI-slop 自检）。

**SFlow 实现**：

- `workflows/sflow/agents/ui-director.ts` → **ui-director 子代理**（7 步美学决策流程）
- `workflows/sflow/agents/ui-implementer.ts` → **ui-implementer 子代理**（前端实现 Specialist，加载 9 个前端 skill）
- `packages/plugin-infra/src/features/frontend-detector.ts` → 前端项目自动检测
- 完整的 9 状态工作流：`exploring → specifying → [ui-design →] bridging → approved-for-build → executing → debugging → closing`
- guard 强制前端项目必须经过 `ui-design` 状态

**SFlow 对 flow-kit 的增强**：

| 功能维度 | flow-kit（2a-ui-design） | SFlow（ui-director + ui-implementer） |
|----------|------------------------|--------------------------------------|
| 角色 | 同模型扮演 UI Director | 独立 `ui-director` 子代理 |
| 决策流程 | 同模型分步对话 | 7 步规范化流程，4 分支决策树 |
| brownfield 对齐 | 7 项观察报告 + 用户校准 | 7 维 grep + 缓存到 CONTEXT.md（90 天过期提醒）|
| v0 草稿 | 3 种反馈处理 | 4 分支决策树（go/adjust/tone change/full rejection）|
| Design Tokens | OKLCH + 直接复制 token | OKLCH + `validate_ui_design` 工具验证 V1-V8 |
| 反 AI-slop | 8 类强制禁忌 | 42 规则（8 类）+ 交付清单 |
| 实现端 | 4-dev Dev 角色手写 | 独立 `ui-implementer` 子代理 + 9 个前端 skill |
| 图像生成 | 无 | `svg-architect` skill + `agnes_image_generate` 工具 |

---

### 7. 横向命令体系（L-/M-/I-/A- 系列）⭐⭐⭐⭐⭐

**flow-kit 做法**：4 组非线性的横向命令，独立于主流程，按需调用。

| 前缀 | 命令 | 用途 |
|------|------|------|
| I- | I-intel-scan | 老项目入场扫描 |
| A- | A-architect / A-evolve | 架构文档建立 / 增量同步 |
| M- | M-health | 周期性健康巡检 |
| L- | L-restyle | 一键换视觉调性 |

**SFlow 实现**：**完整实现且扩展为 7 个共享子代理 + 代码化路由**

| 共享子代理 | 对应 flow-kit | 代码位置 |
|-----------|--------------|----------|
| `flow-intel` | I-intel-scan | `workflows/shared/agents/flow-intel.ts` |
| `flow-architect` | A-architect | `workflows/shared/agents/flow-architect.ts` |
| `flow-evolve` | A-evolve | `workflows/shared/agents/flow-evolve.ts` |
| `flow-health` | M-health | `workflows/shared/agents/flow-health.ts` |
| `flow-restyle` | L-restyle | `workflows/shared/agents/flow-restyle.ts` |
| `test-engineer` | 5-test 阶段 | `workflows/shared/agents/test-engineer.ts` |
| `review-engineer` | 6-review 阶段 | `workflows/shared/agents/review-engineer.ts` |

路由触发机制：

- `workflows/shared/horizontal-commands.ts` → `HORIZONTAL_COMMANDS` 表（支持正则匹配）
- `workflows/shared/slash-commands.ts` → 斜杠命令系统（`/flow-test`、`/flow-review` 等）
- 在 Phase 0 Intent Gate 检测，**绕过**所有状态 guard，独立于工作流状态

**借鉴演化**：从纯 markdown 命令 + 人工触发 → 代码化子代理 + 正则意图匹配 + 斜杠命令 + 状态无关旁路路由。

---

### 8. 5 轮测试金字塔 ⭐⭐⭐⭐

**flow-kit 做法**：独立 `5-test` 阶段，覆盖 5 轮金字塔（功能/性能/安全/兼容/可观测），每轮必须声明范围。

**SFlow 实现**：

- `workflows/shared/agents/test-engineer.ts` → `test-engineer` 共享子代理
- 支持 full-test（全 5 轮）和 partial-test（指定轮次，如"只测性能"）
- 每轮必须声明范围状态（✅ 必跑 / ⚠️ 按需 / ❌ 跳过+理由）
- 测试质量 6 维自检（T1-T6，借鉴 brooks-lint）

**借鉴演化**：从独立阶段 → 横向命令，可随时调用，不受工作流状态限制。

---

### 9. 3 轮审查体系 ⭐⭐⭐⭐

**flow-kit 做法**：独立 `6-review` 阶段，3 轮审查（Spec 合规 + 代码质量 + UI 视觉），严重度分级。

**SFlow 实现**：

- `workflows/shared/agents/review-engineer.ts` → `review-engineer` 共享子代理
- R1: Spec 合规审查（AC 逐条对实现）
- R2: 代码质量审查（6 维衰退风险 + 4 要素输出格式）
- R3: UI 视觉审查（仅前端项目）
- R4: 技术债评估（可选，里程碑触发）
- 支持 full-review 和 partial-review

**借鉴演化**：从独立阶段 → 横向命令，且增加了 R4 技术债评估轮次。

---

### 10. STATE.md — 跨会话状态持久化（部分借鉴）⭐⭐⭐⭐

**flow-kit 做法**：仓库根 `STATE.md` 记录活跃 Change、当前阶段、当前 Task、中断任务、决策日志。

**SFlow 实现**：

- `packages/plugin-infra/src/features/state-manager.ts` → boulder-state 持久化模式
- `packages/plugin-infra/src/features/workflow-manager.ts` → 状态转换 + 自动修复
- 状态文件：`.flow-engine/sflow/state.json`
- 支持自动修复（state ↔ artifact 一致性检查）
- 支持中断任务恢复（写 PROGRESS.md + 更新 state.json）

**与 flow-kit 的差异**：SFlow 使用 JSON 格式而非 markdown，通过代码进行状态管理而非给人阅读。缺少 flow-kit 的决策日志（最近 10 条）和横向命令元数据字段。

---

### 11. Compaction Context — 会话压缩上下文恢复 ⭐⭐⭐⭐

**flow-kit 做法**：R1.5 重启协议——清窗前写 PROGRESS.md + 更新 STATE.md，恢复后按固定顺序加载文件。

**SFlow 实现**：

- `workflows/shared/compaction-context.ts` → `createCompactionContext()` 函数
- 结构化保存：当前任务进度、已完成子步骤、已排除方案、待确认假设
- 反重复检查：恢复后检查新方案是否在已排除清单中
- 任务过大检测：触发清窗 = 任务拆得不够细 → 自动拆子任务

**借鉴演化**：从纯规则 + 手写文件 → 代码化上下文管理 + 自动恢复。

---

### 12. Cascaded Config — 级联配置 ⭐⭐⭐

**flow-kit 做法**：无直接对应。但 flow-kit 有 `RULES.md` 全局规则和 `SYSTEM.md` 精简注入版的分层思想。

**SFlow 实现**：

- `packages/plugin-infra/src/agents/config-loader.ts` → `loadCascadedSFlowConfig()` + `agentOverridesFromConfig()`
- 分层配置：用户级（`~/.config/opencode-flow-engine/`）→ 项目级（`.flow-engine/config.json`）→ 默认值
- 支持 per-agent 模型、温度、工具覆盖

---

## 二、flow-kit 有但 SFlow 尚未借鉴的功能

### 【P0】破坏性变更协议（B4 护栏 + R4.6）

**flow-kit 做法**（4-dev 1.8 节）：修改命中以下任一条件时，必须 grep 引用图 + 反问用户 + 回归测试覆盖：

1. 删除既有代码 ≥ 5 行
2. 改公共导出签名
3. 改公共 API 路由或 schema
4. 删除文件或重命名导出符号

```bash
# 必须 grep 引用图，贴出完整结果
grep -rn "formatLegacyDate" src/ tests/ scripts/ docs/
# 然后反问用户：直接删 / 留兼容期 / 写 codemod / 不删了
```

**SFlow 现状**：`guard.ts` 有文件写入拦截和边界检查，但无"删除代码 ≥ 5 行"的引用图 grep 和反问用户流程。

> 借鉴价值 ⭐⭐⭐⭐⭐ — 老项目最高频事故源，建议在 `build-executor` 的 self-review 环节加入。

---

### 【P0】Schema 变更必伴随迁移文件（R4.5 + 4-dev 1.7 节）

**flow-kit 做法**：改 ORM model / entity / schema.prisma 时，必须：

1. 声明 schema diff（新增表/改字段/删字段）
2. 按优先级探测项目框架（Prisma → Alembic → Knex → Flyway → 手写 SQL）
3. 生成可逆迁移（含 up + down）
4. 检测 DB 凭据 → 反问用户是否执行
5. 未检测到凭据 → 在 SUMMARY 中提醒手动执行

**SFlow 现状**：`build-executor` 执行任务时无 schema 变更检测和迁移生成流程。

> 借鉴价值 ⭐⭐⭐⭐⭐ — 改 model 不迁移是最高频 bug，建议在 `build-executor` 的 per-task 循环中加入 schema 检测门。

---

### 【P1】沿用既有抽象 grep（B5 护栏 + R6.4）

**flow-kit 做法**（4-dev 1.4 节）：写代码前必须 grep 同类抽象，找到就用，找不到才另起。

| 能力 | grep 命令 | 找到怎么办 |
|------|-----------|-----------|
| HTTP 请求 | `grep -rn "axios\|fetch"` | 用既有客户端 |
| 日期格式化 | `grep -rn "formatDate"` | import 用 |
| 状态管理 | 看 `package.json` | 用现有 store 范式 |

每条 grep 结果必须贴入 SUMMARY.md 的「6 维自查」段。

**SFlow 现状**：`build-executor/SKILL.md` 中有"沿用既有抽象"的意识，但未在代码层面强制 grep 执行。

> 借鉴价值 ⭐⭐⭐⭐⭐ — 防重复实现，建议在 `build-executor` 的 per-task 步骤 1 中强制 grep 并记录。

---

### 【P2】Token 预算管控（R1.9）

**flow-kit 做法**：每阶段首轮有严格的 reference 加载预算（≤150 行），每加载项必须声明起止行。

| 类型 | 路径 | 长度 | 加载方式 |
|------|------|------|----------|
| SPEC | `.specs/<id>/*.md` | < 200 行 | 整读 OK |
| REFERENCE | `flow-kit/reference/*.md` | 75~470 行 | **禁止默认整读**，按节 grep |
| TEMPLATE | `flow-kit/templates/*.md` | < 150 行 | 整读 OK |

路由声明必须写"已加载/未加载/起止行"三要素。

**SFlow 现状**：没有 token 预算意识，子代理 prompt 中无加载策略约束。

> 借鉴价值 ⭐⭐⭐ — 适合在 `build-executor` 和 `spec-writer` 等加载量大的子代理 prompt 中嵌入，降低 token 消耗。

---

### 【P2】跨模型 spot-check（6-review 4.2 节）

**flow-kit 做法**：命中以下条件时，用另一个模型跑同样的三轮审查：

- 涉及安全/认证
- 涉及并发/分布式
- 单一函数 > 80 行
- 测试覆盖率有显著下降

两份报告的差异填入 REVIEW.md 的「跨模型分歧」章节。

**SFlow 现状**：`review-engineer` 单模型审查，无跨模型 spot-check 机制。SFlow 的 agent-builder 有 model profile 体系（mechanical/standard/strong/review），具备跨模型调度的基础能力。

> 借鉴价值 ⭐⭐⭐ — 可利用已有的 model profile 体系实现跨模型审查。

---

### 【P3】架构依赖图检查（6-review 2.2 节）

**flow-kit 做法**：大型 change 触发 Mermaid 依赖图检查，重点检查循环依赖、反向依赖、跨边界依赖。

**SFlow 现状**：`guard.ts` 中有 `checkWaveDependencies()`（波次依赖拓扑排序），但无架构级依赖图检查。

> 借鉴价值 ⭐⭐⭐ — 适合在 `code-reviewer` 或 `review-engineer` 中增加架构依赖图轮次。

---

## 三、不应借鉴的部分

| flow-kit 做法 | 不借鉴原因 |
|---------------|-----------|
| 纯 markdown 无运行时 | SFlow 是 OpenCode 插件，本身就有运行时 |
| 靠 AI 自觉遵守规则（无强制门禁） | SFlow 有 hook 系统，可以在代码层面强制执行 |
| prompt 模式（每阶段读 prompt 文件） | SFlow 是 subagent 模式，子代理自带 system prompt |
| GO.md 单一入口 + 文件路由 | SFlow 已有 `workflow_router` + `horizontal-commands.ts` 工具路由，更灵活 |
| 每阶段独立产物（CHANGE/REQUIREMENT/DESIGN 分开） | SFlow 的 `spec-writer` 可一次产出所有规划产物，更高效 |
| 同模型切换角色 | SFlow 已用独立子代理 + 独立模型配置替代 |

---

## 四、建议未来借鉴优先级

| 优先级 | 功能 | 价值 | 工作量 | 对应 flow-kit 位置 |
|--------|------|------|--------|-------------------|
| **P0** | 破坏性变更协议（B4） | ⭐⭐⭐⭐⭐ | 中 | 4-dev 1.8 节 + R4.6 |
| **P0** | Schema 变更必迁移（R4.5） | ⭐⭐⭐⭐⭐ | 中 | 4-dev 1.7 节 + R4.5 |
| **P1** | 沿用抽象 grep（B5） | ⭐⭐⭐⭐⭐ | 低 | 4-dev 1.4 节 + R6.4 |
| **P2** | Token 预算管控 | ⭐⭐⭐ | 低 | GO.md 红线 + R1.9 |
| **P2** | 跨模型 spot-check | ⭐⭐⭐ | 中 | 6-review 4.2 节 |
| **P3** | 架构依赖图检查 | ⭐⭐⭐ | 中 | 6-review 2.2 节 |
| **P3** | STATE.md 决策日志 | ⭐⭐ | 低 | STATE.md 决策日志段 |

---

## 五、SFlow 已超越 flow-kit 的部分

以下功能 flow-kit 没有，但 SFlow 已有：

| 功能 | SFlow 位置 |
|------|-----------|
| **三层文件边界防护**（写入拦截 + 提交拦截 + 自检），flow-kit 仅自检一层 | `guard.ts` → `checkFileWriteGuard()` + `checkGitCommitBoundary()` + `build-executor/SKILL.md` |
| 执行计划 + Wave 分波 + 拓扑排序 | `packages/plugin-infra/src/features/execution-plan.ts` |
| Review 收据持久化 | `packages/plugin-infra/src/features/execution-plan.ts` → `recordReviewReceipt()` |
| 预设升级机制（hotfix/tweak → full） | `workflows/sflow/skills/build-executor/SKILL.md` → "Runtime Preset Upgrade Check" |
| 3 种执行模式（inline/batch-inline/SDD） | `workflows/sflow/skills/build-executor/SKILL.md` → "Execution Mode Selection" |
| 独立 debugging 状态 + bug-investigator 子代理 | `workflows/sflow/agents/bug-investigator.ts` |
| cascade 级联配置 | `packages/plugin-infra/src/agents/config-loader.ts` |
| 共享子代理跨工作流复用 | `workflows/shared/` → 7 个 agents 同时服务 SFlow + iFlow |
| 子代理进度 checkpoint | `workflows/sflow/skills/build-executor/SKILL.md` → "Checkpoint File Format" |
| 前端自动检测 + 前端项目 guard | `packages/plugin-infra/src/features/frontend-detector.ts` |
| agent-specific guard（特定子代理的写操作保护） | `packages/plugin-infra/src/hooks/guard/agent-guards.ts` |

---

## 六、代码路径映射（旧→新）

如果文档中有以下旧路径引用，请替换为当前路径：

| 旧路径（文档中） | 当前路径（实际代码） |
|-----------------|-------------------|
| `packages/core/src/constants.ts` | `packages/plugin-infra/src/features/artifact-preflight.ts` |
| `packages/opencode-adapter/src/hooks/guard.ts` | `packages/plugin-infra/src/hooks/guard.ts` |
| `packages/opencode-adapter/src/features/workflow-manager.ts` | `packages/plugin-infra/src/features/workflow-manager.ts` |
| `packages/opencode-adapter/src/features/state-manager.ts` | `packages/plugin-infra/src/features/state-manager.ts` |
| `packages/opencode-adapter/src/tools/workflow-router.ts` | `packages/plugin-infra/src/tools/workflow-router.ts` |
| `packages/opencode-adapter/src/agents/need-explorer.ts` | `workflows/sflow/agents/need-explorer.ts` |
| `skills/`（根目录） | `workflows/sflow/skills/` |
| `skills/templates/` | `workflows/sflow/templates/` |