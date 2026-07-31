# Runtime Preset Upgrade Check

During execution, if the workflow is `hotfix` or `tweak`, continuously monitor scope. If any task execution exceeds preset constraints, **upgrade to `full`**:

## hotfix → full

Upgrade if any condition met during execution:
- Task modifies 3+ files
- Task introduces a new module, new interface, or new dependency
- Task changes database schema
- Task creates a new public API
- Task scope exceeds a single function/module
- Cross-module coordination becomes necessary

## tweak → full

Upgrade if any condition met during execution:
- Task modifies 5+ files
- Task requires cross-module coordination
- Task needs 5+ new test cases
- Task adds or removes config items (not just value changes)
- Task requires new capability not in original scope
- Task impacts existing specs (delta spec needed)

## Upgrade Procedure

1. Output: `[SFLOW] Runtime preset upgrade: <hotfix|tweak> — <reason>`
2. Update `.flow-engine/sflow/state.json`: set `mode` to `full`
3. If in hotfix fast-path: route back to `contract-builder` to create proper execution contract
4. If in tweak direct-edit mode: pause and ask user to confirm full workflow with proper planning artifacts
5. Record the upgrade in `.flow-engine/sflow/progress.md`
