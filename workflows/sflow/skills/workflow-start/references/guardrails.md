# Guardrails

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
