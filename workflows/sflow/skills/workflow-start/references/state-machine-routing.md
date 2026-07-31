# State Machine Routing

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

## Auto-Transition & State Repair

On every context resume, do **NOT** trust conversation history. Always re-run full inspection from scratch.

### State ↔ Artifact Consistency Check

After reading `.flow-engine/sflow/state.json` and inspecting artifacts, check for mismatches:

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
3. Update `.flow-engine/sflow/state.json` with the corrected state via the state-transition hook
4. Continue with normal routing using the **corrected** state
5. If the repair transitions **backward** (e.g., `executing` → `bridging`), warn the user: "Scope change detected — artifacts no longer match implementation state. Routed back to `<state>`."

### Stale State Detection

Treat state as stale and repair when:

- `state: executing` but `.flow-engine/sflow/progress.md` shows all tasks complete → repair to `closing`
- `state: approved-for-build` but `tasks.md` has unchecked tasks AND `.flow-engine/sflow/progress.md` shows active execution → repair to `executing`
- `state: bridging` but `execution-contract.md` content hash differs from `contract_hash` in state.json → re-validate contract for staleness
- `state: specifying` but `proposal.md` has been updated since `last_transition` timestamp → re-check artifact completeness
- `state: executing` but worktree has no uncommitted changes and no progress entries for > 10 minutes → unclear state, prompt user

After repairing, always re-run the routing rules from the corrected state.
