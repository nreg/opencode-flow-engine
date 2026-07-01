---
name: workflow-start
description: Primary entry point for sFlow. Invoke when the user says start, continue, resume, implement, plan, or when the current workflow stage is unclear.
---

# Workflow Start

This is the primary entry point for `sFlow`.

Its job is not to implement anything directly. Its job is to:

1. inspect the current change context
2. determine the current workflow state
3. route to the correct next skill
4. block invalid transitions

## Use This Skill When

Invoke this skill first when the user says things like:

- "continue"
- "resume this change"
- "start a new workflow"
- "help me figure out what to do next"
- "begin implementation"
- "let's write the spec"
- "we already planned this, now build it"

Use it whenever the correct next skill is not obvious from the current artifacts.

## Default States

- `exploring`
- `specifying`
- `bridging`
- `approved-for-build`
- `executing`
- `debugging`
- `closing`
- `abandoned`

## Required Inspection

Before routing, inspect the current change folder if it exists.

Look for:

- `proposal.md`
- `specs/`
- `design.md`
- `tasks.md`
- `execution-contract.md`

Then answer these questions in order:

1. Is the change still fuzzy?
2. Are planning artifacts missing or unstable?
3. Does a bridge contract exist?
4. Has the user explicitly approved the contract for build work?
5. Is execution in progress or blocked by a bug?
6. Is the change already in verification or wrap-up?

## Routing Rules

### Route to `need-explorer` when:

- the request is still fuzzy
- scope is unclear
- the user is comparing options
- there is no stable change name yet

### Route to `spec-writer` when:

- the user knows what they want
- planning artifacts are missing or incomplete
- proposal, specs, design, or tasks need to be created or revised

### Route to `contract-builder` when:

- planning artifacts exist
- implementation is requested or about to begin
- the execution contract is missing or stale

### Route to `build-executor` when:

- `execution-contract.md` exists
- the user has explicitly approved it
- implementation is the active task

### Route to `bug-investigator` when:

- execution is in the `executing` state but has hit a blockage
- a test failure, unexpected behavior, or build error has stopped progress

### Route to `code-reviewer` when:

- an execution batch has been completed
- the build-executor has finished a group of related tasks

### Route to `release-archivist` when:

- implementation is complete
- verification is complete or nearly complete
- the user wants a final summary, archive, or wrap-up

### Route to `spec-merger` when:

- release-archivist reports delta specs exist that need merging
- the change is closing and has ADDED/MODIFIED/REMOVED/RENAMED specs

## Guardrails

- Do not allow implementation before planning artifacts exist.
- Do not allow implementation before `execution-contract.md` exists.
- Do not treat "continue" as permission to skip state inspection.
- Do not allow continued implementation if scope or core behavior changed without artifact updates.
- If the user is in `executing` but the contract is stale, route backward to `contract-builder`.
- Do not allow implementation to continue past a bug without `bug-investigator` investigation.

## Output Standard

Your response should always make three things explicit:

1. current detected state
2. why that state was chosen (cite the specific file, content, or condition that determined the state)
3. which skill should run next

If transition blocking is required, explain the missing artifact or approval clearly.
