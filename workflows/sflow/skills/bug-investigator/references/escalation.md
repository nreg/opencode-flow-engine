# Escalation Protocol (DP-5)

## When 3+ Fixes Failed: Question Architecture

Pattern indicating architectural problem:
- Each fix reveals new shared state/coupling/problem in different place
- Fixes require "massive refactoring" to implement
- Each fix creates new symptoms elsewhere

## STOP and Question Fundamentals

- Is this pattern fundamentally sound?
- Are we "sticking with it through sheer inertia"?
- Should we refactor architecture vs. continue fixing symptoms?

## Action Required

**Discuss with the user before attempting more fixes**

This is NOT a failed hypothesis - this is a wrong architecture.

## Decision Point Recording

When escalating, record decision point:

```
record_decision_point(
  dp_id: "dp-5",
  state: "debugging",
  target_state: "bridging",  // or appropriate state
  metadata: "3+ fix attempts failed, architectural review required"
)
```

## Integration with sflow

When debugging during `sflow` execution, the `build-executor` routes to this skill when an implementation task hits a blockage. After debugging completes, return to the `executing` state via the `build-executor`.
