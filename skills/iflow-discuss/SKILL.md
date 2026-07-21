---
name: iflow-discuss
description: IFlow discussing state. Clarify requirements, capture user decisions, and prepare for research phase.
---

# IFlow Discuss

Invoke this skill when IFlow is in the **discussing** state. The goal is to clarify requirements, capture user decisions, and prepare for the research phase.

## When to Use

- User request is vague or ambiguous
- New feature or task needs requirement clarification
- Starting a new iteration cycle after shipping
- User decisions need to be captured and locked

## Process

1. **Clarify Requirements**: Ask questions to surface hidden requirements, constraints, and edge cases
2. **Capture Decisions**: Record locked decisions (D-01, D-02, etc.) and deferred ideas
3. **Define Scope**: Establish what's in scope and what's out of scope
4. **Output**: Create initial .flow-engine/iflow/state.json with state="discussing"

## Entry Conditions

- No .flow-engine/iflow/ directory exists, or state.json shows "discussing"
- User has expressed a desire to start or continue work

## Exit Conditions

- Requirements are clarified and documented
- User confirms the direction
- Transition to **researching** state

## Tools

- `call_flow_agent` with subagent_type="iflow-discuss-planner"