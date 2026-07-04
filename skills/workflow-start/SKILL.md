---
name: workflow-start
description: Primary entry point for SFlow. Invoke when the user says start, continue, resume, implement, plan, or when the current workflow stage is unclear.
---

# Workflow Start

This is the primary entry point for `sflow`.

Its job is not to implement anything directly. Its job is to:

1. inspect the current change context
2. check whether the installed plugin is outdated and remind the user if so
3. confirm key decisions with the user before design (DP-0)
4. determine the current workflow state
5. route to the correct next skill
6. block invalid transitions

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

> **Tool note**: Subagent delegation uses `call_flow_agent` (replaces `sflow_delegate`). Supports sync (`run_in_background=false`) and async (`run_in_background=true`) modes. Use `background_output` to retrieve async results and `background_cancel` to abort running tasks.

## Default States

- `exploring`
- `specifying`
- `bridging`
- `approved-for-build`
- `executing`
- `debugging`
- `closing`
- `abandoned`

Read the state machine documentation before making a state decision if the transition is ambiguous.

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

## Auto-Transition & State Repair

On every context resume, do **NOT** trust conversation history. Always re-run full inspection from scratch.

### State ↔ Artifact Consistency Check

After reading `.sflow/state.json` and inspecting artifacts, check for mismatches:

| State says | But artifacts show | Auto-repair action |
|------------|-------------------|-------------------|
| `exploring` | `proposal.md` exists with content | → transition to `specifying` |
| `specifying` | `design.md` + `tasks.md` exist and non-empty | → transition to `bridging` |
| `bridging` | `execution-contract.md` exists + `contractApproved: true` | → transition to `approved-for-build` |
| `approved-for-build` | all tasks checked in `tasks.md` | → transition to `closing` |
| `executing` | all tasks checked in `tasks.md` | → transition to `closing` |
| `specifying` | `proposal.md` missing or empty | → transition back to `exploring` |
| `bridging` | `design.md` missing or `tasks.md` missing | → transition back to `specifying` |
| `approved-for-build` | `execution-contract.md` missing | → transition back to `bridging` |

### Repair Execution

When a mismatch is detected:

1. Output: `[SFLOW] Detected state mismatch: state=<current> but artifacts indicate <corrected>. Auto-repairing.`
2. Call the `record_decision_point` tool to record the repair (dp_id: `dp-0`, metadata: `{"repair": "auto-transition", "from": "<current>", "to": "<corrected>"}`)
3. Update `.sflow/state.json` with the corrected state via the state-transition hook
4. Continue with normal routing using the **corrected** state
5. If the repair transitions **backward** (e.g., `executing` → `bridging`), warn the user: "Scope change detected — artifacts no longer match implementation state. Routed back to `<state>`."

### Stale State Detection

Treat state as stale and repair when:

- `state: executing` but `.sflow/progress.md` shows all tasks complete → repair to `closing`
- `state: approved-for-build` but `tasks.md` has unchecked tasks AND `.sflow/progress.md` shows active execution → repair to `executing`
- `state: bridging` but `execution-contract.md` content hash differs from `contract_hash` in state.json → re-validate contract for staleness
- `state: specifying` but `proposal.md` has been updated since `last_transition` timestamp → re-check artifact completeness
- `state: executing` but worktree has no uncommitted changes and no progress entries for > 10 minutes → unclear state, prompt user

After repairing, always re-run the routing rules from the corrected state.

## Update Check Reminder

Before doing anything else, check for plugin updates:

```bash
npm view opencode-sflow version
```

### How to surface the result

- If a newer version exists → prepend a non-blocking upgrade reminder to your response, then continue normally:
  > A new version of sflow is available. Upgrade with `npm install -g opencode-sflow@latest`.
- If already up to date → silently skip.

Do not block workflow progress on an available upgrade; simply inform the user.

## Dirty Worktree Protocol

When resuming or continuing in a change directory that may have uncommitted work, follow the protocol at `skills/workflow-start/dirty-worktree.md`. This protocol defines how to detect, attribute, and handle uncommitted changes before advancing state or modifying code.

**Key rule:** A dirty worktree is code evidence only — it does not automatically advance `.sflow/state.json` state. Attribution must happen first.

## DP-0: User Confirmation Gate (Design-Preparation)

Before routing to `spec-writer` for a new or incomplete change, confirm key decisions with the user. Do not generate planning artifacts until this gate is passed.

### When to run DP-0

Run DP-0 when **all** of the following are true:
- The change folder does not exist, OR
- Planning artifacts (`proposal.md`, `specs/`, `design.md`, `tasks.md`) are missing or empty, OR
- `.sflow/state.json` does not contain `dp_0_confirmed: true`.

If `dp_0_confirmed` is `true`, skip this gate and proceed with normal state detection.

### Required Questions

Ask the user at least these questions. Record the answers in `.sflow/state.json`.

1. **Scope**: What is the change name and one-sentence intent?
2. **Constraints**: Are there known constraints (naming style, compatibility policy, platforms affected)?
3. **Related optimizations**: Should this change include related optimizations or stay focused?
4. **Communication preference**: Do you prefer to be asked before each design decision, or receive a draft for review?

### Recording DP-0

After the user confirms, update `.sflow/state.json`:

```json
{
  "dp_0_decisions": "<summary>",
  "dp_0_confirmed": true,
  "dp_0_timestamp": "<ISO-8601 timestamp>"
}
```

Then proceed to normal state detection and routing.

### Config-Aware Routing

Before routing, check project configuration in `.sflow/config.json` (if it exists):
- If `artifacts.order` is specified, follow it when checking artifact completeness
- If `artifacts.skip` is specified, do not require those artifacts for state transitions

## Mode Detection

Before routing, determine the workflow mode.

### Auto-Detection

If `.sflow/state.json` workflow is `auto`, `null`, or unset:

1. Inspect `proposal.md` scope and `tasks.md` to infer `hotfix`, `tweak`, or `full`.
2. Update `.sflow/state.json` with the inferred `workflow` value.
3. Output the inferred mode and reason to the user.

Inference rules:

- **hotfix**: 2 or fewer tasks, 2 or fewer files, no schema/API changes, no new modules.
- **tweak**: 4 or fewer tasks, only config/doc files (`.md`, `.json`, `.yaml`, etc.), no schema/API changes, no new modules.
- **full**: anything larger, or changes that touch code files, schemas, APIs, or add new modules.

### Explicit Override

If workflow is already set to `hotfix`, `tweak`, or `full`, do **not** overwrite it unless the user explicitly asks to re-detect.

### Validation with Upgrade Criteria

After the mode is known, validate it against actual artifact content. Use the detailed criteria below — if **any** criterion fails, upgrade to `full`.

1. If workflow is `full` → standard routing (no fast-path)
2. If workflow is `hotfix`:
   - Validate against hotfix constraints:
     - [ ] 2 or fewer files changed
     - [ ] No new modules or new public API introduced
     - [ ] No database schema changes
     - [ ] No architectural changes (no new interfaces, no new dependencies)
     - [ ] Fix scope confined to a single function or module
     - [ ] No cross-module coordination required
   - **All pass** → use hotfix fast-path routing
   - **Any fail** → **upgrade to `full`**, update `.sflow/state.json`, output upgrade reason citing the specific failed criterion
3. If workflow is `tweak`:
   - Validate against tweak constraints:
     - [ ] 4 or fewer files changed
     - [ ] Only config/doc/prompt files (`.md`, `.json`, `.yaml`, `.txt`, `.toml`)
     - [ ] No schema/API/no new modules
     - [ ] Single module scope
     - [ ] 4 or fewer new test cases needed
     - [ ] No config item additions or deletions (value-only changes are OK)
     - [ ] No new capability required
     - [ ] No delta spec impact (existing specs not affected)
   - **All pass** → use tweak fast-path routing
   - **Any fail** → **upgrade to `full`**, update `.sflow/state.json`, output upgrade reason citing the specific failed criterion

### Upgrade Output Format

```
[SFLOW] Preset upgrade: <hotfix|tweak> → full
Reason: <specific criterion that failed>
"<human-readable explanation>"
Routing as full workflow.

### Example

- A one-line fix in `src/lib/utils.ts` with 2 or fewer tasks → infer `hotfix`.
- Updating `README.md` and `CHANGELOG.md` with 4 or fewer tasks → infer `tweak`.
- Adding a new feature with new files, tests, and schema changes → infer `full`.

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

## Routing Rules

### Route to `need-explorer` when:

- the request is still fuzzy
- scope is unclear
- the user is comparing options
- there is no stable change name yet

### Route to `spec-writer` when:

- **Guard check**: Use `contract_validator` to verify the change directory has sufficient artifacts for the `specifying` state
  - If validation fails → BLOCK. Report failures, do not route.
  - If validation passes → proceed.
- the user knows what they want
- planning artifacts are missing or incomplete
- proposal, specs, design, or tasks need to be created or revised

### Route to `contract-builder` when:

- **Guard check**: Use `contract_validator` to verify the change directory has sufficient artifacts for the `bridging` state
  - If validation fails → BLOCK. Report failures, do not route.
  - If validation passes → proceed.
- planning artifacts exist
- implementation is requested or about to begin
- the execution contract is missing or stale
- planning artifacts changed after the last contract draft

### Route to `build-executor` when:

- **Guard check**: Use `contract_validator` to verify the change directory has sufficient artifacts for the `approved-for-build` state
  - If validation fails → BLOCK. Report failures, do not route.
  - If validation passes → proceed.
- `execution-contract.md` exists
- the user has explicitly approved it
- implementation is the active task
- the contract still matches the current planning artifacts

### Route to `bug-investigator` when:

- execution is in the `executing` state but has hit a blockage
- a test failure, unexpected behavior, or build error has stopped progress
- the build-executor reports a task cannot proceed
- the user reports a bug during active implementation

After debugging completes, route back to `build-executor` to resume the executing state.

### Route to `code-reviewer` when:

- an execution batch has been completed
- the build-executor has finished a group of related tasks
- a full batch is ready for spec-compliance and code-quality verification
- the user asks for a review checkpoint

### Route to `release-archivist` when:

- **Guard check**: Use `contract_validator` to verify the change directory has sufficient artifacts for the `closing` state
  - If validation fails → BLOCK. Report failures, do not route.
  - If validation passes → proceed.
- implementation is complete
- verification is complete or nearly complete
- the user wants a final summary, archive, or wrap-up

### Route to `spec-merger` when:

- release-archivist reports delta specs exist that need merging
- the change is closing and has ADDED/MODIFIED/REMOVED/RENAMED specs
- multiple changes have accumulated unsynced delta specs
- the user asks about spec consistency

### Route to `abandonment` when:

- the user explicitly requests to abandon the change
- bug-investigator has escalated after 3+ consecutive fix failures AND the user chooses to abandon
- scope change during specifying makes the change no longer worthwhile AND the user confirms abandonment
- the current state is NOT `closing` or `abandoned` (terminal states block abandonment transition)

### Hotfix Fast-Path Routing

When workflow is `hotfix`:
- Route to `contract-builder` with minimal contract mode (intent + task list only)
- Skip `need-explorer` and full `spec-writer`
- Use `contract_validator` with hotfix mode
- After bridge: DP-3 契约批准
- After approval: route to `build-executor` (inline mode)
- After execution: route to `release-archivist` (lightweight closure)

### Tweak Fast-Path Routing

When workflow is `tweak`:
- Route directly to `build-executor` (direct edit mode)
- Skip `need-explorer`, `spec-writer`, and `contract-builder`
- Use `contract_validator` with tweak mode
- After execution: route to `release-archivist` (lightweight closure: file exists + syntax check)

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

## Guardrails

- Do not allow implementation before planning artifacts exist.
- Do not allow implementation before `execution-contract.md` exists.
- Do not treat "continue" as permission to skip state inspection.
- Do not allow continued implementation if scope or core behavior changed without artifact updates.
- If the user is in `executing` but the contract is stale, route backward to `contract-builder`.
- Do not allow implementation to continue past a bug without `bug-investigator` investigation.
- Do not move from execution batches to closure without code review first.
- Do not close a change with unsynced delta specs without routing to `spec-merger`.
- If the detected state is `debugging`, ensure `bug-investigator` completes before routing back.
- If the user asks to skip a review gate, explain why the gate exists and ask for confirmation.
- Do not allow any state transitions FROM `abandoned` — it is a terminal state.
- Do not allow transition to `abandoned` from `closing` or `abandoned` — these are already terminal.
- Do not auto-abandon without user confirmation — even if bug-investigator recommends it.
- When transitioning to `abandoned`, prompt for abandonment summary generation before confirming.
- Do not merge delta specs from an abandoned change — spec-merger must block this.

## Output Standard

Your response should always make three things explicit:

1. current detected state
2. why that state was chosen (cite the specific file, content, or condition that determined the state)
3. which skill should run next

If transition blocking is required, explain the missing artifact or approval clearly.

If content-level inspection was performed, include a brief note on what was compared (e.g., "Compared proposal scope (3 capabilities) against contract intent lock (2 capabilities) — contract is stale").

### Decision Point References

When routing to a skill that has an associated decision point, include the decision point number in the output:
- Route to contract-builder → include `DP-3: 契约批准 — 用户需明确批准 execution-contract.md`
- Route to build-executor → include `DP-4: 执行模式选择 — 用户选择 TDD 或 SDD`
- Route to bug-investigator (escalation) → include `DP-5: 调试升级`
- Route to release-archivist → include `DP-7: 归档确认`

## Preferred User Experience

- Keep the user on one visible workflow.
- Avoid making them choose between upstream mental models.
- Treat OpenSpec ideas as planning inputs and Superpowers ideas as execution discipline, but keep `sflow` as the only workflow owner.
