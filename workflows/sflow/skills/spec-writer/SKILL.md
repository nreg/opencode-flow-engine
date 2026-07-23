---
name: spec-writer
description: Create or refine sflow planning artifacts. Invoke when the change is understood well enough to write proposal.md, specs/, design.md, and tasks.md. For frontend projects, also generates ui-design.md.
---

# Spec Writer

Use this skill when the change has moved beyond exploration and is ready to become concrete artifacts.

## Use This Skill When

Invoke this skill when the user says things like:

- "write the proposal"
- "turn this into specs"
- "create the design doc"
- "break the work into tasks"
- "formalize the plan"
- "设计UI" or "UI design" (for frontend projects — generates ui-design.md)

## Required Inputs

Before generating or revising artifacts, read:

- `.flow-engine/sflow/state.json` — especially `dp_0_decisions`, `dp_0_confirmed`, and `isFrontend`
- Any existing planning artifacts in the change folder

If `dp_0_confirmed` is not `true` for a new/incomplete change, stop and route back to `workflow-start` to complete DP-0.

## Frontend Project Detection (Enhanced)

Before generating artifacts, detect if this change involves frontend/UI work:

### Step 0: Check Frontend Flag

Read `isFrontend` from `.flow-engine/sflow/state.json`. If `true`, this change will require:
1. All standard artifacts (proposal, specs, design, tasks)
2. **Plus**: `ui-design.md` — UI aesthetics direction + design tokens

### Step 0.1: Detection Methods (if isFrontend not set)

If `isFrontend` is not yet set in state.json, detect from:

1. **Description keywords**: website, web, 网页, page, app, UI, 界面, dashboard, component, react, vue, etc.
2. **Package.json**: Check for frontend dependencies (react, vue, angular, svelte, next, nuxt)
3. **Directory structure**: Check for `src/components/`, `src/pages/`, `.css` files

If detected as frontend, update `.flow-engine/sflow/state.json` to set `isFrontend: true`.

### Step 0.2: Frontend-Specific Workflow Path

For frontend projects, the artifact generation order becomes:
```
proposal.md → specs/ → ui-design.md → design.md → tasks.md
```

> **⚠️ 设计差异说明（vs flow-kit）**：
>
> flow-kit 原始顺序：`REQUIREMENT → DESIGN → UI-DESIGN → TASK`（架构先于视觉）
>
> sflow 当前顺序为 `specs → ui-design → design → tasks`（视觉先于架构）。
>
> **差异理由**：UI aesthetics 决策（color system, typography, spacing）往往决定了 component tree 的形状和 data flow 的设计。对于设计驱动的项目（landing page、consumer app），视觉调性是北极星，架构服务于视觉。对于工程驱动的项目（admin panel、dashboard），可以考虑跳过 ui-design 阶段或手动调整顺序。
>
> **如果需要 flow-kit 原始顺序**：在 `.flow-engine/sflow/config.json` 中设置 `"artifacts.order": ["proposal", "specs", "design", "ui-design", "tasks"]`。
>
> **P23: ui-design ↔ design 冲突回退协议**
>
> 由于 sflow 的 ui-design 在 design 之前生成，可能出现以下冲突：
> - design.md 阶段发现 ui-design.md 中的某个 token（如 `primary` 色）不支持所需的架构模式（如嵌套主题）
> - design.md 阶段需要的数据流模式在 ui-design.md 中没有对应的视觉组件
>
> **处理流程**：
> 1. 在 design.md 中记录冲突：`UI-Design Conflict: token <X> does not support required architecture pattern <Y>`
> 2. **回退修改 ui-design.md**：更新设计 token 或组件架构以适应架构需求
> 3. 修改后再次验证 design.md 引用的一致性
> 4. 如果冲突无法解决（如整体风格方向不适配），在 `.flow-engine/sflow/config.json` 中设置 `"artifacts.order": ["proposal", "specs", "design", "ui-design", "tasks"]` 切换到 flow-kit 顺序
>
> **禁止**：生成不一致的 design.md（设计中引用不存在的 token）。冲突必须解决后再继续生成 tasks.md。

The `ui-design.md` is generated BEFORE `design.md` because UI aesthetics decisions
(color system, typography, spacing) inform architecture decisions (component tree, data flow).

## Required Artifacts

Create or refine:

- `proposal.md` — Always
- `specs/` — Always
- `ui-design.md` — Only for frontend projects (between specs and design)
- `design.md` — Always
- `tasks.md` — Always

### Config Check

Before generating artifacts, check the project configuration in `.flow-engine/sflow/config.json` (if it exists):
- Generate artifacts in the configured order (default: proposal → specs → [ui-design] → design → tasks)
- Skip any artifacts listed in the `artifacts.skip` configuration

Use OpenSpec-style artifact roles:

- `proposal.md` defines why and scope
- `specs/` define required behavior
- `ui-design.md` defines UI aesthetics direction, design tokens, and anti-pattern checklist
- `design.md` defines how and why at the architecture level
- `tasks.md` defines dependency-aware implementation steps

## Working Rules

### Honor DP-0 Decisions

- Read `dp_0_decisions` from `.flow-engine/sflow/state.json` before writing.
- Respect confirmed constraints (e.g., naming style, scope inclusions, communication preference).
- Do not silently expand scope beyond what was confirmed in DP-0.
- If you encounter an unconfirmed decision, pause artifact generation and ask the user.

### `proposal.md`

Must clearly state:

- the problem
- what changes
- capabilities affected
- impact areas
- **must declare if this is a frontend project** (for routing to ui-design phase)

### `specs/`

Must be testable.

Every requirement should be written so that a later test can prove it.

### `ui-design.md` (Frontend Projects Only)

Generated between `specs/` and `design.md`. Must include:

```markdown
# UI Design — <change-title>

## Visual Direction
- **Style**: <e.g., minimal / glassmorphism / brutalist / clean professional>
- **Reference products**: <1-3 real products for inspiration>
- **Key emotion**: <what users should feel>

## Design Tokens
### Color System (OKLCH format preferred)
- Primary: <value>
- Secondary: <value>
- Background: <value>
- Text: <value>
- Accent/Success/Error/Warning: <values>

### Typography
- Headings: <font-family, weights>
- Body: <font-family, weights>
- Scale: <clamp() or step values>

### Spacing
- Base unit: <e.g., 4px / 8px>
- Scale: <values>

### Border Radius / Shadows
- Values for different component levels

## Component Architecture (UI Tree)
- List key visual components and their hierarchy
- Reference existing design system components to reuse

## Anti-AI-Slop Checklist
- [ ] No hardcoded colors — all from CSS variables
- [ ] No hardcoded font sizes — all from type scale tokens
- [ ] Border-left decorations are NOT used
- [ ] Hash tags (#) are NOT used for labels/tags
- [ ] Loading states don't flash empty elements
- [ ] All interactive states defined (hover, focus, active, disabled, loading)
```

### `design.md`

Must explain architectural decisions and trade-offs, not line-by-line implementation.

For frontend projects, design.md must reference `ui-design.md` tokens and component decisions.

### `tasks.md`

Must be ordered, verifiable, and small enough to become execution batches later.

**File Structure section**: Every tasks.md MUST begin with a `## File Structure` section listing all files to be created or modified, with each file's responsibility stated in one sentence. Format:
- `Create: path/to/file.ts` — One-sentence responsibility
- `Modify: path/to/existing.ts` — What changes

**Interfaces section**: Every tasks.md MUST include a `## Interfaces` section declaring cross-batch dependencies. Format:
```
### Batch N → Batch M
- **Produces**: `type/function name` — consumed by Batch M for purpose
```

**Per-task format**: Each task MUST include:
1. **Exact file paths**: `Create: path/to/file.ts` or `Modify: path/to/file.ts:line-range` for every file the task touches
2. **TDD phases expanded** (for code-producing tasks):
   - Write the failing test with exact test code
   - Run the test and confirm it fails for the expected reason
   - Implement the minimal code with exact implementation
   - Run the test and confirm it passes
   - Commit with descriptive message
3. **Interfaces block**: If the task produces output consumed by later tasks, declare `Consumes` (inputs from earlier tasks) and `Produces` (outputs for later tasks) with exact function names, parameter types, and return types
4. **Dependency declaration**: Each batch header states `Depends on: Batch N` if it consumes output from an earlier batch

**Granularity requirement**: Each task step MUST be completable in 2-5 minutes of focused work. This means:
- A task step is one atomic operation: write one function, add one test case, update one config value
- A task step is NOT "implement the authentication module" — that's a batch of steps
- If a step takes longer than 5 minutes to describe, it should be decomposed further

**Zero placeholder rule**: Tasks MUST NOT contain "TBD", "TODO", "implement later", "figure out", "add appropriate", "we'll decide", or similar placeholder language. Every task must be concrete and immediately actionable. If there is uncertainty, resolve it during specification — do not push it to implementation.

**Task Dependency Ordering**: Tasks must be ordered so that:
- Each task depends only on tasks listed before it
- No task references work that hasn't been described yet
- The dependency chain is explicit: "Depends on: Batch N"
- Every batch ends with a commit step

## Quality Bar

The artifact set must be internally aligned:

- `proposal.md` sets scope
- `specs/` define observable behavior
- `ui-design.md` (frontend) defines visual decisions and tokens
- `design.md` explains the chosen technical shape
- `tasks.md` converts that shape into execution order

If any artifact cannot support the others, revise before handoff.

## Schema Validation

After creating or modifying any artifact, run these validation checks. Do not hand off broken artifacts.

### `proposal.md` Validation

- [ ] Has `## Why` section with > 50 characters of problem description
- [ ] Has `## What Changes` section listing concrete changes
- [ ] Has `## Scope` with `### In Scope` and `### Out of Scope` sub-sections
- [ ] Has `## Impact` section listing affected code areas, APIs, and dependencies
- [ ] Has `## Capabilities` section (New Capabilities and Modified Capabilities)
- [ ] No TBD/TODO/placeholder language in any section
- [ ] **Frontend**: declares frontend scope in capabilities

### `specs/` Validation

- [ ] Every requirement uses SHALL or MUST (no "should", "may" for required behavior)
- [ ] Every requirement has at least one `#### Scenario:` with WHEN/THEN clauses
- [ ] Requirements are grouped under ADDED, MODIFIED, or REMOVED headers
- [ ] Each scenario is independently testable
- [ ] No requirement contradicts another requirement

### `ui-design.md` Validation (Frontend Only)

- [ ] Color system defined (primary, background, text minimum)
- [ ] Typography defined (headings + body minimum)
- [ ] Spacing scale defined
- [ ] Anti-AI-slop checklist completed
- [ ] No hardcoded color/typography values in planned components
- [ ] Design tokens referenceable by CSS variables

### `design.md` Validation

- [ ] Has `## Context` section describing current state, constraints, stakeholders
- [ ] Has `## Goals` section stating what the design must achieve
- [ ] Has `## Decisions` section with at least one decision (Choice + Rationale + Alternatives)
- [ ] Has `## Risks And Trade-Offs` section
- [ ] Architectural decisions are justified with trade-off analysis
- [ ] **Frontend**: references ui-design.md tokens and component architecture

### `tasks.md` Validation

- [ ] Has `## File Structure` section listing all files with responsibilities
- [ ] Has `## Interfaces` section with Consumes/Produces between batches
- [ ] Tasks are numbered (1.1, 1.2, 2.1, etc.)
- [ ] Each task has exact file paths (Create/Modify with line ranges)
- [ ] Each code-producing task has expanded TDD phases (5 steps)
- [ ] Each task step is ≤ 5 minutes of focused work
- [ ] No TBD, TODO, or placeholder language in any task
- [ ] Every requirement from specs/ maps to at least one task
- [ ] Dependencies are explicit (Depends on: Batch N)
- [ ] Every batch ends with a commit step

## Quality Gate

**If any artifact fails validation, fix it before handing off to `contract-builder`.**

Do not hand off broken artifacts. The validation checks above are not advisory — they are the minimum bar for the next stage to function. If you skip validation, the contract-builder will produce a contract with holes, and execution will drift.

## Self-Review Checklist

Before handing off:

- [ ] Remove all placeholders — no "TBD", "TODO", "we'll figure it out"
- [ ] Resolve all contradictions — no requirement conflicts with another
- [ ] Ensure tasks align with specs — every requirement has a corresponding task
- [ ] Ensure design supports the required behavior — constraints don't block requirements
- [ ] Run schema validation on all four artifacts — all checks pass
- [ ] Verify task granularity — each task is 2-5 min, atomic, and concretely actionable
- [ ] Verify File Structure — every file referenced in any task appears in the File Structure section
- [ ] Verify Interfaces — every cross-batch dependency is declared in the Interfaces section
- [ ] Verify zero placeholders — grep for TBD, TODO, "implement later", "figure out", "add appropriate"
- [ ] **Frontend**: Verify ui-design.md exists and is referenced by design.md

## DP-2: Artifact Review Gate

Before handing off to `contract-builder`, present a summary of all artifacts to the user for review. Do not assume the artifacts are correct just because validation passed — the user is the domain expert.

1. **Summarize each artifact** in 2-3 sentences:
   - `proposal.md`: what problem, what changes, scope boundaries
   - `specs/`: key requirements and scenarios
   - `ui-design.md` (frontend): visual direction, design tokens
   - `design.md`: architecture decisions and trade-offs
   - `tasks.md`: batch breakdown and dependency chain

2. **Ask the user** if anything needs adjustment before the contract is generated.

3. **Record DP-2** after user approval in `.flow-engine/sflow/state.json`:

```json
{
  "dp_2_result": "approved: <one-line summary>",
  "dp_2_timestamp": "<ISO-8601 timestamp>"
}
```

If the user requests changes, make them and re-present. Do not hand off until DP-2 is recorded.

## UI Design Generation (Frontend Projects)

When the project is detected as frontend and ui-design.md does not exist, generate it automatically after design.md and tasks.md are complete.

### Prerequisites Check

Before generating ui-design.md, verify:
1. proposal.md exists with UI-related requirements
2. specs/ has at least one spec file describing UI behavior
3. design.md has architecture decisions (component structure, layout approach)
4. tasks.md references UI components in task descriptions

### Generation Process

1. Read existing artifacts and extract UI-relevant information:
   - From specs/: UI requirements, user flows, interaction scenarios
   - From design.md: component hierarchy, layout strategy, state management
   - From tasks.md: component implementation tasks

2. Generate ui-design.md with the following structure:

   ```markdown
   # UI Design: [Change Name]

   ## Design System
   - Color palette
   - Typography (headings, body, code)
   - Spacing system
   - Component variants and states

   ## Component Hierarchy
   [Component tree based on specs and design.md]

   ## Interaction Patterns
   [User flows and UX interactions]

   ## Responsive Breakpoints
   [If applicable]

   ## Accessibility Guidelines
   [WCAG compliance requirements]

   ## Implementation Notes
   [Specific implementation guidance for developers]
   ```

3. Validate the generated ui-design.md:
   - Check it references all UI-related specs
   - Check it aligns with architecture decisions in design.md
   - Check it is referenced by tasks in tasks.md

4. Record DP-2-ui after user approval

5. Transition to bridging: After ui-design.md is approved, run the state transition:
   - Update .flow-engine/sflow/state.json: set state to ui-design
   - The Artifact Preflight Gate will verify all prerequisites
   - Route to contract-builder for execution contract generation

### What If UI Design Is Not Needed

If the frontend change has no UI impact (e.g., API integration, utility function, config change):
- Set .flow-engine/sflow/state.json state explicitly to skip ui-design
- Route directly to bridging
- The Artifact Preflight Gate will respect this override

---

## Handoff Rule

Do not start implementation after writing planning artifacts.

Once the artifacts are stable, validated, and DP-2 is recorded, hand off to `contract-builder`.

**For frontend projects**: After ui-design.md is approved, set `.flow-engine/sflow/state.json` state to `ui-design` if specs are done but design/tasks are not yet started. This will cause the Artifact Preflight Gate to route through the ui-design state properly.

## Output Standard

When handing off, report:

1. which artifacts were created or modified
2. validation results (pass/fail for each artifact)
3. whether this is a frontend project (ui-design.md generated)
4. a one-sentence summary of what the change does
