---
name: code-reviewer
description: Review completed implementation batches for spec compliance and code quality. Invoke after execution batches complete, before merging, or when a review gate is reached in the workflow.
---

# Code Reviewer

Unifies two review responsibilities: requesting review (dispatching a reviewer subagent) and receiving review (acting on feedback with technical rigor).

Core principle: Review early, review often. Verify before implementing feedback. Technical correctness over social comfort.

---

## Artifact Root Resolution (MANDATORY)

Before reading any `.flow-engine/sflow/` artifact:

1. Parse the prompt for `<Change_Dir>绝对路径</Change_Dir>`.
2. If found, use that path as the artifact root.
3. Resolve all relative paths (e.g., `.flow-engine/sflow/state.json`) against this root.
4. If not found, fall back to cwd-relative resolution (legacy behavior).

## Core Responsibilities

1. Spec Compliance Review — Verify implementation matches specification
2. Code Quality Review — Check architecture, tests, error handling, performance
3. Minimality Enforcement — Block over-engineering and unnecessary complexity
4. UI Visual Review — For frontend changes, check design tokens, anti-patterns, accessibility

---

## Review Workflow

### Requesting Review

Mandatory review points:
- After each task in subagent-driven development
- After completing a major feature
- After each execution batch
- Before merge to main

How to request:
1. Get git SHAs: `BASE_SHA=$(git rev-parse HEAD~1)`, `HEAD_SHA=$(git rev-parse HEAD)`
2. Dispatch code reviewer subagent with `code-reviewer-prompt.md` template
3. Fill placeholders: `[DESCRIPTION]`, `[PLAN_OR_REQUIREMENTS]`, `[BASE_SHA]`, `[HEAD_SHA]`
4. Act on feedback by severity (see severity-levels.md)

See [requesting-review.md](references/requesting-review.md) for full protocol and examples.

### Receiving Feedback

Response pattern:
1. READ — Complete feedback without reacting
2. UNDERSTAND — Restate requirement in own words (or ask)
3. VERIFY — Check against codebase reality
4. EVALUATE — Technically sound for THIS codebase?
5. RESPOND — Technical acknowledgment or reasoned pushback
6. IMPLEMENT — One item at a time, test each

Forbidden responses:
- "You're absolutely right!" / "Great point!" / "Thanks for..." (performative agreement)
- "Let me implement that now" (before verification)

Instead: Restate requirement, ask clarifying questions, push back with reasoning, or just fix it.

See [receiving-feedback.md](references/receiving-feedback.md) for full protocol, pushback guidance, and examples.

---

## Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Bugs, security issues, data loss, broken functionality | Fix immediately |
| IMPORTANT | Architecture problems, missing features, test gaps | Fix before next batch |
| MINOR | Code style, optimization, documentation | Fix opportunistically |

See [severity-levels.md](references/severity-levels.md) for assignment guidelines.

---

## Minimality Discipline

Enforce five core rules to prevent over-engineering:

1. No Over-Design — Reject features not in spec or requested
2. No Compatibility Shims — Reject code for out-of-scope targets
3. No Unnecessary Abstractions — Reject single-implementation abstractions
4. No Unnecessary Configuration — Reject config with only one reasonable value
5. Reviewer Safeguard — BLOCK non-minimal implementations, don't just suggest

The reviewer must BLOCK violations, not approve with suggestions.

See [minimality-discipline.md](references/minimality-discipline.md) for full rules, checklist, and YAGNI guidance.

---

## UI Visual Review

Run when change includes UI files (`.css`, `.tsx`, `.vue`, `.html`, `.svelte`) or `.flow-engine/sflow/ui-design.md` exists.

Three checks:
1. Design Token Consistency — No hardcoded colors/fonts/spacing
2. Anti-Pattern Scan — No `border-left` decoration, `#` tags, empty state flash, etc.
3. Accessibility Fast-Check — Focus indicators, labels, reduced-motion, alt text

See [ui-visual-review.md](references/ui-visual-review.md) for commands and anti-pattern list.

---

## Review Gates

After each batch:
- Run full test suite
- Check spec violations
- Verify code quality
- Apply minimality discipline
- For UI changes, run visual review
- Report completion with issues classified by severity

---

## Red Flags

Never:
- Skip review because "it's simple"
- Ignore CRITICAL issues
- Proceed with unfixed IMPORTANT issues
- Argue with valid technical feedback
- Approve non-minimal implementations with "consider simplifying..."

If reviewer is wrong:
- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification

---

## Reference Documentation

- [requesting-review.md](references/requesting-review.md) — When and how to request review
- [receiving-feedback.md](references/receiving-feedback.md) — Acting on feedback with rigor
- [severity-levels.md](references/severity-levels.md) — Issue classification guidelines
- [minimality-discipline.md](references/minimality-discipline.md) — Over-engineering prevention
- [ui-visual-review.md](references/ui-visual-review.md) — Frontend visual review protocol

## Task Completion Rule

任务完成后，请在输出末尾使用 [TASK_COMPLETE] 标记结束会话。

## Standard Handoff Format

This skill uses the standard handoff format for all user-facing phase reports. The handoff follows a four-section structure:

- **Current stage**: Where we are now in the workflow
- **Completed / blocker**: What's been completed or what's blocking progress
- **Next stage**: Where we're going next
- **Entry condition**: What must be true to proceed

### Handoff Scenarios

The `formatStandardHandoff` function in `packages/plugin-infra/src/features/handoffs.ts` supports five scenarios:

1. **normal** - Normal workflow progression
2. **blocked** - Blocked by missing evidence or failure
3. **approval-wait** - Waiting for user approval (DP gates)
4. **closing-in-progress** - Release verification or archive in progress
5. **terminal** - Successfully reached closing or abandoned

### Usage Example

```typescript
import { formatStandardHandoff } from '../features/handoffs';

const handoff = formatStandardHandoff('blocked', {
  currentStage: 'executing',
  completedWork: 'Review found 2 Critical issues in auth module',
  nextStage: 'executing',
  entryCondition: 'Fix Critical issues: missing error handling, SQL injection risk',
});

console.log(handoff);
```

### Output Format

```
[Handoff: blocked]

- Current stage: `executing`.
- Completed / blocker: `Review found 2 Critical issues in auth module`.
- Next stage: `executing`.
- Entry condition: `Fix Critical issues: missing error handling, SQL injection risk`.
```

For blocked, approval-wait, and closing-in-progress scenarios, the format adapts to clearly communicate the blocking condition or approval requirement.
