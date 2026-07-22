# flow-kit 横向命令体系详解

---

## 一、什么是横向命令

横向命令是**不属于主流程编号（0-change → 7-integration）的独立工作流**。它们不依赖活跃 change，可以在任何时间通过 `@flow-kit/GO.md` + 关键词触发。

### 前缀命名规则

| 前缀 | 含义 | 作用域 |
|------|------|--------|
| I- | Intel（情报） | 项目级，一次性 |
| A- | Architecture（架构） | 项目级，按需 |
| M- | Maintenance（维护） | 仓库级，周期性 |
| L- | Lifecycle（生命周期） | change 级，按需 |

---

## 二、I-intel-scan — 入场扫描

**触发词**：`扫描代码 / scan / intel / 入场扫描 / 给项目体检`

**一句话**：老项目首次使用 flow-kit 时的"破冰"命令。自动扫描整个代码库，生成 `.specs/CONTEXT.md`，让后续 AI 知道项目架构、约定、抽象层。

### 核心流程

```
步骤 0  → 既有文档探测（AGENTS.md / CLAUDE.md / .cursorrules 等）
步骤 1  → 探测项目元信息（grep 实战）
   ├── 1.1 包管理 + 运行时（package.json / pyproject.toml 等）
   ├── 1.2 框架检测（React / Vue / Spring / FastAPI 等）
   ├── 1.3 关键约定（命名风格 / import 风格 / 测试框架 / CI）
   ├── 1.4 既有抽象层（HTTP client / Repository / hooks / utils 等）
   ├── 1.5 数据库 schema（Prisma / Alembic / Knex 等）
   └── 1.6 基础设施（Docker / k8s / 服务依赖）
步骤 2  → 生成 CONTEXT.md（每个字段都带文件路径+行号证据）
步骤 3  → 更新 STATE.md（last_intel_scan 时间戳）
步骤 4  → 输出扫描总结（关键发现 + 对后续 change 的影响）
```

### 关键设计

- 步骤 0 的 3 个分支：项目已有 AI 文档（A 分支）→ 综合或替换；仅有非标准文档（B 分支）→ 补充输入；完全空白（C 分支）→ 纯扫描生成
- **禁止盲飞**：分支 C 必须等用户确认 1/2/3 才能开始扫描
- 不是周期性命令：跑过一次就行，项目结构大变时才需要重跑

---

## 三、A-architect — 建立/重构项目级架构文档

**触发词**：`建立架构 / 架构梳理 / 重构架构 / architect / 重审 ADR`

**一句话**：建立或重构 `.specs/ARCHITECTURE.md`——项目级架构文档（模块图 + 依赖规则 + ADR 列表 + 跨模块契约 + 扩展点 + 容量边界）。

### 核心流程（首跑 4 步，重构 6 步）

| 步骤 | 内容 |
|------|------|
| 步骤 1 | 判定模式（首跑 vs 重构） |
| 步骤 2 | 系统概览（一句话定位 + 服务边界图 + NFR 基线） |
| 步骤 3 | 模块清单 + 依赖规则（grep 实际依赖 → 让用户确认硬规则） |
| 步骤 4 | ADR 列表（首跑从 CONTEXT 提取；重构逐条审查状态） |
| 步骤 5 | 跨模块契约（公共 API / 事件总线 / Schema） |
| 步骤 6 | 扩展点 + 容量边界（推荐但非必填） |
| 步骤 7 | 写入 + 备份 + 修订历史 |

### 关键设计

- ADR 7 字段：状态 / 取舍 / 决定 / 理由 / 代价 / 来源 change / 推翻成本
- **依赖违例只记录不修**：步骤 3.2 找到违例只列文件，让用户开 fix change 修
- **AI 不替用户编理由**：ADR 的"理由/代价"字段必须用户确认
- 重构跑必备份：`cp ARCHITECTURE.md ARCHITECTURE.md.bak-<date>`

---

## 四、A-evolve — 架构增量同步

**触发词**：`同步架构 / 整理沉淀 / evolve / 架构演进 / 同步 CONTEXT`

**一句话**：把多个已归档 change 的 DESIGN.md § 9 段（架构沉淀建议）聚合起来，逐项让用户 review，批准后 patch 到 CONTEXT.md 和 ARCHITECTURE.md。

### 核心流程

```
步骤 1 → 确定扫描范围（从 last_evolve_at 之后归档的 change）
步骤 2 → 抽取所有 § 9 段（只读 § 9，禁止越界读其他内容）
步骤 3 → 聚合分类（5 类）
   ├── 3.1 新增可复用抽象（含冲突检测：grep CONTEXT 是否已有同类）
   ├── 3.2 项目级技术决策
   ├── 3.3 跨模块契约
   ├── 3.4 依赖变动
   └── 3.5 禁动清单变动
步骤 4 → 逐项 review（核心环节，不能跳过，不能批量 promote）
步骤 5 → 生成 patch（CONTEXT.md + 可选的 ARCHITECTURE.md）
步骤 6 → 写入（备份 + edit 按段 append，不整文件 rewrite）
步骤 7 → 输出 EVOLVE 报告 + 更新 STATE
```

### 关键设计

- 与 A-architect 的边界清晰：A-evolve 只 append 不 delete；遇到需删 ADR / 改依赖规则 → 提示跑 A-architect
- **冲突检测**：每条新抽象都 grep CONTEXT「既有抽象索引」，有同类标 ⚠️ 让用户决策
- **不做批量 promote**：逐项 review 是强制约束
- **不读 § 9 以外的 DESIGN 内容**：避免把 change 级冻结决策错误升级到项目级

---

## 五、M-health — 代码库健康巡检

**触发词**：`健康检查 / health / 体检 / 技术债扫描 / 巡检`

**一句话**：周期性代码库体检，产出 6 维生产代码风险 + 6 维测试风险 + 架构图 + 技术债优先级 + 字面冗余扫描。

### 核心流程

```
步骤 1 → 选模式（快速体检 / 完整审计 / 单维深挖）
步骤 2 → 装 brooks-lint 走首选路径（/brooks-sweep 或 /brooks-health）
步骤 2.5 → 冗余巡检（必跑，无论是否装 brooks-lint）
   ├── jscpd（字面重复块，全语言）
   ├── knip / ts-prune（未用导出，TS/JS）
   ├── depcheck（未用依赖）
   └── 语言原生工具（vulture / staticcheck / cargo udeps）
步骤 3 → 未装 brooks-lint 走内置回退（AI 自评 6+6 维 + 架构图）
步骤 4 → 输出健康报告（.specs/health/<date>-HEALTH.md）
步骤 5 → 反哺到 flow-kit 工件
   ├── 🔴 Critical → 自动开新 CHANGE（health-fix）
   ├── 🟡 Scheduled → 追加到 CONTEXT「技术债」段
   └── 🟢 Monitored → 追加到 LESSONS
```

### 关键设计

- 步骤 2.5 冗余巡检是独立维度：与 brooks-lint 的 R3（概念级知识重复）互补——brooks-lint 管"同个决策多处表达"，jscpd/knip 管"字面重复代码块 + 死代码"
- **未用依赖特殊处理**：写入 CONTEXT「禁动清单」段，避免 AI 再次为已移除的库写代码
- **基线对比**：第二次跑起必须与上次报告对比
- **不开多个 fix CHANGE**：所有 Critical 合并成一个 `health-fix` change

---

## 六、L-restyle — 一键换调性

**触发词**：`换调性 / 改风格 / 换风格 / redesign / restyle / 重做视觉 / 换皮`

**一句话**：保留功能不变，只换视觉。从识别现有调性 → 选新调性 → 生成 UI-DESIGN v2 → 拆 restyle 任务 → 风险通告。

### 核心流程

| 步骤 | 内容 |
|------|------|
| 步骤 1 | 自动生成 change-id（`restyle-<old>-to-<new>`） |
| 步骤 2 | 识别现有调性 v1（优先读 UI-DESIGN.md，降级从代码反向提取） |
| 步骤 3 | 调性切换确认（展示新旧对比 + 切换代价） |
| 步骤 4 | 影响面扫描（"动/不动"清单：token 全换、组件接口绝不动） |
| 步骤 5 | 写新 UI-DESIGN.md（标 v2，含 v1→v2 视觉对照表） |
| 步骤 6 | 拆 restyle 任务（3 波次：token → 组件 → 回归基线） |
| 步骤 7 | 显式风险通告（用户感知变化 / 测试影响 / 性能 / 无障碍） |

### 关键设计

- **"动/不动"清单强制执行**：design tokens 全换、组件接口绝不动、业务逻辑绝不动
- **测试基线重置**：visual regression snapshot 必须逐个组件 review，不允许批量 `--updateSnapshot`
- **风险通告不可跳过**：必须输出 4 项风险（用户感知 / 测试 / 性能 / 无障碍）并经用户确认
- **不允许混搭调性**：要么全切到 v2，不允许 50% 编辑式 + 50% 工业

---

## 七、横向命令之间的协作关系

```
                      ┌─────────────────┐
                      │  I-intel-scan    │  ← 首次入场
                      │  (一次性的)      │
                      └────────┬────────┘
                               │ 产出 CONTEXT.md
                               ▼
┌──────────────────────────────────────────────────┐
│              A-architect                          │  ← 建立架构基线
│  (首次建立 / 重大重构 / ADR 重审)                  │
│  产出/重构 ARCHITECTURE.md                       │
└────────────────────┬─────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────┐
│          A-evolve (周期性同步)                     │  ← 增量同步
│  扫归档 change 的 DESIGN § 9 → patch CONTEXT     │
│  检测到 ADR 冲突 ≥ 5 → 建议跑 A-architect         │
└────────────────────┬─────────────────────────────┘
                     │
          ┌───────────┴───────────┐
          ▼                       ▼
┌─────────────────┐   ┌──────────────────────┐
│   M-health      │   │    L-restyle          │
│  (周期性巡检)    │   │   (按需一键换皮)       │
│  🔴 → 开 CHANGE │   │   产 ui-design v2     │
│  🟡 → CONTEXT   │   │   拆 restyle 任务      │
│  🟢 → LESSONS   │   │   走 4-dev 执行        │
└─────────────────┘   └──────────────────────┘
```

> M-health 与 A-evolve 的联动：M-health 步骤 5 检测到未用导出在 CONTEXT「既有抽象索引」中仍列着 → 在 `last_evolve_at` 之后的 A-evolve 扫描中主动提醒用户清理。

---

## 八、与 SFlow 的对比总结

| 横向能力 | flow-kit 有 | SFlow 有 |
|----------|-------------|----------|
| 老项目入场扫描 | I-intel-scan（250 行 prompt，完整 grep 探针） | ❌ 无 |
| 项目级架构文档 | A-architect（259 行，7 步骤 + ADR 7 字段） | ❌ 无 |
| 架构增量同步 | A-evolve（342 行，逐项 review + 冲突检测） | ❌ 无 |
| 代码库健康巡检 | M-health（230 行，6+6 维 + 冗余扫描） | ❌ 无 |
| 一键换视觉调性 | L-restyle（192 行，保留功能只换视觉） | ❌ 无 |