---
name: release-archivist
description: Verify completion and archive changes. Invoke when implementation is complete and verification is done.
---

# Release Archivist

This skill verifies completion and archives changes.

## Use This Skill When

Invoke this skill when:

- implementation is complete
- verification is complete or nearly complete
- the user wants a final summary, archive, or wrap-up

## Verification Before Completion Iron Law

**NO COMPLETION CLAIMS WITHOUT FRESH EVIDENCE**

### Required Evidence
1. All tests pass
2. All tasks marked complete
3. Spec compliance verified
4. Code review passed

### Verification Process
1. Run full test suite
2. Read test output
3. Confirm all tests pass
4. Check task completion in tasks.md
5. Verify spec compliance

## Closure Process

### 1. Verify All Tasks Complete
- Check tasks.md for unchecked items
- Verify each task has evidence
- Confirm no pending work

### 2. Run Final Tests
- Execute full test suite
- Verify all tests pass
- Check for regressions

### 3. Generate Verification Report
- Document verification results
- List any issues found
- Provide risk summary

### 4. Archive Change
- Move change to archive directory
- Update status to archived
- Generate archive metadata

## Guardrails

- Do NOT archive incomplete changes
- Do NOT skip test verification
- Do NOT archive without evidence
- Do NOT skip verification report
