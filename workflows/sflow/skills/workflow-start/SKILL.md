---
name: workflow-start
description: Primary entry point for SFlow. Invoke when the user says start, continue, resume, implement, plan, or when the current workflow stage is unclear.
---

# Workflow Start

Primary entry point for `sflow`. Routes to the correct next skill based on current workflow state.

## Core Responsibilities

1. Inspect the current change context
2. Check for plugin updates and remind user if outdated
3. Confirm key decisions with user before design (DP-0)
4. Determine the current workflow state
5. Route to the correct next skill
6. Block invalid transitions

## Use This Skill When

Invoke this skill first when the user says things like:

- "continue" / "resume this change"
- "start a new workflow"
- "help me figure out what to do next"
- "begin implementation"
- "let's write the spec"
- "we already planned this, now build it"

Use it whenever the correct next skill is not obvious from the current artifacts.

> **Tool note**: Subagent delegation uses `call_flow_agent` (replaces `sflow_delegate`). Supports sync (`run_in_background=false`) and async (`run_in_background=true`) modes. Use `flowagent_output` to retrieve async results and `flowagent_cancel` to abort running tasks.

## Workflow States

Default states: `exploring` → `specifying` → `bridging` → `approved-for-build` → `executing` → `debugging` → `closing` → `abandoned`

See `references/state-machine-routing.md` for auto-transition and state repair logic.

## Key Rules

### Terminal-State Short Circuit
States `closing` and `abandoned` are terminal — they block recovery scanning and state transitions. See `references/terminal-short-circuit.md`.

### DP-0 User Confirmation Gate
Before routing to `spec-writer`, confirm key decisions with user. See `references/dp-0-gate.md`.

### Workflow Path Intake
Inspect change folder and check for plugin updates before routing. See `references/workflow-path-intake.md`.

### Mode Detection
Determine workflow mode: `full`, `hotfix`, `tweak`, or `quick`. See `references/mode-detection.md`.

### Recovery Scan
Scan for overlay recovery (handoff/checkpoint) and execution-control recovery on context resume. See `references/recovery-scan.md`.

### Dirty Worktree Protocol
A dirty worktree is code evidence only — it does not automatically advance state. Attribution must happen first. See `references/dirty-worktree.md`.

## Routing Overview

Route based on current state and artifact completeness:

- `need-explorer` — request is fuzzy, scope unclear
- `spec-writer` — planning artifacts missing or incomplete
- `contract-builder` — execution contract missing or stale
- `build-executor` — contract approved, implementation active
- `bug-investigator` — execution blocked by bug
- `code-reviewer` — execution batch complete
- `release-archivist` — implementation complete, ready for wrap-up
- `spec-merger` — delta specs need merging

See `references/routing-rules.md` for detailed routing logic and fast-path routing for `hotfix`/`tweak` modes.

## Staleness Detection

Inspect file contents (not just existence) to detect drift between planning artifacts and execution contract. See `references/staleness-detection.md`.

## Guardrails

See `references/guardrails.md` for the complete list of blocking rules.

## Output Standard

Your response should always make three things explicit:

1. Current detected state
2. Why that state was chosen (cite specific file, content, or condition)
3. Which skill should run next

If transition blocking is required, explain the missing artifact or approval clearly.

### Decision Point References

When routing to a skill with an associated decision point, include the DP number:
- Route to contract-builder → include `DP-3: 契约批准 — 用户需明确批准 execution-contract.md`
- Route to build-executor → include `DP-4: 执行模式选择 — 用户选择 TDD 或 SDD`
- Route to bug-investigator (escalation) → include `DP-5: 调试升级`
- Route to release-archivist → include `DP-7: 归档确认`

## Preferred User Experience

- Keep the user on one visible workflow
- Avoid making them choose between upstream mental models
- Treat OpenSpec ideas as planning inputs and Superpowers ideas as execution discipline, but keep `sflow` as the only workflow owner
