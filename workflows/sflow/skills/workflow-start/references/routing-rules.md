# Routing Rules

## Route to `need-explorer` when:

- the request is still fuzzy
- scope is unclear
- the user is comparing options
- there is no stable change name yet

## Route to `spec-writer` when:

- **Guard check**: Use `contract_validator` to verify the change directory has sufficient artifacts for the `specifying` state
  - If validation fails → BLOCK. Report failures, do not route.
  - If validation passes → proceed.
- the user knows what they want
- planning artifacts are missing or incomplete
- proposal, specs, design, or tasks need to be created or revised

## Route to `contract-builder` when:

- **Guard check**: Use `contract_validator` to verify the change directory has sufficient artifacts for the `bridging` state
  - If validation fails → BLOCK. Report failures, do not route.
  - If validation passes → proceed.
- planning artifacts exist
- implementation is requested or about to begin
- the execution contract is missing or stale
- planning artifacts changed after the last contract draft

## Route to `build-executor` when:

- **Guard check**: Use `contract_validator` to verify the change directory has sufficient artifacts for the `approved-for-build` state
  - If validation fails → BLOCK. Report failures, do not route.
  - If validation passes → proceed.
- `execution-contract.md` exists
- the user has explicitly approved it
- implementation is the active task
- the contract still matches the current planning artifacts

## Route to `bug-investigator` when:

- execution is in the `executing` state but has hit a blockage
- a test failure, unexpected behavior, or build error has stopped progress
- the build-executor reports a task cannot proceed
- the user reports a bug during active implementation

After debugging completes, route back to `build-executor` to resume the executing state.

## Route to `code-reviewer` when:

- an execution batch has been completed
- the build-executor has finished a group of related tasks
- a full batch is ready for spec-compliance and code-quality verification
- the user asks for a review checkpoint

## Route to `release-archivist` when:

- **Guard check**: Use `contract_validator` to verify the change directory has sufficient artifacts for the `closing` state
  - If validation fails → BLOCK. Report failures, do not route.
  - If validation passes → proceed.
- implementation is complete
- verification is complete or nearly complete
- the user wants a final summary, archive, or wrap-up

## Route to `spec-merger` when:

- release-archivist reports delta specs exist that need merging
- the change is closing and has ADDED/MODIFIED/REMOVED/RENAMED specs
- multiple changes have accumulated unsynced delta specs
- the user asks about spec consistency

## Hotfix Fast-Path Routing

When workflow is `hotfix`:
- Route to `contract-builder` with minimal contract mode (intent + task list only)
- Skip `need-explorer` and full `spec-writer`
- Use `contract_validator` with hotfix mode
- After bridge: DP-3 契约批准
- After approval: route to `build-executor` (inline mode)
- After execution: route to `release-archivist` (lightweight closure)

## Tweak Fast-Path Routing

When workflow is `tweak`:
- Route directly to `build-executor` (direct edit mode)
- Skip `need-explorer`, `spec-writer`, and `contract-builder`
- Use `contract_validator` with tweak mode
- After execution: route to `release-archivist` (lightweight closure: file exists + syntax check)
