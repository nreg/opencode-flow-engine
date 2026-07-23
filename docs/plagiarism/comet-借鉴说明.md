

# Comet bc6219df — 借鉴说明

项目也是 Spec + Superpowers 的项目，目前 sFlow 的实现借鉴了该项目以下几点：

---

## 一、已借鉴的设计

### 1. 🔄 Preset 升级机制（comet 轻量模式自动升全量）

**comet**：hotfix/tweak 在超出范围时自动升级到 full：
- hotfix → full：涉及 3+ 文件、架构变更、DB schema 改动等
- tweak → full：5+ 文件、跨模块、5+ 新测试用例等

**sFlow 现状**：`WorkflowMode` 有 full/hotfix/tweak，但没有升级机制。

**借鉴方向**：在 `build-executor` 或 `workflow-start` 中加 preset 降级/升级判断——如果 hotfix 任务在执行中触及 3+ 文件，自动提醒用户是否切到 full 模式（重新进入 exploring/specifying 补全 spec）。

### 2. 🔗 Phase Guard 钩子（comet 外部守护 vs sFlow 内部 hook）

**comet**：通过 shell 脚本（`comet-guard.sh`、`comet-hook-guard.sh`）注册为各 agent 平台的 `PreToolUse` hook，在工具调用前阻断非法阶段转换。跨进程、跨平台守护。

**sFlow**：通过 OpenCode plugin hook 在进程内守护，更干净但仅限 OpenCode。

**可借鉴的具体设计**：
- comet 的 `dirty-worktree.md` 协议——处理恢复时遇到未提交变更的归属判断和禁止操作。sFlow 的 `state-transition` hook 可以参考这个策略，在 executing 状态检测到 dirty worktree 时引导用户处理
- comet 的 `debug-gate.md`——异常调试协议，定义什么情况下进入 debug 分支。sFlow 的 debugging 状态进入条件可以参考

### 3. 📋 Subagent Dispatch Protocol（已部分借鉴，可补强）

comet `subagent-dispatch.md` 的设计亮点：
- 严格的 Return Contract：`DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT` + 实现细节 + 测试结果 + commit hash + changed files
- 进度 checkpoint：`subagent-progress.md` 持久化每个 task 的当前阶段、已通过的 review、已用轮次
- Context recovery：重新加载时精确对比 checkpoint 和文件系统状态，永不假设实现存在

**sFlow 的对应**：`build-executor` 已有 `implementer-prompt` 和 `task-reviewer-prompt`。可借鉴 comet 的 progress checkpoint 文件——在 `.flow-engine/sflow/subagent-progress.md` 记录每个 task 的执行阶段（implementing → spec-review → quality-review → checkoff → done），让 context resume 更精确。

### 4. 🔄 Auto-Transition + Resume Robustness

comet `SKILL.md` 的 Resume 规则（第 57-70 行）每一条都很精确：
- 每次 context resume 重新运行 Step 0 + Step 1，不信任对话历史
- 主动修复不一致状态（如 phase: open 但 proposal/design/tasks 已完成 → 自动 repair）
- `build_pause` 的三种亚态精确区分（stale pause / corrupted / 正常暂停）

**sFlow**：`workflow-start` 有检查 artifacts 的逻辑，但没有这么细粒度的自动修复和状态不一致检测。

**借鉴方向**：在 `workflow-start` `SKILL.md` 中加入 artifact ↔ state 一致性校验：
- 如果 state 是 specifying 但 `design.md` 已存在 → 自动 repair 到 bridging
- 如果 state 是 executing 但 `tasks.md` 全部 checked → 自动 transition 到 closing

---

# Comet bc6219df → 9b217fdd

总共 19 个 commits，时间跨度 7 月 6 日到 7 月 15 日。核心变化可以分为三大块：

---

## 二、值得借鉴的增量功能

### 1. Artifact Language 配置 + Guard 语言检测（#153）— ⭐⭐⭐ 中等价值

comet 新增了工件语言配置体系，在 `domains/skill/languages.ts` 中定义：
- `SkillLanguageId: en | zh`
- `ArtifactLanguageId: en | zh-CN`
- 用户选择 skill 语言时自动关联 artifact 语言（en → en, zh → zh-CN）
- `comet-guard.sh` 在 phase 转换时自动检测 artifact 的 CJK/英文占比，排除 fenced code block 中的代码/路径干扰
- 语言不匹配直接阻断，fail-closed
- 支持 `LC_ALL=C` 下字节级 CJK 匹配，解决跨平台 locale 差异

> **启示**：如果项目需要双语 artifact 支持（中英文 spec），可以借鉴这个体系。但当前优先级不高。

### 2. Doctor 诊断增强（#165）— ⭐⭐⭐ 中等价值

`doctor.ts` 新增了更全面的诊断项：
- 检查 openspec CLI 是否安装
- 检查 codegraph 是否可用
- 检查 working directories（`docs/superpowers/specs/` 等）是否存在
- 检查 managed skill paths 完整性
- 检查 classic change 状态一致性
- 按 scope（project/global/auto）分层扫描

> **启示**：可以给 sFlow 加一个 `workflow_doctor` 工具，检查：
> - `.flow-engine/sflow/` 下 artifact 完整性
> - 状态文件一致性（state vs 实际 artifact）
> - 子 agent 注册状态
> - 当前 change 的 guard 状态

### 3. CodeBuddy Hook 支持（#197）— ⭐ 低价值

新增 CodeBuddy 平台的 hook 安装，属于平台扩展，对 sFlow 架构没有直接借鉴意义。

---

## 三、重大架构演进（参考价值有限）

### 4. comet-any / comet-eval（#156）— 全新生态

这是 comet 最大的变化，但属于产品级全新功能，不是 sFlow 能直接借鉴的：

| 模块 | 规模 | 说明 |
|------|------|------|
| comet-any | ~15,000+ 行 | 通用 skill 创作平台，支持 bundle 编译、分发、多平台发布 |
| comet-eval | ~10,000+ 行 | 评估框架，支持 LangSmith 追踪、pass@3 指标、噪声过滤、HTML 报告 |
| Classic Runtime | ~50,000+ 行 | 从 shell 脚本全面迁移到 TypeScript（`comet-runtime.mjs`），8 个脚本全部 `.mjs` |

关键架构变化：comet 从 shell 脚本进化到了 TypeScript 运行时：
- `comet-guard.sh` → `comet-guard.mjs`（10,173 行）
- `comet-state.sh` → `comet-state.mjs`（9,273 行）
- `comet-handoff.sh` → `comet-handoff.mjs`（9,491 行）

这些参考价值有限，因为：
- sFlow 已经是 TypeScript 插件架构，架构层面更先进
- `comet-any` 的 skill 创作/发布平台是产品级生态，超出 sFlow 的 scope
- `comet-eval` 的评估框架如果需要，可以独立设计更轻量的版本

---

## 四、总结：comet 值得借鉴的要点

回到之前已经借鉴的 comet 设计（Preset 升级、Phase Guard、Subagent Dispatch、Auto-Transition），本次演进中真正值得补充的只有两点：

1. **Artifact Language Guard 的思路**
   - 不是直接抄，而是借鉴其"在 guard 中检测 artifact 属性的模式"
   - 可以扩展 guard 做更多 artifact 属性检查（如：检测 spec 是否包含 TODO 占位符）

2. **Doctor 诊断的增强方向**
   - 给 sFlow 加一个轻量的 health check 工具
   - 检查：artifact 完整性、状态一致性、subagent 注册状态

> **综合建议**：comet 本次演进的核心是 `comet-any` 生态和 shell→TS 运行时迁移，这些与我们的架构方向不同。之前的 4 个借鉴点（Preset 升级、Phase Guard 协议、Subagent Dispatch、Auto-Transition）已经覆盖了 comet 对我们最有价值的设计模式，本次新增中没有必须追加的高优先级项目。