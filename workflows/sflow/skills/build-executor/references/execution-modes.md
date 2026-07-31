# Execution Modes

## Mode Selection

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
8. **Progress ledger**: Append task completion to `.flow-engine/sflow/progress.md`

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

## Tweak Mode: Direct Edit

When workflow is `tweak`, build-executor operates in direct edit mode:
1. Skip TDD Iron Law (no test-first requirement for config/doc changes)
2. Apply changes directly to target files
3. Verify file integrity after each change (file exists, non-empty, valid syntax)
4. No batch-based execution — apply all changes in sequence
5. Reference DP-4 for execution mode confirmation
6. Reference DP-5 for debug escalation if changes fail
