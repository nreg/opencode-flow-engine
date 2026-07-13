---
name: iflow-verify
description: IFlow verifying state. Adversarial verification with goal-backward analysis, BLOCKER/WARNING classification, and 4-level artifact check.
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
3. **4-Level Artifact Check**: Exists → Substantive → Wired → Data Flow
4. **Classify Issues**: BLOCKER (must fix) or WARNING (should note)
5. **Output**: VERIFICATION.md with findings and verdict

## Entry Conditions

- .iflow/SUMMARY.md exists
- State is "verifying"

## Exit Conditions

- VERIFICATION.md generated
- All BLOCKER issues resolved
- Transition to **shipping** (pass) or **executing** (fail)

### State Transition Detection

- **Branch: passed** — VERIFICATION.md status is "passed" → transition to **shipping** state
- **Branch: gaps_found** — VERIFICATION.md status is "gaps_found" → transition to **executing** state (re-execute)
- **Auto-route suggestion**: Route based on verification result — passed → iflow-ship, gaps_found → iflow-execute

## Tools

- `call_flow_agent` with subagent_type="iflow-verifier"