---
name: contract-builder
description: Create execution contracts from planning artifacts. Invoke when planning artifacts exist and implementation is about to begin.
---

# Contract Builder

This skill creates execution contracts from planning artifacts.

## Use This Skill When

Invoke this skill when:

- planning artifacts exist
- implementation is requested or about to begin
- the execution contract is missing or stale

## Contract Structure

The execution contract must contain:

### Intent Lock
- Extracted from proposal.md scope
- Defines the boundaries of the change

### Approved Behavior
- Extracted from specs/
- Lists all approved requirements and scenarios

### Design Constraints
- Extracted from design.md
- Technical constraints and architecture decisions

### Task Batches
- Extracted from tasks.md
- Execution order and dependencies

### Test Obligations
- TDD requirements
- Review gates

## Contract Generation Process

1. Read all planning artifacts (proposal.md, specs/, design.md, tasks.md)
2. Extract relevant sections for each contract component
3. Generate execution-contract.md
4. Validate contract completeness
5. Present to user for approval

## Stale Detection

Detect stale contracts by comparing:
- Proposal scope vs contract intent lock
- Specs vs approved behavior
- Design vs constraints
- Tasks vs task batches

If stale, regenerate the contract.

## Guardrails

- Do NOT generate incomplete contracts
- Do NOT skip user approval
- Do NOT proceed with stale contracts
- Ensure all sections are present
