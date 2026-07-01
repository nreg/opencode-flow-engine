---
name: bug-investigator
description: Investigate and fix bugs during implementation. Invoke when execution is blocked by a test failure, unexpected behavior, or build error.
---

# Bug Investigator

This skill investigates and fixes bugs during implementation.

## Use This Skill When

Invoke this skill when:

- execution is in the `executing` state but has hit a blockage
- a test failure, unexpected behavior, or build error has stopped progress
- the build-executor reports a task cannot proceed
- the user reports a bug during active implementation

## 4-Phase Debugging Process

### Phase 1: Root Cause Analysis
- Understand the symptoms
- Trace the execution path
- Identify the failure point
- Determine the root cause

### Phase 2: Pattern Analysis
- Search for similar patterns in the codebase
- Check for common anti-patterns
- Review related code for similar issues

### Phase 3: Hypothesis Verification
- Form hypotheses about the cause
- Test each hypothesis
- Confirm the root cause

### Phase 4: Implement Fix
- Design minimal fix
- Implement the fix
- Verify the fix works
- Check for regressions

## Escalation Rules

After 3+ consecutive fix failures:
1. Question the architecture
2. Consider design flaws
3. Escalate to user with recommendations

## Guardrails

- Do NOT guess at fixes
- Do NOT skip root cause analysis
- Do NOT apply fixes without verification
- Do NOT ignore pattern analysis
