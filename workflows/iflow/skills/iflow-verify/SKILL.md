---
name: iflow-verify
description: IFlow verifying state. Adversarial goal-backward verification — assume goal NOT achieved until codebase evidence proves it. BLOCKER/WARNING classification, 4-level artifact check.
---

# IFlow Verify

Invoke this skill when IFlow is in the **verifying** state. The goal is to verify that the phase goal is actually achieved in the codebase — SUMMARY.md claims are not evidence. Task completion ≠ Goal achievement.

## When to Use

- Execution is complete with SUMMARY.md generated
- Quality check needed before shipping
- Re-verification after fix cycle
- Before any milestone or release

## Critical Mindset

**FORCE stance**: Assume the phase goal was NOT achieved until codebase evidence proves it.

**Common failure modes** (avoid these):
1. **Trusting SUMMARY.md** — reading bullet points without reading actual code files
2. **Existence = implementation** — a stub file satisfies existence but not behavior
3. **UNCERTAIN over FAILED** — when absence of implementation is observable, call it FAILED
4. **Completion bias** — letting high task-completion % bias judgment toward PASS
5. **Anchoring** — giving less scrutiny to later truths after early ones passed

## Entry Conditions

- `.flow-engine/iflow/PLAN.md` and `.flow-engine/iflow/SUMMARY.md` exist
- State is `"verifying"`
- Previous state was `"executing"` (or re-verification after gaps_found)

## Exit Conditions

- VERIFICATION.md generated with findings
- **Branch: passed** — transition to **shipping** state
- **Branch: gaps_found** — transition to **executing** state (re-execute fixes)
- All BLOCKER issues resolved or escalated

## Process

### Step 0: Check for Previous Verification
Read `.flow-engine/iflow/VERIFICATION.md` if exists. If re-verifying, focus on previously failed items (quick regression check on passed items).

### Step 1: Establish Must-Haves
Derive from:
1. CONTEXT.md goals (non-negotiable contract)
2. PLAN.md success criteria (adds plan-specific detail)
3. **Fallback**: Derive from phase goal (3-7 observable truths)

### Step 2: 4-Level Artifact Check

| Level | Check | Tool |
|-------|-------|------|
| **1: EXISTS** | Does the file exist? | `test -f` |
| **2: SUBSTANTIVE** | Not a stub. Meaningful content? | `wc -l`, grep for TODO/FIXME/placeholder |
| **3: WIRED** | Imported and used by other code? | `grep -r "import.*$file"` + `grep -r "$file"` (non-import) |
| **4: DATA_FLOW** | Data actually flows through? | Trace state variable → fetch/query → API endpoint |

Artifact Status: VERIFIED / HOLLOW (wired but data disconnected) / ORPHANED (exists but not used) / STUB / MISSING

### Step 3: Key Link Verification (5 patterns)
80% of stubs hide here:
- **Component → API**: `fetch('/api/...')` with await/.then
- **API → Database**: prisma/db query with result returned
- **Form → Handler**: `onSubmit` with fetch/axios
- **State → Render**: useState variable rendered in JSX
- **Hook → Effect**: useEffect with data fetch inside

### Step 4: Anti-Pattern Scanning
Check for: TODO, FIXME, placeholder, `return null`, `return []`, `console.log` in production code, empty props at call site (`<Component items={[]} />`)

### Step 5: Determine Status

| Condition | Status |
|-----------|--------|
| Any truth FAILED, artifact MISSING/STUB, link NOT_WIRED | **gaps_found** |
| All truths VERIFIED but has human-verification items | **human_needed** |
| All truths VERIFIED, all links WIRED, no blockers, no human items | **passed** |

## Classification

- **BLOCKER**: Must-have truth FAILED — goal not achieved, must not proceed to shipping
- **WARNING**: Must-have UNCERTAIN or artifact exists but wiring incomplete

## Stub Detection

**React**: `return <div>Component</div>`, `return null`, `onClick={() => {}}`
**API**: `return { message: "Not implemented" }`, `Response.json([])` without DB query
**Wiring**: `fetch(...)` without await/.then, `useState([])` declared but never rendered

## Common Pitfalls

- **Overriding gaps**: Only use overrides when alternative implementation achieves the same goal
- **Missing wiring check**: Files exist + have content but aren't connected → phase failed
- **Under-verifying tests**: Test exists but tests wrong behavior or doesn't test at all
- **Accepting human verification too easily**: Only flag truly human-checkable items (visual, real-time, external service)

## State Transition Detection

- **→ shipping**: VERIFICATION.md status is `"passed"` → route to iflow-shipper
- **→ executing**: VERIFICATION.md status is `"gaps_found"` → route to iflow-plan-executor for re-execution

## VERIFICATION.md Format

Generated with YAML frontmatter containing: phase, verified timestamp, status (passed/gaps_found/human_needed), score, gaps[], deferred[], human_verification[]. Body contains markdown tables for: Observable Truths, Required Artifacts, Key Links, Data-Flow Trace, Anti-Patterns.

## Matching Agent Prompt

This skill complements `iflow-verifier.ts` prompt (443 lines). The agent prompt contains the complete Adversarial Stance, Verification Process (10 steps), 4-Level Artifact Check, Data-Flow Trace, Key Link Verification patterns, Anti-Pattern Scanning, and VERIFICATION.md format specification.

## Tools

- `call_flow_agent` with `subagent_type="iflow-verifier"` (for verification)
