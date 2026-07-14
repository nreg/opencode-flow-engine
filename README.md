# Opencode-Flow-Engine — OpenCode Workflow Orchestration Plugin

[**简体中文**](./README.zh.md) | **English**

OpenSpec planning engine + Superpowers execution discipline + GSD iterative cycle, integrated as an OpenCode Plugin.

opencode-flow-engine is a complete development workflow orchestration plugin providing two complementary workflow modes:

- **sFlow** — Linear workflow: full lifecycle coverage from requirements clarification to planning, implementation, review, debugging, and archival
- **iFlow** — Iterative workflow: GSD (Get Stuff Done) iterative cycle: discuss → research → plan → execute → verify → ship → repeat

---

## Table of Contents

- [Overview](#overview)
- [Workflow Selection](#workflow-selection)
- [sFlow Workflow States](#sflow-workflow-states)
- [iFlow Workflow States](#iflow-workflow-states)
- [Agents](#agents)
- [Tools](#tools)
- [Execution Modes](#execution-modes)
- [Execution Discipline](#execution-discipline)
- [oh-my-openagent Integration](#oh-my-openagent-integration)
- [Features](#features)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Preset Upgrade Mechanism](#preset-upgrade-mechanism)
- [Agent Default Models](#agent-default-models)
- [Model Priority](#model-priority)
- [Project Structure](#project-structure)
- [Acknowledgments](#acknowledgments)

---

## Overview

opencode-flow-engine is an OpenCode plugin that integrates three core capabilities:

- **OpenSpec** — Planning engine for requirements, specifications, and proposals
- **Superpowers** — Execution discipline with TDD, code review, and systematic debugging
- **GSD** — Get Stuff Done iterative methodology (scope reduction prohibition, deviation rules, adversarial verification)

> **Architecture Note**: The core validation engine (schema, validation, parsing) for sFlow/iFlow is ported from [spec-superflow](https://github.com/MageByte-Zero/spec-superflow). The runtime architecture — agent factory pattern, 5-tier hook system, tool registration, state management — is newly designed for the OpenCode plugin mechanism, drawing inspiration from [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)'s architecture patterns.
>
> sFlow/iFlow have **zero external dependencies** — subagent routing uses the self-registered `call_flow_agent` tool, no oh-my-openagent required. When oh-my-openagent is also installed, it is automatically detected and its `call_omo_agent` (explore/librarian) and `task` (category delegation) tools become available, enabling stronger codebase exploration and skill injection.

---

## Workflow Selection

sFlow and iFlow share the same plugin. Select the appropriate conversation agent in OpenCode:

| Workflow | Use Case | Style | Color |
|----------|---------|-------|-------|
| **sFlow** | Tasks requiring strict planning, documentation-first, gate-driven development | Linear (9 states, sequential) | `#f8cd93` |
| **iFlow** | Fast iteration, research-driven, continuous delivery tasks | Cyclic (6 states, ship returns to discuss) | `#FFB6C1` |

Selection guidance:
- **Complex features** (3+ files, cross-module, DB schema changes) → use sFlow
- **Quick iterations** (small features, fixes, research exploration) → use iFlow
- **Uncertain** → start with sFlow, switch to iFlow for small tasks

![Flow.png](./docs/Flow.png)

---

## sFlow Workflow States

sFlow has **9 workflow states**, executed sequentially:

| # | State | Subagent | Artifact | Gate |
|---|-------|----------|----------|------|
| 1 | **exploring** | need-explorer | Clarified requirements | User confirmation |
| 2 | **specifying** | spec-writer | proposal.md, specs/, design.md, tasks.md | Artifact validation |
| 3 | **ui-design**\* | spec-writer | ui-design.md | UI Token validation |
| 4 | **bridging** | contract-builder | execution-contract.md | Contract validation |
| 5 | **approved-for-build** | — | Approved contract | User approval |
| 6 | **executing** | build-executor | Implemented code | Tests pass, review passed |
| 7 | **debugging** | bug-investigator | Bug report, fix | Issue resolved |
| 8 | **closing** | release-archivist | Verification report | All checks passed |
| 9 | **abandoned** | — | — | Terminal state |

> \*The ui-design state is automatically enabled for frontend projects (detected via package.json and directory structure).

### Automatic State Repair

On each context restoration, sFlow re-detects current artifact state and automatically repairs inconsistencies:

| State file says | But artifacts show | Auto-repair |
|----------------|-------------------|-------------|
| `exploring` | proposal.md exists | → Jump to `specifying` |
| `specifying` | design.md + tasks.md generated | → Jump to `bridging` |
| `bridging` | execution-contract.md approved | → Jump to `approved-for-build` |
| `approved-for-build` | All tasks completed | → Jump to `closing` |
| `executing` | Contract expired | → Fall back to `bridging` |

---

## iFlow Workflow States

iFlow has **6 workflow states**, forming a continuous cycle: discuss → research → plan → execute → verify → ship → (back to discuss)

| # | State | Subagent | Artifact | Gate |
|---|-------|----------|----------|------|
| 1 | **discussing** | iflow-discuss-planner | Clarified requirements, user decisions | User confirmation |
| 2 | **researching** | iflow-researcher | CONTEXT.md (goals, constraints, research findings) | Research complete |
| 3 | **planning** | iflow-discuss-planner | PLAN.md (XML tasks, wave dependencies) | Plan validated |
| 4 | **executing** | iflow-plan-executor | Implemented code | Tests pass, deviations handled |
| 5 | **verifying** | iflow-verifier | VERIFICATION.md (BLOCKER/WARNING) | All checks pass |
| 6 | **shipping** | iflow-shipper | UAT.md, PR/branch | Shipped, return to discuss |

### Key Differences from sFlow

| Dimension | sFlow | iFlow |
|-----------|-------|-------|
| **Flow shape** | Linear pipeline (9 states, terminates at closed/abandoned) | Cyclic (6 states, ship returns to discuss) |
| **Artifacts** | proposal.md, specs/, design.md, tasks.md, execution-contract.md | CONTEXT.md, PLAN.md, SUMMARY.md, VERIFICATION.md, UAT.md |
| **State directory** | `.sflow/` | `.iflow/` |
| **Methodology** | OpenSpec + Superpowers | GSD (Get Stuff Done) |
| **Scope reduction** | Enforced by guard hook | Declared in agent prompt as scope reduction prohibition |
| **Verification stance** | Contract-based validation | Adversarial verification |

---

## Agents

### sFlow Agents

| Agent | Mode | Description |
|-------|------|-------------|
| **sFlow** | Main orchestrator | Workflow controller: detects state → routes to subagent, never writes code directly |
| **need-explorer** | Subagent | Requirements clarification: asks questions when user needs are vague, documents requirements |
| **spec-writer** | Subagent | Generates proposal.md, specs, design, tasks, ui-design.md |
| **contract-builder** | Subagent | Creates execution contract with boundary control, test plan |
| **build-executor** | Subagent | TDD/SDD executor: implements code and reviews by batch |
| **bug-investigator** | Subagent | Systematic debugging: diagnoses failures and applies fixes |
| **code-reviewer** | Subagent | Reviews code quality against specifications |
| **release-archivist** | Subagent | Verifies, archives, and closes changes |
| **spec-merger** | Subagent | Incremental spec change merging |
| **ui-implementer** | Subagent | Frontend UI implementation, integrating 9 frontend specialized skills |

### iFlow Agents

| Agent | Mode | Description |
|-------|------|-------------|
| **iFlow** | Main orchestrator | Cyclic workflow controller: 6-state orchestration, never writes code directly |
| **iflow-discuss-planner** | Subagent | Discuss + plan: clarifies requirements, generates PLAN.md (XML tasks + wave dependencies) |
| **iflow-plan-executor** | Subagent | Executor: 4 deviation rules (auto-fix bugs → auto-add critical functionality → auto-fix blockers → ask about architectural changes) |
| **iflow-verifier** | Subagent | Adversarial verification: goal-backward verification, BLOCKER/WARNING classification, 3-level artifact checks |
| **iflow-researcher** | Subagent | Technical research: discovery levels (0-3), tool priority chain, confidence markers |
| **iflow-shipper** | Subagent | Shipping: creates PR, generates UAT.md, manages branch lifecycle |

### UI Implementer Subagent

A dedicated frontend UI implementation subagent, integrating 9 frontend specialized skills via `skills/ui-implementer/SKILL.md`:

| Skill Source | Role | Description |
|-------------|------|-------------|
| **taste-skill** | Design taste control | 3-knob design system, Design Read, AI anti-pattern prohibition |
| **impeccable** | Review & fix | Production-grade design guidelines, Absolute Bans, interaction norms |
| **ui-ux-pro-max** | Visual & interaction | 50+ styles, color palettes, font pairings |
| **frontend-design** | Page design | Component layout and full-page design |
| **shadcn-ui** | Component library patterns | Component selection, installation, theme customization |
| **svg-architect** | SVG icon design | Icon library selection, custom SVG standards |
| **polish** | Quality final check | Spacing system, class name semantics, responsive adaptation |
| **frontend-code-review** | Code quality | Code scanning, severity grading |
| **frontend-performance-optimization** | Performance optimization | Load/runtime performance, Core Web Vitals |

**Invocation** (dual entry):
- **SFlow direct delegation** — for post-workflow small frontend patches
- **build-executor delegation** — in SDD execution mode, frontend tasks are automatically routed to ui-implementer

**Optional enhancements** (auto-enabled when agnesmore provider is detected):
- `agnes_image_generate` tool — generate product images, carousels, card backgrounds, etc.
- `agnes_video_generate` tool — generate page background videos, product demo videos, etc.

### Routing Principles

- **NEVER** implement code yourself — always delegate to subagents
- **NEVER** skip states — must pass through the pipeline in order
- **NEVER** approve your own contract — the user must approve
- **NEVER** close without verification — release-archivist must verify first

---

## Tools

### sFlow Native Tools

| Tool | Description |
|------|-------------|
| `workflow_router` | Detects sFlow workflow state, routes to the corresponding subagent |
| `call_flow_agent` | **Core**: delegates tasks to subagents (supports sync/async, shared by sFlow and iFlow) |
| `flowagent_output` | Retrieves results from async subagent tasks |
| `flowagent_cancel` | Cancels a running async subagent task |
| `contract_validator` | Validates execution contract correctness and completeness |
| `artifact_inspector` | Reviews planning artifact completeness and consistency |
| `record_decision_point` | Records decision points (DP-0 through DP-5) |

### iFlow Native Tools

| Tool | Description |
|------|-------------|
| `iflow_router` | Detects iFlow workflow state, infers current state from `.iflow/` directory artifacts |

### Artifact Validation Toolset

| Tool | Validates |
|------|-----------|
| `validate_spec` | Single spec file (SHALL/MUST statements) |
| `validate_proposal` | Proposal file (Why + What Changes) |
| `validate_delta_spec` | Incremental spec changes (ADDED/MODIFIED/REMOVED) |
| `validate_tasks` | Task definition completeness |
| `validate_contract` | Execution contract structure |
| `validate_design` | Architecture decisions, constraints, implementation approach |
| `validate_implementation` | Implementation conformance to spec/design |
| `detect_sync_conflicts` | Sync conflicts across multiple delta specs |

### oh-my-openagent Tools (Optional Integration)

When oh-my-openagent is detected, sFlow automatically enables these tools:

| Tool | Description | Use Case |
|------|-------------|----------|
| `call_omo_agent` | Invokes explore (codebase exploration) or librarian (literature research) | Parallel exploration during Exploring/Specifying phases |
| `task` | Full delegation: category model selection + skill injection | SDD sub-task distribution for build-executor |

> **Note**: Without oh-my-openagent, these tools are not visible. sFlow works fully through `call_flow_agent`.

---

## Execution Modes

`build-executor` supports three execution modes, auto-selected or user-overridden:

### 1. Inline Mode

**Condition**: Tasks ≤ 3 with no cross-module dependencies
**Behavior**: Current agent implements code directly (TDD discipline still applies)
**Use case**: Small changes, quick fixes

### 2. Batch Inline Mode

**Condition**: Tasks > 3 but all within the same module, no API/Schema changes, estimated ≤ 15 minutes
**Behavior**: Entire batch completed in one pass, each step still follows TDD red-green-refactor cycle
**Use case**: Multiple small changes within the same module

### 3. SDD Mode (Subagent-Driven Development)

**Condition**: Cross-module changes, high-risk tasks, or changes with architectural impact
**Behavior**:
1. Spawns independent implementer subagents for each task
2. Runs spec compliance + code quality review per batch
3. Final global review

When **oh-my-openagent** is available, SDD mode can further leverage:

```bash
# Frontend tasks: visual-engineering category + shadcn-ui skill
task(category="visualEngineering", load_skills=["shadcn-ui"], run_in_background=true, prompt="...")

# Backend tasks: deep category
task(category="deep", load_skills=["programming"], run_in_background=true, prompt="...")

# Simple modifications: quick category
task(category="quick", prompt="Fix typo in README")
```

---

## Execution Discipline

### TDD Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

| Phase | Action | Evidence |
|-------|--------|----------|
| **RED** | Write a test that fails | Run tests, confirm failure for expected reason |
| **GREEN** | Write minimal production code | Tests pass (and all other tests still pass) |
| **REFACTOR** | Clean up code while tests remain green | Full test suite still passes |

### File Boundary Control

Each task declares `read_files` (reference boundary) and `write_files` (modification boundary) in the execution contract.
`git diff --name-only` is automatically run before commit to prevent scope creep.

### Failure Lessons Registry

```bash
# Automatically written to .sflow/lessons.md on each debug exit
# Automatically scanned before each task to prevent repeated mistakes
```

### Checkpoint Recovery

```bash
.sflow/subagent-progress.md  # Node state (implementing/review/done)
.sflow/progress.md           # Batch completion progress
.sflow/lessons.md            # Cross-task lessons learned database
```

---

## oh-my-openagent Integration

sFlow can automatically detect the oh-my-openagent plugin and leverage its enhanced tools, **with zero additional configuration**.

### Detection Mechanism

During plugin initialization, sFlow detects oh-my-openagent via the `cfg.plugin` list:

```javascript
// Auto-detection, no user intervention required
const hasOmo = cfg.plugin.some(p => 
  p === 'oh-my-openagent' || p === 'oh-my-opencode'
);
```

### Phase Enhancement Mapping

| sFlow Phase | Available omo Resource | Enhancement |
|-------------|----------------------|-------------|
| **exploring** | `call_omo_agent(explore)` parallel codebase exploration | need-explorer gains codebase context |
| **specifying** | `call_omo_agent(librarian)` external documentation research | spec-writer gains API best practice references |
| **bridging** | `task(category="deep")` higher-quality model selection | Complex contracts use stronger reasoning models |
| **executing** | `task` category + skill injection system | build-executor selects models and skills by task type |

### SDD Task Classification Strategy

When using the `task` tool, select recommended categories by task type:

| Task Type | Recommended Category | Injected Skills | Scenario |
|-----------|---------------------|-----------------|----------|
| Frontend UI | `visualEngineering` | shadcn-ui, frontend-design | Pages, components, styling |
| Backend logic | `deep` | programming | APIs, services, data processing |
| Simple changes | `quick` | — | Single-file changes, small fixes |
| Documentation | `writing` | — | README, comments, docs |
| Architecture | `ultrabrain` | — | Complex design decisions |

### Compatibility Notes

- **Without oh-my-openagent**: sFlow runs independently, all features work normally
- **With oh-my-openagent**: sFlow automatically enables enhanced tools, orchestrator strategy notes dynamically include omo section
- **Both installed**: No tool name conflicts (sFlow native tools use `flowagent_*` prefix)

---

## Features

### Workflow Management

- 9-state workflow with automatic state detection and routing
- Guard conditions preventing invalid state transitions
- Automatic state repair (artifact ↔ state inconsistency auto-repair)
- Frontend/backend project adaptation (frontend projects auto-insert ui-design state)

### Preset Upgrade Mechanism

| Preset | Downgrade Condition | Upgrade Trigger |
|--------|---------------------|-----------------|
| **hotfix** | ≤2 files, no architecture changes | Touching 3+ files, DB schema changes, etc. auto-upgrades to full |
| **tweak** | ≤4 config files, no code changes | Touching 5+ files, cross-module, etc. auto-upgrades to full |
| **full** | — | Standard process |

### Incremental Spec Management

- Tracks ADDED/MODIFIED/REMOVED/RENAMED specs per change
- Auto-detects spec sync conflicts across changes
- spec-merger merges delta specs back to mainline on close

### Hook System

| Hook | Trigger | Description |
|------|---------|-------------|
| `state_transition` | On state transition | Logs transition |
| `artifact_validation` | After tool execution | Validates artifact completeness |
| `guard` | Before tool execution | Prevents illegal operations (e.g., executing without approval) |
| `pre_process` | Before message processing | Injects context |
| `post_process` | After tool execution | Detects state transition signals |
| `continuation` | After context compression | Decides whether to auto-continue |

---

## Installation

### Via npm

```bash
npm install -g opencode-flow-engine
```

### Build from Source

```bash
git clone https://gitee.com/opencode-plugin/opencode-flow-engine.git
cd opencode-flow-engine
npm install
npm run build
```

---

## Configuration

### OpenCode Configuration

Add the plugin to `opencode.json`:

```json
{
  "plugin": ["opencode-flow-engine"]
}
```

Or for backward compatibility (legacy plugin name):

```json
{
  "plugin": ["opencode-sflow"]
}
```

To install oh-my-openagent alongside:

```json
{
  "plugin": ["oh-my-openagent", "opencode-flow-engine"]
}
```

### Create .sflow/config.json

```bash
# Project-level configuration (recommended)
sflow init

# User-level global configuration (shared across projects)
sflow init --user
```

Configuration loading priority (highest to lowest):

1. **Project-level `.sflow/config.json`** — overrides user-level config
2. **User-level `~/.config/opencode/opencode-flow-engine.json`** — global defaults

### Custom Agent Models

```json
{
  "version": "0.1.0",
  "mode": "full",
  "agents": {
    "sFlow": {
      "model": "your-provider/glm-5.2",
      "temperature": 0.6,
      "fallbackModels": [
        "your-provider/minimax-m3",
        "your-provider/deepseek-v4-flash"
      ]
    },
    "iFlow": {
      "model": "your-provider/deepseek-v4-flash",
      "temperature": 0.6,
      "fallbackModels": [
        "your-provider/minimax-m3"
      ]
    },
    "need-explorer": {
      "model": "your-provider/step-3.7-flash",
      "temperature": 0.6,
      "fallbackModels": [
        "your-provider/step-3.7-flash"
      ]
    },
    "spec-writer": {
      "model": "your-provider/glm-5.1",
      "temperature": 0.6,
      "fallbackModels": [
         "your-provider/glm-5"
      ]
    },
    "contract-builder": {
      "model": "your-provider/glm-5.1",
      "temperature": 0.6,
      "fallbackModels": [
        "your-provider/glm-5"
      ]
    },
    "build-executor": {
      "model": "your-provider/glm-5.1",
      "temperature": 0.7,
      "fallbackModels": [
        "your-provider/glm-5"
      ]
    },
    "bug-investigator": {
      "model": "your-provider/minimax-m2.7",
      "temperature": 0.6,
      "fallbackModels": [
        "your-provider/kimi-k2.6"
      ]
    },
    "code-reviewer": {
      "model": "your-provider/glm-5.1",
      "temperature": 0.6,
      "fallbackModels": [
        "your-provider/glm-5"
      ]
    },
    "release-archivist": {
      "model": "your-provider/glm-5.1",
      "temperature": 0.7,
      "fallbackModels": [
        "your-provider/glm-5"
      ]
    },
    "spec-merger": {
      "model": "your-provider/glm-5.1",
      "temperature": 0.7,
      "fallbackModels": [
        "your-provider/glm-5"
      ]
    },
    "iflow-discuss-planner": {
      "model": "your-provider/kimi-k2.6",
      "temperature": 0.6,
      "fallbackModels": [
        "your-provider/minimax-m2.7"
      ]
    },
    "iflow-plan-executor": {
      "model": "your-provider/glm-5.1",
      "temperature": 0.6,
      "fallbackModels": [
        "your-provider/glm-5"
      ]
    },
    "iflow-verifier": {
      "model": "your-provider/minimax-m2.7",
      "temperature": 0.6,
      "fallbackModels": [
        "your-provider/kimi-k2.6"
      ]
    },
    "iflow-researcher": {
      "model": "your-provider/glm-5.1",
      "temperature": 0.7,
      "fallbackModels": [
        "your-provider/glm-5"
      ]
    },
    "iflow-shipper": {
      "model": "your-provider/glm-5.1",
      "temperature": 0.6,
      "fallbackModels": [
        "your-provider/glm-5"
      ]
    }
  },
  "features": {
    "workflow_manager": true,
    "state_manager": true
  },
  "hooks": {
    "state_transition": true,
    "artifact_validation": true,
    "guard": true
  },
  "tools": {
    "workflow_router": true,
    "contract_validator": true,
    "artifact_inspector": true
  }
}
```

---

## Usage

### Start a Workflow

Select the sFlow or iFlow agent to start a conversation:

```
sFlow: "start a workflow"
iFlow: "start an iteration"
```

sFlow will:
1. Detect the current workflow state
2. Route to the corresponding subagent
3. Guide you through the process step by step

### Common Commands

| You Say | Action |
|---------|--------|
| "start a workflow" | Launches sFlow workflow |
| "start an iteration" | Launches iFlow workflow |
| "continue" | Continues the current workflow |
| "check status" | Checks current state |
| "explain this" | Explains current state or artifact |

---

## Preset Upgrade Mechanism

During workflow execution, sFlow continuously monitors scope. If upgrade conditions are triggered, the user is automatically notified.

### hotfix → full Upgrade Conditions

Any single item triggers an upgrade:

- Modifying 3+ files
- Introducing new modules/interfaces/dependencies
- Changing database schema
- Creating new public APIs
- Scope exceeding a single function/module
- Cross-module coordination required

### tweak → full Upgrade Conditions

- Modifying 5+ files
- Cross-module coordination required
- 5+ new test cases needed
- Adding or removing configuration items (not just changing values)
- New capabilities required that are outside the original scope
- Affecting existing specifications (delta spec needed)

---

## Agent Default Models

### sFlow Agents

| Agent | Default Model | Fallback Models |
|-------|---------------|-----------------|
| sFlow | deepseek-v4-flash | glm-5.1, kimi-k2.6 |
| need-explorer | kimi-k2.6 | glm-5.1, deepseek-v4-flash |
| spec-writer | glm-5.1 | kimi-k2.6, deepseek-v4-flash |
| contract-builder | glm-5 | glm-5.1, deepseek-v4-flash |
| build-executor | glm-5.1 | glm-5, kimi-k2.6 |
| bug-investigator | minimax-m2.7 | deepseek-v4-flash, glm-5.1 |
| code-reviewer | deepseek-v4-flash | glm-5.1, kimi-k2.6 |
| release-archivist | mimo-v2.5-pro | mimo-v2.5, glm-5.1 |
| spec-merger | mimo-v2.5 | mimo-v2.5-pro, glm-5.1 |

### iFlow Agents

| Agent | Default Model | Fallback Models |
|-------|---------------|-----------------|
| iFlow | deepseek-v4-flash | glm-5.1, kimi-k2.6 |
| iflow-discuss-planner | kimi-k2.6 | glm-5.1, deepseek-v4-flash |
| iflow-plan-executor | step-3.7-flash | deepseek-v4-flash, glm-5.1 |
| iflow-verifier | minimax-m2.7 | deepseek-v4-flash, glm-5.1 |
| iflow-researcher | glm-5.1 | kimi-k2.6, deepseek-v4-flash |
| iflow-shipper | mimo-v2.5-pro | mimo-v2.5, glm-5.1 |

---

## Model Priority

Model selection follows this priority (highest to lowest):

1. **AgentOverrides** (programmatic override parameters)
2. **createAgent's model parameter**
3. **`.sflow/config.json` configuration file**
4. **Built-in DEFAULT_MODELS**

When a model is unavailable, the fallback model list is tried in order.

---

## Project Structure

```
opencode-flow-engine/
├── packages/
│   ├── core/                    # Schema, validation, parsing engine
│   ├── plugin-infra/            # Plugin infrastructure (agent factories, hooks, tools, features)
│   │   └── src/
│   │       ├── agents/          # Infrastructure: agent builders, types, config loading
│   │       ├── hooks/           # 6 life-cycle hook types + iFlow guard
│   │       ├── tools/           # Tool definitions and implementations (including iflow-router)
│   │       ├── features/        # Workflow manager, state manager, MCP
│   │       └── helpers/         # Polling and other utility functions
│   └── shared/                  # Shared utility functions
├── workflows/
│   ├── sflow/                   # SFlow workflow definitions
│   │   ├── agents/              # 10 SFlow agent factories
│   │   ├── skills/              # SFlow skill definitions (SKILL.md)
│   │   └── templates/           # SFlow artifact templates
│   └── iflow/                   # IFlow workflow definitions
│       ├── agents/              # 6 IFlow agent factories
│       ├── skills/              # IFlow skill definitions
│       └── templates/           # IFlow artifact templates (CONTEXT.md, PLAN.md, SUMMARY.md, UAT.md)
├── sflow-plugin.ts              # SFlow-specific PluginModule
├── iflow-plugin.ts              # IFlow-specific PluginModule
├── shared-plugin.ts             # Combined PluginModule (default export)
├── docs/                        # Technical documentation
├── config.example.json          # Example configuration
└── .sflow/
    └── config.json              # Project configuration (generated by sflow init)
```

---

## Acknowledgments

- [OpenCode](https://github.com/anomalyco/opencode) — Runtime platform, plugin mechanism
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) — Planning engine
- [Superpowers](https://github.com/obra/superpowers) — Execution discipline
- [GSD (Get Shit Done)](https://github.com/telestrial-org/get-shit-done) — iFlow iterative methodology source
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) — Architecture inspiration + optional integration
- [spec-superflow](https://github.com/MageByte-Zero/spec-superflow) — Validation engine port source
- [grill-me](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling) — Requirements clarification reference