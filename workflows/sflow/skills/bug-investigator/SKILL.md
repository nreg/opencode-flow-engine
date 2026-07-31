---
name: bug-investigator
description: Use when encountering any bug, test failure, or unexpected behavior during sflow execution, before proposing fixes. Invoked automatically when build-executor hits a blockage.
---

# Bug Investigator

## Core Principle

Random fixes waste time and create new bugs. Quick patches mask underlying issues.

**ALWAYS find root cause before attempting fixes. Symptom fixes are failure.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue:
- Test failures, bugs in production, unexpected behavior
- Performance problems, build failures, integration issues

Use ESPECIALLY when:
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work
- You don't fully understand the issue

Don't skip when:
- Issue seems simple (simple bugs have root causes too)
- You're in a hurry (rushing guarantees rework)
- Manager wants it fixed NOW (systematic is faster than thrashing)

## Integration with sflow

When debugging during `sflow` execution, the `build-executor` routes to this skill when an implementation task hits a blockage. After debugging completes, return to the `executing` state via the `build-executor`.

This skill respects the TDD rules embedded in `build-executor`: before writing a fix, create a failing test that reproduces the bug. The fix is validated by the test turning green.

## Four-Stage Investigation Process

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation
Read errors carefully → Reproduce consistently → Check recent changes → Gather evidence → Trace data flow

See [references/4-stage-investigation.md](references/4-stage-investigation.md) for detailed steps.
See [references/root-cause-analysis.md](references/root-cause-analysis.md) for analysis techniques.

### Phase 2: Pattern Analysis
Find working examples → Compare against references → Identify differences → Understand dependencies

See [references/4-stage-investigation.md](references/4-stage-investigation.md) for detailed steps.

### Phase 3: Hypothesis and Testing
Form single hypothesis → Test minimally → Verify before continuing → When you don't know, ask

See [references/4-stage-investigation.md](references/4-stage-investigation.md) for detailed steps.

### Phase 4: Implementation
Create failing test case → Implement single fix → Verify fix → If fix doesn't work, re-analyze

See [references/4-stage-investigation.md](references/4-stage-investigation.md) for detailed steps.
See [references/fix-verification.md](references/fix-verification.md) for verification process.

## Red Flags - STOP and Follow Process

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "One more fix attempt" (when already tried 2+)
- Each fix reveals new problem in different place

**ALL of these mean: STOP. Return to Phase 1.**

See [references/red-flags.md](references/red-flags.md) for complete list and common rationalizations.

## Escalation Protocol (DP-5)

If 3+ fixes failed: Question the architecture.

Pattern indicating architectural problem:
- Each fix reveals new shared state/coupling/problem in different place
- Fixes require "massive refactoring" to implement
- Each fix creates new symptoms elsewhere

STOP and question fundamentals:
- Is this pattern fundamentally sound?
- Are we "sticking with it through sheer inertia"?
- Should we refactor architecture vs. continue fixing symptoms?

**Discuss with the user before attempting more fixes.**

See [references/escalation.md](references/escalation.md) for DP-5 escalation protocol.

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| 1. Root Cause | Read errors, reproduce, check changes, gather evidence | Understand WHAT and WHY |
| 2. Pattern | Find working examples, compare | Identify differences |
| 3. Hypothesis | Form theory, test minimally | Confirmed or new hypothesis |
| 4. Implementation | Create test, fix, verify | Bug resolved, tests pass |
