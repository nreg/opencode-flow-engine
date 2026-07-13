---
name: iflow-ship
description: IFlow shipping state. Create PR, generate UAT.md, manage branch lifecycle, and prepare for next iteration.
---

# IFlow Ship

Invoke this skill when IFlow is in the **shipping** state. The goal is to ship the completed work: push branch, create PR, generate UAT.md, and track the merge.

## When to Use

- Verification passed with no BLOCKER issues
- Ready to deliver completed work
- Closing the current iteration cycle

## Process

1. **Prepare Branch**: Ensure all commits are pushed, check for uncommitted changes
2. **Create PR**: Generate PR body with title, description, and checklist
3. **Generate UAT.md**: Document acceptance criteria and test results
4. **Track Merge**: Monitor PR status, resolve conflicts, confirm merge

## Entry Conditions

- Verification passed with VERIFICATION.md
- State is "shipping"

## Exit Conditions

- PR created and merged
- UAT.md generated
- Return to **discussing** state for next iteration

## Tools

- `call_flow_agent` with subagent_type="iflow-shipper"