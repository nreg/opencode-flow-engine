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

**Frontend UI tasks**: For tasks involving UI components, design tokens, SVG, or visual assets, delegate to the `ui-implementer` subagent instead of a general implementer. ui-implementer is specialized in frontend code with merged design skills (taste-skill, impeccable, shadcn-ui, svg-architect, polish, etc.).

### Per-Task Loop

For each task in the execution batch:

1. **Read task brief**: Read the task brief file if provided by sFlow, or read the task directly from execution-contract.md
2. **Implement directly**: Write failing test (RED) → implement (GREEN) → refactor (REFACTOR)
3. **Verify**: Run tests, check lsp_diagnostics
4. **Mark complete**: Update tasks.md and report back to sFlow



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

## LESSONS Knowledge Base Check (Cross-Task Failure Prevention)

> Inspired by flow-kit LESSONS.md (R1.8). Every task must check `.sflow/lessons.md` before starting implementation.

### Before Each Task

Before dispatching or starting any task implementation:

1. **Check if `.sflow/lessons.md` exists**. If not, create an empty skeleton.
2. **Extract keywords** from the task:
   - File paths mentioned in `write_files` / `read_files`
   - Key nouns from `action` description
   - Programming languages / libraries involved
3. **Grep `.sflow/lessons.md`** with these keywords
4. **For each hit entry (L-NNN)**:
   - If the entry is `status: active` and matches your planned approach → **STOP**
   - Write to task plan: `"已查阅 L-NNN，本次方案与之的差异是 X"` or `"已查阅 L-NNN，本次确认仍适用，因此不重试该方案"`
   - If your approach is identical to a failed approach → trigger anti-repeat protocol below

### On Debug Exit

After bug-investigator completes diagnosis and before transitioning back to executing:

1. If the root cause is non-trivial (>30 min debug time, or likely to recur)
2. Use `.sflow-templates/LESSONS.md` as template
3. Call the `addLesson` method on state-manager to append to `.sflow/lessons.md`
4. Include: tags, title, problem scenario, what was attempted, why it failed, recommended approach, keywords for future grep

---

## Anti-Repeat Protocol (PROGRESS.md)

> Inspired by flow-kit R1.5/R1.6. Prevents repeated failed approaches across context resets.

### When to Write PROGRESS.md

Write a PROGRESS.md snapshot when ANY of these signals trigger:

- Input tokens > 50k
- AI repeats content already said (self-hinting symptom)
- Same error pattern appears ≥ 2 times
- User says the conversation is "spinning"
- Context needs compaction

### What to Include

Write to `.sflow/progress.md` using the template at `.sflow-templates/PROGRESS.md`:

1. **Completed sub-steps**: what's already done
2. **Current state**: exactly what's being worked on
3. **Excluded approaches (已排除的方案)**: ALL approaches tried and failed, with reasons
4. **Pending assumptions**: things that need confirmation
5. **Clues**: file locations, line numbers, discoveries

### On Context Resume (Recovery)

When resuming from a context break:

1. **Read `.sflow/progress.md`** — do NOT trust conversation history
2. **Read the EXCLUDED APPROACHES section** — this is the anti-repeat key
3. **Check your planned next step** against the excluded list:
   - If your step matches an excluded approach → **STOP**
   - You MUST write: "本次与第 N 次失败的差异是 X" — if you cannot, pause and ask the user
4. **If the task is too large** (was interrupted mid-task) → split it into ≥2 sub-tasks in TASK.md
5. If clean, resume from the "current state" description

### On Task Completion

After a task passes all reviews:
1. Delete `.sflow/progress.md`
2. Move task summary to `SUMMARY.md`

---

## Task Too Large Early Signal (R1.7)

> Inspired by flow-kit R1.7. When a task triggers context compaction mid-execution, it means the task was not decomposed finely enough.

### Detection Signal

If **any** of these occur during a single task execution:
- Input tokens > 50k
- AI repeats content already said (self-hinting symptom)
- Same error pattern appears ≥ 2 times
- User says the conversation is "spinning"

### Recovery Procedure

When resuming from context compaction:

1. **Do NOT continue the task as-is**
2. **Read `.sflow/progress.md`** to understand where you stopped
3. **Split the current task in `tasks.md`** into ≥ 2 sub-tasks:
   - Use the original task ID with suffix: `<task-id>-1`, `<task-id>-2`, etc.
   - Each sub-task must be completable within a single context window
   - Preserve the original task's `read_files` and `write_files` boundaries
4. **Update `.sflow/subagent-progress.md`** to reference the new sub-task
5. **Resume from the first incomplete sub-task**

### Example Split

Original task:
```
T03 - Implement authentication flow
```

After split:
```
T03-1 - Create login form component (depends on: T02)
T03-2 - Add form validation logic (depends on: T03-1)
T03-3 - Connect to auth API (depends on: T03-2)
T03-4 - Add error handling and loading states (depends on: T03-3)
```

### Why This Matters

- Prevents the same task from triggering compaction repeatedly
- Each sub-task can complete within a single context window
- Progress is preserved across compactions via PROGRESS.md

---

## File Boundary Control (read_files / write_files)

> Inspired by flow-kit B3 brownfield safety rail (R7.3 / R6.5). Prevents scope drift by enforcing strict file boundaries per task.

### Task Boundary Fields

Each task in the execution contract MUST include two boundary fields:

- **read_files**: Files/directories the implementer is ALLOWED to read for context
- **write_files**: Files the implementer is ALLOWED to create or modify

### Task-Level Isolation (CRITICAL)

File boundaries are checked at the **task level**, not globally. The guard hook:

1. Reads `.sflow/subagent-progress.md` to determine the **active task ID** (e.g., T03)
2. Extracts that task's `write_files` from the execution contract
3. Validates every file write against ONLY that task's boundary

This means **Task A cannot write files belonging to Task B**, even if both are in the same contract. This prevents scope drift between parallel or sequential tasks.

**Format support**: Boundaries can be defined in the contract in multiple formats:

**XML-style task blocks** (preferred — explicit task isolation):
```xml
<!-- Task T01 -->
<write_files>
src/module-a/feature.ts
src/module-a/__tests__/feature.test.ts
</write_files>
<!-- /Task T01 -->

<!-- Task T02 -->
<write_files>
src/module-b/helper.ts
src/module-b/__tests__/helper.test.ts
</write_files>
<!-- /Task T02 -->
```

**Task table** (write_files column):
```
| Task | Description | Dependencies | write_files                  |
|------|-------------|--------------|------------------------------|
| T01  | Add feature | -            | `src/module-a/feature.ts`, `src/module-a/__tests__/` |
| T02  | Add helper  | T01          | `src/module-b/helper.ts`     |
```

**Global write_files** (fallback — no task isolation, applies to all tasks):
```xml
<write_files>
src/components/*
src/utils/*
</write_files>
```

If both task-level and global boundaries exist, the **task-level boundary takes priority**. Global boundaries are only used as fallback when no active task is detected or the task has no explicit write_files.

### Caching

Parsed boundary patterns are **cached in memory** (keyed by contract content hash) to avoid re-reading and re-parsing the contract on every file write. The cache is invalidated automatically when the contract file changes. At most 3 cache entries per change directory are retained (LRU-eviction).

### Implementation Rules

1. **Task brief must include** the read_files and write_files from the execution contract
2. **Before writing any code**, verify the target file is in the task's write_files list
3. **If a needed file is NOT in write_files**:
   - Do NOT modify it — this is scope drift
   - Stop and report: "File X is not in task write_files. Need to either update the task boundary or create a new task."
4. **Before commit**, run boundary verification:
   ```bash
   git diff --name-only
   ```
   Compare against the task's write_files list

### Commit Boundary Enforcement

Before any commit in the progress ledger:

1. Run: `git diff --name-only` (or similar command)
2. Compare against current task's `write_files` list
3. **If boundary violated** (files outside write_files were modified):
   - Report all out-of-bound files
   - Do NOT commit — either:
     a. Roll back the unintended changes
     b. OR escalate to user for scope expansion
4. **Report clean or violated** in the progress checkpoint:
   - `✅ Boundary check: 0 files out of bounds` or
   - `❌ Boundary violation: <files> are not in write_files`

### Example Task Boundary

```
Task: T03 - Add ThemeContext provider
read_files:
  src/theme/*
  src/lib/api-client.ts
  src/utils/storage.ts
write_files:
  src/theme/ThemeContext.tsx
  src/theme/__tests__/ThemeContext.test.tsx
  
Boundary check: Only modify files under src/theme/ and src/theme/__tests__/
```

### Scope Drift Response

If scope drift is detected during execution:

1. **Stop immediately** — do not continue
2. Report which files were changed outside the boundary
3. Offer options:
   - "Update the task boundary to include these files"
   - "Roll back the unintended changes"
   - "Split this into a new task for the out-of-bound files"
4. Do NOT proceed until the user or contract-builder resolves the boundary




