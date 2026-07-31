# Staleness Detection

## Enhanced Stale Detection via Content Inspection

Do not rely solely on file existence to determine staleness. Inspect file **contents** to detect drift:

### Detecting stale `execution-contract.md`

Compare the **intent lock** in the contract against the current proposal:

- Open `proposal.md` and read the scope (## What Changes, ## Scope sections)
- Open `execution-contract.md` and read the **Intent Lock** section
- If the proposal's scope has expanded beyond what the contract's scope fence allows → **stale**
- If the contract references capabilities no longer in the proposal → **stale**

### Detecting stale planning artifacts

Compare the proposal's scope against spec files:

- Open `proposal.md` and note which capabilities are in scope
- Open `specs/<capability>/spec.md` for each listed capability
- If a proposal-listed capability has no spec file → **stale artifacts**
- If a spec file exists for a capability not in the proposal scope → **drift detected**

### Detecting stale spec vs. tasks

- Open `specs/` and list all requirement names (SHALL/MUST statements)
- Open `tasks.md` and check that each spec requirement is represented in at least one task
- If a requirement has no corresponding task → **stale tasks**

## Staleness Rules

Treat `execution-contract.md` as stale if:

- `proposal.md` changed scope (confirmed by content comparison, not just timestamp)
- `specs/` changed approved behavior
- `design.md` changed architecture constraints
- `tasks.md` changed execution batches materially
- the contract's intent lock no longer matches the proposal's scope (content-level check)

If stale, do not continue implementation. Route back to `contract-builder`.

Treat planning artifacts as stale if:

- A requirement in `specs/` has no corresponding task in `tasks.md`
- A capability listed in `proposal.md` has no spec file
- The design references decisions no longer valid given current specs
