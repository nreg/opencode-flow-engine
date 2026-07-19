# Opencode-Flow-Engine — OpenCode Workflow Orchestration Plugin

[**简体中文**](./README.zh.md) | **English**

OpenSpec planning engine + Superpowers execution discipline + GSD iterative cycle, integrated as an OpenCode Plugin.

opencode-flow-engine provides two complementary workflow modes:

- **sFlow** — Linear workflow: requirements → planning → implementation → review → debugging → archival
- **iFlow** — Iterative workflow: GSD cycle: discuss → research → plan → execute → verify → ship → repeat

---

## Table of Contents

- [Quick Start](#quick-start)
- [Workflow Selection](#workflow-selection)
- [sFlow Workflow](#sflow-workflow)
- [iFlow Workflow](#iflow-workflow)
- [Agents](#agents)
- [Frontend UI Design System](#frontend-ui-design-system)
- [Tools](#tools)
- [Execution Modes](#execution-modes)
- [Execution Discipline](#execution-discipline)
- [Features](#features)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Acknowledgments](#acknowledgments)

---

## Quick Start

```bash
npm install -g opencode-flow-engine
```

Add to `opencode.json`:

```json
{
  "plugin": ["opencode-flow-engine"]
}
```

Then start a conversation:

```
"start a workflow"    → sFlow (linear, documentation-first)
"start an iteration"  → iFlow (cyclic, rapid iteration)
```

---

## Workflow Selection

| Workflow | Use Case | Shape | Agent Color |
|----------|----------|-------|-------------|
| **sFlow** | Complex features, strict gates, documentation-first | Linear (9 states) | `#f8cd93` |
| **iFlow** | Quick iterations, research-driven, continuous delivery | Cyclic (6 states) | `#FFB6C1` |

**Guidance**: Complex features (3+ files, cross-module, DB schema) → sFlow. Quick fixes, small features → iFlow. Uncertain → start with sFlow.

---

## sFlow Workflow

9 states executed sequentially:

| # | State | Subagent | Artifact | Gate |
|---|-------|----------|----------|------|
| 1 | **exploring** | need-explorer | Clarified requirements | User confirmation |
| 2 | **specifying** | spec-writer | proposal.md, specs/, design.md, tasks.md | Artifact validation |
| 3 | **ui-design**\* | ui-director | ui-design.md | UI tokens validated |
| 4 | **bridging** | contract-builder | execution-contract.md | Contract validated |
| 5 | **approved-for-build** | — | Approved contract | User approval |
| 6 | **executing** | build-executor | Implemented code | Tests pass, review passed |
| 7 | **debugging** | bug-investigator | Bug report, fix | Issue resolved |
| 8 | **closing** | release-archivist | Verification report | All checks passed |
| 9 | **abandoned** | — | — | Terminal state |

> \* The ui-design state is automatically inserted for frontend projects. It uses the **ui-director** subagent (not spec-writer) to guide a 7-step aesthetic decision process, with 71 brand design references and 9 merged frontend skills.

### Automatic State Repair

On context restoration, sFlow detects artifact/state mismatches and auto-repairs:

| State says | Artifacts show | Auto-repair |
|------------|---------------|-------------|
| `exploring` | proposal.md exists | → `specifying` |
| `specifying` | design.md + tasks.md exist | → `bridging` |
| `bridging` | execution-contract.md approved | → `approved-for-build` |
| `executing` | All tasks checked | → `closing` |

---

## iFlow Workflow

6 states in a continuous cycle:

| # | State | Subagent | Artifact | Gate |
|---|-------|----------|----------|------|
| 1 | **discussing** | iflow-discuss-planner | Clarified requirements, user decisions | User confirmation |
| 2 | **researching** | iflow-researcher | CONTEXT.md (goals, constraints, findings) | Research complete |
| 3 | **planning** | iflow-discuss-planner | PLAN.md (XML tasks, wave dependencies) | Plan validated |
| 4 | **executing** | iflow-plan-executor | Implemented code | Tests pass, deviations handled |
| 5 | **verifying** | iflow-verifier | VERIFICATION.md (BLOCKER/WARNING) | All checks pass |
| 6 | **shipping** | iflow-shipper | UAT.md, PR/branch | Shipped, return to discuss |

### Key Differences from sFlow

| Dimension | sFlow | iFlow |
|-----------|-------|-------|
| Flow shape | Linear (terminates at closed/abandoned) | Cyclic (returns to discuss) |
| Artifacts | proposal, specs, design, tasks, contract | CONTEXT, PLAN, SUMMARY, VERIFICATION, UAT |
| State dir | `.sflow/` | `.iflow/` |
| Methodology | OpenSpec + Superpowers | GSD (Get Stuff Done) |
| Verification | Contract-based validation | Adversarial verification |
| Scope reduction | Guard hook enforced | Agent prompt declaration |

---

## Agents

### sFlow Agents (11)

| Agent | Mode | Description |
|-------|------|-------------|
| **sFlow** | Primary orchestrator | State detection → subagent routing, never writes code |
| **need-explorer** | Subagent | Requirements clarification via structured questioning |
| **spec-writer** | Subagent | Generates proposal, specs, design, tasks |
| **ui-director** | Subagent | **Frontend projects**: 7-step aesthetic decision process, 71 brand references, produces ui-design.md |
| **contract-builder** | Subagent | Creates execution contract with boundary control, test plan |
| **build-executor** | Subagent | TDD/SDD executor: 3 execution modes (inline, batch-inline, SDD) |
| **bug-investigator** | Subagent | Systematic debugging, root cause analysis, fix verification |
| **code-reviewer** | Subagent | Spec compliance + code quality review. Enforces **Minimality Discipline** (5 gates) |
| **release-archivist** | Subagent | Verify, archive, close changes |
| **spec-merger** | Subagent | Incremental spec change merging |
| **ui-implementer** | Subagent | Frontend UI implementation specialist |

### iFlow Agents (6)

| Agent | Mode | Description |
|-------|------|-------------|
| **iFlow** | Primary orchestrator | Cyclic workflow controller, 6-state orchestration |
| **iflow-discuss-planner** | Subagent | Discuss + plan: requirements clarification, PLAN.md generation |
| **iflow-plan-executor** | Subagent | Executor with 4 deviation rules. Can delegate frontend tasks to `ui-implementer` |
| **iflow-verifier** | Subagent | Adversarial verification: goal-backward, BLOCKER/WARNING classification |
| **iflow-researcher** | Subagent | Technical research: discovery levels, tool priority chain, confidence markers |
| **iflow-shipper** | Subagent | PR creation, UAT.md generation, branch lifecycle management |

### Routing Principles

- **NEVER** implement code yourself — always delegate to subagents
- **NEVER** skip states — must pass through pipeline in order
- **NEVER** approve your own contract — user must approve
- **NEVER** close without verification — release-archivist must verify first

---

## Frontend UI Design System

opencode-flow-engine has a comprehensive frontend UI design system built into the sFlow workflow, spanning from aesthetic direction to production code delivery.

### ui-director: Aesthetic Decision Engine

For frontend projects, the `ui-director` subagent is automatically inserted between `specifying` and `bridging`. It guides a **7-step aesthetic decision process**:

```
Step 1: Tone Confirmation    → Pick from 71 brand references or 9 abstract tone cards
Step 2: 4-Question Framework → Purpose, Tone, Constraints, Differentiation
Step 3: Brownfield Alignment → Extract existing visual vocabulary (7 dimensions)
Step 4: 5-Dimension Matrix   → Typography, Color (OKLCH), Motion, Space, Texture
Step 5: v0 Draft Review      → User confirms before full document
Step 6: Write ui-design.md   → Structured output with frontmatter tokens
Step 7: Anti-AI-Slop Check   → 8 categories, 42 rules
```

**71 Brand Design References**: Built-in library of design systems from Apple, Stripe, Linear, Notion, Claude, Ferrari, and 65+ other brands. Each includes complete color palettes, typography scales, and interaction patterns. Users select a reference brand to inherit design tokens, then fine-tune in Step 4.

### ui-implementer: 9 Merged Frontend Skills

The `ui-implementer` subagent loads 9 frontend specialized skills at runtime, each providing domain-specific rules and patterns:

| Phase | Skills Loaded | Purpose |
|-------|--------------|---------|
| Design Intake | `taste-skill` | Aesthetic direction, anti-slop, design reading |
| Design System | `shadcn-ui` + `ui-ux-pro-max` | Component library theming, 95+ color palettes, 56 font pairings |
| Component Implementation | `frontend-design-pro` + `svg-architect` | Component layout, SVG icon design |
| Quality Pass | `polish` + `frontend-code-review` + `impeccable` + `frontend-performance-optimization` | Spacing/alignment, code review, production standards, Core Web Vitals |

**Delivery Checklist**: 10-item pre-commit verification (console.log cleanup, interactive states, hardcoded colors, responsive adaptation, accessibility, and more).

### UI Design Validation

The `validate_ui_design` tool checks ui-design.md for 7 quality gates:

| Check | Rule | Severity |
|-------|------|----------|
| V1 | Color format (OKLCH required, not plain HEX) | ERROR |
| V2 | Font compliance (no AI-default fonts) | WARNING |
| V3 | Tone declaration (frontmatter must specify tone) | ERROR |
| V4 | Component coverage (≥5 component types) | WARNING |
| V5 | Placeholder strategy section exists | ERROR |
| V6 | Anti-AI-slop coverage (≥6/8 categories) | WARNING |
| V7 | WCAG AA accessibility guidelines | ERROR |

---

## Tools

### Native Tools

| Tool | Description |
|------|-------------|
| `workflow_router` / `iflow_router` | State detection and subagent routing |
| `call_flow_agent` | **Core**: delegates tasks to subagents (sync/async) |
| `flowagent_output` / `flowagent_cancel` | Async task management |
| `contract_validator` / `artifact_inspector` | Artifact validation |
| `record_decision_point` | Decision point recording (DP-0 to DP-5) |
| `record_execution_plan` | Wave-based execution plan creation |
| `record_review_receipt` | Wave review result persistence |
| `validate_ui_design` | UI design quality validation (7 checks) |

### Artifact Validation Toolset

`validate_spec`, `validate_proposal`, `validate_delta_spec`, `validate_tasks`, `validate_contract`, `validate_design`, `validate_implementation`, `detect_sync_conflicts`

### oh-my-openagent Tools (Optional)

When oh-my-openagent is also installed, sFlow auto-enables:

| Tool | Use Case |
|------|----------|
| `call_omo_agent` | Parallel codebase exploration (explore) + documentation research (librarian) |
| `task` | Category-based delegation with model selection and skill injection |

> Without oh-my-openagent, sFlow works fully through `call_flow_agent`. No configuration needed.

---

## Execution Modes

`build-executor` automatically selects one of three modes based on task count and dependency analysis:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Inline** | ≤3 tasks, no cross-module deps | Current agent implements directly (TDD applies) |
| **Batch Inline** | 3-5 tasks, same module, no API changes | Whole batch in one pass, each step TDD |
| **SDD** | 6+ tasks, cross-module, or dependency chains | Per-task subagent + review receipts + final review |

### Preset Upgrade Mechanism

During execution, sFlow continuously monitors scope. If thresholds are exceeded, it auto-upgrades:

| Preset | Downgrade Condition | Upgrade Trigger |
|--------|---------------------|-----------------|
| **hotfix** | ≤2 files, no architecture changes | 3+ files, DB schema → auto-upgrade to `full` |
| **tweak** | ≤4 config files, no code changes | 5+ files, cross-module → auto-upgrade to `full` |
| **full** | — | Standard process |

---

## Execution Discipline

### TDD Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

| Phase | Action | Evidence |
|-------|--------|----------|
| **RED** | Write failing test | Run, confirm failure for expected reason |
| **GREEN** | Write minimal production code | Tests pass (all others still pass) |
| **REFACTOR** | Clean up while tests stay green | Full suite still passes |

### File Boundary Control

Each task declares `read_files` (reference boundary) and `write_files` (modification boundary) in the execution contract. `git diff --name-only` runs before commit to prevent scope creep.

### Failure Lessons Registry

```
.sflow/lessons.md  — Auto-written on debug exit, auto-scanned before each task
```

### Checkpoint & Handoff

```
.sflow/subagent-progress.md   — Node state (implementing/review/done)
.sflow/checkpoints/           — Structured checkpoints with commit evidence
.sflow/handoffs/              — Cross-session handoff contracts
.sflow/progress.md            — Batch completion progress
```

### Execution Control Plane

SDD-mode execution is orchestrated via `.sflow/execution-plan.json`:

- **Wave scheduling**: Tasks grouped into waves with `serial`/`parallel` strategy and `depends_on` dependencies
- **Wave dependency validation**: Guard hooks detect circular dependencies before execution
- **Review receipts**: Persisted to `.sflow/reviews/<wave-id>.json` with commit range evidence
- **Triple hash validation**: content_hash + artifacts_hash + contract_hash integrity check
- **Closing gate**: All wave reviews must pass before entering closing state

---

## Features

### Workflow Management
- 9-state sFlow + 6-state iFlow, automatic state detection and routing
- Guard conditions preventing invalid state transitions
- Automatic state repair (artifact ↔ state inconsistency)
- Frontend/backend project adaptation (auto-inserts ui-design state for frontend)

### Incremental Spec Management
- Tracks ADDED/MODIFIED/REMOVED/RENAMED specs per change
- Auto-detects spec sync conflicts across changes
- spec-merger merges delta specs on close

### Hook System

| Hook | Trigger | Description |
|------|---------|-------------|
| `state_transition` | On state transition | Logs transition |
| `artifact_validation` | After tool execution | Validates artifact completeness |
| `guard` | Before tool execution | Prevents illegal operations |
| `pre_process` | Before message processing | Injects context |
| `post_process` | After tool execution | Detects state transition signals |
| `continuation` | After context compression | Decides auto-continue |

### Model Profiles

4-layer model resolution: `override → config → profile → fallback → default`

| Profile | Purpose | Typical Agents |
|---------|---------|----------------|
| `mechanical` | Fast, cheap | release-archivist |
| `standard` | Balanced | sFlow, need-explorer, ui-implementer |
| `strong` | Powerful | spec-writer, contract-builder, build-executor |
| `review` | Specialized | code-reviewer |

---

## Configuration

### OpenCode Configuration

```json
{
  "plugin": ["opencode-flow-engine"]
}
```

To also use oh-my-openagent:

```json
{
  "plugin": ["oh-my-openagent", "opencode-flow-engine"]
}
```

### Project Configuration

```bash
# Project-level (recommended)
sflow init

# User-level global
sflow init --user
```

### Custom Agent Models

```json
{
  "version": "0.1.0",
  "mode": "full",
  "agents": {
    "sFlow": { "model": "your-provider/glm-5.2", "temperature": 0.6 },
    "iFlow": { "model": "your-provider/deepseek-v4-flash", "temperature": 0.6 },
    "need-explorer": { "model": "your-provider/step-3.7-flash", "temperature": 0.6 },
    "spec-writer": { "model": "your-provider/glm-5.1", "temperature": 0.6 },
    "ui-director": { "model": "your-provider/glm-5.1", "temperature": 0.7 },
    "contract-builder": { "model": "your-provider/glm-5.1", "temperature": 0.6 },
    "build-executor": { "model": "your-provider/glm-5.1", "temperature": 0.7 },
    "bug-investigator": { "model": "your-provider/minimax-m2.7", "temperature": 0.6 },
    "code-reviewer": { "model": "your-provider/glm-5.1", "temperature": 0.6 },
    "release-archivist": { "model": "your-provider/glm-5.1", "temperature": 0.7 },
    "spec-merger": { "model": "your-provider/glm-5.1", "temperature": 0.7 },
    "ui-implementer": { "model": "your-provider/glm-5.1", "temperature": 0.6 },
    "iflow-discuss-planner": { "model": "your-provider/kimi-k2.6", "temperature": 0.6 },
    "iflow-plan-executor": { "model": "your-provider/glm-5.1", "temperature": 0.6 },
    "iflow-verifier": { "model": "your-provider/minimax-m2.7", "temperature": 0.6 },
    "iflow-researcher": { "model": "your-provider/glm-5.1", "temperature": 0.7 },
    "iflow-shipper": { "model": "your-provider/glm-5.1", "temperature": 0.6 }
  },
  "modelProfiles": {
    "mechanical": "your-provider/step-3.7-flash",
    "standard": "your-provider/glm-5.1",
    "strong": "your-provider/glm-5.1",
    "review": "your-provider/glm-5.1"
  }
}
```

Configuration loading priority: project-level `.sflow/config.json` → user-level `~/.config/opencode/opencode-flow-engine.json`

---

## Project Structure

```
opencode-flow-engine/
├── packages/
│   ├── core/                    # Schema, validation, parsing engine
│   ├── plugin-infra/            # Plugin infrastructure
│   │   └── src/
│   │       ├── agents/          # Builders, types, config loading
│   │       ├── hooks/           # 6 lifecycle hook types + guards
│   │       ├── tools/           # Tool definitions and implementations
│   │       ├── features/        # Workflow manager, state manager, MCP
│   │       └── helpers/         # Utility functions
│   └── shared/                  # Shared utilities
├── workflows/
│   ├── sflow/                   # SFlow workflow
│   │   ├── agents/              # 11 agent factories
│   │   ├── skills/              # 22 skill definitions (13 sFlow + 9 frontend UI)
│   │   └── templates/           # Artifact templates (incl. UI-DESIGN.md)
│   └── iflow/                   # IFlow workflow
│       ├── agents/              # 6 agent factories
│       ├── skills/              # Skill definitions
│       └── templates/           # Artifact templates
├── design-reference/            # (Moved into skills/design-reference/data/)
├── sflow-plugin.ts              # SFlow-only PluginModule
├── iflow-plugin.ts              # IFlow-only PluginModule
├── shared-plugin.ts             # Combined PluginModule (default export)
├── docs/                        # Technical documentation
└── config.example.json          # Example configuration
```

---

## Acknowledgments

- [OpenCode](https://github.com/anomalyco/opencode) — Runtime platform, plugin mechanism
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) — Planning engine
- [Superpowers](https://github.com/obra/superpowers) — Execution discipline
- [GSD](https://github.com/telestrial-org/get-shit-done) — iFlow iterative methodology source
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) — Architecture inspiration + optional integration
- [spec-superflow](https://github.com/MageByte-Zero/spec-superflow) — Validation engine port source
- [flow-kit](https://github.com/rihebty/flow-kit) — UI design methodology reference (2a-ui-design, anti-AI-slop, brownfield alignment)
- [grill-me](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling) — Requirements clarification methodology
- [getdesign.md](https://getdesign.md) — 71 brand design system references