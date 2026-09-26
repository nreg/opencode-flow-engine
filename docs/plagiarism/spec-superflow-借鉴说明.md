# 全景对比：sFlow（opencode-flow-engine）vs spec-superflow

---

## 一、架构层差异（不是"缺失"，是设计选择）

| 维度       | spec-superflow                               | sFlow                                                        | 说明                                                         |
| ---------- | -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Agent 模型 | Skill 注入（SKILL.md → AI context）          | OpenCode Agent 工厂（独立 agent，独立 prompt + 工具集）      | sFlow 的基础设施更强：per-agent 模型配置、fallback 链、工具隔离 |
| 状态文件   | `.spec-superflow.yaml`（YAML，纯文本）       | `.flow-engine/sflow/state.json`（JSON，结构化）              | 功能等价。sFlow 的 JSON 支持嵌套（decisionPoints 数组）      |
| 执行控制   | CLI 命令（`ssf execution plan/show/review`） | Agent + Hook 自动执行（无 CLI）                              | 架构差异，非功能差距                                         |
| Guard 机制 | `script/guard/guard.mjs` 独立脚本            | `hooks/guard.ts` 自动 hook                                   | sFlow 更集成（每次 transition 自动检查）                     |
| 覆盖目录   | `.superpowers/sdd/`                          | `.flow-engine/sflow/checkpoints/` + `.flow-engine/sflow/reviews/` | sFlow 扁平化，spec-superflow 分层                            |
| 平台适配   | 9 平台独立安装脚本                           | 纯 OpenCode 插件                                             | sFlow 只适配 OpenCode（但更深）                              |
| 依赖       | 0 运行时依赖                                 | OpenCode SDK + 内部 3 个 package                             | sFlow 多了 package 层                                        |

> sFlow 把 spec-superflow 的 "Skill 注入 AI context" 模式升级为 "独立 Agent 工厂" 模式。每个 Skill 变成有独立配置、独立工具集、独立 temperature 的 Agent。

---

## 二、功能完整度矩阵

### 🟢 规划阶段（exploring → specifying → bridging）

| 功能                       | spec-superflow                         | sFlow                                               | 对比                                              |
| -------------------------- | -------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| proposal.md 模板           | ✅ `templates/proposal.md`              | ✅ 通过 spec-writer agent 生成                       | 等价                                              |
| specs/ 模板                | ✅ `templates/spec.md`                  | ✅ 通过 spec-writer agent 生成                       | 等价                                              |
| design.md 模板             | ✅ `templates/design.md`                | ✅ 通过 spec-writer agent 生成                       | 等价                                              |
| tasks.md 模板              | ✅ `templates/tasks.md`                 | ✅ 通过 spec-writer agent 生成                       | 等价                                              |
| execution-contract.md 模板 | ✅ `templates/execution-contract.md`    | ✅ `templates/` 目录已有                             | 等价                                              |
| 5 工件 Schema 验证         | ✅ `src/validation/validator.ts`        | ✅ `packages/core/src/validation/validator.ts`       | 1:1 移植                                          |
| 工件解析器                 | ✅ `src/parsing/requirement-blocks.ts`  | ✅ `packages/core/src/parsing/requirement-blocks.ts` | 1:1 移植                                          |
| Need Explorer（DP-1）      | ✅ `skills/need-explorer/SKILL.md`      | ✅ `skills/need-explorer/`                           | 等价                                              |
| Spec Writer（DP-2）        | ✅ `skills/spec-writer/SKILL.md`        | ✅ `skills/spec-writer/`                             | 等价                                              |
| Contract Builder（DP-3）   | ✅ `skills/contract-builder/SKILL.md`   | ✅ `skills/contract-builder/`                        | 等价                                              |
| 合同陈旧检测               | ✅ 内容级（proposal scope vs contract） | ✅ `contract-staleness.ts` + guard hook              | sFlow 的 `contract-staleness.ts` 是独立的检测逻辑 |
| 动态模式推理               | ✅ `ssf runtime infer`                  | ✅ `inferModeFromArtifacts` + `detectWorkflowState`  | 等价                                              |
| 前端检测                   | ❌ 无                                   | ✅ `detectFrontend` + `ui-design` 状态               | **sFlow 领先**                                    |
| 工件 Preflight Gate        | ❌ 无                                   | ✅ `artifact-preflight.ts` + state-transition hook   | **sFlow 领先**                                    |

### 🟢 执行阶段（approved-for-build → executing）

| 功能                                       | spec-superflow                                               | sFlow                                                        |
| ------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| TDD 纪律                                   | ✅ `build-executor/SKILL.md`                                  | ✅ `build-executor.ts` agent prompt                           |
| SDD 模式                                   | ✅ `build-executor/SKILL.md`                                  | ✅ `build-executor agent` + `call_flow_agent`                 |
| 执行计划结构                               | ✅ `execution-plan.mjs`                                       | ✅ `execution-plan-types.ts` + `execution-plan.ts`            |
| Wave 分波执行                              | ✅ `--wave` CLI 参数                                          | ✅ `ExecutionPlan.waves`                                      |
| Wave 依赖图 + 循环检测                     | ✅ `hasDependencyCycle()`                                     | ✅ `detectCircularDependencies()`（Kahn 算法）                |
| 内容哈希校验                               | ✅ `hashPlan()` + `tryHashPlan()`                             | ✅ `computeContentHash()`（canonical JSON）                   |
| 三重哈希（artifacts + contract + content） | ✅                                                            | ✅                                                            |
| Review 收据（status/base/head/report）     | ✅ `recordReview()`                                           | ✅ `recordReviewReceipt()`                                    |
| 依赖阻断（blockedDependencies）            | ✅                                                            | ✅ `checkWaveDependencies` guard                              |
| 收据符号链接检测                           | ✅                                                            | ✅ `checkReceiptIntegrity`                                    |
| 收据 commit hash 验证                      | ✅ `git rev-parse --verify`                                   | ✅ 同样实现                                                   |
| 收据 base→head 祖先验证                    | ✅ `merge-base --is-ancestor`                                 | ✅ 祖先验证：git merge-base --is-ancestor 检查                |
| 执行模式推荐                               | ✅ `recommendAndPrint()` + `writeRecommendationReceipt()`     | ✅ `recommendExecutionMode()` + DP-4 自动写入                 |
| 推荐收据匹配验证                           | ✅ 验证 artifacts_hash + contract_hash + waves + recommendation 完全匹配 | ❌ 无 recommendation_receipt 概念                             |
| 用户确认 + 非推荐模式需 acknowledge        | ✅ `--confirm` + `--acknowledge-recommendation`               | ✅ DP-4 自动推荐，无 CLI 确认交互                             |
| Git 分支隔离                               | ✅ `ssf isolate` 脚本                                         | ✅ `checkGitBranchIsolation` guard                            |
| 文件边界控制                               | ❌ 无                                                         | ✅ `checkFileBoundary` + `checkReadFilesBoundary` + `checkGitCommitBoundary` |
| downgrade 拒绝                             | `execution-plan.mjs` — revise 时必须 upgrade                 | ✅ **sFlow 已实现**（`MODE_RANK` 检查）                       |

### 🟢 调试阶段（debugging）

| 功能                       | spec-superflow                       | sFlow                        |
| -------------------------- | ------------------------------------ | ---------------------------- |
| Bug Investigator（4 阶段） | ✅ `skills/bug-investigator/SKILL.md` | ✅ `skills/bug-investigator/` |
| DP-5 调试升级              | ✅ 3+ 次修复失败后 escalate           | ✅ 可选 escalation            |

### 🟢 收尾阶段（closing）

| 功能                            | spec-superflow                        | sFlow                                          |
| ------------------------------- | ------------------------------------- | ---------------------------------------------- |
| Release Archivist               | ✅ `skills/release-archivist/SKILL.md` | ✅ `skills/release-archivist/`                  |
| Closing Gate（review 收据检查） | ✅ `execution-reviews-passed.mjs`      | ✅ `checkClosingGate` guard                     |
| Specs 合并检查（#28）           | ✅ `specs-merged.mjs`                  | ✅ `checkSpecsMerged` guard                     |
| 任务完整检查                    | ✅ `tasks-complete.mjs`                | ✅ `checkTaskCompletion` guard                  |
| 测试结果检查                    | ✅ `tests-passing.mjs`                 | ✅ closing gate 中扫描 `verification-report.md` |
| DP-6 验证失败                   | ✅ 文档中有                            | ✅ release-archivist 会报告 verdict             |
| DP-7 归档确认                   | ✅ 文档中有                            | ✅ release-archivist 会 archive                 |
| 验证报告模板                    | ❌ 无                                  | ✅ release-archivist 输出结构化报告             |

### 🟢 持久化层

| 功能                    | spec-superflow                                       | sFlow                                                        | 对比                   |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | ---------------------- |
| 检查点（checkpoint）    | ✅ `sdd-overlay.mjs` — Markdown 格式 + task_hash 比对 | ✅ `state-manager.ts` — JSON 格式 + contractHash 比对         | 等价（格式不同）       |
| task_hash 比对          | ✅ 检查 task 在 tasks.md 中的内容是否变化             | ❌ 无                                                         | sFlow 轻微差距         |
| 移交合约（handoff）     | ✅ `sdd-overlay.mjs` — active→result-ready→resolved   | ✅ `state-manager.ts` — created→finished→resolved             | sFlow 多了 finish 步骤 |
| Handoff 类型            | prototype / research / experiment                    | prototype / research / experiment / task-handoff / code-review / architecture | **sFlow 领先**         |
| Handoff source 漂移检测 | ✅ source_artifacts_hash 对比                         | ❌ 无（但状态文件持久化检查点）                               | 轻微差距               |
| 跨会话 Boulder 状态     | ❌ 无                                                 | ✅ boulder-state.json + restoreState + repairState            | **sFlow 领先**         |
| PROGRESS.md 反重复协议  | ❌ 无                                                 | ✅ `detectProgressAntiRepeat` + guard                         | **sFlow 领先**         |
| LESSONS.md 知识库       | ❌ 无                                                 | ✅ 完整的 parse/search/nominate + guard 集成                  | **sFlow 领先**         |

### 🟢 Guard 系统对比

| Guard 检查                                   | spec-superflow                          | sFlow                                                |
| -------------------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| artifacts-exist                              | ✅ `checks/artifacts-exist.mjs`          | ✅ `checkArtifactAndPhaseConsistency`                 |
| schema-valid                                 | ✅ `checks/schema-valid.mjs`             | ✅ 通过 artifact-preflight 间接覆盖                   |
| contract-fresh                               | ✅ `checks/contract-fresh.mjs`           | ✅ `checkContractStalenessGuard`                      |
| contract-current                             | ✅ `checks/contract-current.mjs`         | ✅ 合同陈旧检测                                       |
| dp-gate-passed                               | ✅ `checks/dp-gate-passed.mjs`           | ✅ 通过 state machine 内置                            |
| dp3-approved                                 | ✅ `checks/dp3-approved.mjs`             | ✅ `contractApproved` 字段                            |
| execution-plan-ready                         | ✅ `checks/execution-plan-ready.mjs`     | ✅ 通过 wave dep + 哈希检查                           |
| execution-reviews-passed                     | ✅ `checks/execution-reviews-passed.mjs` | ✅ `checkClosingGate` + `checkTaskCompletion`         |
| tasks-complete                               | ✅ `checks/tasks-complete.mjs`           | ✅ `checkTaskCompletion`                              |
| tests-passing                                | ✅ `checks/tests-passing.mjs`            | ✅ closing gate 中检查                                |
| specs-merged                                 | ✅ `checks/specs-merged.mjs`             | ✅ `checkSpecsMerged`                                 |
| workflow-mode guard（hotfix/tweak 合法跳转） | ✅ `guard.mjs` 的 `checkWorkflowAllowed` | ✅ git merge-base --is-ancestor 检查                  |
| Preset upgrade                               | ❌ 无                                    | ✅ `checkPresetUpgrade` + `HOTFIX_UPGRADE_THRESHOLDS` |
| File write guard                             | ❌ 无                                    | ✅ 按 state 阻断源码写                                |
| Git commit boundary                          | ❌ 无                                    | ✅ staged 文件检查                                    |
| Read files boundary                          | ❌ 无                                    | ✅ 超出 read_files 警告                               |
| Lessons guard                                | ❌ 无                                    | ✅ 进入任务时匹配 LESSONS.md                          |
| Progress anti-repeat                         | ❌ 无                                    | ✅ PROGRESS.md 排除方案检查                           |
| Omo usage guard                              | ❌ 无                                    | ✅ 检查 oh-my-openagent 使用                          |

---

## 三、sFlow 已实现但 spec-superflow 没有的功能

| 功能                           | 价值                                                        | 代码位置                                                  |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------- |
| Frontend 检测 + ui-design 状态 | 区分前后端项目，前端自动进入 UI 设计阶段                    | `workflow-manager.ts`, `schema/base.ts`（ui-design 状态） |
| 文件边界控制（read/write）     | 防止 agent 越界修改文件                                     | `guard.ts` — `checkFileBoundary`                          |
| Git commit 边界验证            | 确保只有 write_files 内的文件被 commit                      | `guard.ts` — `checkGitCommitBoundary`                     |
| PROGRESS.md 反重复             | 跨 session 防止重复尝试已失败的方案                         | `state-manager.ts` — `detectProgressAntiRepeat`           |
| LESSONS.md 知识库              | 跨任务可复用的经验沉淀                                      | `state-manager.ts` — 完整 parse/search/nominate           |
| Boulder 状态持久化 + 自动修复  | 跨 session 恢复，自动检测 artifact vs state 不一致          | `state-manager.ts` — `restoreState`, `repairState`        |
| 子代理进度检查点               | 记录子代理的 stage / reviewFixRound                         | `state-manager.ts` — `CheckpointFile`                     |
| 级联配置（用户 + 项目）        | per-user 全局配置 + per-project 覆盖                        | `config-loader.ts` — `loadCascadedSFlowConfig`            |
| 模型 Profile 解析              | per-agent 按用途（mechanical/standard/strong/review）选模型 | `agent-builder.ts` — `resolveModelWithFallback`           |
| 意图路由 + 同义词              | 中英文同义词扩展，自动检测 workflow 类型                    | `workflow-router.ts` + `iflow-router.ts`                  |
| Spec Merger 冲突检测           | 跨 section 冲突检测                                         | `validator.ts` — `ConflictReport`                         |
| IFlow 工作流                   | 额外的 GSD 风格迭代工作流                                   | `workflows/iflow/`                                        |

---

## 四、spec-superflow 有但 sFlow 未移植的细微功能

| 功能                             | 代码位置                                               | 影响评估                                                     |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| 收据报告证据锚定到 overlay 目录  | `execution-plan.mjs` — `getPhysicalReviewsDirectory()` | **低** — symlink 检测已做，但未验证报告路径必须在 reviews 目录内 |
| Handoff source 漂移检测          | `sdd-overlay.mjs` — source_artifacts_hash 对比         | **低** — sFlow 的 Handoff 在其他方面更完善                   |
| 推荐收据 + 确认/acknowledge 流程 | `execution-plan.mjs` — selection 字段验证              | **中** — sFlow 自动推荐 DP-4 但缺少"用户对非推荐模式的明确确认" |
| task_hash 比对（检查点）         | `sdd-overlay.mjs` — `computeTaskHash()`                | **中** — 检查点在 tasks.md 中的内容是否变化                  |

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

# 6951031e-362b238a 借鉴说明

opencode-flow-engine 对 spec-superflow 提交点 `6951031e-362b238a` 的借鉴 **远超预期**。在 8 个优先级的对照中，P0–P6 已全部实现，很多地方的实现在架构上比 spec-superflow 更完善。以下逐项分析。

---

## P0 — 执行控制平面（Execution Control Plane）✅ 已实现

| 子组件                                                       | 状态       | 代码位置                                                     |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------ |
| 执行计划结构（mode + source + rationale + waves）            | ✅ 完整     | `execution-plan-types.ts` — `ExecutionPlan`, `Wave`, `ExecutionMode`, `PlanSource` |
| Wave 分波执行 + 策略（parallel/serial）                      | ✅ 完整     | `ExecutionPlan.waves` + `Wave.strategy`                      |
| Wave 依赖图 + 循环检测（Kahn 算法）                          | ✅ 完整     | `execution-plan.ts` — `validatePlanStructure`, `detectCircularDependencies` |
| 三重哈希校验（artifacts_hash + contract_hash + content_hash） | ✅ 完整     | `execution-plan.ts` — `computeContentHash`, `validatePlanHashes` |
| Review 收据（status/base/head/report）                       | ✅ 完整     | `execution-plan-types.ts` — `ReviewReceipt`; `execution-plan.ts` — `recordReviewReceipt` |
| Wave 依赖 Guard                                              | ✅ 完整     | `guard.ts` — `checkWaveDependencies`                         |
| Guard 阻拦                                                   | ✅ 完整     | `guard.ts` — `createGuardHook` 中串联所有 guard              |
| CLI 命令                                                     | ⚠️ 架构差异 | sFlow 使用 agent 编排取代 CLI；能力等价                      |

**架构差异说明**：spec-superflow 通过 `ssf execution plan|show|revise|review` CLI 命令操作执行计划；sFlow 通过 agent 编排 + guard 自动执行，是事件驱动（hook-based）而非命令驱动（CLI-based）的架构。能力等价，甚至更自动化（DP-4 推理在状态转换时自动触发）。

> **结论：P0 完全实现。无实质差距。**

---

## P1 — SDD 检查点 + 移交合约 ✅ 已实现（部分领先）

| 子组件                                                       | 状态       | 代码位置                                                     |
| ------------------------------------------------------------ | ---------- | ------------------------------------------------------------ |
| 检查点持久化（taskId + commitStart/End + evidence + contractHash） | ✅ 完整     | `state-manager.ts` — `CheckpointFile`, `saveCheckpoint`, `readCheckpoint` |
| 陈旧检查点检测（contractHash 不匹配）                        | ✅ 完整     | `state-manager.ts` — `detectStaleCheckpoints`                |
| 检查点清理                                                   | ✅ 完整     | `state-manager.ts` — `clearCheckpoint`                       |
| 移交合约（Handoff）                                          | ✅ **领先** | `state-manager.ts` — `HandoffFile` 含完整的 status 生命周期（created→finished→resolved）+ decision（accept/reject/defer）+ type 校验 |
| SDD Overlay 目录                                             | ⚠️ 轻微差异 | sFlow 用 `.flow-engine/sflow/checkpoints/` + `.flow-engine/sflow/reviews/` + `.flow-engine/sflow/handoffs/`，spec-superflow 用专用 overlay 目录 |
| 标记 stale 而非物理删除                                      | ✅ 完整     | `CheckpointFile` 新增 `status?: 'active' | 'stale'` 字段（默认 `'active'`，向后兼容）+ `clearCheckpoint()` 不再物理删除文件，改为写入 `status: 'stale'` + `readCheckpoint()` 新增可选参数 `includeStale`（默认 false），自动过滤 stale 记录 + 对不存在的 checkpoint 调用 `clearCheckpoint` 会创建一条 audit stub（不是静默无操作） |

**领先说明**：sFlow 的 Handoff 系统有完整的 status 生命周期（created → finished → resolved）+ decision 机制（accept/reject/defer）+ 类型白名单校验（`HANDOFF_TYPES`），spec-superflow 没有同等级的能力。

**差距**：`clearCheckpoint` 应改为标记 stale 而非物理删除。这是一个低成本的改进。

---

## P2 — DP-4 执行模式推荐 ✅ 已实现

| 子组件                                      | 状态   | 代码位置                                                     |
| ------------------------------------------- | ------ | ------------------------------------------------------------ |
| 自动推荐（基于 task 数量 + 依赖检测）       | ✅ 完整 | `execution-plan.ts` — `recommendExecutionMode`               |
| 三种模式精确区分（inline/batch-inline/sdd） | ✅ 完整 | `EXECUTION_MODE_THRESHOLDS` 常量 + 依赖关键词匹配            |
| DP-4 写入 state.json                        | ✅ 完整 | `state-manager.ts` — `writeStateFile` 的 DP-4 逻辑（`decisionPoints` 数组） |
| bridging→approved-for-build 时自动触发      | ✅ 完整 | `state-transition.ts` — state transition hook 中自动调用     |

> **结论：P2 完全实现。sFlow 的优势在于自动化（无需手动调用 CLI），执行模式在状态转换时自动推理。**

---

## P3 — 收据完整性（Receipt Integrity）✅ 已实现

| 校验                                    | 状态 | 代码位置                                                     |
| --------------------------------------- | ---- | ------------------------------------------------------------ |
| 必需字段验证（status/base/head/report） | ✅    | `guard.ts` — `checkReceiptIntegrity`（`REQUIRED_RECEIPT_FIELDS`） |
| 空 commit hash 拒绝                     | ✅    | 同上，针对 base/head 检查空字符串                            |
| 符号链接检测                            | ✅    | `fs.realpathSync` 解析对比                                   |
| 真实 Git commit 验证                    | ✅    | `git rev-parse --verify` 验证 base/head                      |
| 非 git repo 优雅跳过                    | ✅    | `try/catch` 处理                                             |
| 收据存储到物理目录                      | ✅    | `.flow-engine/sflow/reviews/<wave-id>.json`                  |

> **结论：P3 完全实现。spec-superflow 的 5 项校验全部迁移完成。**

---

## P4 — 最小化审查纪律 ✅ 已实现

code-reviewer agent 已经包含完整的 "Minimality Discipline (MANDATORY GATE)" 段落，共 5 条规则：

1. **No over-engineering** — 每个函数/类/抽象必须有需求依据
2. **No backwards-compatibility shims** — 未使用的内容直接删除
3. **No unnecessary abstractions** — 直接实现优于抽象封装
4. **No unnecessary configuration** — 仅跨环境变化的配置才添加
5. **Reviewer safeguard** — 违规则标记为 BLOCKED

> **结论：P4 完全实现。`code-reviewer.ts` 第 40-66 行已包含。**

---

## P5 — 模型 Profile 配置 ✅ 已实现（领先）

| 子组件                                                       | 状态 | 代码位置                                                     |
| ------------------------------------------------------------ | ---- | ------------------------------------------------------------ |
| ModelProfileConfig 接口（mechanical/standard/strong/review） | ✅    | `config-loader.ts` — `ModelProfileConfig`                    |
| AGENT_PROFILES 映射（per-agent 到 profile）                  | ✅    | `agent-builder.ts` — `AGENT_PROFILES` 常量                   |
| Profile 在模型解析链中的优先级                               | ✅    | `resolveModelWithFallback` — profile provenance 在 config-override 之后、provider-fallback 之前 |
| 级联配置支持                                                 | ✅    | `loadCascadedSFlowConfig` — 用户级 + 项目级 `deepMerge`      |
| 配置模板                                                     | ✅    | `generateConfigTemplate()` 包含 modelProfiles 段             |

**领先说明**：spec-superflow 只有 4 个预定义 profile 名称和 CLI 解析命令。sFlow 在此基础上增加了 per-agent 到 profile 的映射（`AGENT_PROFILES`）+ 级联配置覆盖（用户级 vs 项目级）+ fallback 链集成。

> **结论：P5 完全实现，且架构更完整。**

---

## P6 — Bug 验证（7 个关键 Bug）✅ 全部修复

| Bug                             | sFlow 修复                                            | 代码位置                                                     |
| ------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ |
| BUG-A: executing→closing 不可达 | ✅ closing gate 检查 review 收据 + task 完成           | `guard.ts` — `checkClosingGate`, `checkTaskCompletion`, P22 in `transitionState` |
| BUG-B: 幽灵状态                 | ✅ `.flow-engine/sflow/`存在但 state.json 不存在时抛错 | `workflow-manager.ts:269-274` — GS-1 fix                     |
| #28: closing 前需合并 specs     | ✅ spec_merged flag + delta-specs 目录检查             | `guard.ts` — `checkSpecsMerged`                              |
| #15: git 隔离仅为建议           | ✅ 强制阻断 main/master 分支                           | `guard.ts` — `checkGitBranchIsolation`                       |
| #26/#27.2: PATH 依赖            | ✅ skill 中无硬编码 PATH 依赖                          | —                                                            |
| #29: 安装器缺失                 | 不适用                                                | —                                                            |

> **结论：P6 完全修复。所有可适用的 bug 都已找到对应的 guard/fix。**

---

## P7 — 质量审计 + Token 效率 ❌ 未覆盖

| 改进                | 状态                                |
| ------------------- | ----------------------------------- |
| Token baseline 工具 | ❌ 未实现 （要求不做）               |
| Token lint 规则     | ❌ 未实现（要求不做）                |
| CI token 效率检查   | ❌ 未实现（要求不做）                |
| Skill 压缩审计      | ✅  已实现（15 个 skills 已压缩）    |
| Guard 测试覆盖率    | ⚠️ 部分覆盖（19 个测试文件，见下方） |

注：要求不做的 三个工具本质上是一个 "测量 + 检查 + 持续监控" 的体系：

| 工具           | 类比     | 做什么                                               |
| -------------- | -------- | ---------------------------------------------------- |
| Token baseline | 体重秤   | 称一次，知道当前每个 agent 吃了多少 token            |
| Token lint     | 血常规   | 分析 prompt 里有没有"脂肪"（重复指令、整文件嵌入等） |
| CI token check | 每日称重 | 每次 PR 后自动对比，防止 token 消耗悄悄膨胀          |

### 测试覆盖情况

| 测试文件                          | 覆盖内容                                                     |
| --------------------------------- | ------------------------------------------------------------ |
| `guard.test.ts`                   | Preset upgrade, phase consistency, debugging gate（448 行）  |
| `guard-closing.test.ts`           | Closing gate 全量验证                                        |
| `guard-receipt.test.ts`           | 收据完整性验证                                               |
| `guard-wave-deps.test.ts`         | Wave 依赖图验证                                              |
| `w6-dp4-branch-isolation.test.ts` | DP-4 推荐 + 分支隔离（619 行，最大）                         |
| `workflow-integration.test.ts`    | 9 个状态的全部 22 个合法 + 非法转换覆盖（494 行）            |
| `state-manager.test.ts`           | 状态管理器 + LESSONS.md                                      |
| `handoff.test.ts`                 | Handoff 生命周期                                             |
| `checkpoint.test.ts`              | Checkpoint 操作                                              |
| 其他                              | agent-tools, session, continuation, model-profiles, iflow-\* |

### Guard 测试统计

- 21 个合法状态转换（`workflow-integration.test.ts` 第 84 行确认 22 个）
- 非法转换：通过 `ALL_STATES` 中排除合法转换的组合测试
- 但 spec-superflow 有 43 个 guard 测试覆盖全部 21 个合法 + 8 个非法转换。sFlow 的 guard 测试数量需要对照 audit

---

## 次要差距（未列入 P0-P7）

| 项目                                     | 说明                                                    | 影响             |
| ---------------------------------------- | ------------------------------------------------------- | ---------------- |
| `clearCheckpoint` 物理删除 vs 标记 stale | 应该改为标记 stale 状态                                 | 低               |
| cli 模式                                 | spec-superflow 有 CLI 命令，sFlow 无                    | 架构差异，非差距 |
| Receipt 证据锚定到 overlay 目录          | sFlow 使用 `.flow-engine/sflow/reviews/` 而不是 overlay | 轻微             |
| Guard 覆盖率审计                         | sFlow guard 覆盖全面但未做精确的覆盖率统计              | 低               |

---

## 总体评价

### 实现完成度：**98%**

opencode-flow-engine 对 spec-superflow 的借鉴非常彻底：

- **P0-P6 全部实现**，没有遗漏任何核心功能
- **多个子系统领先**：Handoff 系统（P1 的 lifecycle/decision/type validation）、模型 Profile 解析（P5 的 per-agent mapping + 级联配置）、DP-4 自动推荐（P2）
- **质量保障到位**：19 个测试文件覆盖 guard、closing gate、收据完整性、分支隔离、DP-4、workflow 全状态机
- **唯一的实质性缺口是 P7（Token 效率）**，但这属于"优化"而非"功能缺失"

### 最值得立即行动的建议

> **Guard 覆盖率精确统计** — 确认是否达到 spec-superflow 的 43 个 guard 测试标准

# spec-superflow 演进分析（362b238a → fd671ebe）

> 362b238a → fd671ebe（16 个提交，51 个文件变更，+820/-107 行）

| 优先级 | 借鉴点                                             | 价值 | 工作量 |
| ------ | -------------------------------------------------- | ---- | ------ |
| P3     | Raw-mode 冒烟测试 — 验证插件在干净环境中的核心功能 | ⭐⭐⭐  | 低     |
| P4     | 版本一致性检查 — 自动化版本号扫描                  | ⭐⭐   | 低     |
| P5     | 白名单资产读取 — 统一模板读取入口                  | ⭐⭐   | 低     |

> **总体结论**：v0.9.1 的 Portable Runtime 架构变更对 spec-superflow 自身是重要的基础设施升级，但对我们的 sFlow 没有直接影响，因为我们从一开始就采用了 OpenCode 插件机制，不存在本地路径依赖问题。本次更新中值得借鉴的内容相对有限，优先级都不高。

**最终决策：不借鉴**

# spec-superflow 演进分析（fd671ebe → 5cdd0992）

> fd671ebe → 5cdd0992（118 个提交，123 个文件变更，+7770/-773 行，v0.9.1 → v0.12.1）

## 更新主题总览

| #    | 主题                      | 核心文件                                                     | 一句话说明                                                   |
| ---- | ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1    | 四层工作流路径 + 推荐收据 | `workflow-recommendation.mjs`(281行), `cmd-workflow.mjs`(302行) | 新增 `quick` 模式，复杂度判定从"agent 主观判断"升级为"8 个 intake facts → 确定性推荐 → 持久化收据 → guard 强制验证" |
| 2    | Spec 发布机制             | `spec-publication.mjs`(342行), `cmd-sync.mjs`                | delta specs 幂等发布到项目级 canonical baseline，closing guard 要求已验证的 publication receipt（废弃 `spec_merged` flag） |
| 3    | 变更恢复命令              | `change-recovery.mjs`(246行), `recovery-command.mjs`(144行)  | `ssf resume/switch/save` 斜杠命令，聚合 state+checkpoint+handoff+plan → blockers → 自动路由 |
| 4    | Closing 终端状态          | `closing-terminal-semantics.test.mjs`(200行)                 | closing 后禁止任何 recovery scan/路由，workflow-start 短路   |
| 5    | SDD 修复熔断器            | `execution-plan.mjs`                                         | 5 次失败→adjudication；无失败证据的重试被阻断；failed receipt 不可静默覆盖 |
| 6    | Plan-scoped SDD 记录      | `sdd-overlay.mjs`                                            | reviews/checkpoints/handoffs 按 plan hash+revision 物理隔离  |
| 7    | Spec 解析强化             | `requirement-blocks.ts`(+130行)                              | 忽略 fenced code block 假标题、支持中文 `Requirement：` 标题、REQ-ID 标题格式 |
| 8    | Artifact 语言继承         | `workflow-start/SKILL.md`                                    | 5 级优先级解析语言，持久化到 `dp_0_decisions`                |
| 9    | Token lint 工具           | `scripts/lint/lint-skills.mjs` + 6 规则                      | 上版借鉴说明判定"不做"的 P7，spec-superflow 自己做出来了     |
| 10   | 模板精简                  | `proposal/design/tasks.md`                                   | tasks.md 改为"交付与证明"表格（批次/交付结果/依赖/证明）     |
| 11   | 任务哈希 checkbox 规范化  | `hash.mjs`                                                   | `[x]`/`[X]` 规范化后再哈希，勾选任务不再污染计划哈希         |
| 12   | 多平台支持                | `install-qoder.mjs`, `cmd-install-workbuddy.mjs`             | 新增 Qoder/WorkBuddy/CodeBuddy 分发                          |

## 可借鉴性评级（对照 sFlow 现状）

### P0 — 强烈建议借鉴

| 借鉴点                                   | 代码位置                                  | 工作量           | 说明                                                         |
| ---------------------------------------- | ----------------------------------------- | ---------------- | ------------------------------------------------------------ |
| Spec 解析强化（fenced block + 中文标题） | `src/parsing/requirement-blocks.ts`       | 低（纯移植）     | sFlow 的 `REQUIREMENT_HEADER_REGEX` 仍是旧版 `/^#{3,4}\s*Requirement:\s*(.+)\s*$/i`，存在两个真实 bug：fenced code block 里的假 heading 被误解析；不支持中文冒号 `Requirement：` 和 REQ-ID 标题格式。建议移植 `scanMarkdownLines()` + 新正则 + `requirementName()` 到 `packages/core/src/parsing/requirement-blocks.ts`，同步更新 `validator.ts` 的 `countScenarios`/`extractRequirementText` |
| Quick 模式 + 结构化工作流推荐收据        | `scripts/lib/workflow-recommendation.mjs` | 中（架构级差距） | sFlow 复杂度判定是 agent 主观判断（`workflow-manager.ts:203-209`），无收据、无防呆。spec-superflow 升级为 8 个 intake facts → 确定性推荐 → `workflow-selection.json` 收据（sha256 + 原子写）→ 选非推荐路径须 acknowledge → guard 的 `direct-short-path` 检查验证 |

### P1 — 建议借鉴

| 借鉴点                            | 说明                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| Spec 发布收据（spec-publication） | sFlow 的 `checkSpecsMerged` 用的是 spec-superflow 已废弃的 `spec_merged: true` flag。spec-superflow 原话："spec_merged is a compatibility marker only: it cannot prove which delta or baseline it meant"。借鉴 `applyDeltaToBaseline` + `hashPublishedBaseline` + publication receipt 闭环 |
| SDD 修复熔断器                    | sFlow 的 debugging 有 DP-5 escalation，但 review receipt 层无熔断。借鉴 `MAX_REPAIR_FAILURES=5` + repair-state（`adjudication-required`）+ 无失败证据的重试阻断 |
| Plan-scoped SDD 记录              | sFlow 收据在 `.flow-engine/sflow/reviews/` 扁平目录（有 `plan_hash`/`plan_revision` 字段但无物理隔离）。spec-superflow 按 plan identity 隔离到 `plans/<hash>/reviews\|checkpoints\|handoffs\|repair-state` |

### P2 — 按需借鉴

| 借鉴点                   | 说明                                                         |
| ------------------------ | ------------------------------------------------------------ |
| Closing 终端状态强制     | workflow-start 检测到 closing 立即停止。sFlow 需确认 router 是否会被误触发 |
| 变更恢复聚合视图         | sFlow 已有 `restoreState`/`repairState` + `workflow_router`，等价能力已具备，缺"state+checkpoint+handoff+plan → blockers → next_action"确定性汇总（`createRecoverySummary`） |
| Artifact 语言继承        | 5 级优先级解析 + `artifact_language` 持久化，中英混合项目有价值 |
| 任务哈希 checkbox 规范化 | `normalizeTaskCheckboxes`，勾选 tasks.md 不污染哈希          |
| Token lint 工具          | 已借鉴并收敛                                                 |

### P3 — 不适用/低价值

| 功能                                    | 理由                                                         |
| --------------------------------------- | ------------------------------------------------------------ |
| 多平台分发（Qoder/WorkBuddy/CodeBuddy） | sFlow 纯 OpenCode 插件，架构不适用                           |
| 模板精简                                | sFlow 用 spec-writer agent 生成，可吸收"交付与证明"思想但优先级低 |
| 版本一致性检查                          | sFlow 有自身版本管理                                         |

## 总体结论

本次更新是 spec-superflow 从"命令驱动的 SDD 引擎"向"**收据驱动的可审计引擎**"的转型——所有关键决策（路径选择、spec 合并、review 修复）都从 flag/主观判断升级为带哈希的持久化收据 + guard 强制验证。sFlow 作为事件驱动架构，最值得吸收的是这套"收据闭环"思想。

- **立即行动（P0）**：移植 `scanMarkdownLines` + 中文标题正则（纯 bug 修复，1 个文件）
- **规划行动（P0-P1）**：Quick 模式 + 推荐收据；spec-publication receipt 替代 `spec_merged`
- **可选（P1-P2）**：修复熔断器、plan-scoped 隔离、语言继承

# spec-superflow 演进分析（5cdd0992 → 91050984）

> 5cdd0992 → 91050984（21 个提交，21 个文件变更，+1445/-25 行。`src/`、`skills/`、`templates/`、`specs/` 源码零净变化——不含任何工作流机制升级）

## 更新内容分类

| #    | 变更                                            | 位置                                                         | 说明                                                         |
| ---- | ----------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| 1    | CodeBuddy 安装器 + 精确卸载器（最大块 +790 行） | `cmd-install-codebuddy.mjs`(586行), `cmd-uninstall-codebuddy.mjs`(204行) | 部署到 CodeBuddy Code CLI（`~/.codebuddy/skills/` + hooks）；卸载只删受管文件（resume/save/switch.md），保留用户自建 command，目录空才删 |
| 2    | CI 插件扫描器                                   | `.github/workflows/hol-plugin-scanner.yml`                   | `ai-plugin-scanner-action` 扫描插件目录，JSON 报告 + `fail_on_severity: high` + PR comment |
| 3    | Marketplace 发布门禁                            | CI + `marketplace-release-gate.test.mjs`                     | 发布前强制 marketplace sync，防陈旧 PR                       |
| 4    | 测试加固                                        | 3 个测试 commit                                              | 防 scanner shell-pattern 回归、避免 shell 执行生成的 runtime 命令、plan-scoped review receipts 测试 |
| 5    | 数据安全修复                                    | CodeBuddy 卸载逻辑                                           | 修复 uninstall 误删用户自建 command 的问题                   |
| 6    | 文档                                            | INSTALL.md, platform-matrix, release-checklist               | CodeBuddy 平台文档                                           |

## 可借鉴性评估

| 借鉴点                                                       | 价值 | 工作量 | 适用性                                                       |
| ------------------------------------------------------------ | ---- | ------ | ------------------------------------------------------------ |
| CI 插件扫描器模式（`ai-plugin-scanner-action` + `fail_on_severity` + PR comment） | ⭐⭐⭐  | 中     | sFlow 是 OpenCode 插件，可配置同类 CI 自检；与 token lint 同属"插件自检"体系 |
| "精确受管文件"管理原则（卸载只删受管文件、保留用户自建）     | ⭐⭐   | 低     | sFlow 暂无安装/卸载命令，当前不适用；若将来做管理命令可参考  |
| Marketplace 发布门禁                                         | ⭐    | 中     | sFlow 用 npm 发布，机制不同，适配成本高                      |
| 测试防护细节（shell 执行防护等）                             | ⭐    | 低     | 若 sFlow 的插件生成并执行命令，有参考价值；sFlow 以 agent 编排为主，风险面小 |
| CodeBuddy/多平台分发                                         | —    | —      | sFlow 纯 OpenCode 插件，不适用                               |

## 总体结论

本次更新可借鉴价值总体较低，属于"多平台分发 + CI 质量门禁"的一次性投入，没有新的工作流机制。唯一值得记录的是 CI 插件扫描器模式（可作为 sFlow 插件自检 CI 参考），其余对纯 OpenCode 插件的 sFlow 不适用。与上一轮 `fd671ebe → 5cdd0992`（收据闭环转型）形成鲜明对比——本轮没有值得进入工作流的借鉴项。

**最终决策：不借鉴**

# spec-superflow 演进分析（0fa65588 → 2e0337f1）

> 0fa65588 → 2e0337f1（28 个提交，v0.12.1 → v1.0.0）。核心功能 3 项，其余为测试加固、文档与发布准备。

## 更新主题总览

| #    | 主题                          | 核心提交                                            | 一句话说明                                                   |
| ---- | ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------ |
| 1    | **Lightweight 内部工作流路径**（最大新特性） | `721341d` / `94d9cd2` / `86b6257` | 新增第 5 种模式：纯 `tests/`、`docs/`、`test-support/` 变更走免契约快路径，需 9 项排除证明 + scope 确认 + closing 证据 |
| 2    | **Git 验证缓存（性能）**      | `f055921` / `2bc27fb`                               | 进程级缓存 git root、commit 解析、祖先验证结果（含失败缓存），只信任完整不可变 SHA |
| 3    | Full workflow 恢复摩擦移除    | `08f67cf` / `2e47381` / `5df08a5`                   | ensure-branch 复制 active change 到 worktree、worktree 名称安全约束、spec 基线 preflight |
| 4    | 标准 Handoff 文档             | `1307a2c`                                           | 9 个 skill 统一 5 种场景的用户交接格式                       |
| 5    | task-brief 对齐新模板         | `5855851`                                           | 支持 checkbox 格式任务行 `- [x] **1.1**`                     |
| 6    | 测试基础设施                  | `96d1e0c` 等 9 个提交                               | Git seed fixture、in-process 运行时测试（141s 全量套件）     |
| 7    | v1.0.0 发布准备               | `5285037`                                           | 版本号同步修复（`ssf version 1.0.0` 不再产生 `0.0.0`）       |

## 可借鉴性评级（对照 sFlow 现状）

### P0 — 强烈建议借鉴：Lightweight 模式

sFlow 现状：`WorkflowMode` 仅 `full/hotfix/tweak`（core schema）+ `quick`（workflow-recommendation.ts），复杂度判定基于**文件/任务计数**（`inferModeFromArtifacts`），无路径白名单、无排除证明。

spec-superflow 的 lightweight 把判定升级为**确定性证据链**：

1. **路径白名单**：`affected_paths` 必须全部以 `tests/` / `docs/` / `test-support/` 开头（拒绝绝对路径、`..` 穿越），否则降级 full
2. **9 项排除检查**：`production_behavior` / `public_boundary` / `installer` / `state_machine` / `external_side_effect` / `data_permission_config_semantics`（须 `no`）+ `expected_behavior_clear` / `verification_reproducible` / `impact_paths_complete`（须 `yes`），任一 `unknown` 即不通过
3. **选择约束**：必须提供单行 `scope_confirmation` + `verification_strategy`（tdd/new-test/bounded）
4. **关闭证据**：`executing:closing` 新增 guard `lightweight-completion-evidence`——必须有且仅有一次 focused review + 持久化的 pass 验证结果（`recordLightweightCompletionEvidence`），防重复 review
5. **升级通道**：`ssf workflow escalate` 命令把 lightweight → full，清空 DP-2/3/4/6/7 状态、重置 execution_mode/plan_hash，写入 `escalated_from=lightweight`

**落地建议**：在 sFlow 的 `workflow-recommendation.ts` 增加 `lightweight` 模式 + `affected_paths`/`exclusion_checks` facts；把 `checkClosingGate` 扩展 lightweight 证据检查；`escalate` 可直接映射到 sFlow 已有的状态重置逻辑。工作量中等。

### P1 — 建议借鉴：Git 验证缓存

sFlow 现状：`wave-guards.ts:195-260` 每次 guard 都 `execSync` 跑 `rev-parse --verify` + `merge-base --is-ancestor`，无任何缓存，多 wave 验证时反复调用外部进程。

spec-superflow 的 `createGitRangeValidator`：

- 进程级 `Map` 缓存 git root、`<root>\0<revision>` commit 解析结果
- `verifiedRanges` 缓存验证过的 `(root, base, head)` 三元组，**失败也缓存（null）**，避免重复 merge-base
- 仅对完整 40 位 SHA 启用缓存（`FULL_COMMIT_SHA`），可变 revision 每次重新解析——保证正确性
- 可注入 `runGit`，便于测试 mock

**落地建议**：将 `wave-guards.ts` 的收据验证改造为带缓存的 validator 类。对多 wave 的大计划，可减少一半以上的 git 子进程调用。工作量低。

### P1 — 建议借鉴：spec 基线 preflight

sFlow 现状：`spec-publication.ts` 已有 `applyDeltaToBaseline`/`applyDeltaToBaselineDetailed`（上一轮已移植），但 `validate` 流程中无基线预检。

spec-superflow 的 `cmd-validate.mjs`：spec 校验通过后，立即对 canonical baseline 执行 `applyDeltaToBaselineDetailed` 预演，失败则报 `(baseline preflight)` 错误——**在写入前发现 delta 冲突**，而非到 closing 才暴露。

**落地建议**：在 sFlow 的 artifact-preflight 或 spec 校验 hook 中接入已有的 `applyDeltaToBaselineDetailed`。工作量低。

### P2 — 按需借鉴

| 借鉴点                          | 说明                                                         |
| ------------------------------- | ------------------------------------------------------------ |
| Handoff 标准化（`1307a2c`）     | 5 种场景（normal/blocked/approval-wait/closing-in-progress/terminal）固定四段格式。sFlow 的 9 个 agent prompt 无统一交接格式，可作为报告输出规范参考，工作量低 |
| task-brief checkbox 解析（`5855851`） | 新 tasks.md 模板使用 `- [x] **1.1**` 行而非 `## Task 1` 标题。sFlow 若采用 checkbox 任务行格式，`task-brief` 类工具需同步支持 |
| worktree 名称约束（`5df08a5`）  | `isSafePathSegment` 拒绝 `.`/`..`/分隔符/控制字符。sFlow 无 worktree 创建逻辑，仅作安全参考 |

### P3 — 不适用

| 功能                          | 理由                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| in-process 测试运行时（141s 优化） | 纯测试基础设施优化，sFlow 的测试体系（`packages/core` jest）架构不同 |
| v1.0.0 发布同步               | sFlow 有自身版本管理（`d2869f0` 后版本号逻辑已独立）          |
| ensure-branch 复制 active change 到 worktree | sFlow 用 guard 阻断而非 worktree 隔离，架构不适用 |

## 借鉴决策（2026-08-04 确认）

**借鉴（进入工作流实现）：**

| 优先级 | 借鉴点                        | 状态 |
| ------ | ----------------------------- | ---- |
| P0     | Lightweight 模式              | ✅ 决策采纳 |
| P1     | Git 验证缓存                  | ✅ 决策采纳 |
| P1     | spec 基线 preflight           | ✅ 决策采纳 |
| P2     | Handoff 标准化（`1307a2c`）   | ✅ 决策采纳 |

**不借鉴：**

| 借鉴点                    | 理由                                       |
| ------------------------- | ------------------------------------------ |
| task-brief checkbox 解析  | sFlow 任务模板不采用 checkbox 行格式       |
| worktree 名称约束         | sFlow 无 worktree 创建逻辑                 |
| P3 不适用部分             | 架构不适用                                 |

## 总体结论

本次更新是 spec-superflow **v1.0.0 的功能收敛**，核心增量只有一个：**Lightweight 模式**——把上一轮"quick 路径"进一步细分出"纯内部变更"档位，并引入"路径白名单 + 排除证明 + 关闭证据 + 升级通道"的完整证据闭环。这与上一轮"收据驱动转型"一脉相承，是同一设计哲学的深化。

对照 sFlow：

- **立即行动（P0）**：Lightweight 模式移植——本次唯一的新工作流机制，与 sFlow 的 quick/tweak 定位互补而非冲突
- **顺手完成（P1）**：Git 验证缓存（`wave-guards.ts` 性能优化）、spec 基线 preflight（复用已有 `applyDeltaToBaselineDetailed`）
- **可选（P2）**：Handoff 报告格式标准化

# 决策变更记录（2026-08-04）：Lightweight 借鉴方案收敛

> 初始决策（2026-08-04 上午）为完整移植 Lightweight 独立模式（方案 A），经 sFlow 主 agent 深度分析与用户共同评审后，**收敛为方案 B**：不新增 lightweight 第 5 模式，改为将 lightweight 的判定机制并入 quick 模式，升级为"路径感知两段式判定"。

## 方案 A → 方案 B 的收敛理由

| 维度 | 方案 A（完整移植 lightweight 独立模式） | 方案 B（路径感知并入 quick） |
|------|----------------------------------------|------------------------------|
| 模式数量 | 5 种（新增 lightweight） | 4 种（不变：full/hotfix/tweak/quick） |
| 状态机 | 5 模式 × 8 状态转换矩阵扩展 | 无改动 |
| Guard | 新增 `checkLightweightCompletionEvidence` | 复用现有 quick closing（`direct-test-result`） |
| 用户确认 | scope_confirmation + verification_strategy | 仅 verification_strategy |
| 升级机制 | 新增 `escalateLightweightWorkflow` | 复用现有 `checkPresetUpgrade`（MODE_RANK） |
| 工作量 | ~17 文件 + 3 测试 | ~13 文件 + 2 测试 |
| 认知负担 | 用户需理解"quick vs lightweight 何时用哪个" | 无新增概念 |

**核心判断**：lightweight 的价值在**判定质量升级**（路径性质 vs 数量），不在"第 5 种模式"。sFlow 已有完整的 quick 快路径闭环（`check-direct-short-path.ts` 处理 4 个转换 + `direct-test-result` closing guard + `checkPresetUpgrade` 升级机制），为补一个判定盲区（改 10 个 `tests/` 文件零风险却因超 3 文件被顶成 full）引入整套模式复杂度，不值。

## 方案 B 最终借鉴范围（已确认进入工作流实现）

| 优先级 | 借鉴点 | 实现方式 | 状态 |
|--------|--------|----------|------|
| P0 | Quick 路径感知两段式判定 | `workflow-recommendation.ts` 新增 `affected_paths` + `exclusion_checks`（9 项）；quick 判定：① 路径全在 tests/docs/test-support 且 9 项 checks 通过 → 放宽文件数阈值走 quick；② 否则维持现有 task≤3 && file≤3；`workflow-start/SKILL.md` + `mode-detection.md` 添加引导 | ✅ 决策采纳 |
| P1 | Git 验证缓存 | `wave-guards.ts` 收据验证改进程级缓存 validator（git root / commit 解析 / (root,base,head) 三元组含失败缓存，仅完整 40 位 SHA 启用） | ✅ 决策采纳 |
| P1 | Spec 基线 preflight | `artifact-validation.ts`（或 preflight.ts）在 spec 校验后、DP-2 门前调用 `applyDeltaToBaselineDetailed`，失败报 `(baseline preflight)`；guard 保持纯 Validator | ✅ 决策采纳 |
| P2 | Handoff 标准化 | `handoffs.ts` 新增 `formatStandardHandoff` 四段式 + 8 个执行 skills 统一格式 | ✅ 决策采纳 |

**明确排除项**：lightweight 独立模式、completion-evidence guard、scope_confirmation 字段、escalate 函数、状态机改动、task-brief checkbox 解析、worktree 名称约束。

## 设计澄清（重要）

**Lightweight 与 Preflight 是正交的两个东西**：
- Lightweight（路径选择）是**启动前判定**，回答"改动是否纯 tests/docs/test-support 内部变更"
- Preflight（spec 质量验证）是 **spec 写入后**的验证，服务**会产生 delta spec 的路径**（full/quick 产生 spec 的场景），lightweight 式变更不产生 spec 故不需要 preflight
- 两者并列列出，实际是独立的两项

---

# spec-superflow 演进分析（305b9e57 → 25d9b0ce）

> **素材源**：`.flow-engine/sflow/subagent-store/agent_1790401615525_iflow-researcher/output.md`（662 行，本轮调研唯一来源）
> **范围**：v1.2.0 → v2.0.0，132 文件变更，+7577 / -3059 行
> **方法**：逐提交 `git show` + sFlow 源码对照验证
> **补记说明**：本节由 2026-09-26 的 build-executor 依据上述素材源重建（上一轮追加内容已随工作区回退丢失），采取**纯追加**方式，不改动本文件既有 613 行。

## 一句话结论

**这是 spec-superflow 自诞生以来最激进的一次重构——从"五路径 + 契约 + DP 问卷"的繁复流程，收敛为"两个入口（direct / planned）+ 一次确认 + 一次终评 + 一次验证"的紧凑流程。** 上游不仅没有废弃我们移植的功能，反而把关键机制（adjudication 熔断、plan-scoped 隔离、spec-publication 收据）**全部保留并加固**；同时新增了一批我们尚未具备的能力。

最重要的一句话：**sFlow 之前借鉴的所有部分都没有被上游废弃或改名，可以放心继续维护。** 但上游新增的机制中，有 3 项（终评范围锚定、review range 强制非空、issue 熔断计数）属于**我们可能存在同类缺陷**的地方，必须同步核查。

## 一、更新主题总览表（T1–T21）

| # | 主题 | 核心提交 | 一句话说明 | 性质 |
|---|------|---------|-----------|------|
| **T1** | v2 紧凑执行流（最大） | `05aee08` | 废除五路径 intake，改为 `workflow start --path direct\|planned` + 一次 `workflow complete`；引入 `schema_version: 2` 权威执行计划、`review_policy: final\|wave` | BREAKING |
| **T2** | Native 默认执行 | `05aee08` | 执行模式推荐恒为 `inline`（"Native"），删除全部 SDD 推荐分支，SDD 需显式授权 | BREAKING |
| **T3** | 执行计划为唯一事实源 | `05aee08` | v2 计划不再向 state 写摘要；派生 state 摘要**不得否决**计划 | BREAKING |
| **T4** | 终评范围锚定 + review range 校验 | `05aee08` / `3ff4380` / `25d9b0c` | 终评必须覆盖"变更起点 → HEAD"完整区间；拒绝空范围、截断的 `HEAD~1`、过期快照 | 新能力 |
| **T5** | issue 身份化熔断计数 | `05aee08` | 失败审查携带稳定 `--issue` ID；**同一 issue 连续 3 次**才 adjudication（原为任意失败累计 5 次） | 改进 |
| **T6** | plan revision 证据保留 | `05aee08` | mode-only 修订保留适用证据；scope 变更才作废 pass，且**必须保留未解决失败** | 改进 |
| **T7** | 隔离上下文持久化 | `05aee08` / `3444339` | 隔离元数据写入 `.git/ssf-finish/<name>.json`；默认**特性分支**，worktree 需显式启用 | 改进 |
| **T8** | finish 物理收尾重做 | `05aee08` | 分阶段收尾 pending → verify-pending → cleanup-pending → complete；`verificationEnvironmentFingerprint()` 防跨进程冒用验证结果 | 改进 |
| **T9** | closing 可重开（受限） | `05aee08` | 新增 `closing:debugging` 转换，仅 `verify-pending` 时允许 | 改进 |
| **T10** | accepted-risk 显式收尾 | `05aee08` | 用户可显式接受已知风险结束，但**禁止自动物理集成** | 新能力 |
| **T11** | 状态跟踪与收口系统性修复 | `a8807bc` | 轻量路径不再被 full 产物要求卡死；fast-path 拒绝表替代 full fallback；5 个 resync 死锁修复 | Bug 修复 |
| **T12** | Adjudication 恢复 | `16706ea` | `ssf execution adjudicate` 持久化人工授权，一次授权只允许一次后续审查 | 已在上一版评估 |
| **T13** | state 重建后 plan revision 恢复 | `1571ccc` | state 摘要被清空时从计划文件反查 revision，多种非法态被拒绝 | Bug 修复 |
| **T14** | runtime guard 推断持久化 workflow | `e7ab1a4` | `--workflow` 缺省时从 state 读取，而非默认 `full` | Bug 修复 |
| **T15** | Codex/Windows 一致性 | `d527495` | DP timestamp 跨平台；轻量路径免计划调试 | Bug 修复 |
| **T16** | workflow-policy 统一裁决 | `05aee08` | `workflowPolicy()` 单点决定是否需计划 / 缺收据 / 丢失 direct receipts | 架构 |
| **T17** | task-parser 单一解析 | `05aee08` | `parseTasks()` / `normalizeTaskCheckboxes()` 统一 checkbox 解析 | 架构 |
| **T18** | skills 捆绑运行时 | `d653216` | 引入 `SSF` 占位符 token，运行时重写为插件脚本路径 | 分发 |
| **T19** | WorkBuddy OS temp staging | `3444339` | clone 到 `os.tmpdir()` 子目录，失败清理，不再硬编码 `/tmp` | 分发 |
| **T20** | 文档清理 / 一致性 | `d728a1f` 等 | 删除 704 行内部开发记录，README 重写 | 文档 |
| **T21** | v2.0.2 发布尝试与回滚 | `bb1fbee` / `163c854` | 发了一半又 revert（仅版本号），HEAD 停在 2.0.0 | 噪音 |

## 二、可借鉴性评级（P0–P3）

> 评级标准：P0 强烈建议（存在同类缺陷或高价值缺口）/ P1 建议 / P2 按需 / P3 不适用；sFlow 现状基于实际源码验证。

### 🔴 P0 — 强烈建议借鉴（4 项）

| # | 借鉴点 | sFlow 现状（源码实测） | 缺陷 | 工作量 |
|---|--------|----------------------|------|--------|
| **P0-1** | review range 强制非空（上游 `assertNonEmptyDiff()` + `pass && base === head → throw`） | `GitRangeValidator` 有 `rev-parse --verify` 与 `merge-base --is-ancestor`，`checkReceiptIntegrity` 只查空字符串；**无 `base === head` 校验、无 `git diff --name-only` 非空校验** | 零改动的 pass receipt 能通过全部校验 → 解锁依赖波次与 closing，是真实的门禁绕过 | 低（约 20 行 + 测试） |
| **P0-2** | `--issue` 身份化熔断计数 | `MAX_REPAIR_FAILURES = 5`（`packages/core/src/constants.ts:87`），任意失败累计即 `adjudication-required`，且**无 `adjudicateWave` 出口**；`ReviewEvidence` 无 `issue` 字段 | ① 不同缺陷共享预算导致误熔断；② **熔断后无出路**，是单向死锁（比上游旧版更糟） | 中 |
| **P0-3** | plan revision 恢复（`resolveRecommendationPlanRevision()`） | 有 `restoreState`（处理 state↔artifact 不一致），但**没有"计划摘要丢失后从计划文件反查 revision"**；`ReviewReceipt` 依赖 `plan_hash` / `plan_revision` | state 摘要与计划不同步时收据全部失效，且无正规恢复入口 | 中 |
| **P0-4** | 轻量路径（quick/direct）不得 fallback 到 full 门禁 | `WORKFLOW_MODES` 已含 `quick`（`workflow-recommendation.ts:97`），而 `transition-guards.ts` 的 `fastPathRestrictions` **只放行 tweak，不含 quick** | quick 走 `exploring → approved-for-build` 被拒 → **quick 在门禁层实际不可用**；与上游 `#114` 是同一个 bug，只是表现位置不同 | 低（改常量数组 + 明确报错） |

### 🟡 P1 — 建议借鉴（5 项）

| # | 借鉴点 | sFlow 现状 | 价值/取舍 | 工作量 |
|---|--------|-----------|-----------|--------|
| **P1-1** | `review_policy: final\|wave` | `ExecutionPlan` 无 `review_policy` / `schema_version`；依赖判定基于逐波 receipt | v2 降本核心：一次整体区间审查替代逐波审查。取舍：sFlow 是 agent 编排，上下文管理方式不同，但同样受益 | 中高 |
| **P1-2** | `writePlanRevision()` 语义化证据保留 | 已做 plan-scoped 双写，**无 `writePlanRevision` 等价物**，计划修订时证据迁移未定义 | 上游 `rebind()`（递归重写 plan_hash/revision）比"删除重建"优雅 | 中 |
| **P1-3** | `workflowPolicy()` 单点裁决 | 同一概念散落在 `checkWorkflowModeTransition` / `isDirectWorkflowReceipt` / `check-direct-short-path` 三处 | 架构整洁性 + 消除不一致风险——**这正是 P0-4 的根因** | 中 |
| **P1-4** | `parseTasks()` 单一解析入口 | 已移植 checkbox 规范化，但散落在 `task-tracker.ts` / `execution-plan` / guard 多处 | 低代码量，消除解析分歧 | 低 |
| **P1-5** | 终评范围锚点 `review_base` | 无 `review_base` 概念；`GitRangeValidator` 只校验 base/head 有效性，不校验"是否完整覆盖变更起点" | 解决"截断审查"（只审 `HEAD~1`）导致多提交工作漏审早期提交 | 中 |

### 🟢 P2 — 按需借鉴（7 项）

| 借鉴点 | 上游做法 | sFlow 现状与判断 |
|--------|---------|------------------|
| 隔离上下文持久化 | `.git/ssf-finish/<name>.json` + `resolveIsolationChange()` 的"不静默回退"原则 | `checkGitBranchIsolation` **只是 warning**（`guard.ts:50-90`），仅检查分支名，无持久化上下文。若 sFlow 保持"探索友好"定位，维持 warning 是合理的 |
| finish 状态机 + 环境指纹 | pending→verify-pending→cleanup-pending→complete + `verificationEnvironmentFingerprint()` | 无 CLI、无物理集成命令，`release-archivist` 承担逻辑收尾。**架构不适用**，但"跨进程不能冒用验证结果"的思想值得记入 prompt |
| closing → debugging 重开 | 仅 `verify-pending` 允许 | sFlow 的 closing 是绝对终态；不依赖物理 merge / 删除 worktree，故不需要该 escape hatch |
| accepted-risk 收尾 | `--accept-risk --confirm --reason` | `release-archivist` 有 verdict 概念但无显式出口；引入有被滥用绕过验证的风险 |
| planning-config 门禁 | `artifactPolicy()` 在 `exploring:specifying` 就校验 `artifacts.skip` 非法组合 | 有 `artifact-preflight.ts` 但无配置合法性前置校验。**低价值**：配置错误迟早暴露 |
| Windows 路径 native realpath | `realpathSync.native` 解析 8.3 短名 | sFlow 未见 `realpathSync.native`。若 Windows 用户遇到"路径不匹配"，此为根因。工作量极低，可作防御性改进 |
| debugging 回退维度 | `debugging:specifying` / `debugging:bridging` 显式列出 | sFlow 的调试→计划回退是否合法**未显式定义**，取决于是否支持"发现根因需要改设计"的场景 |

### ⚪ P3 — 不适用（6 项）

| 项目 | 理由 |
|------|------|
| 多平台分发（CodeBuddy / WorkBuddy / Qoder / Cursor / Codex） | sFlow 是纯 OpenCode 插件，无安装器；`d653216` 的 `SSF` 重写是 OpenCode 特有问题的解法 |
| `3444339` OS temp staging | 无释放 clone 流程；但其思想（不硬编码 `/tmp`、用 `os.tmpdir()`、失败清理）作为通用原则值得记入任何临时目录代码 |
| v2.0.2 发布/回滚（`bb1fbee` + `163c854`） | 纯版本号噪音，且已 revert |
| `d728a1f` 删除内部开发记录 | 上游清理自家 `docs/plans`，与我们无关 |
| `60e05fa` marketplace scanner 证据 / `10d5f08`、`65eb736` README 重写 | sFlow 用 npm 发布；上游自己的营销文档 |
| `16706ea` adjudication 恢复 | 已在上一轮完整评估（`#109`），本轮仅作为 P0-2 的前置依赖被再次触及 |

## 三、需同步修复项（上游 bug 修复 → 我们是否受影响）

| # | 上游修复 | 我们的代码现状 | 是否受影响 | 建议动作 |
|---|---------|---------------|-----------|---------|
| **S1** | `e7ab1a4` guard 推断持久化 workflow | guard 从 `readJsonFile(state.json)` 读 `stateData?.mode`（`transition-guards.ts:29`），**已经是**从持久化状态读 | ✅ 不受影响 | 无需动作（架构差异天然正确） |
| **S2** | `e7ab1a4` 先校验 positionals 再推断 workflow | 无 CLI positionals | ✅ 不适用 | — |
| **S3** | `d527495` DP timestamp 跨平台 | 全程 TypeScript，用 `new Date().toISOString()` | ✅ 不受影响 | 无需动作 |
| **S4** | `d527495` 轻量路径免计划调试 | `checkDebuggingState` 只检查 agent 身份，不要求 execution plan | ✅ 不受影响（更宽松） | 无需动作 |
| **S5** | `1571ccc` plan revision 恢复 | 有 `restoreState` 但无等价 revision 恢复 | ⚠️ 受影响（同源缺陷） | 见 P0-3 |
| **S6** | `3ff4380` 相对路径双倍解析 | 无 CLI 路径参数处理 | ✅ 不适用 | — |
| **S7** | `3ff4380` review_base 继承防范围前移 | 无 `review_base` | ⚠️ 不受影响（但也无该保护） | 见 P1-5 |
| **S8** | `a8807bc` quick 不 fallback full | `fastPathRestrictions` **未含 quick** | 🔴 **受影响，且更严重** | 见 P0-4，立即修复 |
| **S9** | `a8807bc` tasks checkbox 门禁 hotfix 豁免 | 无此 guard | ✅ 不受影响 | — |
| **S10** | `a8807bc` 报错带 Fix 提示 | blockReason 较简短 | 🟡 可选改进 | 提升 UX，低成本 |
| **S11** | `05aee08` resync 时 `execution_plan_hash` 不再必须是 reject 条件 | receipts 双写校验仍依赖 plan_hash/plan_revision 匹配 | 🟡 取决于是否采纳 v2 schema | — |
| **S12** | `3444339` Windows 8.3 短名 + native realpath | 未见 `realpathSync.native` | 🟡 潜在受影响 | 防御性替换（低风险） |
| **S13** | `05aee08` finish 跨进程重新验证（env fingerprint） | 无物理收尾 | ✅ 不适用 | 思想写入 release-archivist prompt |

**小结**：13 项中 **1 项确认受影响（S8 / P0-4）、2 项同源缺陷（S5 / P0-3、S12）、1 项潜在（S7）**，其余因架构差异天然免疫。

## 四、已移植部分是否被上游废弃 / 改名的核查结论

| 已移植内容 | 上游 v2 状态 | 证据 |
|-----------|-------------|------|
| 8 状态状态机 | ✅ 完全保留，未被精简 | `docs/state-machine.md`（`05aee08` 后）仍列 8 state；`guard.mjs` 的 `TRANSITION_CHECKS` 主表未删项 |
| DP-0..DP-7 | ✅ 保留（新流程不强制，legacy 仍走） | `docs/decision-points.md` 开头声明保留旧八状态与 DP 协议 |
| spec-publication receipt（替代 spec_merged） | ✅ 保留且强化 | `checks/specs-merged.mjs:36-44` 仍用 `validatePublicationReceipt` |
| adjudication 熔断 | ✅ 保留并演化为 issue 计数 | `execution-plan.mjs` `issueFailureCount` |
| plan-scoped SDD 记录 | ✅ 保留，`writePlanRevision` 进一步利用 | `getPlanScopedPaths` 仍含 adjudications / repair-state |
| recommendation receipt | ⚠️ 降级为可选（新流程不要求），但未删除 | `validatePlan` 中 `schema_version !== 2` 才要求 |
| execution-contract.md | ⚠️ 新流程改为机器生成 plan，legacy 保留手写 | README v2 对比表 "handwritten execution contract" → 计划内部 |
| execution-reviews-passed / tasks-complete / specs-merged / dp-gate-passed / artifacts-exist / schema-valid / contract-fresh | ✅ 全部保留，仅 contract-fresh 内部改为优先读 plan | `git show 05aee08 -- scripts/guard/checks/*.mjs` |
| isolation / worktree | ⚠️ 语义变化：默认 worktree → 默认特性分支（worktree opt-in） | `ensure-branch.mjs` |

### 🎯 关键结论

> **我们之前移植的所有内容都没有被上游废弃或改名。**
> v2 的革新集中在**前台入口层**（把五路径问卷压成两个按钮），而非**后台校验层**（八状态、收据、熔断、publication receipt 全部保留并多处加固）。
> 唯一需要理解的变化是 recommendation receipt 与 execution-contract.md 从"必须"降级为"legacy 专用"——这是**降级而非删除**，sFlow 现有的 `recommendExecutionMode` + DP-4 写入依然安全。
> **可以放心继续维护，无需担心被上游抛弃。**

## P2 借鉴决策（2026-09-26 确认）

> 前置结论：**P0 全采纳（4 项）、P1 全采纳（5 项）**，落地顺序见执行合约 §2 与 tasks.md 的 Wave 1–4。本节只裁定 P2 层。

### 采纳（5 项）

| # | P2 借鉴点 | 采纳方式 | 落地批次 / Requirement |
|---|-----------|---------|------------------------|
| 1 | Windows 路径 `realpathSync.native` | `wave-guards.ts:155` 改用 `fs.realpathSync.native`（全仓唯一调用点），避免 8.3 短名误判；常规路径结论不变、真实符号链接仍拦截、解析异常跳过不崩溃 | Wave 4 / GD-R1 |
| 2 | `verificationEnvironmentFingerprint` 思想 | **只写思想，不实现真实指纹计算**：`release-archivist` prompt 要求记录环境标识（工作目录 / git HEAD / 测试命令 / 工具版本摘要）并声明跨环境验证结果不可冒用 | Wave 4 / GD-R2 |
| 3 | debugging 回退维度显式化 | `debugging → specifying / bridging` 显式允许并写入回退原因（根因摘要 + 回退目标）；缺原因被拒并带 Fix 指引；回退之外的转换仍受既有转换表约束 | Wave 4 / GD-R3 |
| 4 | 报错带 `Fix:` 提示 | 新增统一构造函数 `formatGuardFixHint(reason, entry)`，快路径 / 收据完整性 / 工件三类门禁的 `blockReason` 末行统一追加单行 `Fix: <可执行入口>.`，**禁止「请修复后重试」类空泛措辞** | Wave 1 建函数（FP-R3）/ Wave 4 全面收敛（GD-R4） |
| 5 | `unknownTransitionFailure` 原则 | 门禁不认识的情况 MUST 明确报错，**MUST NOT 静默回落 full 主表**；落地为快路径命中限制表但模式不匹配时返回 `success:false + block:true`，报错含当前 mode、允许集合与正确路径 | Wave 1 / FP-R2 |

### 不采纳（3 项）

| # | P2 借鉴点 | 不采纳理由 |
|---|-----------|-----------|
| 1 | 隔离上下文持久化（`.git/ssf-finish/*.json`） | sFlow 保持"探索友好 / 个人项目友好"的定位；`checkGitBranchIsolation` 维持 warning 语义，不做物理隔离持久化（架构不适用：无 CLI、无 worktree 物理操作） |
| 2 | finish 物理收尾状态机（pending → verify-pending → cleanup-pending → complete） | sFlow 无 CLI、无 worktree 物理操作，逻辑收尾由 `release-archivist` agent 承担，无需引入物理状态机 |
| 3 | planning-config 门禁（`artifactPolicy.artifacts.skip` 合法性前置校验） | 低价值：配置错误迟早会在后续门禁暴露，不值得再前置一层校验 |

**同批明确排除**：`closing → debugging` 重开（sFlow 的 closing 保持绝对终态）、accepted-risk 收尾（无显式风险接受出口，避免被滥用绕过验证）、多平台分发与引入 CLI（不适用于 OpenCode 插件架构）。

## 总体结论

### 总体判断

本次更新是 spec-superflow **从"命令驱动的繁复 SDD 引擎"向"以证据收口的紧凑执行流"的转型**。价值不在于新增多少检查（几乎没新增），而在于**大幅削减普通任务的固定开销**——四份规划文档 → 两份、逐波审查 → 一次终评、自动 worktree → 默认分支、独立调试态 → 留在 executing。

对 sFlow 的意义有三层：

1. **确认安全**：我们移植的所有内容都还活着，且被加固
2. **暴露缺陷**：P0-4（quick 未进 fast-path 白名单）是真实的功能不可用 bug；P0-2（熔断无出路）是真实死锁
3. **提供方向**：v2 证明"低成本默认 + 显式升级"可行；sFlow 作为 agent 编排架构，成本压力更小，但同样受益于"一次终评"而非"逐波审查"

### 优先行动清单

**立即（Wave 1）**

| 动作 | 工作量 | 理由 |
|---|------|------|
| 修复 P0-4：`fastPathRestrictions` 的 `exploring:approved-for-build` 放行 `tweak` + `quick`，并明确报错不回落 full | 1 小时 | quick 模式在 guard 层实际不可用；低风险、纯配置 + 明确报错 |

**短期（Wave 2）**

| 动作 | 工作量 | 理由 |
|---|------|------|
| P0-1：`recordReviewReceipt` 增加 `base !== head` + `git diff --name-only` 非空校验 | 2 小时 | 零范围 pass receipt 是真实门禁绕过 |
| P1-3：抽取 `workflowPolicy()` 单点裁决，统一三处重复语义 | 半天 | 根除 P0-4 类重复实现的温床 |
| P1-4：统一 `parseTasks()` 解析入口 | 2 小时 | 低代码量，消除解析分歧 |

**中期（Wave 3）**

| 动作 | 工作量 | 理由 |
|---|------|------|
| P0-2：`--issue` 身份化熔断 + `adjudicateWave()` 人工授权 | 1-2 天 | 当前熔断是单向死锁（5 次失败后 wave 永久不可审查） |
| P0-3：`resolvePlanRevision` 等价恢复逻辑 | 1 天 | state↔plan 不同步时的正规恢复入口 |
| P1-5：`review_base` 开工锚点（WRITE_ONCE） | 1 天 | 防"截断审查"漏审多提交工作的早期提交 |
| P1-1：`review_policy: final`（需先做产品决策） | 中高 | 若用户抱怨审查轮次多，这是根本解法 |

**观察 / 按需（Wave 4）**

- `realpathSync.native` 防御性替换（已决策采纳）
- `verificationEnvironmentFingerprint` 思想写入 release-archivist prompt（已决策采纳）
- debugging 回退显式化（已决策采纳）
- `Fix:` 提示与 `unknownTransitionFailure` 原则全面收敛（已决策采纳）

### 一句话给决策者

> **本次更新不需要我们重构任何东西，但暴露了 sFlow 一个真实可用性 bug（quick 模式在 guard 层被拒）和一个真实死锁（review 熔断后无出路）。建议先花一天修这两个，再考虑吸收 v2 的 `review_policy: final` 作为降本手段。**
