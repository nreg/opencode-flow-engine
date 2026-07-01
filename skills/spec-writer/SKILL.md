---
name: spec-writer
description: Generate planning artifacts with schema validation. Invoke when creating proposal, specs, design, or tasks.
---

# Spec Writer

This skill generates planning artifacts with schema validation.

## Use This Skill When

Invoke this skill when:

- the user knows what they want
- planning artifacts are missing or incomplete
- proposal, specs, design, or tasks need to be created or revised

## Artifact Generation

### proposal.md
- **Why section**: Explain motivation (minimum 50 characters)
- **What Changes section**: Describe changes clearly

### specs/
- Each requirement must contain SHALL or MUST statement
- Each requirement must have at least 1 scenario
- Use #### Requirement: Name format

### design.md
- Architecture decisions
- Technical constraints
- Implementation approach

### tasks.md
- Task breakdown with completion definitions
- Dependencies between tasks
- Estimated effort

## Schema Validation

After generating each artifact, run validation:

```bash
node scripts/validate-artifacts.js <change-dir>
```

Fix any errors before proceeding.

## Guardrails

- Do NOT skip schema validation
- Do NOT generate incomplete artifacts
- Do NOT proceed with validation errors
- Ensure all requirements have scenarios
