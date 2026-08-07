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

## Artifact Root Resolution (MANDATORY)

Before reading any `.flow-engine/sflow/` artifact:

1. Parse the prompt for `<Change_Dir>绝对路径</Change_Dir>`.
2. If found, use that path as the artifact root.
3. Resolve all relative paths (e.g., `.flow-engine/sflow/state.json`) against this root.
4. If not found, fall back to cwd-relative resolution (legacy behavior).

## Required Inputs

Before generating or revising artifacts, read:

- `.flow-engine/sflow/state.json` — especially `dp_0_decisions`, `dp_0_confirmed`, and `isFrontend`
- Any existing planning artifacts in the change folder

If `dp_0_confirmed` is not `true` for a new/incomplete change, stop and route back to `workflow-start` to complete DP-0.

## Frontend Project Detection

See [references/frontend-detection.md](references/frontend-detection.md) for detection methods and frontend-specific workflow path.

**Quick check**: Read `isFrontend` from `.flow-engine/sflow/state.json`. If `true`, generate `ui-design.md` between `specs/` and `design.md`.

## Required Artifacts

Create or refine (all under `.flow-engine/sflow/`):

- `.flow-engine/sflow/proposal.md` — Always
- `.flow-engine/sflow/specs/` — Always
- `.flow-engine/sflow/ui-design.md` — Only for frontend projects (between specs and design)
- `.flow-engine/sflow/design.md` — Always
- `.flow-engine/sflow/tasks.md` — Always

### Config Check

Before generating artifacts, check the project configuration in `.flow-engine/sflow/config.json` (if it exists):
- Generate artifacts in the configured order (default: proposal → specs → [ui-design] → design → tasks)
- Skip any artifacts listed in the `artifacts.skip` configuration

Use OpenSpec-style artifact roles (all under `.flow-engine/sflow/`):

- `.flow-engine/sflow/proposal.md` defines why and scope
- `.flow-engine/sflow/specs/` define required behavior
- `.flow-engine/sflow/ui-design.md` defines UI aesthetics direction, design tokens, and anti-pattern checklist
- `.flow-engine/sflow/design.md` defines how and why at the architecture level
- `.flow-engine/sflow/tasks.md` defines dependency-aware implementation steps

## Working Rules

### Honor DP-0 Decisions

- Read `dp_0_decisions` from `.flow-engine/sflow/state.json` before writing.
- Respect confirmed constraints (e.g., naming style, scope inclusions, communication preference).
- Do not silently expand scope beyond what was confirmed in DP-0.
- If you encounter an unconfirmed decision, pause artifact generation and ask the user.

### Artifact Structure

See [references/artifact-templates.md](references/artifact-templates.md) for detailed structure requirements for each artifact type.

**Quick reference** (all under `.flow-engine/sflow/`):
- `.flow-engine/sflow/proposal.md` — Problem, changes, capabilities, impact, scope
- `.flow-engine/sflow/specs/` — Testable requirements with SHALL/MUST and scenarios
- `.flow-engine/sflow/ui-design.md` — Visual direction, design tokens, component architecture, anti-AI-slop checklist
- `.flow-engine/sflow/design.md` — Context, goals, decisions, trade-offs
- `.flow-engine/sflow/tasks.md` — File structure, interfaces, numbered tasks with TDD phases

## Quality Bar

The artifact set must be internally aligned (all under `.flow-engine/sflow/`):

- `.flow-engine/sflow/proposal.md` sets scope
- `.flow-engine/sflow/specs/` define observable behavior
- `.flow-engine/sflow/ui-design.md` (frontend) defines visual decisions and tokens
- `.flow-engine/sflow/design.md` explains the chosen technical shape
- `.flow-engine/sflow/tasks.md` converts that shape into execution order

If any artifact cannot support the others, revise before handoff.

## Schema Validation & Quality Gates

See [references/artifact-quality-gates.md](references/artifact-quality-gates.md) for complete validation checklists.

**Key principle**: Do not hand off broken artifacts. Run validation on all artifacts before proceeding to DP-2.

## DP-2: Artifact Review Gate (Blind Reader)

See [references/dp-2-review.md](references/dp-2-review.md) for the blind reader review process.

**Quick summary**: Present artifact summaries to the user (domain expert) for review. Do not hand off until DP-2 is recorded in `.flow-engine/sflow/state.json`.

## UI Design Generation (Frontend Projects)

See [references/ui-design-generation.md](references/ui-design-generation.md) for the UI design generation process.

**Quick check**: If frontend project and ui-design.md doesn't exist, generate it automatically after specs/ are complete.

## Handoff Rule

Do not start implementation after writing planning artifacts.

Once the artifacts are stable, validated, and DP-2 is recorded, hand off to `contract-builder`.

**For frontend projects**: After ui-design.md is approved, set `.flow-engine/sflow/state.json` state to `ui-design` if specs are done but design/tasks are not yet started. This will cause the Artifact Preflight Gate to route through the ui-design state properly.

## Task Completion Rule

任务完成后，请在输出末尾使用 [TASK_COMPLETE] 标记结束会话。

## Output Standard

When handing off, report:

1. which artifacts were created or modified
2. validation results (pass/fail for each artifact)
3. whether this is a frontend project (ui-design.md generated)
4. a one-sentence summary of what the change does

## Standard Handoff Format

This skill uses the standard handoff format for all user-facing phase reports. The handoff follows a four-section structure:

- **Current stage**: Where we are now in the workflow
- **Completed / blocker**: What's been completed or what's blocking progress
- **Next stage**: Where we're going next
- **Entry condition**: What must be true to proceed

### Handoff Scenarios

The `formatStandardHandoff` function in `packages/plugin-infra/src/features/handoffs.ts` supports five scenarios:

1. **normal** - Normal workflow progression
2. **blocked** - Blocked by missing evidence or failure
3. **approval-wait** - Waiting for user approval (DP gates)
4. **closing-in-progress** - Release verification or archive in progress
5. **terminal** - Successfully reached closing or abandoned

### Usage Example

```typescript
import { formatStandardHandoff } from '../features/handoffs';

const handoff = formatStandardHandoff('normal', {
  currentStage: 'specifying',
  completedWork: 'Generated proposal.md, spec.md, design.md, tasks.md',
  nextStage: 'bridging',
  entryCondition: 'All artifacts validated and DP-2 review passed',
});

console.log(handoff);
```

### Output Format

```
[Handoff: normal]

- Current stage: `specifying`.
- Completed / blocker: `Generated proposal.md, spec.md, design.md, tasks.md`.
- Next stage: `bridging`.
- Entry condition: `All artifacts validated and DP-2 review passed`.
```

For blocked, approval-wait, and closing-in-progress scenarios, the format adapts to clearly communicate the blocking condition or approval requirement.
