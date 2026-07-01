---
name: spec-merger
description: Merge delta specs into main specs. Invoke when delta specs exist that need merging.
---

# Spec Merger

This skill merges delta specs into main specs.

## Use This Skill When

Invoke this skill when:

- release-archivist reports delta specs exist that need merging
- the change is closing and has ADDED/MODIFIED/REMOVED/RENAMED specs
- multiple changes have accumulated unsynced delta specs
- the user asks about spec consistency

## Delta Operations

### ADDED
- Add new requirement to spec
- Include requirement text and scenarios

### MODIFIED
- Update existing requirement
- Preserve version history

### REMOVED
- Remove requirement from spec
- Document removal reason

### RENAMED
- Rename requirement
- Update all references

## Merge Process

### 1. Parse Delta Spec
- Read change directory
- Extract delta operations
- Validate delta format

### 2. Read Main Spec
- Load current spec file
- Parse existing requirements
- Identify target requirements

### 3. Apply Changes
- Apply ADDED operations
- Apply MODIFIED operations
- Apply REMOVED operations
- Apply RENAMED operations

### 4. Detect Conflicts
- Check for conflicting operations
- Identify overlapping changes
- Report conflicts to user

### 5. Resolve Conflicts
- Present conflicts to user
- Apply resolution
- Update main spec

## Conflict Detection

### Cross-Section Conflicts
- Same requirement in MODIFIED and REMOVED
- Same requirement in ADDED and MODIFIED

### Overlapping Changes
- Multiple changes to same requirement
- Conflicting requirement text

## Guardrails

- Do NOT merge without conflict resolution
- Do NOT skip conflict detection
- Do NOT apply invalid deltas
- Do NOT overwrite without user approval
