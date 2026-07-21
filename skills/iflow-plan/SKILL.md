---
name: iflow-plan
description: IFlow planning state. Generate PLAN.md with XML tasks, wave dependency analysis, and goal-backward verification.
---

# IFlow Plan

Invoke this skill when IFlow is in the **planning** state. The goal is to generate an executable PLAN.md with task breakdown, dependency analysis, and verification criteria.

## When to Use

- CONTEXT.md exists and research is complete
- User requests a plan for execution
- Planning needs to be revisited after execution blockers

## Process

1. **Read Context**: Load CONTEXT.md for goals, constraints, and research findings
2. **Task Breakdown**: Decompose work into 2-3 task batches with wave dependencies
3. **Goal-Backward Verification**: Verify each task maps to a stated goal
4. **Output**: Create PLAN.md with frontmatter + XML task blocks

## Entry Conditions

- .flow-engine/iflow/CONTEXT.md exists
- State is "planning" or can transition to planning

## Exit Conditions

- PLAN.md is generated and validated
- Plan covers all requirements from CONTEXT.md
- Transition to **executing** state

## Tools

- `call_flow_agent` with subagent_type="iflow-discuss-planner"