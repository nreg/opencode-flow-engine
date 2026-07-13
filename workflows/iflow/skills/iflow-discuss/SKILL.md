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
- Returning from shipping state for next iteration

## Entry Conditions

- No `.iflow/` directory exists, or `state.json` shows `"discussing"`
- User has expressed a desire to start or continue work
- Previous phase shipped successfully (ship→discuss transition)

## Exit Conditions

- Requirements are clarified and documented
- User confirms the direction
- Transition to **researching** state (if technical uncertainty) or **planning** state (if requirements clear)

## Process

### Step 1: Clarify Requirements
Ask structured questions to surface:
- **Primary goal**: What exactly needs to be achieved?
- **Constraints**: Time, budget, technology, compatibility restrictions
- **Edge cases**: Error states, boundary conditions, empty states
- **Non-goals**: What explicitly is NOT in scope
- **User type**: Who will use the deliverable?

**DO**: Ask specific, answerable questions. "What data source should the billing table use?"
**DO NOT**: Ask vague questions. "Tell me more about what you want" — this wastes cycles.
**DO NOT**: Assume you know the answer — always verify with the user.

### Step 2: Capture Decisions
Record decisions in three categories:

**Locked Decisions (D-01, D-02, ...)** — NON-NEGOTIABLE.
- Examples: "Use PostgreSQL", "Implement as REST API", "Must support IE11"
- Format: `D-01: [decision]`
- These MUST be implemented exactly as specified later

**Discretion Areas** — Your judgment.
- Examples: "Choose any React component library", "Decide on caching strategy"
- Document your choice rationale

**Deferred Ideas** — OUT OF SCOPE.
- Examples: "Mobile app later", "Admin panel in phase 2"
- These MUST NOT appear in any plan

### Step 3: Define Scope
- **In scope**: List every deliverable
- **Out of scope**: List explicitly excluded items to prevent scope creep

### Step 4: Output
Create initial `.iflow/state.json` with state `"discussing"`

## Decision Fidelity Rules

| Rule | Description |
|------|-------------|
| **Locked decisions** | Every D-XX must appear in PLAN.md task actions. No exceptions. |
| **Deferred ideas** | Never create tasks for deferred ideas. Never mention them in plans. |
| **Discretion** | Use judgment. Document choice rationale in task Assessment fields. |
| **Conflicts** | If locked decision conflicts with research → HONOR the locked decision. Document the conflict. |

## Common Pitfalls

- **Premature commitment**: Don't lock a decision until you understand the tradeoffs. Ask "Why?" before accepting technical constraints.
- **Missing non-goals**: If you haven't asked "What's out of scope?", you're missing important constraints.
- **Over-specifying**: Don't ask about implementation details in discussion — that's for planning/research phases.
- **Silent assumptions**: Always state assumptions explicitly. "I'm assuming this is a single-module project — correct?"

## State Transition Detection

- **Trigger**: User confirms the requirement direction and no ambiguities remain
- **→ researching**: If technical approach is uncertain (new library, complex domain)
- **→ planning**: If technical approach is well-understood (standard CRUD, established patterns)
- **Auto-route suggestion**: "请执行 iflow-router 检测状态，应转换到 researching/planning 状态"

## Matching Agent Prompt

This skill complements the `iflow-discuss-planner` agent prompt. The agent prompt contains the detailed behavioral instructions (complexity assessment, scope reduction enforcement, etc.); this skill provides the contextual guidance for when and how the skill should be invoked in the OpenCode skill system.

## Tools

- `call_flow_agent` with `subagent_type="iflow-discuss-planner"` (for requirement clarification and decision capture)
