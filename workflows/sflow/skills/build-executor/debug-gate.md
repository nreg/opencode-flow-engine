# Debug Gate Protocol

Canonical path: `skills/build-executor/debug-gate.md`

This protocol is shared by sflow skills that directly modify code, including build-executor, hotfix, and tweak. Enter the Debug Gate when a crash, unexpected behavior, test failure, or build failure appears while running the program, tests, build, or manual verification.

## Core Rules

- Immediately route to `bug-investigator` for root cause investigation
- Do not propose or implement source fixes before the root cause investigation is complete
- After debugging completes, route back to `build-executor` to resume the executing state

## Four-Stage Flow

1. **Reproduce and locate** the root cause first by reading the full error, checking recent changes, and tracing data flow
2. If the root cause is a source bug, first add a minimal failing test that reproduces the crash or unexpected behavior, then modify the source
3. After the fix, run that failing test, related tests, and the project'\''s build or verification commands until all pass
4. Keep the test, the source fix, and the tasks.md checkoff in the current change; do not replace the current change verification loop by starting a separate test-only change

## When to Enter Debug Gate

Enter debug gate when:
- A test failure stops execution progress
- A build error prevents compilation
- An unexpected behavior is discovered during implementation
- A crash occurs during test execution or runtime verification

## When NOT to Enter Debug Gate

Do not enter debug gate for:
- Planned refactoring or code improvement
- Adding new features within the contract scope
- Test failures caused by incomplete implementation (expected during RED phase)

## Recovery

After debugging completes:
1. Verify the fix with the original failing test
2. Run the full relevant test suite
3. Update .flow-engine/sflow/state.json back to `executing`
4. Update .flow-engine/sflow/subagent-progress.md if applicable
5. Resume the execution workflow from the point of failure
