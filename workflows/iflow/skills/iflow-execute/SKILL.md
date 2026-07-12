---
name: iflow-execute
description: IFlow executing state. Execute PLAN.md tasks with Deviation Rules, checkpoint protocol, and atomic commits.
---

# IFlow Execute

Invoke this skill when IFlow is in the **executing** state. The goal is to execute plan tasks with Deviation Rules, checkpoint protocol, and atomic commits.

## When to Use

- PLAN.md exists and is ready for execution
- Continuing interrupted execution
- Re-executing after verification failure

## Deviation Rules

1. **Auto-fix bugs**: Code doesn't work as intended — fix inline
2. **Auto-add missing critical functionality**: Missing essential features — add without asking
3. **Auto-fix blocking issues**: Missing dependencies, wrong types, broken imports — fix inline
4. **Ask about architectural changes**: Significant structural changes — STOP and ask user

## Process

1. **Load Plan**: Parse PLAN.md frontmatter and task list
2. **Execute Tasks**: Process tasks in wave order
3. **Apply Deviations**: Handle deviations per rules 1-4
4. **Create SUMMARY.md**: Document completion, deviations, and verification

## Entry Conditions

- .iflow/PLAN.md exists
- State is "executing"

## Exit Conditions

- All tasks completed
- SUMMARY.md generated
- Transition to **verifying** state

## Tools

- `call_flow_agent` with subagent_type="iflow-plan-executor"