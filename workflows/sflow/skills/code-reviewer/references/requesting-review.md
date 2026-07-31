# Requesting Review

## When to Request Review

Mandatory:
- After each task in subagent-driven development (via build-executor)
- After completing a major feature
- After each execution batch
- Before merge to main

Optional but valuable:
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## How to Request

**1. Get git SHAs:**

```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**2. Dispatch code reviewer subagent:**

Dispatch a subagent using the template at `skills/code-reviewer/code-reviewer-prompt.md`.

Placeholders to fill:
- `[DESCRIPTION]` — Brief summary of what was built
- `[PLAN_OR_REQUIREMENTS]` — What it should do (reference the execution-contract.md or relevant spec)
- `[BASE_SHA]` — Starting commit
- `[HEAD_SHA]` — Ending commit

**3. Act on feedback:**

- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back if reviewer is wrong (with reasoning — see receiving-feedback.md)

## Example

```
[Just completed Batch 1 of execution]

BASE_SHA=$(git log --oneline | grep "Before batch 1" | head -1 | awk '{print $1}')
HEAD_SHA=$(git rev-parse HEAD)

[Dispatch code reviewer subagent with code-reviewer-prompt.md]
  DESCRIPTION: Batch 1 — auth module with session tokens and test suite
  PLAN_OR_REQUIREMENTS: execution-contract.md Batch 1 obligations + specs/auth/spec.md
  BASE_SHA: a7981ec
  HEAD_SHA: 3df7661

[Subagent returns]:
  Strengths: Clean architecture, real tests
  Issues:
    Important: Missing error handling for expired tokens
    Minor: Magic number (3600) for session timeout
  Assessment: Needs fixes

[Fix Important issues]
[Continue to Batch 2]
```

## Red Flags — Requesting

Never:
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

If reviewer is wrong:
- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification
