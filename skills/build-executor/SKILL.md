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

Before anything else, check the current workflow mode from `.sflow/state.json`:

- If `tweak`: skip contract/spec input requirements. Proceed directly to edit the target files.
- If `hotfix` or `full`: follow the standard contract-first discipline.

### Config Check

Before determining execution mode, check the project configuration in `.sflow/config.json` (if it exists):
- If `execution.inlineThreshold` is specified, use it as the inline threshold; otherwise use default (3)

## Core Laws

### Law 1: Contract First

Do not treat chat history as the source of truth once implementation begins.

The execution contract is the approved handoff artifact.

### Law 2: No Production Code Without a Failing Test First (TDD Iron Law)

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

This is not a preference. It is the execution discipline.

**The RED-GREEN-REFACTOR Cycle:**

| Phase | Action | Evidence Required |
|-------|--------|-------------------|
| **RED** | Write the failing test | Run it, see it fail for the expected reason |
| **GREEN** | Write minimal production code | Run test, see it pass (and all others still pass) |
| **REFACTOR** | Clean up code while tests stay green | Full suite still passing after cleanup |

**Red Flags — STOP and return to RED:**

If you catch yourself thinking any of these, you are violating the TDD Iron Law:

- "Just a quick implementation first, test later"
- "This is simple enough, I'll test after"
- "Let me write the code and the tests together"
- "Skip the test, I'll manually verify"
- "The test setup is complex, let me just code it"
- "I already know it works, testing is redundant"
- "Just this one time without tests"
- "The implementation will inform the test design" (it won't — it will validate whatever you built)

**ALL of these mean: STOP. Write the test first.**

### Law 3: Review Before Drift

Use review gates between meaningful execution batches.

Block progress on:

- logic defects
- spec violations
- missing required tests
- unintended scope expansion

### Law 4: Rewind on Contract Break

Return to `specifying` or `bridging` if:

- new behavior appears
- interfaces change materially
- design assumptions fail
- the current artifacts no longer define the intended implementation

### Runtime Preset Upgrade Check

During execution, if the workflow is `hotfix` or `tweak`, continuously monitor scope. If any task execution exceeds preset constraints, **upgrade to `full`**:

**hotfix → full** (upgrade if any condition met during execution):
- Task modifies 3+ files
- Task introduces a new module, new interface, or new dependency
- Task changes database schema
- Task creates a new public API
- Task scope exceeds a single function/module
- Cross-module coordination becomes necessary

**tweak → full** (upgrade if any condition met during execution):
- Task modifies 5+ files
- Task requires cross-module coordination
- Task needs 5+ new test cases
- Task adds or removes config items (not just value changes)
- Task requires new capability not in original scope
- Task impacts existing specs (delta spec needed)

**Upgrade procedure:**
1. Output: `[SFLOW] Runtime preset upgrade: <hotfix|tweak> — <reason>`
2. Update `.sflow/state.json`: set `mode` to `full`
3. If in hotfix fast-path: route back to `contract-builder` to create proper execution contract
4. If in tweak direct-edit mode: pause and ask user to confirm full workflow with proper planning artifacts
5. Record the upgrade in `.sflow/progress.md`

## Execution Mode Selection

Before starting implementation, determine the execution mode:

### Automatic Selection Criteria

1. Count total tasks in the execution contract's task batches
2. Analyze cross-module dependencies (does any task modify files in > 2 modules?)
3. Analyze risk indicators:
   - Does any task introduce a new public API, schema, or configuration change?
   - Are there open questions or dependencies on unimplemented behavior?
4. Decision:
   - Tasks ≤ 3 AND no cross-module dependencies → **Inline mode**
   - Tasks > 3 AND all tasks within the same module AND no risk indicators AND total estimated effort ≤ 15 minutes → **Batch Inline mode**
   - Otherwise → **SDD mode** (default)

### Reporting

Before executing the first task, report to the user:
- Selected mode and reasoning
- Total task count
- Cross-module dependency analysis (if any)
- Risk indicators that prevent Batch Inline (if any)
- Offer user override: "You can override this by saying 'use SDD', 'use inline', or 'use batch inline'"

### User Override

If the user explicitly requests a mode, use it regardless of automatic selection. Record the override in the progress ledger.

## Batch Inline Execution

Batch Inline is for low-risk, same-module tasks where the overhead of one subagent per task outweighs the value. The current agent executes the batch directly, but the TDD Iron Law still applies.

### When to use Batch Inline

- Total tasks > 3 but the entire batch stays within one module or directory
- No task introduces a new public API, schema, or configuration change
- No open questions or dependencies on unimplemented behavior
- Total estimated effort ≤ 15 minutes

### Batch Inline Procedure

1. **Announce the mode** and the task range being batched.
2. **Write or update the failing test** for the first code change in the batch.
3. **Run the test** and confirm it fails for the expected reason.
4. **Implement the minimal changes** across the batch to make tests pass.
5. **Run the full relevant test suite** and confirm green.
6. **Refactor** if needed while keeping tests green.
7. **Run a lightweight checkpoint** before moving to the next batch or closure:
   - All declared files exist and are non-empty.
   - No placeholder markers remain.
   - At least one relevant test passed.
   - No unintended files were modified.
8. **Report checkpoint result** to the user.

### Batch Inline Boundaries

If any task in the planned batch:
- touches more than one module,
- involves schema, API, or configuration changes, or
- has open questions or unimplemented dependencies,

downgrade to **Inline** or **SDD** and report the reason.

## Subagent-Driven Development (SDD) Workflow

For changes with more than one execution batch, use the SDD workflow: dispatch a fresh implementer subagent per task, review each task (spec compliance + code quality), and conduct a broad final review after all tasks are complete.

### Pre-Flight Plan Review

Before dispatching Task 1, scan the execution contract and tasks for conflicts:

- Tasks that contradict each other or the contract's intent lock
- Anything the spec explicitly mandates that the review rubric treats as a defect
- Present all findings to the user as one batched question before execution begins

If the scan is clean, proceed without comment.

### Worktree Isolation (Optional, Recommended)

Before starting execution, check the current branch:

1. Run: `git branch --show-current`
2. If on `main` or `master` branch:
   - Create worktree: `git worktree add ../<project>-<change-name> -b <change-name>`
   - Change the working directory to the worktree path before any file operations
   - All subsequent commands must run from the worktree directory
3. If already on a feature branch → proceed normally
4. After all batches complete, remind the user:
   - "Worktree ready for merge. Suggested commands:"
   - `git merge <change-name>`
   - `git worktree remove <worktree-path>`

If `git worktree` is unavailable → silently skip, continue in current directory.

### Dirty Worktree Check

Before starting or resuming execution, if the worktree has uncommitted changes, follow the protocol at `skills/workflow-start/dirty-worktree.md`. This protocol defines:

1. **Checks**: `git status --short`, `git diff --stat`, `git ls-files --others`
2. **Attribution**: Classify changes as belongs-to-change / unrelated / unclear
3. **Prohibitions**: Do not overwrite user changes, do not advance state without attribution**

If attribution is unclear, pause and ask the user before proceeding with any file modifications.

### Model Selection Strategy

Use the least powerful model that can handle each role:

- **Mechanical implementation** (isolated functions, clear specs, 1-2 files): use a fast, cheap model
- **Integration and judgment** (multi-file coordination, pattern matching, debugging): use a standard model
- **Architecture and design** (requires broad codebase understanding or design judgment): use the most capable model
- **Review tasks**: match the model to the diff's size, complexity, and risk
- **Final whole-branch review**: use the most capable model

**Always specify the model explicitly when dispatching a subagent.** An omitted model inherits the session's model, defeating cost optimization.

### Per-Task Loop

For each task in the execution batch:

1. **Dispatch implementer**: Use the template at `skills/build-executor/implementer-prompt.md` to craft the dispatch. Extract the task brief. Compose the dispatch prompt with: (a) where this task fits, (b) the brief path, (c) interfaces/decisions from prior tasks, (d) report file path.
2. **Handle implementer response**:
   - **DONE**: Generate review package and dispatch task reviewer
   - **DONE_WITH_CONCERNS**: Read concerns, assess, then review
   - **NEEDS_CONTEXT**: Provide missing context, re-dispatch
   - **BLOCKED**: Assess blocker — if task requires more reasoning, re-dispatch with better model; if plan is wrong, escalate to user
3. **Review**: Dispatch task reviewer using `skills/build-executor/task-reviewer-prompt.md`. Reviewer returns spec compliance verdict + code quality verdict.
4. **Fix**: If Critical or Important issues found, dispatch fix subagent. Re-review after fixes.
5. **Mark complete**: Append one line to `.sflow/progress.md`: `Task N: complete (commits <base7>..<head7>, review clean)`

### File Handoffs

Keep your context lean by handing artifacts as files, not pasted text:

- **Task brief**: Extract task text to a uniquely named file
- **Report file**: Named after the brief (`task-N-report.md`) — implementer writes full report there, returns only status summary
- **Review package**: Write diff to a unique file; reviewer reads one file instead of running git commands

### Subagent Progress Checkpoint

Maintain a structured checkpoint at `.sflow/subagent-progress.md` for durable progress tracking across context compactions. This file stores **only coordinator recovery state** — it does not replace `tasks.md` checkboxes or the progress ledger.

#### Checkpoint File Format

```markdown
# Subagent Progress Checkpoint

## Current Task
- **Plan task**: <full task text from execution-contract.md>
- **Mapped spec task**: <corresponding spec requirement, if any>
- **Stage**: implementing | spec-review | quality-review | checkoff | done | blocked | final-review | final-fix
- **Review-fix round**: <current round, max 3>

## Implementation
- **Commit**: <commit hash>
- **Changed files**: <file list>
- **RED evidence**: <failing test command + summary>
- **GREEN evidence**: <passing test command + summary>

## Review Status
- **Spec compliance**: pending | pass | fail (<round>)
- **Code quality**: pending | pass | fail (<round>)
- **Unresolved feedback**: <list of unresolved reviewer comments>

## History
- <timestamp>: Dispatched implementer for task N
- <timestamp>: Implementer returned DONE (commit <hash>)
- <timestamp>: Spec review pass (round 1)
- <timestamp>: Quality review pass (round 1)
- <timestamp>: Task checked off
```

#### Stage Transitions

| From | To | Trigger |
|------|-----|---------|
| `implementing` | `spec-review` | Implementer returns DONE/DONE_WITH_CONCERNS |
| `spec-review` | `quality-review` | Spec compliance = pass |
| `quality-review` | `checkoff` | Code quality = pass |
| `checkoff` | `done` | Task checked off in plan + spec tasks |
| `spec-review` | `implementing` | Spec compliance = fail, dispatch fix agent |
| `quality-review` | `implementing` | Code quality = fail, dispatch fix agent |
| `done` | `implementing` | Dispatch implementer for next task |
| `implementing` | `blocked` | 3 review-fix rounds exhausted OR implementer returns BLOCKED |
| `done` | `final-review` | All tasks complete, dispatch final reviewer |
| `final-review` | `final-fix` | CRITICAL issues found, dispatch fix agent |
| `final-fix` | `final-review` | Fix agent complete, re-review |
| `final-review` | `closing` | Final review passes |

#### Review-Fix Round Limit

Each task allows at most **3 review-fix rounds**. When either reviewer finds an issue:
1. Increment the round counter in the checkpoint
2. Dispatch a fresh background fix agent with the reviewer's complete feedback
3. Re-review after fixes
4. If the task still does not pass after 3 rounds, mark it **BLOCKED**, pause, and hand the accumulated feedback to the user

#### Per-Task Checkoff

After both reviews pass:
1. Change the task from `- [ ]` to `- [x]` in the execution-contract.md plan
2. If a mapping exists, also check off the corresponding spec task
3. Commit this progress update
4. Update the checkpoint: set stage to `done`, record checkoff timestamp
5. Append a one-line summary to `.sflow/progress.md`: `Task N: complete (commits <base7>..<head7>, review clean)`

#### Context Recovery

On every context resume:
1. Read `.sflow/subagent-progress.md`
2. Compare the checkpoint against the first unchecked task in the plan and the current worktree:
   - **Checkpoint matches unchecked task** → resume from the exact recorded stage, preserving the implementation commit, RED/GREEN evidence, review stages already passed, unresolved feedback, and current review-fix round. **Never reset the round or repeat an already passed stage.**
   - **Checkpoint missing or does not match** → create a new checkpoint for the first unchecked task, begin with implementer dispatch
   - **Recorded commit or file not visible in worktree** → pull, merge, or recover the corresponding changes before proceeding; never assume the implementation exists
3. When all tasks are checked and the checkpoint stage is `final-review` or `final-fix`, resume the exact final-review stage while preserving final feedback and its review-fix round; never re-enter completed tasks

#### Wrap-up

- After both reviews pass and the task is checked off, **immediately dispatch the next unchecked task**. Do NOT summarize, do NOT ask the user whether to continue, do NOT wait for user input between tasks.
- After all tasks complete, switch the checkpoint to `final-review`, then dispatch a fresh final code quality reviewer. For CRITICAL issues, switch to `final-fix`, record feedback and the round, dispatch a fresh fix agent, and re-review. Final review also has a maximum of 3 rounds; when exhausted, mark the checkpoint `blocked` and pause. Non-CRITICAL findings may be accepted with rationale recorded.
- After final review passes, return control to `workflow-start` for state transition to `closing`.

### Progress Ledger

Track high-level progress in `.sflow/progress.md`. At skill start, check for an existing ledger — tasks marked complete there are done, do not re-dispatch them. After each clean review, append one line to the ledger.

The ledger survives context compaction. If `git clean -fdx` destroys it, recover from `git log`.

After each batch completes and the progress ledger is updated, sync `.sflow/state.json`:

1. Increment `batches_completed` counter
2. Update `last_transition` timestamp

### Dispatch Instructions for Implementer Subagents

Refer to `skills/build-executor/implementer-prompt.md` for the complete dispatch template. Key principles:

- Subagent works from its task brief, not the whole plan
- Subagent follows TDD (the rules embedded in this build-executor)
- Subagent self-reviews before reporting back
- Subagent escalates when stuck (BLOCKED, NEEDS_CONTEXT) rather than guessing
- Subagent writes its full report to the report file, returns only status summary

### Dispatch Instructions for Reviewer Subagents

Refer to `skills/build-executor/task-reviewer-prompt.md` for the complete dispatch template. Key principles:

- Reviewer gets the task brief, the implementer's report, and the diff file — nothing more
- Reviewer does NOT trust the implementer's report; it verifies against the diff
- Reviewer returns two verdicts: spec compliance and code quality
- Reviewer's output is the report itself — no preamble, no process narration

### Handling Reviewer ⚠️ Items

The task reviewer may report "⚠️ Cannot verify from diff" items — requirements in unchanged code or spanning tasks. Resolve each yourself before marking the task complete. If real gaps, treat as failed spec review — send back to implementer and re-review.

## Inline Execution Mode

For small changes (≤ 3 tasks, no cross-module dependencies). Executes in the current session without subagent dispatch.

### Per-Task Loop (Inline)

1. **Read task**: Extract the task from the plan
2. **Write failing test**: Follow the task's TDD phase 1 — write the exact test code specified
3. **Confirm failure**: Run the test, verify it fails for the expected reason
4. **Implement**: Follow the task's TDD phase 3 — write the exact implementation code specified
5. **Confirm green**: Run the full test suite, verify all tests pass
6. **Checkpoint review**: Before proceeding to the next task:
   - Verify the task's done-when criteria from the execution contract
   - Verify the task output against its spec requirements (SHALL/MUST statements)
   - If any check fails → STOP, report the gap, ask user how to proceed
7. **Commit**: Follow the task's commit step
8. **Progress ledger**: Append task completion to `.sflow/progress.md`

### Inline → SDD Escalation

If an inline task hits a BLOCKED state (test failure after 3 fix attempts, or the implementation requires changes outside the task's declared file paths), suggest escalating to SDD mode:
- "This task is more complex than estimated. Switch to SDD mode for subagent-driven implementation?"

## Execution Modes Summary

| Aspect | SDD Mode | Inline Mode |
|--------|----------|-------------|
| Task count | > 3 or cross-module | ≤ 3, single module |
| Implementation | Subagent per task | Current session |
| Review | Reviewer subagent per task | Checkpoint review by governor |
| Model selection | Per-task model routing | Single model |
| Progress ledger | Yes | Yes |
| TDD Iron Law | Yes | Yes |
| Escalation | → bug-investigator | → SDD mode or bug-investigator |

## Progress Reporting

During implementation, keep reporting against the contract:

- which batch is active
- which test or verification step is next
- whether scope drift has appeared

If drift appears, stop and route backward instead of improvising new behavior.

## Tweak Mode: Direct Edit

When workflow is `tweak`, build-executor operates in direct edit mode:
1. Skip TDD Iron Law (no test-first requirement for config/doc changes)
2. Apply changes directly to target files
3. Verify file integrity after each change (file exists, non-empty, valid syntax)
4. No batch-based execution — apply all changes in sequence
5. Reference DP-4 for execution mode confirmation
6. Reference DP-5 for debug escalation if changes fail

## Completion Standard

Do not report completion until:

- required tests pass
- contract obligations are satisfied
- review blockers are resolved
- all batches have been reviewed (per-task reviews + broad final review)
- the workflow is ready for `release-archivist`
