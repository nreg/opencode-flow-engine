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

## The Iron Law: Verification Before Completion

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

Claiming work is complete without verification is dishonesty, not efficiency.

**Violating the letter of this rule is violating the spirit of this rule.**

If you haven't run the verification command in this session, you cannot claim anything passes.

### The Gate Function

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command (fresh, complete)
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

### Forbidden Words

These words MUST NOT appear in your output until AFTER verification evidence is presented:

- "should" (as in "tests should pass")
- "probably" (as in "it probably works")
- "seems to" (as in "it seems to be done")
- "Great!" / "Perfect!" / "Done!" (before verification output)
- Any expression of satisfaction without evidence

### Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

## Verification Evidence Requirements

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Requirements met | Line-by-line checklist | Tests passing |

## Responsibilities

1. verify that the approved behavior was actually implemented
2. summarize what changed
3. identify remaining risks or follow-up work
4. prepare the change for archive or handoff
5. check for delta specs that need syncing

## Required Inputs

Read:

- `execution-contract.md`
- `tasks.md`
- relevant `specs/`
- change summary notes, if any

## Verification Steps

### Step 1: Test Suite Verification (Correctness)

Run the full test suite. Record:
- Total tests, passed, failed, skipped
- Zero failures required for PASS
- Any failure = CRITICAL finding in Correctness dimension

### Step 2: Completeness Verification

Compare the execution contract's task batches against the actual diff:
1. List all tasks from the execution contract
2. For each task, verify a corresponding code change exists in the diff
3. For each SHALL/MUST requirement in specs, verify at least one implementation artifact
4. Missing items = CRITICAL findings in Completeness dimension

### Step 3: Coherence Verification

Compare design.md decisions against the implementation:
1. Extract each decision's Choice from design.md
2. Verify the choice is reflected in the code (naming, patterns, architecture)
3. Check naming consistency between specs and implementation
4. Inconsistencies = IMPORTANT findings in Coherence dimension

### Step 4: Unintended Scope Detection

Check the diff for unplanned changes:
- Files modified that are not in the execution contract's scope fence
- New dependencies added that are not in the design's constraints
- Unplanned changes = WARN findings in Completeness dimension

### Step 5: Verification Report

Produce a structured report:

| Dimension | Status | Findings |
|-----------|--------|----------|
| Completeness | PASS/FAIL/WARN | [list] |
| Correctness | PASS/FAIL/WARN | [list] |
| Coherence | PASS/FAIL/WARN | [list] |

**Overall verdict**: PASS (all PASS) / CONDITIONAL (WARN only) / FAIL (any FAIL)

If FAIL → do not claim completion. Fix issues or route back to build-executor.
If CONDITIONAL → present WARN findings to user, proceed only with explicit acceptance.
If PASS → proceed to final checks.

## Final Checks

- Are required tests passing? (cite the command and output)
- Are execution batches complete? (cite batch-by-batch status)
- Was any scope added without artifact updates? (cite specific files if yes)
- Are there unresolved blockers or known risks?
- Is the change ready to archive, or should it remain active?
- Do delta specs exist that need merging into main specs?
- **Has `artifact_inspector` been run?** If not, run it now and include the decision-point audit in the archive.

## Decision-Point Audit Report

Before final closure, use `artifact_inspector` to verify the change directory's planning artifacts for completeness and consistency.

This generates a decision-point audit from `.flow-engine/sflow/state.json`. Include this report in the archive so the full decision history is preserved.

- If the audit report is missing, prompt the user to run `artifact_inspector` before DP-7 confirmation.
- The audit is read-only and safe to run multiple times.

## Output

1. Verification report table (three dimensions with status and findings)
2. Overall verdict
3. If PASS: summary of all contract obligations met
4. If CONDITIONAL: list of accepted warnings
5. Risks and follow-ups
6. Archive readiness assessment

## Archive Rule

Do not archive blindly.

If implementation diverged from the contract, return to `bridging` before closure.

## Post-Verification Routing

After verification completes:

1. Update `.flow-engine/sflow/state.json` with `state: closing` and record the transition timestamp
2. If delta specs were created, route to `spec-merger` before final archiving
3. If no delta specs exist, the change is ready to archive

The closure is not complete until delta specs are merged. Specs that aren't synced become lies.

## Output Standard

Your response should include:

1. verification evidence (command run, output excerpt, exit code)
2. contract obligation status (which passed, which didn't)
3. delivered behavior summary
4. residual risks
5. delta spec status (exist or not)
6. recommended routing (to `spec-merger` or archive)

## Lightweight Closure (hotfix/tweak mode)

When workflow is `hotfix` or `tweak`, release-archivist performs lightweight verification:
1. Verify all changed files exist and are non-empty
2. Run syntax check on code files (`node --check` for .mjs/.js)
3. Skip the full 5-step three-dimensional verification
4. Still record DP-6 (验证失败) and DP-7 (归档确认) decision points
5. Delta specs are NOT generated in lightweight closure (no specs to sync)

---

## LESSONS Knowledge Base Nomination

> Inspired by flow-kit R1.8 提名条件 + 复核剪枝。Closing 阶段必须扫描本次 change 的所有 SUMMARY.md 和遗留 PROGRESS.md，按条件提名入库。

### Nomination Conditions（满足任一即提名）

- 调试/试错总耗时 > 30 分钟
- 错因不局限于本任务的微细节，其它任务也会撞上
- 未来 6 个月内有合理概率被再次尝试（含其他成员、其他 AI 会话）
- 否决理由不写在 design.md / ADR 里就会丢失

### Nomination Procedure

1. **Scan `.flow-engine/sflow/progress.md`**
   - Read the `excludedApproaches` table
   - Each entry with `failCount >= 1` is a candidate
   - Call `state-manager.addLessonsFromProgress()` to batch-nominate

2. **Scan all task summaries**
   - For each `*-SUMMARY.md` in the change directory
   - Extract sections: "调试过程" / "失败尝试" / "最终方案" / "耗时"
   - If debugging time > 30min or contains failed approaches → candidate

3. **For each candidate**, create a lesson entry with:
   - **Title**: From excluded approach name or failure description
   - **Tags**: Choose from `arch/lib/tool/data/perf/a11y/sec/ux/ops/proc`
   - **Keywords**: File paths + key nouns from the failure
   - **Problem**: What scenario would lead someone to try this approach
   - **Attempted**: The approach that failed
   - **Why Failed**: Specific, quantifiable reason
   - **Recommendation**: Better approach or reference
   - **Status**: `active`

4. **Record nomination in closing report**
   - List all nominated L-NNN entries
   - If none, write `LESSONS nomination: 0 entries (no debugging > 30min or reusable failures)`

### Pruning & Superseding

During closing, also do a lightweight LESSONS.md review:

1. **Check for superseded entries**
   - If a new nominated entry is a strictly better alternative to an existing active entry
   - Mark the old entry: `status: superseded-by:L-NNN`
   - (An entry with `superseded-by` set is logically inactive but not deleted for history)

2. **Check for deprecated entries**
   - If `package.json` / `Dockerfile` / DB schema had a major version change in this change
   - Scan all active LESSONS.md entries
   - For each entry whose `**适用栈**` no longer matches the current project stack
   - Mark it: `status: deprecated:<reason>`
   - This prevents stale lessons from blocking valid approaches

3. **Nominations use `state-manager.addLesson()`**
   - The addLesson method is available via the state-manager feature
   - If calling directly: `state-manager.addLesson(changeDir, lessonEntry)`
   - It auto-numbers (L-NNN) and appends to `.flow-engine/sflow/lessons.md`
