---
name: iflow-plan
description: IFlow planning state. Generate PLAN.md with XML tasks, wave dependency analysis, complexity assessment, and goal-backward verification.
---

# IFlow Plan

Invoke this skill when IFlow is in the **planning** state. The goal is to generate an executable PLAN.md with task breakdown, dependency analysis, complexity scoring, and verification criteria — a prompt that executors can implement without interpretation.

## When to Use

- CONTEXT.md exists and research is complete
- User requests a plan for execution
- Returning from executing state (execution blocked by complexity overload)
- Returning from researching state (plan revealed unknowns that need research)
- Replanning after verification failure (gap closure mode)

## Entry Conditions

- `.iflow/CONTEXT.md` exists with goals, constraints, decisions
- State is `"planning"` or can transition to planning
- Research findings are available (or explicitly not needed for Level 0 tasks)

## Exit Conditions

- PLAN.md is generated and validated against all 4 source types
- All tasks have Complexity/Score assignments
- Nyquist Rule satisfied: every task has `<automated>` verification command
- Goal-backward verification passed (every truth maps to a task)
- Transition to **executing** state

## Process

### Step 1: Read Context
Load and parse:
- `.iflow/CONTEXT.md` — goals, constraints, locked decisions (D-IDs)
- `.iflow/IFLOW-CONTEXT.md` — shared IFlow state machine, core principles

### Step 2: Multi-Source Coverage Audit
Audit all 4 source types BEFORE writing tasks:

| Source | What to Check |
|--------|---------------|
| **GOAL** | Every component of the user's goal has at least one task |
| **REQ** | Every explicit requirement is implemented, not deferred or "v1" |
| **RESEARCH** | Relevant findings incorporated, recommendations followed |
| **CONTEXT** | Every locked D-ID referenced in task actions |

If ANY item is missing → return options to user. Never finalize with gaps.

### Step 3: Complexity Assessment
Score every task using the Complexity Assessment Framework (8 factors):

| Factor | Weight |
|--------|--------|
| write_files count | Primary (1-2→S, 3-4→M, 5-8→L, 8+→XL) |
| read_files scope | Bump one level if 8+ files |
| Cross-module reach | Bump one level if cross-package |
| Schema/DB changes | At least M, with migration → L |
| New module creation | At least L |
| External API integration | At least M |
| Business logic complexity | Simple CRUD→S, state machine→M/L |
| Test burden | 1-3→S, 4-8→M, 8+→L/XL |

**Score → Level**: 1-5→S, 6-10→M, 11-15→L (SHOULD split), 16+→XL (MUST split)

### Step 4: Create PLAN.md
Generate PLAN.md with:
- Objective + Context sections
- Task blocks with: Type, Complexity, Score, Wave, Depends On, Files, Actions, Verification (with `<automated>` tag), Assessment
- Success Criteria section
- Wave dependency graph (Wave 1: no deps, Wave 2: depends on Wave 1, etc.)
- 2-3 tasks per wave for optimal context utilization

### Step 5: Interface-First Ordering
Order tasks by dependency:
1. **Wave 1**: Define contracts/interfaces/types first (type: interface)
2. **Wave 2**: Implement against contracts (type: implementation)
3. **Final wave**: Wire connections (type: wiring)

Same-wave tasks must have zero `files_modified` overlap.

### Step 6: Goal-Backward Verification
Before finalizing:
1. What must be TRUE for the goal to be achieved?
2. What must EXIST for those truths to hold?
3. What must be WIRED for those artifacts to function?
4. Map each truth to concrete tasks. If uncovered → ADD task.

## Scope Reduction Enforcement

**You have ZERO authority to reduce scope.**

PROHIBITED patterns: "v1", "simplified version", "static for now", "placeholder", "basic version", "future enhancement", "skip for now"

Allowed reasons to split (only 4): Context cost >50%, Missing information, Dependency conflict, Complexity overload (XL/L)

## Common Pitfalls

- **Overloaded tasks**: Score > 10 means SPLIT. Don't let a single task exceed M.
- **Missing Nyquist Rule**: Every task MUST have `<automated>` verification. "Looks good" is not verification.
- **Ignoring wave dependencies**: Task in Wave 2 dependending on Wave 2 task = cycle.
- **Vague file paths**: "the auth files" is not a file path. Use `src/app/api/auth/login/route.ts`.
- **Scope creep via discretion**: Discretion areas ≠ permission to add features not requested.

## State Transition Detection

- **Trigger**: PLAN.md is complete and passes goal-backward verification + Nyquist Rule
- **Auto-route suggestion**: "Plan validated. Transition to executing state, route to iflow-execute"

## Matching Agent Prompt

This skill complements `iflow-discuss-planner.ts` prompt (436 lines). The agent prompt contains the full Complexity Assessment Framework, Multi-Source Coverage Audit, Scope Reduction Enforcement, Interface-First Ordering, and TDD Detection Heuristics. This skill provides the concise contextual reference for the OpenCode skill invocation system.

## Tools

- `call_flow_agent` with `subagent_type="iflow-discuss-planner"` (for planning task generation)
