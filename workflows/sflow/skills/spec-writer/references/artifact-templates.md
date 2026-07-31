# Artifact Templates and Structure

This document defines the required structure and content for each planning artifact.

## proposal.md

Must clearly state:

- the problem
- what changes
- capabilities affected
- impact areas
- **must declare if this is a frontend project** (for routing to ui-design phase)

Required sections:
- `## Why` — Problem description (> 50 characters)
- `## What Changes` — Concrete changes
- `## Scope` — With `### In Scope` and `### Out of Scope` sub-sections
- `## Impact` — Affected code areas, APIs, and dependencies
- `## Capabilities` — New Capabilities and Modified Capabilities

## specs/

Must be testable.

Every requirement should be written so that a later test can prove it.

Requirements must:
- Use SHALL or MUST (no "should", "may" for required behavior)
- Have at least one `#### Scenario:` with WHEN/THEN clauses
- Be grouped under ADDED, MODIFIED, or REMOVED headers
- Be independently testable
- Not contradict another requirement

## ui-design.md (Frontend Projects Only)

Generated between `specs/` and `design.md`. Must include:

```markdown
# UI Design — <change-title>

## Visual Direction
- **Style**: <e.g., minimal / glassmorphism / brutalist / clean professional>
- **Reference products**: <1-3 real products for inspiration>
- **Key emotion**: <what users should feel>

## Design Tokens
### Color System (OKLCH format preferred)
- Primary: <value>
- Secondary: <value>
- Background: <value>
- Text: <value>
- Accent/Success/Error/Warning: <values>

### Typography
- Headings: <font-family, weights>
- Body: <font-family, weights>
- Scale: <clamp() or step values>

### Spacing
- Base unit: <e.g., 4px / 8px>
- Scale: <values>

### Border Radius / Shadows
- Values for different component levels

## Component Architecture (UI Tree)
- List key visual components and their hierarchy
- Reference existing design system components to reuse

## Anti-AI-Slop Checklist
- [ ] No hardcoded colors — all from CSS variables
- [ ] No hardcoded font sizes — all from type scale tokens
- [ ] Border-left decorations are NOT used
- [ ] Hash tags (#) are NOT used for labels/tags
- [ ] Loading states don't flash empty elements
- [ ] All interactive states defined (hover, focus, active, disabled, loading)
```

## design.md

Must explain architectural decisions and trade-offs, not line-by-line implementation.

Required sections:
- `## Context` — Current state, constraints, stakeholders
- `## Goals` — What the design must achieve
- `## Decisions` — At least one decision (Choice + Rationale + Alternatives)
- `## Risks And Trade-Offs`

For frontend projects, design.md must reference `ui-design.md` tokens and component decisions.

## tasks.md

Must be ordered, verifiable, and small enough to become execution batches later.

### File Structure Section

Every tasks.md MUST begin with a `## File Structure` section listing all files to be created or modified, with each file's responsibility stated in one sentence. Format:
- `Create: path/to/file.ts` — One-sentence responsibility
- `Modify: path/to/existing.ts` — What changes

### Interfaces Section

Every tasks.md MUST include a `## Interfaces` section declaring cross-batch dependencies. Format:
```
### Batch N → Batch M
- **Produces**: `type/function name` — consumed by Batch M for purpose
```

### Per-Task Format

Each task MUST include:
1. **Exact file paths**: `Create: path/to/file.ts` or `Modify: path/to/file.ts:line-range` for every file the task touches
2. **TDD phases expanded** (for code-producing tasks):
   - Write the failing test with exact test code
   - Run the test and confirm it fails for the expected reason
   - Implement the minimal code with exact implementation
   - Run the test and confirm it passes
   - Commit with descriptive message
3. **Interfaces block**: If the task produces output consumed by later tasks, declare `Consumes` (inputs from earlier tasks) and `Produces` (outputs for later tasks) with exact function names, parameter types, and return types
4. **Dependency declaration**: Each batch header states `Depends on: Batch N` if it consumes output from an earlier batch

### Granularity Requirement

Each task step MUST be completable in 2-5 minutes of focused work. This means:
- A task step is one atomic operation: write one function, add one test case, update one config value
- A task step is NOT "implement the authentication module" — that's a batch of steps
- If a step takes longer than 5 minutes to describe, it should be decomposed further

### Zero Placeholder Rule

Tasks MUST NOT contain "TBD", "TODO", "implement later", "figure out", "add appropriate", "we'll decide", or similar placeholder language. Every task must be concrete and immediately actionable. If there is uncertainty, resolve it during specification — do not push it to implementation.

### Task Dependency Ordering

Tasks must be ordered so that:
- Each task depends only on tasks listed before it
- No task references work that hasn't been described yet
- The dependency chain is explicit: "Depends on: Batch N"
- Every batch ends with a commit step
