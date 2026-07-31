# TDD Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

This is not a preference. It is the execution discipline.

## RED-GREEN-REFACTOR Cycle

| Phase | Action | Evidence Required |
|-------|--------|-------------------|
| **RED** | Write the failing test | Run it, see it fail for the expected reason |
| **GREEN** | Write minimal production code | Run test, see it pass (and all others still pass) |
| **REFACTOR** | Clean up code while tests stay green | Full suite still passing after cleanup |

## Red Flags — STOP and return to RED

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
