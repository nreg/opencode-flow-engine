# Verification Checklist

## 5-Step Verification Process

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

## Required Inputs

Read:
- `execution-contract.md`
- `tasks.md`
- relevant `specs/`
- change summary notes, if any
