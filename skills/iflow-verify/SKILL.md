---
name: iflow-verify
description: IFlow verifying state. Adversarial verification with goal-backward analysis, BLOCKER/WARNING classification, and 3-level artifact check.
---

# IFlow Verify

Invoke this skill when IFlow is in the **verifying** state. The goal is to verify that the phase goal is actually achieved in the codebase — SUMMARY.md claims are not evidence.

## When to Use

- Execution is complete with SUMMARY.md
- Quality check needed before shipping
- Re-verification after fixes

## Process

1. **Establish Must-Haves**: Derive from phase goal (truths, artifacts, key links)
2. **Verify Truths**: For each truth, check if codebase enables it
3. **3-Level Artifact Check**: Exists → Substantive → Wired
4. **Classify Issues**: BLOCKER (must fix) or WARNING (should note)
5. **Output**: VERIFICATION.md with findings and verdict

## Entry Conditions

- .flow-engine/iflow/SUMMARY.md exists
- State is "verifying"

## Exit Conditions

- VERIFICATION.md generated
- All BLOCKER issues resolved
- Transition to **shipping** (pass) or **executing** (fail)

## Tools

- `call_flow_agent` with subagent_type="iflow-verifier"