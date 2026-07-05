# Execution Contract: [Change Name]

## Intent Lock

[Extracted from proposal.md scope. Defines the boundaries of the change.]

## Approved Behavior

[Extracted from specs/. Lists all approved requirements and scenarios.]

## Design Constraints

[Extracted from design.md. Technical constraints and architecture decisions.]

## Task Batches

Each task MUST declare its file boundaries to prevent scope drift.

| Task ID | Description | read_files | write_files |
|---------|-------------|------------|-------------|
| T01 | [Task description] | `src/moduleA/*` `src/lib/utils.ts` | `src/moduleA/feature.ts` `src/moduleA/__tests__/feature.test.ts` |
| T02 | [Task description] | `src/moduleB/*` | `src/moduleB/handler.ts` `src/moduleB/__tests__/handler.test.ts` |

**read_files**: Files/directories the implementer is ALLOWED to read for context.
**write_files**: Files the implementer is ALLOWED to create or modify — any change outside these paths is scope drift and MUST be blocked.

## Test Obligations

### TDD Requirements

- **RED**: Write failing test first
- **GREEN**: Write minimal implementation
- **REFACTOR**: Clean up code

### Review Gates

- After each batch completion
- Before moving to next batch

### Verification Requirements

- All tests pass
- Spec compliance verified
- Code quality reviewed

## Approval

**User:** [User name]

**Date:** [Approval date]

**Signature:** [Digital signature or confirmation]
