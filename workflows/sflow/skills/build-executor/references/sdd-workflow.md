# Subagent-Driven Development (SDD) Workflow

For changes with more than one execution batch, use the SDD workflow: dispatch a fresh implementer subagent per task, review each task (spec compliance + code quality), and conduct a broad final review after all tasks are complete.

## Pre-Flight Plan Review

Before dispatching Task 1, scan the execution contract and tasks for conflicts:

- Tasks that contradict each other or the contract's intent lock
- Anything the spec explicitly mandates that the review rubric treats as a defect
- Present all findings to the user as one batched question before execution begins

If the scan is clean, proceed without comment.

## Worktree Isolation (Optional, Recommended)

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

## Dirty Worktree Check

Before starting or resuming execution, if the worktree has uncommitted changes, follow the protocol at `workflows/sflow/skills/workflow-start/references/dirty-worktree.md`. This protocol defines:

1. **Checks**: `git status --short`, `git diff --stat`, `git ls-files --others`
2. **Attribution**: Classify changes as belongs-to-change / unrelated / unclear
3. **Prohibitions**: Do not overwrite user changes, do not advance state without attribution**

If attribution is unclear, pause and ask the user before proceeding with any file modifications.

## Model Selection Strategy

Use the least powerful model that can handle each role:

- **Mechanical implementation** (isolated functions, clear specs, 1-2 files): use a fast, cheap model
- **Integration and judgment** (multi-file coordination, pattern matching, debugging): use a standard model
- **Architecture and design** (requires broad codebase understanding or design judgment): use the most capable model
- **Review tasks**: match the model to the diff's size, complexity, and risk
- **Final whole-branch review**: use the most capable model

**Always specify the model explicitly when dispatching a subagent.** An omitted model inherits the session's model, defeating cost optimization.

**Frontend UI tasks**: For tasks involving UI components, design tokens, SVG, or visual assets, delegate to the `ui-implementer` subagent instead of a general implementer. ui-implementer is specialized in frontend code with merged design skills (taste-skill, impeccable, shadcn-ui, svg-architect, polish, etc.).

## Per-Task Loop

For each task in the execution batch:

1. **Read task brief**: Read the task brief file if provided by sFlow, or read the task directly from execution-contract.md
2. **Implement directly**: Write failing test (RED) → implement (GREEN) → refactor (REFACTOR)
3. **Verify**: Run tests, check lsp_diagnostics
4. **Mark complete**: Update tasks.md and report back to sFlow

## Checkpoint File Format

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

## Stage Transitions

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

## Review-Fix Round Limit

Each task allows at most **3 review-fix rounds**. When either reviewer finds an issue:
1. Increment the round counter in the checkpoint
2. Dispatch a fresh background fix agent with the reviewer's complete feedback
3. Re-review after fixes
4. If the task still does not pass after 3 rounds, mark it **BLOCKED**, pause, and hand the accumulated feedback to the user

## Per-Task Checkoff

After both reviews pass:
1. Change the task from `- [ ]` to `- [x]` in the execution-contract.md plan
2. If a mapping exists, also check off the corresponding spec task
3. Commit this progress update
4. Update the checkpoint: set stage to `done`, record checkoff timestamp
5. Append a one-line summary to `.flow-engine/sflow/progress.md`: `Task N: complete (commits <base7>..<head7>, review clean)`

## Context Recovery

On every context resume:
1. Read `.flow-engine/sflow/subagent-progress.md`
2. Compare the checkpoint against the first unchecked task in the plan and the current worktree:
   - **Checkpoint matches unchecked task** → resume from the exact recorded stage, preserving the implementation commit, RED/GREEN evidence, review stages already passed, unresolved feedback, and current review-fix round. **Never reset the round or repeat an already passed stage.**
   - **Checkpoint missing or does not match** → create a new checkpoint for the first unchecked task, begin with implementer dispatch
   - **Recorded commit or file not visible in worktree** → pull, merge, or recover the corresponding changes before proceeding; never assume the implementation exists
3. When all tasks are checked and the checkpoint stage is `final-review` or `final-fix`, resume the exact final-review stage while preserving final feedback and its review-fix round; never re-enter completed tasks

## Wrap-up

- After both reviews pass and the task is checked off, **immediately dispatch the next unchecked task**. Do NOT summarize, do NOT ask the user whether to continue, do NOT wait for user input between tasks.
- After all tasks complete, switch the checkpoint to `final-review`, then dispatch a fresh final code quality reviewer. For CRITICAL issues, switch to `final-fix`, record feedback and the round, dispatch a fresh fix agent, and re-review. Final review also has a maximum of 3 rounds; when exhausted, mark the checkpoint `blocked` and pause. Non-CRITICAL findings may be accepted with rationale recorded.
- After final review passes, return control to `workflow-start` for state transition to `closing`.

## Progress Ledger

Track high-level progress in `.flow-engine/sflow/progress.md`. At skill start, check for an existing ledger — tasks marked complete there are done, do not re-dispatch them. After each clean review, append one line to the ledger.

The ledger survives context compaction. If `git clean -fdx` destroys it, recover from `git log`.

After each batch completes and the progress ledger is updated, sync `.flow-engine/sflow/state.json`:

1. Increment `batches_completed` counter
2. Update `last_transition` timestamp

## Dispatch Instructions for Implementer Subagents

Refer to `workflows/sflow/skills/build-executor/implementer-prompt.md` for the complete dispatch template. Key principles:

- Subagent works from its task brief, not the whole plan
- Subagent follows TDD (the rules embedded in this build-executor)
- Subagent self-reviews before reporting back
- Subagent escalates when stuck (BLOCKED, NEEDS_CONTEXT) rather than guessing
- Subagent writes its full report to the report file, returns only status summary

## Dispatch Instructions for Reviewer Subagents

Refer to `workflows/sflow/skills/build-executor/task-reviewer-prompt.md` for the complete dispatch template. Key principles:

- Reviewer gets the task brief, the implementer's report, and the diff file — nothing more
- Reviewer does NOT trust the implementer's report; it verifies against the diff
- Reviewer returns two verdicts: spec compliance and code quality
- Reviewer's output is the report itself — no preamble, no process narration

## Handling Reviewer ⚠️ Items

The task reviewer may report "⚠️ Cannot verify from diff" items — requirements in unchanged code or spanning tasks. Resolve each yourself before marking the task complete. If real gaps, treat as failed spec review — send back to implementer and re-review.
