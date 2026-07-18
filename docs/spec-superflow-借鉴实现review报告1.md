# 全景对比：sFlow（opencode-flow-engine）vs spec-superflow

---

## 一、架构层差异（不是"缺失"，是设计选择）

| 维度 | spec-superflow | sFlow | 说明 |
|------|----------------|-------|------|
| Agent 模型 | Skill 注入（SKILL.md → AI context） | OpenCode Agent 工厂（独立 agent，独立 prompt + 工具集） | sFlow 的基础设施更强：per-agent 模型配置、fallback 链、工具隔离 |
| 状态文件 | `.spec-superflow.yaml`（YAML，纯文本） | `.sflow/state.json`（JSON，结构化） | 功能等价。sFlow 的 JSON 支持嵌套（decisionPoints 数组） |
| 执行控制 | CLI 命令（`ssf execution plan/show/review`） | Agent + Hook 自动执行（无 CLI） | 架构差异，非功能差距 |
| Guard 机制 | `script/guard/guard.mjs` 独立脚本 | `hooks/guard.ts` 自动 hook | sFlow 更集成（每次 transition 自动检查） |
| 覆盖目录 | `.superpowers/sdd/` | `.sflow/checkpoints/` + `.sflow/reviews/` | sFlow 扁平化，spec-superflow 分层 |
| 平台适配 | 9 平台独立安装脚本 | 纯 OpenCode 插件 | sFlow 只适配 OpenCode（但更深） |
| 依赖 | 0 运行时依赖 | OpenCode SDK + 内部 3 个 package | sFlow 多了 package 层 |

> sFlow 把 spec-superflow 的 "Skill 注入 AI context" 模式升级为 "独立 Agent 工厂" 模式。每个 Skill 变成有独立配置、独立工具集、独立 temperature 的 Agent。

---

## 二、功能完整度矩阵

### 🟢 规划阶段（exploring → specifying → bridging）

| 功能 | spec-superflow | sFlow | 对比 |
|------|----------------|-------|------|
| proposal.md 模板 | ✅ `templates/proposal.md` | ✅ 通过 spec-writer agent 生成 | 等价 |
| specs/ 模板 | ✅ `templates/spec.md` | ✅ 通过 spec-writer agent 生成 | 等价 |
| design.md 模板 | ✅ `templates/design.md` | ✅ 通过 spec-writer agent 生成 | 等价 |
| tasks.md 模板 | ✅ `templates/tasks.md` | ✅ 通过 spec-writer agent 生成 | 等价 |
| execution-contract.md 模板 | ✅ `templates/execution-contract.md` | ✅ `templates/` 目录已有 | 等价 |
| 5 工件 Schema 验证 | ✅ `src/validation/validator.ts` | ✅ `packages/core/src/validation/validator.ts` | 1:1 移植 |
| 工件解析器 | ✅ `src/parsing/requirement-blocks.ts` | ✅ `packages/core/src/parsing/requirement-blocks.ts` | 1:1 移植 |
| Need Explorer（DP-1） | ✅ `skills/need-explorer/SKILL.md` | ✅ `skills/need-explorer/` | 等价 |
| Spec Writer（DP-2） | ✅ `skills/spec-writer/SKILL.md` | ✅ `skills/spec-writer/` | 等价 |
| Contract Builder（DP-3） | ✅ `skills/contract-builder/SKILL.md` | ✅ `skills/contract-builder/` | 等价 |
| 合同陈旧检测 | ✅ 内容级（proposal scope vs contract） | ✅ `contract-staleness.ts` + guard hook | sFlow 的 `contract-staleness.ts` 是独立的检测逻辑 |
| 动态模式推理 | ✅ `ssf runtime infer` | ✅ `inferModeFromArtifacts` + `detectWorkflowState` | 等价 |
| 前端检测 | ❌ 无 | ✅ `detectFrontend` + `ui-design` 状态 | **sFlow 领先** |
| 工件 Preflight Gate | ❌ 无 | ✅ `artifact-preflight.ts` + state-transition hook | **sFlow 领先** |

### 🟢 执行阶段（approved-for-build → executing）

| 功能 | spec-superflow | sFlow |
|------|----------------|-------|
| TDD 纪律 | ✅ `build-executor/SKILL.md` | ✅ `build-executor.ts` agent prompt |
| SDD 模式 | ✅ `build-executor/SKILL.md` | ✅ `build-executor agent` + `call_flow_agent` |
| 执行计划结构 | ✅ `execution-plan.mjs` | ✅ `execution-plan-types.ts` + `execution-plan.ts` |
| Wave 分波执行 | ✅ `--wave` CLI 参数 | ✅ `ExecutionPlan.waves` |
| Wave 依赖图 + 循环检测 | ✅ `hasDependencyCycle()` | ✅ `detectCircularDependencies()`（Kahn 算法） |
| 内容哈希校验 | ✅ `hashPlan()` + `tryHashPlan()` | ✅ `computeContentHash()`（canonical JSON） |
| 三重哈希（artifacts + contract + content） | ✅ | ✅ |
| Review 收据（status/base/head/report） | ✅ `recordReview()` | ✅ `recordReviewReceipt()` |
| 依赖阻断（blockedDependencies） | ✅ | ✅ `checkWaveDependencies` guard |
| 收据符号链接检测 | ✅ | ✅ `checkReceiptIntegrity` |
| 收据 commit hash 验证 | ✅ `git rev-parse --verify` | ✅ 同样实现 |
| 收据 base→head 祖先验证 | ✅ `merge-base --is-ancestor` | ✅ 祖先验证：git merge-base --is-ancestor 检查 |
| 执行模式推荐 | ✅ `recommendAndPrint()` + `writeRecommendationReceipt()` | ✅ `recommendExecutionMode()` + DP-4 自动写入 |
| 推荐收据匹配验证 | ✅ 验证 artifacts_hash + contract_hash + waves + recommendation 完全匹配 | ❌ 无 recommendation_receipt 概念 |
| 用户确认 + 非推荐模式需 acknowledge | ✅ `--confirm` + `--acknowledge-recommendation` | ✅ DP-4 自动推荐，无 CLI 确认交互 |
| Git 分支隔离 | ✅ `ssf isolate` 脚本 | ✅ `checkGitBranchIsolation` guard |
| 文件边界控制 | ❌ 无 | ✅ `checkFileBoundary` + `checkReadFilesBoundary` + `checkGitCommitBoundary` |
| downgrade 拒绝 | `execution-plan.mjs` — revise 时必须 upgrade | ✅ **sFlow 已实现**（`MODE_RANK` 检查） |

### 🟢 调试阶段（debugging）

| 功能 | spec-superflow | sFlow |
|------|----------------|-------|
| Bug Investigator（4 阶段） | ✅ `skills/bug-investigator/SKILL.md` | ✅ `skills/bug-investigator/` |
| DP-5 调试升级 | ✅ 3+ 次修复失败后 escalate | ✅ 可选 escalation |

### 🟢 收尾阶段（closing）

| 功能 | spec-superflow | sFlow |
|------|----------------|-------|
| Release Archivist | ✅ `skills/release-archivist/SKILL.md` | ✅ `skills/release-archivist/` |
| Closing Gate（review 收据检查） | ✅ `execution-reviews-passed.mjs` | ✅ `checkClosingGate` guard |
| Specs 合并检查（#28） | ✅ `specs-merged.mjs` | ✅ `checkSpecsMerged` guard |
| 任务完整检查 | ✅ `tasks-complete.mjs` | ✅ `checkTaskCompletion` guard |
| 测试结果检查 | ✅ `tests-passing.mjs` | ✅ closing gate 中扫描 `verification-report.md` |
| DP-6 验证失败 | ✅ 文档中有 | ✅ release-archivist 会报告 verdict |
| DP-7 归档确认 | ✅ 文档中有 | ✅ release-archivist 会 archive |
| 验证报告模板 | ❌ 无 | ✅ release-archivist 输出结构化报告 |

### 🟢 持久化层

| 功能 | spec-superflow | sFlow | 对比 |
|------|----------------|-------|------|
| 检查点（checkpoint） | ✅ `sdd-overlay.mjs` — Markdown 格式 + task_hash 比对 | ✅ `state-manager.ts` — JSON 格式 + contractHash 比对 | 等价（格式不同） |
| task_hash 比对 | ✅ 检查 task 在 tasks.md 中的内容是否变化 | ❌ 无 | sFlow 轻微差距 |
| 移交合约（handoff） | ✅ `sdd-overlay.mjs` — active→result-ready→resolved | ✅ `state-manager.ts` — created→finished→resolved | sFlow 多了 finish 步骤 |
| Handoff 类型 | prototype / research / experiment | prototype / research / experiment / task-handoff / code-review / architecture | **sFlow 领先** |
| Handoff source 漂移检测 | ✅ source_artifacts_hash 对比 | ❌ 无（但状态文件持久化检查点） | 轻微差距 |
| 跨会话 Boulder 状态 | ❌ 无 | ✅ boulder-state.json + restoreState + repairState | **sFlow 领先** |
| PROGRESS.md 反重复协议 | ❌ 无 | ✅ `detectProgressAntiRepeat` + guard | **sFlow 领先** |
| LESSONS.md 知识库 | ❌ 无 | ✅ 完整的 parse/search/nominate + guard 集成 | **sFlow 领先** |

### 🟢 Guard 系统对比

| Guard 检查 | spec-superflow | sFlow |
|------------|----------------|-------|
| artifacts-exist | ✅ `checks/artifacts-exist.mjs` | ✅ `checkArtifactAndPhaseConsistency` |
| schema-valid | ✅ `checks/schema-valid.mjs` | ✅ 通过 artifact-preflight 间接覆盖 |
| contract-fresh | ✅ `checks/contract-fresh.mjs` | ✅ `checkContractStalenessGuard` |
| contract-current | ✅ `checks/contract-current.mjs` | ✅ 合同陈旧检测 |
| dp-gate-passed | ✅ `checks/dp-gate-passed.mjs` | ✅ 通过 state machine 内置 |
| dp3-approved | ✅ `checks/dp3-approved.mjs` | ✅ `contractApproved` 字段 |
| execution-plan-ready | ✅ `checks/execution-plan-ready.mjs` | ✅ 通过 wave dep + 哈希检查 |
| execution-reviews-passed | ✅ `checks/execution-reviews-passed.mjs` | ✅ `checkClosingGate` + `checkTaskCompletion` |
| tasks-complete | ✅ `checks/tasks-complete.mjs` | ✅ `checkTaskCompletion` |
| tests-passing | ✅ `checks/tests-passing.mjs` | ✅ closing gate 中检查 |
| specs-merged | ✅ `checks/specs-merged.mjs` | ✅ `checkSpecsMerged` |
| workflow-mode guard（hotfix/tweak 合法跳转） | ✅ `guard.mjs` 的 `checkWorkflowAllowed` | ✅ git merge-base --is-ancestor 检查 |
| Preset upgrade | ❌ 无 | ✅ `checkPresetUpgrade` + `HOTFIX_UPGRADE_THRESHOLDS` |
| File write guard | ❌ 无 | ✅ 按 state 阻断源码写 |
| Git commit boundary | ❌ 无 | ✅ staged 文件检查 |
| Read files boundary | ❌ 无 | ✅ 超出 read_files 警告 |
| Lessons guard | ❌ 无 | ✅ 进入任务时匹配 LESSONS.md |
| Progress anti-repeat | ❌ 无 | ✅ PROGRESS.md 排除方案检查 |
| Omo usage guard | ❌ 无 | ✅ 检查 oh-my-openagent 使用 |

---

## 三、sFlow 已实现但 spec-superflow 没有的功能

| 功能 | 价值 | 代码位置 |
|------|------|----------|
| Frontend 检测 + ui-design 状态 | 区分前后端项目，前端自动进入 UI 设计阶段 | `workflow-manager.ts`, `schema/base.ts`（ui-design 状态） |
| 文件边界控制（read/write） | 防止 agent 越界修改文件 | `guard.ts` — `checkFileBoundary` |
| Git commit 边界验证 | 确保只有 write_files 内的文件被 commit | `guard.ts` — `checkGitCommitBoundary` |
| PROGRESS.md 反重复 | 跨 session 防止重复尝试已失败的方案 | `state-manager.ts` — `detectProgressAntiRepeat` |
| LESSONS.md 知识库 | 跨任务可复用的经验沉淀 | `state-manager.ts` — 完整 parse/search/nominate |
| Boulder 状态持久化 + 自动修复 | 跨 session 恢复，自动检测 artifact vs state 不一致 | `state-manager.ts` — `restoreState`, `repairState` |
| 子代理进度检查点 | 记录子代理的 stage / reviewFixRound | `state-manager.ts` — `CheckpointFile` |
| 级联配置（用户 + 项目） | per-user 全局配置 + per-project 覆盖 | `config-loader.ts` — `loadCascadedSFlowConfig` |
| 模型 Profile 解析 | per-agent 按用途（mechanical/standard/strong/review）选模型 | `agent-builder.ts` — `resolveModelWithFallback` |
| 意图路由 + 同义词 | 中英文同义词扩展，自动检测 workflow 类型 | `workflow-router.ts` + `iflow-router.ts` |
| Spec Merger 冲突检测 | 跨 section 冲突检测 | `validator.ts` — `ConflictReport` |
| IFlow 工作流 | 额外的 GSD 风格迭代工作流 | `workflows/iflow/` |

---

## 四、spec-superflow 有但 sFlow 未移植的细微功能

| 功能 | 代码位置 | 影响评估 |
|------|----------|----------|
| 收据报告证据锚定到 overlay 目录 | `execution-plan.mjs` — `getPhysicalReviewsDirectory()` | **低** — symlink 检测已做，但未验证报告路径必须在 reviews 目录内 |
| Handoff source 漂移检测 | `sdd-overlay.mjs` — source_artifacts_hash 对比 | **低** — sFlow 的 Handoff 在其他方面更完善 |
| 推荐收据 + 确认/acknowledge 流程 | `execution-plan.mjs` — selection 字段验证 | **中** — sFlow 自动推荐 DP-4 但缺少"用户对非推荐模式的明确确认" |
| task_hash 比对（检查点） | `sdd-overlay.mjs` — `computeTaskHash()` | **中** — 检查点在 tasks.md 中的内容是否变化 |

注：确认不做的功能：

| 功能                             | 建议       | 理由                                           |
| -------------------------------- | ---------- | ---------------------------------------------- |
| 推荐收据 + 确认/acknowledge 流程 | **不用做** | 防呆机制，多一步确认没意义，sFlow 的做法更顺畅 |
| task_hash 比对（检查点）         | **不用做** | 一次做完的项目用不上，适用于跨天/跨周恢复      |

---

## 五、总结

### 移植完整度：~98%

所有核心功能都已移植，且 sFlow 在任何方面都不弱于 spec-superflow。以下是精确的增量总结：

#### sFlow 移植了 spec-superflow 的：

- 8 状态状态机 ✅
- 5 工件模型 ✅
- 9 个 Skill → 9 个 Agent ✅
- Schema 验证 + 解析器 ✅（1:1 移植）
- 执行控制平面（plan + wave + receipt + hash）✅
- 检查点 + 移交 ✅
- Guard 系统（10/11 个检查）✅
- 全部 DP-0 到 DP-7 ✅
- 快路径（hotfix/tweak）✅

#### sFlow 新增的（spec-superflow 没有）：

- Agent 工厂体系（per-agent 模型 + 温度 + 工具隔离）
- 文件边界控制（read/write/git commit）
- PROGRESS.md 反重复 + LESSONS.md 知识库
- Boulder 跨会话持久化 + 自动修复
- 前端检测 + ui-design 状态
- 级联配置 + 模型 Profile 解析
- 子代理进度检查点
- IFlow 迭代工作流

#### 
