# 一、借鉴来源

主要移植：

https://github.com/MageByte-Zero/spec-superflow

其它业务借鉴：

https://github.com/rpamis/comet

https://github.com/rihebty/flow-kit

OpenCode的Agent插件实现：

https://github.com/code-yeongyu/oh-my-openagent

相关文章：

spec-superflow:

https://mp.weixin.qq.com/s/pgzZccGTxCVhaHLhOxXOvg

spec + superflow + comet:

https://mp.weixin.qq.com/s/1g7FRte8w_vV-kXcBxtVDw

flow-kit:

https://mp.weixin.qq.com/s/6NSD1WoKRXTHR0exWBKXtg

https://mp.weixin.qq.com/s/gvRWbnB1heYGhUtNGYetWQ



# 二、借鉴详情

## @spec-superflow

6951031e on 2026/7/1 at 12:47

sFlow 实现的主要移植

## @oh-my-openagent

在OpenCode插件机制的实现上， 借鉴了成熟的插件项目： @oh-my-openagent\ 

几下几点：
   1.Agent 定义和调用：借鉴 oh-my-openagent 的 agent 工厂模式（createXXXAgent）和模式系统（primary/subagent/all）

   2.父子 agent 通信：借鉴 oh-my-openagent 的 Team Mode 和 mailbox 系统。

3. Skill 内置
借鉴 oh-my-openagent 的 builtin-skills 模式：
将 spec-superflow 的技能转换为 BuiltinSkill 对象
实现 BuiltinSkill 接口：name、description、content、MCP 配置
注册到 createBuiltinSkills() 工厂
4. MCP 内置
借鉴 oh-my-openagent 的三层 MCP 系统：
将 spec-superflow 的验证引擎和解析器包装为 MCP 服务器
作为 Tier 1 (Built-in) MCP 注册
或者作为 Tier 3 (Skill-embedded) MCP，跟随特定技能加载
5. 状态管理
借鉴 oh-my-openagent 的 boulder-state 模式：
创建一个状态管理模块，类似 boulder-state
管理 spec-superflow 的 8 个状态
支持跨会话持久化
6. 钩子系统
借鉴 oh-my-openagent 的 5 层钩子组合：
Session hooks - 会话生命周期
ToolGuard hooks - 工具执行前/后
Transform hooks - 消息转换
Continuation hooks - 继续执行
Skill hooks - 技能加载

  7.模型绑定：借鉴 oh-my-openagent 的模型解析管道（override → category-default → provider-fallback → system-default）

注意：
oh-my-openagent 的 BackgroundManager 有 ~100 个文件，极其庞大（处理了并发限制、fallback、parent-wake、dedupe、compaction-aware 等）。
sflow 只借鉴模式（3 个工具接口），不复制 ~100 文件的 BackgroundManager:
┌─────────────────────────────────────────────────────┐
│  sflow 需要的 3 个工具（轻量版）                      │
│                                                     │
│  call_flow_agent(subagent, prompt, run_in_background) │
│    ├─ run_in_background=true → 返回 task_id          │
│    └─ run_in_background=false → 同步等待结果         │
│                                                     │
│  flowagent_output(task_id) → 取子 agent 结果        │
│  flowagent_cancel(task_id) → 取消子 agent           │
└─────────────────────────────────────────────────────┘

## @comet  

bac6ab5f on 2026/6/30 at 21:39 （已被删）

bc6219df on 2026/6/27 at 20:28

项目也是 Spec + Superpowers 的项目，目前 sFlow 的实现 借鉴了该项目以下几点：

1. 🔄 Preset 升级机制（comet 轻量模式自动升全量）
comet: hotfix/tweak 在超出范围时自动升级到 full：
- hotfix → full: 涉及 3+ 文件、架构变更、DB schema 改动等
- tweak → full: 5+ 文件、跨模块、5+ 新测试用例等
sflow 现状: WorkflowMode 有 full/hotfix/tweak，但没有升级机制。
借鉴方向: 在 build-executor 或 workflow-start 中加 preset 降级/升级判断——如果 hotfix 任务在执行中触及 3+ 文件，自动提醒用户是否切到 full 模式（重新进入 exploring/specifying 补全 spec）。
2. 🔗 Phase Guard 钩子（comet 外部守护 vs sflow 内部 hook）
comet: 通过 shell 脚本 (comet-guard.sh, comet-hook-guard.sh) 注册为各 agent 平台的 PreToolUse hook，在工具调用前阻断非法阶段转换。跨进程、跨平台守护。
sflow: 通过 OpenCode plugin hook 在进程内守护，更干净但仅限 OpenCode。
可借鉴的具体设计:
- comet 的 dirty-worktree.md 协议——处理恢复时遇到未提交变更的归属判断和禁止操作。sflow 的 state-transition hook 可以参考这个策略，在 executing 状态检测到 dirty 
worktree 时引导用户处理
- comet 的 debug-gate.md——异常调试协议，定义什么情况下进入 debug 分支。sflow 的 debugging 状态进入条件可以参考
3. 📋 Subagent Dispatch Protocol（已部分借鉴，可补强）
comet subagent-dispatch.md 的设计亮点：
- 严格的 Return Contract: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT + 实现细节 + 测试结果 + commit hash + changed files
- 进度 checkpoint：subagent-progress.md 持久化每个 task 的当前阶段、已通过的 review、已用轮次
- Context recovery: 重新加载时精确对比 checkpoint 和文件系统状态，永不假设实现存在
sflow 的对应: build-executor 已有 implementer-prompt 和 task-reviewer-prompt。可借鉴 comet 的 progress checkpoint 文件——在 .sflow/subagent-progress.md 记录每个 task 的执行阶段（implementing → spec-review → quality-review → checkoff → done），让 context resume 更精确。
4. 🔄 Auto-Transition + Resume Robustness
comet SKILL.md 的 Resume 规则（第 57-70 行）每一条都很精确：
- 每次 context resume 重新运行 Step 0 + Step 1，不信任对话历史
- 主动修复不一致状态（如 phase: open 但 proposal/design/tasks 已完成 → 自动 repair）
- build_pause 的三种亚态精确区分（stale pause / corrupted / 正常暂停）
sflow: workflow-start 有检查 artifacts 的逻辑，但没有这么细粒度的自动修复和状态不一致检测。
借鉴方向: 在 workflow-start SKILL.md 中加入 artifact ↔ state 一致性校验：
- 如果 state 是 specifying 但 design.md 已存在 → 自动 repair 到 bridging
- 如果 state 是 executing 但 tasks.md 全部 checked → 自动 transition 到 closing

## @flow-kit 

9b5dda72 on 2026/5/13 at 15:25

借鉴部分：

1、Artifact Preflight Gate — 工件前置检查门
flow-kit 做法：进入任意阶段前，必须检查上游工件是否存在：
目标阶段	必须已有的上游工件
1-requirement	CHANGE.md
2-design	CHANGE.md + REQUIREMENT.md
3-task	REQUIREMENT.md + DESIGN.md（前端还要 UI-DESIGN.md）
4-dev	TASK.md 或用户显式提供的临时最小 TASK
sflow 借鉴：

文件：packages/core/src/constants.ts → ARTIFACT_PREFLIGHT 表
文件：packages/opencode-adapter/src/hooks/guard.ts → checkArtifactPreflightGate()
每个状态都有一张"进入该状态前必须存在的工件"映射表。状态转换时自动检测缺失工件，并给出应回退到哪个状态补齐的指引。
目标状态	必须已有
exploring	无
specifying	proposal.md
bridging	proposal.md + specs/ + design.md + tasks.md
approved-for-build	全部 + execution-contract.md

借鉴价值 ⭐⭐⭐⭐⭐：可以为 sflow 的 8 个状态各定义一套"进入该状态前必须已存在的 artifacts"表，在状态转换 hook 中强制执行。尤其是 executing 状态进入前必须验证 execution-contract.md 已批准。

2、GO.md 统一入口 + 意图自动路由
flow-kit 做法：用户只需要 @flow-kit/GO.md + 一句话意图，AI 自动：

- 检测当前是否有活跃 change
- 按关键词表匹配用户意图（新需求/继续/执行任务/review/测试/巡检等）
- 自动生成 change-id
- 按需自动加载对应 artifacts

sflow 借鉴：

文件：packages/opencode-adapter/src/tools/workflow-router.ts
支持自然语言意图匹配："审查代码"→ code-reviewer，"调试"→ bug-investigator，"执行 T03"→ build-executor，"设计UI"→ spec-writer（ui-design 路径）

借鉴价值 ⭐⭐⭐⭐⭐：sflow 的 workflow_router 工具可以借鉴 GO.md 的意图匹配表，支持更丰富的用户输入模式（"执行 T03"、"帮我 review"等），而不是仅靠 state 检测。

3、PROGRESS.md + 反重复协议（R1.5/R1.6）
flow-kit 做法：清窗前必须写 PROGRESS.md，核心是「已排除方案」段：

| #    | 方案                           | 排除理由        | 失败次数 |
| ---- | ------------------------------ | --------------- | -------- |
| X-1  | 用 useEffect 同步 localStorage | 首次渲染闪一下  | 1        |
| X-2  | 服务端渲染 + cookie            | 纯 SPA 范围超标 | 1        |

恢复后第一步：检查新方案不在已排除清单中。
sflow 借鉴：

文件：skills/templates/PROGRESS.md
文件：packages/opencode-adapter/src/features/state-manager.ts → writeProgressSnapshot(), clearProgressSnapshot(), checkProgressAntiRepeat()

借鉴价值 ⭐⭐⭐⭐⭐：在 build-executor 的 task 执行循环中加入类似 PROGRESS.md 的 checkpoint，尤其是在 debugging 状态进入时更为关键。

4、LESSONS.md — 跨任务失败知识库
flow-kit 做法：项目级常驻文件 .specs/LESSONS.md，每个 DEV 任务进入实现前必扫：

- 用当前任务的 files + action 关键词 grep LESSONS.md
- 命中条目必须在执行计划里说明"差异是 X"或"确认仍适用"
- 任务完成后按提名条件决定是否新增

sflow 借鉴：

文件：skills/templates/LESSONS.md
文件：packages/opencode-adapter/src/features/state-manager.ts → grepLessons(), addLesson()
每个 task 开工前自动 grep .sflow/lessons.md，调试退出时自动追加经验教训。带标签索引和关键词匹配。

借鉴价值 ⭐⭐⭐⭐⭐：在 .sflow/ 下增加 lessons.md 文件，每次 debugging 状态退出时自动写入"原因 + 方案 + 关键词"，build-executor 每个 task 开始前先扫。

5、文件边界控制（read_files / write_files）（B3 护栏 + R6.5）
flow-kit 做法：每个 TASK 中的任务必须声明两组路径：
<read_files>   <!-- 参考边界：允许读的范围 -->
src/features/*
src/lib/api-client.ts
</read_files>
<write_files>  <!-- 修改边界：允许改的范围（严格管控） -->
src/features/NotificationCenter.tsx
src/features/__tests__/*
</write_files>
提交前用 git diff --name-only 比对 write_files，越界则停下。
sflow 借鉴：

文件：skills/build-executor/SKILL.md → 新增「File Boundary Control」章节
每个 task 声明 read_files（参考边界）和 write_files（修改边界），提交前执行 git diff --name-only 边界验证，防止 scope drift。
借鉴价值 ⭐⭐⭐⭐⭐：在 sflow 的 execution-contract.md 中为每个 task 增加 read_files/write_files 字段，由 build-executor 在提交前执行边界 verify。

6、前端专用路径（2a-ui-design）
flow-kit 为前端项目设计了专门的 UI 设计阶段（夹在 DESIGN 和 TASK 之间）。

sflow 借鉴：

文件：packages/core/src/constants.ts → 新增 ui-design 状态
文件：packages/opencode-adapter/src/features/workflow-manager.ts → detectFrontend()
文件：skills/spec-writer/SKILL.md → 新增 ui-design.md 生成流程
完整的 9 状态工作流：exploring → specifying → [ui-design →] bridging → approved-for-build → executing → debugging → closing
- 前端项目自动检测（关键词 + package.json + 目录结构）
- spec-writer 在 specs 和 design 之间插入 ui-design.md 生成阶段
- guard 强制前端项目必须经过 ui-design 状态



**可借鉴但目前没有借鉴的**：（暂不需要借鉴）

1、STATE.md — 跨会话状态持久化
flow-kit 做法：仓库根 STATE.md 记录：

- 活跃 Change + 当前阶段 + 当前 Task
- 中断任务（指向 PROGRESS.md）
- 决策日志（最近 10 条）
- 横向命令元数据（last_intel_scan、last_architect_at 等）
sflow 现状：状态主要在 .sflow/ 下的文件推断，没有集中的跨会话状态文件。
借鉴价值 ⭐⭐⭐⭐：可在 opencode-sflow 中增加 .sflow/STATE.md 或增强现有的 .sflow/ 文件体系，增加明确的跨会话恢复入口。

2、 横向命令体系（L-/M-/I-/A- 系列）
flow-kit 做法：4 组非线性的横向命令：

- I- 项目情报（I-intel-scan — 老项目入场扫描）
- A- 架构演进（A-architect 项目级架构梳理 / A-evolve 增量同步）
- M- 维护巡检（M-health 周期性健康检查）
- L- 生命周期（L-restyle 一键换调性）
  sflow 现状：sflow 的 8 个状态是线性管道，没有这种"横向/按需"的命令体系。
  借鉴价值 ⭐⭐⭐⭐：sflow 可以考虑增加"横向子命令"概念——不在主流程中、但可通过特定指令触发的旁路工作流。例如：
- sflow health — 检查 workflow 状态一致性（类似 M-health）
- sflow resume — 恢复中断 workflow
- sflow archive — 归档已完成 change

3、 Token 预算管控（R1.9）
flow-kit 做法：每阶段首轮有严格的 reference 加载预算（≤150 行），每加载项必须声明起止行：

- ui-anti-patterns.md 75 行 — 可整读
- tech-stacks.md 470 行 — 禁止整读，只查"适用矩阵"节
- 路由声明里必须写"已加载/未加载/起止行"三要素
  sflow 现状：没有 token 预算意识。
  借鉴价值 ⭐⭐⭐：在 sflow subagent 的 prompt 中嵌入 token 预算规则，尤其是 build-executor 加载 spec 文件时限制一次性加载量。

**不应借鉴的部分**：

| flow-kit 做法                       | 不借鉴原因                                                |
| ----------------------------------- | --------------------------------------------------------- |
| 纯 markdown 无运行时                | sflow 是 OpenCode 插件，本身就有运行时                    |
| 靠 AI 自觉遵守规则（无强制门禁）    | sflow 有 hook 系统，可以在代码层面强制执行                |
| prompt 模式（每阶段读 prompt 文件） | sflow 是 subagent 模式，子代理自带 system prompt          |
| GO.md 单一入口 + 路由               | sflow 已有 workflow_router 工具，更适合用工具而非文件路由 |

## @[grilling](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md):

需求澄清智能体：packages/opencode-adapter/src/agents/need-explorer.ts 提示词借鉴了grilling中的3点：

1. 区分"事实"和"决策" — 最大亮点

  > "If a fact can be found by exploring the codebase, look it up rather than asking me. The decisions, though, are mine"

2. "沿着设计树的分支逐个走" — 结构化追问

  > "Walk down each branch of the design tree, resolving dependencies between decisions one-by-one"

3.  "共享理解" 而非 "清晰需求"

  > "Do not enact the plan until I confirm we have reached a shared understanding"

## @spec-kit：不借鉴

SFlow 当前的架构是 Agent 驱动 的，是一个有自主决策能力的编排者，Spec-Kit 的 YAML 引擎是 引擎驱动 的，把 YAML 步骤引擎搬过来会破坏 Agent 的自主决策能力，不做 YAML 引擎，而是做 YAML 工作流配置（声明式，非可执行），但 YAML 声明式配置 需要做吗？
现状：工作流状态定义在 spec-flow.ts 的 Agent system prompt 里，workflow_router 从 state.json 检测状态。
做 YAML 带来的变化：

- 增加一个配置文件 + 解析逻辑 + 向后兼容回退
- 但用户实际几乎不会去改这个 YAML——9 状态线性流覆盖了绝大多数场景
- 改 YAML 还不如改 prompt 直观
  投入产出比低。硬编码的 9 状态流目前够用，等用户真的需要自定义流程时再考虑。

宪法系统 有必要做吗：

宪法系统解决的是 Spec-Kit 特有的问题——他们的 LLM 生成 CLI 工具时，经常过度抽象、封装、加不必要的模块。宪法就是用来约束 LLM 的坏习惯的。
但 SFlow 已经通过不同方式解决了同样的问题：
宪法要解决的问题	SFlow 的现有机制
过度工程化	contract 的边界控制 + code-reviewer 审查
没写测试就写代码	build-executor 强制 TDD + guard 检查
超出范围实现	contract 定义了精确的 scope
架构不一致	spec → design → contract 层层约束
*宪法系统本质上是一个"AI 行为约束清单"*，而 SFlow 的 Agent 系统提示 + 守卫钩子 + 契约验证 已经构成了更强大的约束体系。
做了会有什么代价

- 维护成本：宪法规则需要持续更新，否则会变成无人问津的文档
- 噪音：违反宪法不一定意味着问题，Agent 每次都要处理宪法报告，反而降低效率
- 虚假安全感：宪法条款写得再好，如果 Agent 选择忽略或编造豁免理由，它就是一张纸

门控扩展 需要做吗？
现状：guard.ts 已经有全面的守卫检查：

- 制品与阶段一致性
- 契约过期
- 任务完成
- 调试状态
- 文件写入
- 进度防重复
- 等等

已经很完善了。再加宪法检查、前置条件检查，属于"为加而加"。

步骤类型扩展：
并行的 fan_out 与 fan_in 合并，反而会带来复杂性和不确定性。

shell 和 prompt 步骤
shell：子 Agent 已经有 bash 工具，不需要额外实现。 
prompt：就是现有的 call_flow_agent 工具，已有。

# 三、关于源项目更新：

## Comet 演进分析（bc6219df → 9b217fdd）

总共 19 个 commits，时间跨度 7月6日 到 7月15日。核心变化可以分为三大块：
一、值得借鉴的增量功能

1. Artifact Language 配置 + Guard 语言检测 (#153) — ⭐⭐⭐ 中等价值
comet 新增了工件语言配置体系，在 domains/skill/languages.ts 中定义：
SkillLanguageId: en | zh
ArtifactLanguageId: en | zh-CN
- 用户选择 skill 语言时自动关联 artifact 语言（en → en, zh → zh-CN）
- comet-guard.sh 在 phase 转换时自动检测 artifact 的 CJK/英文占比，排除 fenced code block 中的代码/路径干扰
- 语言不匹配直接阻断，fail-closed
- 支持 LC_ALL=C 下字节级 CJK 匹配，解决跨平台 locale 差异
对我们的启示：如果我们的项目需要双语 artifact 支持（中英文 spec），可以借鉴这个体系。但当前优先级不高。
2. Doctor 诊断增强 (#165) — ⭐⭐⭐ 中等价值
doctor.ts 新增了更全面的诊断项：
- 检查 openspec CLI 是否安装
- 检查 codegraph 是否可用
- 检查 working directories（docs/superpowers/specs/ 等）是否存在
- 检查 managed skill paths 完整性
- 检查 classic change 状态一致性
- 按 scope（project/global/auto）分层扫描
对我们的启示：可以给 sFlow 加一个 workflow_doctor 工具，检查：
- .sflow/ 下 artifact 完整性
- 状态文件一致性（state vs 实际 artifact）
- 子 agent 注册状态
- 当前 change 的 guard 状态
3. CodeBuddy Hook 支持 (#197) — ⭐ 低价值
新增 CodeBuddy 平台的 hook 安装，属于平台扩展，对我们的 sFlow 架构没有直接借鉴意义。
二、重大架构演进（参考价值有限）
4. comet-any / comet-eval (#156) — 全新生态
这是 comet 最大的变化，但属于产品级全新功能，不是我们 sFlow 能直接借鉴的：
模块	规模	说明
comet-any	~15,000+ 行	通用 skill 创作平台，支持 bundle 编译、分发、多平台发布
comet-eval	~10,000+ 行	评估框架，支持 LangSmith 追踪、pass@3 指标、噪声过滤、HTML 报告
Classic Runtime	~50,000+ 行	从 shell 脚本全面迁移到 TypeScript（comet-runtime.mjs），8 个脚本全部 .mjs
关键架构变化：comet 从 shell 脚本进化到了 TypeScript 运行时
- comet-guard.sh → comet-guard.mjs（10,173 行）
- comet-state.sh → comet-state.mjs（9,273 行）
- comet-handoff.sh → comet-handoff.mjs（9,491 行）
这些对我们来说参考价值有限，因为：
- 我们的 sFlow 已经是 TypeScript 插件架构，架构层面更先进
- comet-any 的 skill 创作/发布平台是产品级生态，超出 sFlow 的 scope
- comet-eval 的评估框架如果我们需要，可以独立设计更轻量的版本
三、总结：comet 值得借鉴的要点
回到我们之前已经借鉴的 comet 设计（Preset 升级、Phase Guard、Subagent Dispatch、Auto-Transition），本次演进中真正值得补充的只有两点：
1. Artifact Language Guard 的思路
   └─ 不是直接抄，而是借鉴其"在 guard 中检测 artifact 属性的模式"
   └─ 我们可以扩展 guard 做更多 artifact 属性检查（如：检测 spec 是否包含 TODO 占位符）

2. Doctor 诊断的增强方向
   └─ 给 sFlow 加一个轻量的 health check 工具
   └─ 检查：artifact 完整性、状态一致性、subagent 注册状态
   综合建议：comet 本次演进的核心是 comet-any 生态和 shell→TS 运行时迁移，这些与我们的架构方向不同。之前的 4 个借鉴点（Preset 升级、Phase Guard 协议、Subagent Dispatch、Auto-Transition）已经覆盖了 comet 对我们最有价值的设计模式，本次新增中没有必须追加的高优先级项目。

## spec-superflow 演进分析（6951031 → 362b238a）

当前状态: opencode-flow-engine 的 sFlow 已实现以下能力（且部分已领先 spec-superflow）：
- Artifact Preflight Gate（状态进入前工件检查）
- Preset Upgrade Thresholds（hotfix/tweak → full 阈值）
- 文件边界控制（read_files / write_files）
- Git commit 边界验证
- PROGRESS.md 反重复协议
- LESSONS.md 跨任务知识库
- 前端检测 + ui-design 状态
- 合同陈旧检测
- 意图路由 + 同义词扩展
- 级联配置（用户级 + 项目级）
- Boulder 状态持久化 + 自动修复
- 子代理进度检查点（subagent-progress.md）

从 spec-superflow 更新中值得借鉴的功能，按优先级排序：
P0 — 执行控制平面（Execution Control Plane）
spec-superflow 新增了 14 个提交 实现完整的执行控制平面，这是最大、最值得借鉴的新功能：
核心设计：ssf execution plan|show|revise|review 四组命令 + 持久化执行计划
组件	说明	借鉴价值
执行计划结构	mode(inline/batch-inline/sdd) + source(user-override/default) + rationale + waves	⭐⭐⭐⭐⭐
Wave 分波执行	每个 wave 包含 id + strategy(parallel/serial) + tasks + depends_on	⭐⭐⭐⭐⭐
Wave 依赖图	检查循环依赖，确保串行 wave 按顺序执行	⭐⭐⭐⭐⭐
Review 收据	`ssf execution review --wave <id> --base <sha> --head <sha> --report <path> --verdict pass	fail`
计划哈希校验	artifacts_hash + contract_hash + content_hash 三重校验，防止计划过期	⭐⭐⭐⭐
Revision 机制	计划版本号，仅允许 inline/batch-inline 升级到 sdd	⭐⭐⭐⭐
Guard 阻拦	没有控制记录时阻止执行和关闭	⭐⭐⭐⭐⭐
sFlow 现状：build-executor 已实现 SDD 模式，但没有 formal 的执行计划结构。任务执行依赖 tasks.md 的 checklist，没有 wave 分波、依赖图、review 收据的概念。
借鉴方向：
在 execution-contract.md 中增加执行计划区段（mode + waves + dependencies）
build-executor 执行前先验证 wave 依赖是否就绪
增加 ssf execution review 等价命令来记录 review 收据
在 closing 状态 gate 中增加 "所有 wave 的 review 收据必须为 pass" 的条件
P1 — SDD Overlay 存储 + 检查点 + 移交
spec-superflow 新增了 8 个提交 实现 SDD overlay 和检查点系统：
组件	说明	借鉴价值
SDD Overlay 存储	持久化 overlay 目录，存储 SDD 执行状态	⭐⭐⭐⭐⭐
任务检查点	`ssf checkpoint save	list
移交合约	`ssf handoff create	list
标记失效	删除的 SDD 任务标记为 stale 而非物理删除	⭐⭐⭐⭐
sFlow 现状：build-executor 已有 subagent-progress.md 记录 stage + reviewFixRound，但没有 formal 的检查点系统和移交合约。
借鉴方向：
将 subagent-progress.md 升级为更结构化的检查点系统，记录 commit-start/commit-end 证据
增加移交合约概念，用于跨会话的 context 交接
在 .sflow/ 下增加 overlay 存储目录结构
P2 — 执行模式推荐（DP-4）
ba81a4a: ssf execution plan 命令自动记录执行模式推荐到 DP-4
设计：ssf execution plan <dir> --mode <mode> --reason <text> --wave <id>:<strategy>:<task,...>
在 DP-4（决策点）自动推荐执行模式（inline/batch-inline/sdd）
writeExecutionSummary() 同时更新 execution_mode, execution_plan_hash, dp_4_result, dp_4_timestamp
三种模式精确区分：inline（单任务直接执行）、batch-inline（批量执行）、sdd（子代理驱动开发）
sFlow 现状：record_decision_point 工具已有 DP-0 到 DP-5，但 DP-4 没有自动推荐执行模式。
借鉴方向：在 record_decision_point 执行 DP-4 时，基于 tasks.md 的任务数量和复杂度自动推荐执行模式，将推荐结果写入 state.json。
P3 — 收据完整性（Receipt Integrity）
spec-superflow 新增了 8 个提交 强化 review 收据的完整性验证：
校验	说明
验证收据证据	review 收据必须包含 base/head/report，且指向真实文件
拒绝符号链接	收据证据不能是符号链接（防止篡改）
锚定到物理 overlay	收据必须存储在 overlay 目录中
迁移到真实 Git 证据	测试用例从 mock 迁移到真实 git commit hash
重新验证持久化范围	每次验证时重新检查持久化的 review 范围
sFlow 现状：code-reviewer 执行 review 并输出结果，但没有收据持久化机制和完整性校验。
借鉴方向：在 code-reviewer 完成 review 后，将 review 收据（commit hash 范围 + review 报告路径 + verdict）持久化到 .sflow/reviews/ 目录，并验证收据完整性。
P4 — 最小化纪律（Minimality Discipline）
spec-superflow 新增了 4 个提交 实现 code-reviewer 的最小化审查：
216b17d: 审查器明确检查"不必要的复杂性"
审查规则：不添加未要求的特性、不创建一次性辅助工具、不添加向后兼容垫片
审查器安全阀：如果审查发现不必要的复杂性，必须 block
sFlow 现状：AGENTS.md 中已有"不要过度工程"的指令，但 code-reviewer 没有专门的"最小化"审查规则。
借鉴方向：在 code-reviewer 的 prompt 中增加明确的最小化审查指令，要求检查每个新增代码是否都是必要且最小化的。
P5 — 模型配置文件（Model Profile Resolver）
spec-superflow 新增了 6 个提交 实现模型配置文件：
4 个预定义 profile：mechanical, standard, strong, review
在 spec-superflow.config.json 中配置：{ "models": { "strong": "claude-4" } }
CLI 暴露：ssf model resolve <profile>
sFlow 现状：config-loader.ts 已有 SFlowConfig 接口和 AgentConfigEntry 支持 per-agent 模型配置，但没有 profile 级别的抽象。
借鉴方向：在 SFlowConfig 中增加 modelProfiles 字段，支持用户按用途（机械/标准/强/审查）配置模型，减少重复配置。
P6 — 问题验证批量修复（7 个关键 Bug）
7e9d2b1 修复了 7 个关键问题，其中多个问题 sFlow 也可能遇到：
Bug	发现	sFlow 是否受影响
BUG-A: executing→closing 不可达	release-archivist 不写 test_result:pass	✅ 需检查 closing gate
BUG-B: 幽灵状态	缺少 state 文件时静默返回默认值	✅ 当前有兜底但可能掩蔽问题
#28: closing 前需合并 specs	关闭前 delta spec 必须合并	✅ 有 spec-merger 但无强制 gate
#15: git 隔离仅为建议	分支隔离没强制执行	✅ 当前有建议但无强制
#26/#27.2: PATH 依赖	skill 中依赖 PATH 解析 CLI	✅ 需检查 skill 中 CLI 路径
#29: 安装器缺失	某些平台缺少安装器	不适用
借鉴方向：
检查 closing state 的 gate 是否充分：验证所有 task 已完成 + 所有 delta spec 已合并 + 所有 review 收据已收集
在 workflow-manager.ts 的 transitionState 中增加"状态文件缺失时直接报错"的逻辑
在 build-executor 的 SDD 模式中增加 git 分支隔离的强制检查
P7 — 质量审计 + Token 效率
spec-superflow 进行了全面的质量审计和 token 优化：
改进	说明
31 个 bug + 6 个 token 优化	v0.8.4 质量审计
Token baseline 工具	ssf token baseline + token lint 规则
Skill 压缩	Group A (5 skills) + Group B (4 skills) 各压缩 ~50%
CI token 效率 lint	每次 CI 运行自动检查 token 效率
状态机审计	43 个 guard 测试覆盖全部 21 个合法 + 8 个非法转换
sFlow 现状：sFlow 的 skill 尚未进行压缩优化，guard 也没有完整的测试覆盖。
借鉴方向：对 sFlow 的 9 个 skill 进行 token 压缩审计，确认 guard 测试的覆盖率。
总结：建议的行动优先级
优先级	功能	价值	工作量
P0	执行控制平面（Wave 分波 + 依赖图 + Review 收据）	⭐⭐⭐⭐⭐	高
P1	SDD 检查点 + 移交合约升级	⭐⭐⭐⭐⭐	中
P2	DP-4 执行模式推荐	⭐⭐⭐⭐	低
P3	收据完整性验证	⭐⭐⭐⭐	中
P4	最小化审查纪律	⭐⭐⭐	低
P5	模型 profile 配置	⭐⭐⭐	低
P6	Bug 验证（closing gate、幽灵状态、分支隔离）	⭐⭐⭐⭐⭐	低-中
P7	Skill token 压缩 + Guard 测试覆盖	⭐⭐⭐	中
最值得立即借鉴的 3 个功能：
执行控制平面 — 这是 spec-superflow 最大的架构改进，sFlow 的 build-executor 可以借鉴 wave 分波
SDD 检查点升级 — sFlow 已有 subagent-progress.md 基础，升级到结构化检查点成本低
Bug 验证 — closing gate 强制检查、幽灵状态检测、git 分支隔离，这些是质量保障的"最后一公里"

spec-superflow 演进分析（362b238a → fd671ebe）

362b238a → fd671ebe（16 个提交，51 个文件变更，+820/-107 行）

优先级	借鉴点	价值	工作量
P3	Raw-mode 冒烟测试 — 验证插件在干净环境中的核心功能	⭐⭐⭐	低
P4	版本一致性检查 — 自动化版本号扫描	⭐⭐	低
P5	白名单资产读取 — 统一模板读取入口	⭐⭐	低
总体结论：v0.9.1 的 Portable Runtime 架构变更对 spec-superflow 自身是重要的基础设施升级，但对我们的 sFlow 没有直接影响，因为我们从一开始就采用了 OpenCode 插件机制，不存在本地路径依赖问题。本次更新中值得借鉴的内容相对有限，优先级都不高。

最终决策：不借鉴
