# Artifact Quality Gates

After creating or modifying any artifact, run these validation checks. Do not hand off broken artifacts.

## Schema Validation

### proposal.md Validation

- [ ] Has `## Why` section with > 50 characters of problem description
- [ ] Has `## What Changes` section listing concrete changes
- [ ] Has `## Scope` with `### In Scope` and `### Out of Scope` sub-sections
- [ ] Has `## Impact` section listing affected code areas, APIs, and dependencies
- [ ] Has `## Capabilities` section (New Capabilities and Modified Capabilities)
- [ ] No TBD/TODO/placeholder language in any section
- [ ] **Frontend**: declares frontend scope in capabilities

### specs/ Validation

- [ ] Every requirement uses SHALL or MUST (no "should", "may" for required behavior)
- [ ] Every requirement has at least one `#### Scenario:` with WHEN/THEN clauses
- [ ] Requirements are grouped under ADDED, MODIFIED, or REMOVED headers
- [ ] Each scenario is independently testable
- [ ] No requirement contradicts another requirement

### ui-design.md Validation (Frontend Only)

- [ ] Color system defined (primary, background, text minimum)
- [ ] Typography defined (headings + body minimum)
- [ ] Spacing scale defined
- [ ] Anti-AI-slop checklist completed
- [ ] No hardcoded color/typography values in planned components
- [ ] Design tokens referenceable by CSS variables

### design.md Validation

- [ ] Has `## Context` section describing current state, constraints, stakeholders
- [ ] Has `## Goals` section stating what the design must achieve
- [ ] Has `## Decisions` section with at least one decision (Choice + Rationale + Alternatives)
- [ ] Has `## Risks And Trade-Offs` section
- [ ] Architectural decisions are justified with trade-off analysis
- [ ] **Frontend**: references ui-design.md tokens and component architecture

### tasks.md Validation

- [ ] Has `## File Structure` section listing all files with responsibilities
- [ ] Has `## Interfaces` section with Consumes/Produces between batches
- [ ] Tasks are numbered (1.1, 1.2, 2.1, etc.)
- [ ] Each task has exact file paths (Create/Modify with line ranges)
- [ ] Each code-producing task has expanded TDD phases (5 steps)
- [ ] Each task step is ≤ 5 minutes of focused work
- [ ] No TBD, TODO, or placeholder language in any task
- [ ] Every requirement from specs/ maps to at least one task
- [ ] Dependencies are explicit (Depends on: Batch N)
- [ ] Every batch ends with a commit step

## Quality Gate

**If any artifact fails validation, fix it before handing off to `contract-builder`.**

Do not hand off broken artifacts. The validation checks above are not advisory — they are the minimum bar for the next stage to function. If you skip validation, the contract-builder will produce a contract with holes, and execution will drift.

## Self-Review Checklist

Before handing off:

- [ ] Remove all placeholders — no "TBD", "TODO", "we'll figure it out"
- [ ] Resolve all contradictions — no requirement conflicts with another
- [ ] Ensure tasks align with specs — every requirement has a corresponding task
- [ ] Ensure design supports the required behavior — constraints don't block requirements
- [ ] Run schema validation on all four artifacts — all checks pass
- [ ] Verify task granularity — each task is 2-5 min, atomic, and concretely actionable
- [ ] Verify File Structure — every file referenced in any task appears in the File Structure section
- [ ] Verify Interfaces — every cross-batch dependency is declared in the Interfaces section
- [ ] Verify zero placeholders — grep for TBD, TODO, "implement later", "figure out", "add appropriate"
- [ ] **Frontend**: Verify ui-design.md exists and is referenced by design.md
