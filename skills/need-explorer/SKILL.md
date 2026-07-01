---
name: need-explorer
description: Clarify requirements before implementation. Invoke when the user's request is fuzzy, scope is unclear, or when comparing options.
---

# Need Explorer

This skill helps clarify requirements before implementation.

## Use This Skill When

Invoke this skill when:

- the request is still fuzzy
- scope is unclear
- the user is comparing options
- there is no stable change name yet

## Interview Process

1. Start with open-ended questions about the goal
2. Drill down into specific requirements
3. Identify constraints and edge cases
4. Compare implementation approaches
5. Recommend the best approach with reasoning
6. Record decisions in `.spec-superflow.yaml`

## Output Format

When clarifying requirements:
1. Ask ONE question at a time
2. Present options with pros/cons
3. Wait for user response before proceeding
4. Summarize findings after each round

## Guardrails

- Do NOT start implementation without clear requirements
- Do NOT assume user's intent - ask for clarification
- Do NOT skip the interview process
- Record all decisions for traceability
