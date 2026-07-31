---
name: build-executor
description: Govern implementation from an approved execution contract. Invoke when execution-contract.md is approved and the user wants disciplined build work, TDD execution, or guarded batch-by-batch implementation.
---

# Build Executor

This skill controls the implementation phase of `sflow`.

It borrows the spirit of Superpowers execution discipline, but uses `execution-contract.md` as the workflow authority.

## Use This Skill When

Invoke this skill when the user says things like:

- "implement this now"
- "start coding"
- "execute batch 1"
- "continue implementation"
- "finish the build work"

Only use it after the contract exists and the user has approved it.

## Required Inputs

Read before implementation:

- `execution-contract.md` (unless workflow is `tweak` — tweak edits config/doc files directly without a contract)
- `tasks.md` (unless workflow is `tweak`)
- relevant `specs/` (unless workflow is `tweak`)
- relevant `design.md` (unless workflow is `tweak`)

### Workflow Mode Check

Before anything else, check the current workflow mode from `.flow-engine/sflow/state.json`:

- If `tweak`: skip contract/spec input requirements. Proceed directly to edit the target files.
- If `hotfix` or `full`: follow the standard contract-first discipline.

### Config Check

Before determining execution mode, check the project configuration in `.flow-engine/sflow/config.json` (if it exists):
- If `execution.inlineThreshold` is specified, use it as the inline threshold; otherwise use default (3)

## Core Laws

See `references/core-laws.md` for the complete core laws.

**Key principle**: The execution contract is the approved handoff artifact. Do not treat chat history as the source of truth once implementation begins.

## TDD Iron Law

See `references/tdd-discipline.md` for the complete TDD discipline.

**Key principle**: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. This is not a preference. It is the execution discipline.

## Execution Modes

See `references/execution-modes.md` for complete mode selection, Batch Inline, Inline, and Tweak mode details.

**Mode selection summary**:
- Tasks ≤ 3 AND no cross-module dependencies → **Inline mode**
- Tasks > 3 AND all tasks within the same module AND no risk indicators AND total estimated effort ≤ 15 minutes → **Batch Inline mode**
- Otherwise → **SDD mode** (default)

## SDD Workflow

See `references/sdd-workflow.md` for the complete SDD workflow including Pre-Flight, Worktree Isolation, Per-Task Loop, Checkpoint, Stage Transitions, Review-Fix, Context Recovery, and Progress Ledger.

**Key principle**: Dispatch a fresh implementer subagent per task, review each task (spec compliance + code quality), and conduct a broad final review after all tasks are complete.

## Progress Protocols

See `references/progress-protocols.md` for LESSONS Knowledge Base, Anti-Repeat Protocol, and Task Too Large Early Signal.

**Key principle**: Every task must check `.flow-engine/sflow/lessons.md` before starting implementation to prevent cross-task failures.

## File Boundary Control

See `references/file-boundary-control.md` for Task-Level Isolation, Caching, Implementation Rules, Commit Boundary Enforcement, and Scope Drift Response.

**Key principle**: Each task in the execution contract MUST include `read_files` and `write_files` boundary fields. File boundaries are checked at the task level, not globally.

## Runtime Preset Upgrade

See `references/runtime-upgrade.md` for hotfix→full and tweak→full upgrade conditions and procedures.

**Key principle**: During execution, if the workflow is `hotfix` or `tweak`, continuously monitor scope. If any task execution exceeds preset constraints, upgrade to `full`.

## Progress Reporting

During implementation, keep reporting against the contract:

- which batch is active
- which test or verification step is next
- whether scope drift has appeared

If drift appears, stop and route backward instead of improvising new behavior.

## Completion Standard

Do not report completion until:

- required tests pass
- contract obligations are satisfied
- review blockers are resolved
- all batches have been reviewed (per-task reviews + broad final review)
- the workflow is ready for `release-archivist`
