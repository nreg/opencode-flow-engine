---
name: release-archivist
description: Close out a sflow change with verification, summary, and archive readiness. Invoke when implementation is complete, verification is underway, or the user asks for a final wrap-up.
---

# Release Archivist

Use this skill to finish a `sflow` change cleanly.

## Use This Skill When

Invoke this skill when the user says things like:

- "wrap this up"
- "give me the final summary"
- "is this ready to close"
- "what remains before we ship"
- "prepare the handoff"

## Artifact Root Resolution (MANDATORY)

Before reading any `.flow-engine/sflow/` artifact:

1. Parse the prompt for `<Change_Dir>绝对路径</Change_Dir>`.
2. If found, use that path as the artifact root.
3. Resolve all relative paths (e.g., `.flow-engine/sflow/state.json`) against this root.
4. If not found, fall back to cwd-relative resolution (legacy behavior).

## Core Responsibilities

1. Verify that the approved behavior was actually implemented
2. Summarize what changed
3. Identify remaining risks or follow-up work
4. Prepare the change for archive or handoff
5. Check for delta specs that need syncing

## The Iron Law

**NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE**

Claiming work is complete without verification is dishonesty, not efficiency.

See [references/iron-law.md](references/iron-law.md) for:
- The Gate Function (5-step verification protocol)
- Forbidden Words (until evidence is presented)
- Rationalization Prevention Table
- Evidence Requirements Matrix

## Verification Process

### Overview

Release-archivist performs a 5-step verification across three dimensions:

| Dimension | Purpose |
|-----------|---------|
| Completeness | All contract tasks implemented, all spec requirements met |
| Correctness | Tests pass, no regressions |
| Coherence | Implementation matches design decisions |

See [references/verification-checklist.md](references/verification-checklist.md) for the full verification procedure.

### Lightweight Closure

For `hotfix` or `tweak` modes, use lightweight verification:
- Verify changed files exist and are non-empty
- Run syntax check on code files
- Skip full 5-step verification
- Still record DP-6 and DP-7 decision points
- Delta specs are NOT generated

## Decision Gates

### DP-6: Verification Failure Gate

When verification fails:
1. Record: `record_decision_point(dp-6, executing, debugging, "verification failed")`
2. Route back to `debugging` state
3. Do NOT proceed to closing until verification passes

### DP-7: Archive Confirmation Gate

When verification passes:
1. Run `artifact_inspector` for decision-point audit
2. Present verification report to user
3. Await explicit user confirmation
4. Record: `record_decision_point(dp-7, closing, closed, "archive confirmed")`
5. Record `test_result: pass` in state.json
6. Proceed to archive

See [references/dp6-dp7-gates.md](references/dp6-dp7-gates.md) for terminal state semantics and direct short-path closure options.

## Archive Procedure

### Final Checks

- Are required tests passing? (cite command and output)
- Are execution batches complete? (cite batch-by-batch status)
- Was any scope added without artifact updates?
- Are there unresolved blockers or known risks?
- Do delta specs exist that need merging?
- Has `artifact_inspector` been run?

### Archive Rule

Do not archive blindly. If implementation diverged from the contract, return to `bridging` before closure.

### Post-Verification Routing

1. Update `state.json` with `state: closing`
2. If delta specs exist → route to `spec-merger`
3. If no delta specs → ready to archive

The closure is not complete until delta specs are merged. Specs that aren't synced become lies.

See [references/archive-procedure.md](references/archive-procedure.md) for output standard and lightweight closure details.

## LESSONS Knowledge Base Nomination

Closing 阶段扫描 SUMMARY.md 和 PROGRESS.md，按条件提名入库。

### Nomination Conditions（满足任一即提名）

- 调试/试错总耗时 > 30 分钟
- 错因不局限于本任务，其它任务也会撞上
- 未来 6 个月内有合理概率被再次尝试
- 否决理由不写在 design.md / ADR 里就会丢失

See [references/lessons-nomination.md](references/lessons-nomination.md) for nomination procedure and pruning rules.

## Task Completion Rule

任务完成后，请在输出末尾使用 [TASK_COMPLETE] 标记结束会话。

## Output

Your response should include:

1. Verification evidence (command run, output excerpt, exit code)
2. Contract obligation status (which passed, which didn't)
3. Delivered behavior summary
4. Residual risks
5. Delta spec status (exist or not)
6. Recommended routing (to `spec-merger` or archive)
7. LESSONS nomination summary

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

const handoff = formatStandardHandoff('terminal', {
  currentStage: 'closing',
  completedWork: 'All artifacts archived, verification complete',
  nextStage: 'none',
  entryCondition: 'No further transition exists',
});

console.log(handoff);
```

### Output Format

```
[Handoff: terminal]

- Current stage: successfully persisted `closing` or `abandoned`.
- Completed / blocker: `All artifacts archived, verification complete`.
- Next stage: `none`.
- Entry condition: no further transition exists.
```

For blocked, approval-wait, and closing-in-progress scenarios, the format adapts to clearly communicate the blocking condition or approval requirement.
