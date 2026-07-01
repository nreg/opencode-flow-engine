---
name: build-executor
description: Execute implementation with TDD discipline. Invoke when execution contract is approved and the user wants disciplined build work.
---

# Build Executor

This skill controls the implementation phase with TDD discipline.

## Use This Skill When

Invoke this skill when:

- "implement this now"
- "start coding"
- "execute batch 1"
- "continue implementation"
- "finish the build work"

Only use after the contract exists and the user has approved it.

## TDD Iron Law

**NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST**

### RED-GREEN-REFACTOR Cycle

| Phase | Action | Evidence Required |
|-------|--------|-------------------|
| **RED** | Write the failing test | Run it, see it fail for expected reason |
| **GREEN** | Write minimal production code | Run test, see it pass |
| **REFACTOR** | Clean up code | Full suite still passing |

### Red Flags - STOP and return to RED

If you catch yourself thinking:
- "Just a quick implementation first, test later"
- "This is simple enough, I'll test after"
- "Let me write the code and the tests together"

**ALL of these mean: STOP. Write the test first.**

## Execution Process

1. Read execution-contract.md
2. Select next task from task batches
3. Write failing test (RED)
4. Write minimal implementation (GREEN)
5. Refactor if needed (REFACTOR)
6. Update tasks.md
7. Repeat until batch complete

## Review Gates

After completing a batch:
1. Run all tests
2. Check for spec violations
3. Verify code quality
4. Report completion

## Guardrails

- Do NOT skip TDD cycle
- Do NOT proceed without failing test
- Do NOT skip review gates
- Do NOT modify contract without approval
