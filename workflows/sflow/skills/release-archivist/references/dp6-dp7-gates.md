# DP-6/DP-7 Decision Gates

## Decision-Point Audit Report

Before final closure, use `artifact_inspector` to verify the change directory's planning artifacts for completeness and consistency.

This generates a decision-point audit from `.flow-engine/sflow/state.json`. Include this report in the archive so the full decision history is preserved.

- If the audit report is missing, prompt the user to run `artifact_inspector` before DP-7 confirmation.
- The audit is read-only and safe to run multiple times.

## DP-6: Verification Failure Gate

When verification fails:
1. Record decision point: `record_decision_point(dp-6, executing, debugging, "verification failed")`
2. Route back to `debugging` state
3. Do NOT proceed to closing until verification passes

## DP-7: Archive Confirmation Gate

When verification passes:
1. Run `artifact_inspector` to generate decision-point audit
2. Present verification report to user
3. Await explicit user confirmation: "确认归档" or "archive confirmed"
4. Record decision point: `record_decision_point(dp-7, closing, closed, "archive confirmed by user")`
5. Record `test_result: pass` in state.json
6. Proceed to archive

## Closing Terminal State Semantics

The `closing` state is a terminal state that finalizes while executing:
- All verification must pass before entering closing
- Delta specs must be merged (or confirmed not needed)
- Decision-point audit must be complete
- User must explicitly confirm archive

Direct Short-Path Closure:
- **Quick**: Skip full verification, use lightweight checks
- **Tweak**: Direct edit, minimal verification
- **Hotfix**: Emergency fix, lightweight verification + immediate archive
