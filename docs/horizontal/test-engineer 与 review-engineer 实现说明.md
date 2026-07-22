# test-engineer 与 review-engineer 实现说明

---

## 一、实现讨论

### 保留现状

- 每波次的内置 test/review 保持轻量，只做功能验证
- iFlow 和 sFlow 各自的波次循环不变

### 新增能力

- `test-engineer` 和 `review-engineer` 是两个独立子代理，**不属于任何工作流**
- 由用户主动触发（"进行全面review"、"进行全面test"）
- 在工作流结束后（或任何时刻）做一次性的、全面的质量评估

### 架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户触发层                                    │
│                                                                     │
│   "进行全面review"  ──────┐                                         │
│   "进行全面test"   ──────┼─── 用户一句话，不依赖工作流状态          │
│   "帮我做一次完整的测试" ──┘                                         │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              │ 意图路由
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    主智能体 (iFlow / sFlow)                         │
│                                                                     │
│  识别到"全面review"或"全面test"意图 → 跳过工作流状态检测            │
│  → 直接 dispatch 对应子代理                                          │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ call_flow_agent
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  独立子代理（一次性·全面评估）                       │
│                                                                     │
│  ┌────────────────────────────┐  ┌────────────────────────────────┐ │
│  │     test-engineer          │  │     review-engineer            │ │
│  │                            │  │                                │ │
│  │  输入：全部代码 + 产物     │  │  输入：全部代码 + 产物 + diff  │ │
│  │                            │  │                                │ │
│  │  R1: 功能测试（全量）      │  │  R1: Spec 合规审查             │ │
│  │  R2: 性能测试              │  │  R2: 代码质量 6 维             │ │
│  │  R3: 安全测试              │  │  R3: UI 视觉审查               │ │
│  │  R4: 兼容性测试            │  │  R4: 技术债评估(可选)          │ │
│  │  R5: 可观测性验证          │  │  R5: 跨模型 spot-check(可选)   │ │
│  │                            │  │                                │ │
│  │  输出：TEST.md + 报告      │  │  输出：REVIEW.md + 报告        │ │
│  └────────────────────────────┘  └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、与现有波次流程的关系

### iFlow 波次循环

```
┌─────────────────────────────────────────────────────────────────────┐
│  Wave 1 → Wave 2 → Wave 3 → ... → 全部完成                         │
│    │          │         │              │                            │
│    ├─ 执行    ├─ 执行   ├─ 执行        │                            │
│    ├─ 轻量verify  ├─ 轻量verify  ├─ 轻量verify  │                   │
│    └─ 轻量review  └─ 轻量review  └─ 轻量review  │                   │
│                                       │                            │
│                                       ▼                            │
│                              用户说："进行全面review"               │
│                                       │                            │
│                                       ▼                            │
│                              dispatch → review-engineer            │
│                              (一次性扫全部代码 + 全部产物)          │
└─────────────────────────────────────────────────────────────────────┘
```

### sFlow 波次循环

```
┌─────────────────────────────────────────────────────────────────────┐
│  Wave 1 → Wave 2 → Wave 3 → ... → 全部完成                         │
│    │          │         │              │                            │
│    ├─ 执行    ├─ 执行   ├─ 执行        │                            │
│    ├─ TDD测试 ├─ TDD测试 ├─ TDD测试    │                            │
│    └─ code-reviewer ──┘               │                            │
│                                       │                            │
│                                       ▼                            │
│                              用户说："进行全面test"                 │
│                                       │                            │
│                                       ▼                            │
│                              dispatch → test-engineer              │
│                              (一次性 5 轮金字塔)                    │
└─────────────────────────────────────────────────────────────────────┘
```

> **核心原则**：波次内测试/review 是"红灯/绿灯"的快速检查，全面测试/review 是"质量审计报告"。

---

## 三、子代理输入/输出契约

### test-engineer

**输入：**

- 项目代码（全量或指定模块）
- 已有产物：REQUIREMENT.md / DESIGN.md / TASK.md / 各 SUMMARY.md（如有）
- 用户可指定范围："只测性能"、"只测安全"、"全量"

**执行流程：**

1. 声明本次跑哪几轮（用户可指定 skip）
2. 按轮次依次执行，每轮输出量化结果
3. 汇总报告

**输出：**

```
.sflow/test-report/TEST-<timestamp>.md
├── 本次测试范围声明
├── R1 功能测试：AC 覆盖矩阵 + 覆盖率 + 边界值
├── R2 性能测试：Lighthouse/k6 指标 + 基线对比
├── R3 安全测试：依赖扫描 + 秘钥扫描 + SAST + OWASP
├── R4 兼容性测试：跨浏览器 + 数据迁移
├── R5 可观测性：日志/指标/告警/健康检查
└── 总体判定：PASS / FAIL（含失败项清单）
```

**调用示例：**

```
call_flow_agent(
  subagent_type="test-engineer",
  prompt="对本次 change 进行全面 test。范围：全量 5 轮。"
)
```

### review-engineer

**输入：**

- git diff（本次变更的完整 diff）
- 全部产物：REQUIREMENT.md / DESIGN.md / UI-DESIGN.md / TASK.md / TEST.md
- 用户可指定范围："只看代码质量"、"只看 UI"

**执行流程：**

1. 声明本次跑哪几轮
2. 依次审查，每轮输出严重度分级 + 文件行号引用
3. 汇总修复建议

**输出：**

```
.sflow/review-report/REVIEW-<timestamp>.md
├── 本次审查范围声明
├── R1 Spec 合规：AC 逐条对实现 + 测试覆盖 + 范围蔓延检测
├── R2 代码质量：6 维衰退风险 + 书本引用 + 4 要素格式
├── R3 UI 视觉：Design Tokens + Anti-pattern + 无障碍
├── [R4 技术债评估(可选)]
├── [R5 跨模型 spot-check(可选)]
├── 严重度汇总：🔴 Critical / 🟡 Major / 🟢 Minor
└── 修复任务清单（如需要）
```

**调用示例：**

```
call_flow_agent(
  subagent_type="review-engineer",
  prompt="对本次 change 进行全面 review。范围：R1+R2+R3。"
)
```

---

## 四、与 flow-kit 的横向命令体系对比

flow-kit 也有类似概念——它的 L-/M-/I-/A- 系列命令就是独立于主流程的横向命令。

| 命令 | flow-kit 等价 | 说明 |
|------|---------------|------|
| test-engineer | 无直接等价（5-test 是阶段而非横向命令） | 我们的设计比 flow-kit 更灵活 |
| review-engineer | 无直接等价（6-review 是阶段而非横向命令） | 同上 |

> flow-kit 的 5-test 和 6-review 是必须按顺序走的阶段，而我们的方案把它们变成了按需调用的横向命令——这比 flow-kit 更灵活，用户可以在任何时候触发。

---

## 五、实现方案

### 第一步：注册子代理

在 `sflow-plugin-factory.ts` 和 `iflow-plugin-factory.ts` 中同时注册：

```typescript
// 两个工厂都注册，让 iFlow 和 sFlow 都能调用
export const SHARED_AGENT_NAMES = [
  'test-engineer',
  'review-engineer',
] as const;
```

### 第二步：主智能体识别意图

在 sFlow 和 iFlow 的 system prompt 中增加意图路由规则：

| 用户说 | 意图 | 动作 |
|--------|------|------|
| "进行全面review" / "全面审查" | full-review | dispatch → review-engineer |
| "进行全面test" / "全面测试" | full-test | dispatch → test-engineer |
| "只测性能" / "安全扫描" | partial-test | dispatch → test-engineer（指定轮次） |
| "只看代码质量" | partial-review | dispatch → review-engineer（指定轮次） |

### 第三步：两个子代理的 prompt 来源

直接从 flow-kit 的 `prompts/5-test.md` 和 `prompts/6-review.md` 移植核心逻辑，转化为子代理的 system prompt：

- `test-engineer` ← 移植 5-test.md 的 5 轮金字塔 + `reference/test-pyramid.md`
- `review-engineer` ← 移植 6-review.md 的 3 轮审查 + `reference/ui-anti-patterns.md`

---

## 六、现有路由系统分析

### sFlow 路由有两层

**第一层：主智能体（spec-flow.ts）的 Phase 0 Intent Gate**

sFlow 每收到一条消息，先做意图分类：

| 用户说 | 意图 | 动作 |
|--------|------|------|
| "开始一个新功能" | Start workflow | 调用 `workflow_router` 检测状态 |
| "帮我看看" | Status check | 检查 `.sflow/` 工件 |
| "继续" | Continue | 调用 `workflow_router` → 路由 |

**第二层：`workflow_router` 工具（workflow-router.ts）**

- Phase 1: Intent-based routing → 遍历 `INTENT_MAP` 匹配关键词 → 检查 `STATE_ALLOWED_AGENTS` 状态门禁 → 命中 → 返回 skill 名称
- Phase 2: Artifact-based state detection（fallback）→ 读 `.sflow/state.json` + 工件推断 → 返回当前状态 + 推荐 skill

### iFlow 路由

`iflow_router` 工具：

- Phase 1: 遍历 `IFLOW_INTENT_PATTERNS` 匹配
- Phase 2: 从 `.iflow/` 工件推断状态

---

## 七、集成方案

### 核心思路：新增"Phase 0 — 横向命令检测"

在 `workflow_router` 和 `iflow_router` 的 Phase 1 之前，插入一个新的 Phase 0，专门检测"全面review"和"全面test"这类不依赖工作流状态的横向命令。

```
Phase 0 (新增): 横向命令检测
  → 匹配 "全面test" / "全面review" / "进行全面测试" 等
  → 命中 → 直接返回对应子代理，跳过状态门禁
  → 不命中 → 继续 Phase 1

Phase 1: Intent-based routing（现有）
  → 匹配工作流内意图
  → 检查状态门禁

Phase 2: Artifact-based detection（现有）
  → 通过工件推断状态
```

### 对 `workflow_router` 的修改

```typescript
// 在 workflow-router.ts 开头的 INTENT_MAP 之前新增
const HORIZONTAL_COMMANDS: Array<{
  pattern: RegExp;
  agent: string;
  action: string;
  description: string;
  tokens: string[];
}> = [
  // --- test-engineer (全面测试) ---
  {
    pattern: /全面.*test|全面.*测试|full.*test|完整.*测试|全线.*测|彻底.*测|测试所有|run.*all.*test/i,
    agent: 'test-engineer',
    action: 'full-test',
    description: '全面测试',
    tokens: ['全面test', '全面测试', 'full test', '完整测试', '全线测试', '彻底测试', '测试所有']
  },
  {
    pattern: /只测性能|只测安全|只测兼容|只跑.*test|只跑.*测试|partial.*test/i,
    agent: 'test-engineer',
    action: 'partial-test',
    description: '部分测试',
    tokens: ['只测', '部分测试', 'partial test']
  },

  // --- review-engineer (全面审查) ---
  {
    pattern: /全面.*review|全面.*审查|full.*review|完整.*审查|彻底.*审查|全线.*审|审查所有|代码审计|code.*audit/i,
    agent: 'review-engineer',
    action: 'full-review',
    description: '全面审查',
    tokens: ['全面review', '全面审查', 'full review', '完整审查', '彻底审查', '代码审计', 'code audit']
  },
  {
    pattern: /只看代码|只看UI|只看视觉|只看.*质量|只看.*合规|partial.*review/i,
    agent: 'review-engineer',
    action: 'partial-review',
    description: '部分审查',
    tokens: ['只看', '部分审查', 'partial review']
  },
];
```

然后在 `execute()` 方法中，Phase 1 之前插入 Phase 0：

```typescript
execute: async (params, context) => {
  // ...

  // Phase 0: Horizontal command detection (bypasses state guards)
  if (userIntent) {
    for (const cmd of HORIZONTAL_COMMANDS) {
      if (cmd.pattern.test(userIntent)) {
        return {
          title: "Workflow Router",
          output: JSON.stringify({
            success: true,
            data: {
              source: 'horizontal-command',
              state: null,  // 不依赖工作流状态
              skill: cmd.agent,
              action: cmd.action,
              description: cmd.description,
              isHorizontalCommand: true,  // 标记为横向命令
              reasons: [`Horizontal command: ${userIntent} → ${cmd.agent}`],
              stateGuardBlocked: false,  // 跳过状态门禁
            },
          }),
        };
      }
    }
  }

  // Phase 1: Intent-based routing (existing)...
}
```

### 对 `iflow_router` 的修改

同样方式，在 `IFLOW_INTENT_PATTERNS` 之前新增横向命令检测：

```typescript
const IFLOW_HORIZONTAL_COMMANDS: Array<{
  pattern: RegExp;
  agent: string;
  action: string;
  description: string;
}> = [
  { pattern: /全面.*test|全面.*测试|full.*test|完整.*测试|全线.*测|彻底.*测/i,
    agent: 'test-engineer', action: 'full-test', description: '全面测试' },
  { pattern: /全面.*review|全面.*审查|full.*review|完整.*审查|代码审计/i,
    agent: 'review-engineer', action: 'full-review', description: '全面审查' },
];
```

### 对主智能体 prompt 的修改

**sFlow（spec-flow.ts）** 的 Phase 0 Intent Gate 增加：

| 用户说 | 意图 | 动作 |
|--------|------|------|
| "进行全面test" / "帮我做一次完整的测试" / "全面测试" | horizontal-test | dispatch → test-engineer |
| "进行全面review" / "帮我审查代码" / "全面审查" | horizontal-review | dispatch → review-engineer |
| "只测性能" / "安全扫描" | partial-test | dispatch → test-engineer（指定轮次） |
| "只看代码质量" / "UI审查" | partial-review | dispatch → review-engineer（指定轮次） |

iFlow 主智能体 prompt 同理增加。

### 关键设计：跳过状态门禁

这是最核心的改动。现有系统有个 `STATE_ALLOWED_AGENTS` 表（`workflow-router.ts` 第14行），任何路由都会检查当前状态是否允许该 agent。

```
exploring:   ['need-explorer']
specifying:  ['spec-writer', 'spec-merger']
executing:   ['build-executor', 'code-reviewer', 'bug-investigator']
closing:     ['release-archivist']
```

`test-engineer` 和 `review-engineer` 必须在所有状态下都可用，包括 exploring（还没开始开发时也可以做审计）。

**实现方式**：在 `STATE_ALLOWED_AGENTS` 中为每个状态都加入这两个 agent：

```typescript
const STATE_ALLOWED_AGENTS: Record<string, string[]> = {
  exploring: ['need-explorer', 'test-engineer', 'review-engineer'],
  specifying: ['spec-writer', 'spec-merger', 'test-engineer', 'review-engineer'],
  'ui-design': ['spec-writer', 'test-engineer', 'review-engineer'],
  bridging: ['contract-builder', 'spec-merger', 'test-engineer', 'review-engineer'],
  'approved-for-build': ['contract-builder', 'build-executor', 'code-reviewer', 'spec-merger', 'test-engineer', 'review-engineer'],
  executing: ['build-executor', 'code-reviewer', 'bug-investigator', 'test-engineer', 'review-engineer'],
  debugging: ['bug-investigator', 'build-executor', 'test-engineer', 'review-engineer'],
  closing: ['release-archivist', 'test-engineer', 'review-engineer'],
};
```

或者更简单——在 `workflow_router` 的 Phase 0 中直接返回 `stateGuardBlocked: false`，不走 `STATE_ALLOWED_AGENTS` 检查。

### 对 sFlow factory 的修改

`call_flow_agent` 工具需要允许 iFlow 调用 sFlow 注册的子代理（反之亦然）。当前 `sflow-plugin-factory.ts` 第115行限制了：

```typescript
const validSFlowAgents = SFLOW_AGENT_NAMES as readonly string[];
if (!validSFlowAgents.includes(subagent_type as string)) {
  return await formatToolError(...);  // 拒绝
}
```

需要新增一个共享子代理名单，两个工厂都允许：

```typescript
// 新增共享 agent 名单
export const SHARED_AGENT_NAMES = [
  'test-engineer',
  'review-engineer',
] as const;

// iFlow-plugin-factory.ts 和 sflow-plugin-factory.ts 都允许
const allowedAgents = [...SFLOW_AGENT_NAMES, ...SHARED_AGENT_NAMES];
```

### 完整集成流程图

```
用户输入: "进行全面review"
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ sFlow / iFlow 主智能体 Phase 0 Intent Gate                  │
│                                                             │
│  匹配 → "horizontal-review"                                 │
│  → 不调 workflow_router                                     │
│  → 直接 call_flow_agent(subagent_type="review-engineer")     │
└─────────────────────────────────────────────────────────────┘
         │
         │ 或者代理调用了 workflow_router / iflow_router
         ▼
┌─────────────────────────────────────────────────────────────┐
│ workflow_router / iflow_router                              │
│                                                             │
│ Phase 0: Horizontal Command Detection ← 新增                │
│   → 匹配 "全面review"                                       │
│   → 返回 { skill: "review-engineer", isHorizontal: true }   │
│   → 跳过 Phase 1 + Phase 2                                   │
│                                                             │
│ Phase 1: Intent-based (现有)                                │
│ Phase 2: Artifact-based (现有)                              │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ call_flow_agent 工具                                        │
│                                                             │
│ 检查 subagent_type 是否在允许名单中                          │
│ → test-engineer 在 SHARED_AGENT_NAMES 中                    │
│ → 允许调用                                                   │
│ → 独立 session，独立模型                                      │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ test-engineer / review-engineer                              │
│                                                             │
│ 一次性执行完整测试/审查                                      │
│ 输出报告到 .sflow/test-report/ 或 .sflow/review-report/     │
│ 返回给主智能体                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 八、最终实现：已完成改动

### Wave 1 — 创建 agent 定义 ✅

| 任务 | 文件 | 状态 |
|------|------|------|
| T01: test-engineer agent | `workflows/shared/agents/test-engineer.ts` | ✅ |
| T02: review-engineer agent | `workflows/shared/agents/review-engineer.ts` | ✅ |
| 共享导出 | `workflows/shared/index.ts` | ✅ |

### Wave 2 — 注册与路由集成 ✅

| 任务 | 改动 | 状态 |
|------|------|------|
| T03: agent-builder.ts 注册 | 新增 `AGENT_MODES` + `DEFAULT_MODELS` + `DEFAULT_FALLBACKS` + `AGENT_REGISTRY` | ✅ |
| T03: types.ts 类型 | 新增 `BuiltinAgentName` 分支 | ✅ |
| T03: agents/index.ts 导出 | 新增 `SHARED_AGENT_NAMES` 导出 | ✅ |
| T04: workflow_router Phase 0 | 新增 `HORIZONTAL_COMMANDS` 表 + Phase 0 检测逻辑 | ✅ |
| T05: iflow_router Phase 0 | 新增 `IFLOW_HORIZONTAL_COMMANDS` 表 + Phase 0 检测逻辑 | ✅ |
| T06: combined/sflow/iflow factory | 3 个工厂的 `call_flow_agent` 均放开 `SHARED_AGENT_NAMES` 白名单 | ✅ |

### Wave 3 — 主智能体 Prompt 集成 ✅

| 任务 | 改动 | 状态 |
|------|------|------|
| T07: sFlow spec-flow.ts | Phase 0 Intent Gate 增加 4 条横向命令 | ✅ |
| T07: iFlow iflow.ts | 新增 Horizontal Commands 表 + 输出格式 intent 扩展 | ✅ |

### 调用方式

**用户触发：**

- `"全面test"` / `"进行全面测试"` → dispatch test-engineer
- `"全面review"` / `"全面审查"` → dispatch review-engineer
- `"只测性能"` / `"只看代码质量"` → dispatch 指定轮次

**内部调用（由主智能体自动路由）：**

两种方式都生效：

1. 主智能体直接识别 intent → `call_flow_agent(subagent_type="test-engineer")`
2. 主智能体调用 `workflow_router` / `iflow_router` → Phase 0 检测 → 返回共享 agent

### 关键设计

- **跳过状态门禁**：`isHorizontalCommand: true` 标记，`STATE_ALLOWED_AGENTS` 不拦截
- **跨工作流**：`SHARED_AGENT_NAMES` 同时注册到 iFlow 和 sFlow 工厂
- **零侵入**：不改变现有波次循环，不修改现有子代理逻辑

---

## 九、实现总结

### 新增文件

| 文件 | 说明 |
|------|------|
| `workflows/shared/index.ts` | 共享 agent 导出入口 + `SHARED_AGENT_NAMES` 常量 |
| `workflows/shared/agents/test-engineer.ts` | test-engineer agent 定义（5 轮测试金字塔） |
| `workflows/shared/agents/review-engineer.ts` | review-engineer agent 定义（3 轮审查） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `packages/plugin-infra/src/agents/agent-builder.ts` | 注册 test-engineer/review-engineer 到 `AGENT_MODES`、`DEFAULT_MODELS`、`DEFAULT_FALLBACKS`、`AGENT_REGISTRY` |
| `packages/plugin-infra/src/agents/types.ts` | `BuiltinAgentName` 增加两个新类型 |
| `packages/plugin-infra/src/agents/index.ts` | 导出 `SHARED_AGENT_NAMES` |
| `packages/plugin-infra/src/tools/workflow-router.ts` | 新增 Phase 0 横向命令检测（`HORIZONTAL_COMMANDS`） |
| `packages/plugin-infra/src/tools/iflow-router.ts` | 新增 Phase 0 横向命令检测（`IFLOW_HORIZONTAL_COMMANDS`） |
| `packages/plugin-infra/src/combined-plugin-factory.ts` | `call_flow_agent` 放开 `SHARED_AGENT_NAMES` 白名单 |
| `packages/plugin-infra/src/sflow-plugin-factory.ts` | 同上 |
| `packages/plugin-infra/src/iflow-plugin-factory.ts` | 同上 |
| `workflows/sflow/agents/spec-flow.ts` | Phase 0 Intent Gate 增加 4 条横向命令 |
| `workflows/iflow/agents/iflow.ts` | 新增 Horizontal Commands 表 + 输出格式扩展 |

### 最终架构图

```
用户说 "全面test" / "全面review"
       │
       ▼
┌─────────────────────────────┐
│ sFlow / iFlow 主智能体      │
│ Phase 0 Intent Gate 识别     │
│ → 直接 call_flow_agent       │
└─────────────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ call_flow_agent 工具        │
│ SHARED_AGENT_NAMES 白名单    │
│ → 跳过 workflow 边界检查     │
│ → 创建独立 session           │
└─────────────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ test-engineer / review-engineer│
│ 一次性全面评估                │
│ 输出 .sflow/test-report/     │
│ 或 .sflow/review-report/     │
└─────────────────────────────┘
```

### 工作流不侵入

- **iFlow 的波次循环**：discussing → researching → planning → executing → verifying → shipping — 不变
- **sFlow 的波次循环**：exploring → specifying → [ui-design] → bridging → executing → debugging → closing — 不变
- 每波次内的轻量测试/审查 — 不变
- 共享 agent 只在用户主动触发时被调用