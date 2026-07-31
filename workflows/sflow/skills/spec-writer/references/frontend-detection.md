# Frontend Project Detection

Before generating artifacts, detect if this change involves frontend/UI work.

## Step 0: Check Frontend Flag

Read `isFrontend` from `.flow-engine/sflow/state.json`. If `true`, this change will require:
1. All standard artifacts (proposal, specs, design, tasks)
2. **Plus**: `ui-design.md` — UI aesthetics direction + design tokens

## Step 0.1: Detection Methods (if isFrontend not set)

If `isFrontend` is not yet set in state.json, detect from:

1. **Description keywords**: website, web, 网页, page, app, UI, 界面, dashboard, component, react, vue, etc.
2. **Package.json**: Check for frontend dependencies (react, vue, angular, svelte, next, nuxt)
3. **Directory structure**: Check for `src/components/`, `src/pages/`, `.css` files

If detected as frontend, update `.flow-engine/sflow/state.json` to set `isFrontend: true`.

## Step 0.2: Frontend-Specific Workflow Path

For frontend projects, the artifact generation order becomes:
```
proposal.md → specs/ → ui-design.md → design.md → tasks.md
```

### Design Order Rationale (vs flow-kit)

flow-kit 原始顺序：`REQUIREMENT → DESIGN → UI-DESIGN → TASK`（架构先于视觉）

sflow 当前顺序为 `specs → ui-design → design → tasks`（视觉先于架构）。

**差异理由**：UI aesthetics 决策（color system, typography, spacing）往往决定了 component tree 的形状和 data flow 的设计。对于设计驱动的项目（landing page、consumer app），视觉调性是北极星，架构服务于视觉。对于工程驱动的项目（admin panel、dashboard），可以考虑跳过 ui-design 阶段或手动调整顺序。

**如果需要 flow-kit 原始顺序**：在 `.flow-engine/sflow/config.json` 中设置 `"artifacts.order": ["proposal", "specs", "design", "ui-design", "tasks"]`。

### P23: ui-design ↔ design 冲突回退协议

由于 sflow 的 ui-design 在 design 之前生成，可能出现以下冲突：
- design.md 阶段发现 ui-design.md 中的某个 token（如 `primary` 色）不支持所需的架构模式（如嵌套主题）
- design.md 阶段需要的数据流模式在 ui-design.md 中没有对应的视觉组件

**处理流程**：
1. 在 design.md 中记录冲突：`UI-Design Conflict: token <X> does not support required architecture pattern <Y>`
2. **回退修改 ui-design.md**：更新设计 token 或组件架构以适应架构需求
3. 修改后再次验证 design.md 引用的一致性
4. 如果冲突无法解决（如整体风格方向不适配），在 `.flow-engine/sflow/config.json` 中设置 `"artifacts.order": ["proposal", "specs", "design", "ui-design", "tasks"]` 切换到 flow-kit 顺序

**禁止**：生成不一致的 design.md（设计中引用不存在的 token）。冲突必须解决后再继续生成 tasks.md。

The `ui-design.md` is generated BEFORE `design.md` because UI aesthetics decisions (color system, typography, spacing) inform architecture decisions (component tree, data flow).
