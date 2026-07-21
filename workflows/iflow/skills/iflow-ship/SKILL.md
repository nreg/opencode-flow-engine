---
name: iflow-ship
description: IFlow shipping state. Create PR with auto-generated body, generate UAT.md, manage branch lifecycle, and prepare for next iteration cycle.
---

# IFlow Ship

Invoke this skill when IFlow is in the **shipping** state. The goal is to ship the completed work: push branch, create PR with structured body, generate UAT.md, and close the iteration loop.

## When to Use

- Verification passed with "passed" or "human_needed" status (user confirms)
- Ready to deliver completed work to the repository
- Closing the current iteration cycle before starting the next

## Entry Conditions

- `.flow-engine/iflow/VERIFICATION.md` exists with status `"passed"` or `"human_needed"` (user confirmed)
- State is `"shipping"`
- All code changes are committed
- Working tree is clean (no uncommitted changes)

## Exit Conditions

- PR created with auto-generated body
- UAT.md generated in `.flow-engine/iflow/`
- Branch pushed to remote
- Return to **discussing** state for next iteration

## Process

### Step 1: Preflight Checks (All 5 Mandatory)

| Check | What to Run | Pass/Fail |
|-------|-------------|-----------|
| **1. Verification** | Read VERIFICATION.md frontmatter — status must be `passed` or `human_needed` | ❌ If `gaps_found`: WARN user, ask for confirmation |
| **2. Clean working tree** | `git status --short` — must be empty | ❌ Uncommitted changes: ask user to commit/stash |
| **3. Correct branch** | `git branch --show-current` — must be feature branch, not main | ❌ On main: warn user |
| **4. Remote configured** | `git remote -v` — origin must exist | ❌ No remote: cannot create PR |
| **5. gh CLI available** | `which gh && gh auth status` | ⚠️ Not available: proceed with manual PR instructions |

### Step 2: Generate PR Body

Auto-generated with 6 sections:

1. **Summary**: Phase name, goal, verification status
2. **Changes**: From SUMMARY.md — key files created/modified
3. **Requirements**: REQ-IDs from plan frontmatter
4. **Verification**: PASS/FAIL from VERIFICATION.md + human UAT items
5. **Key Decisions**: From CONTEXT.md locked decisions (D-IDs)
6. **Checklist**: Tasks completed / Deviations documented / Verification passed / UAT.md generated

### Step 3: Generate UAT.md

Document acceptance criteria with PASS/FAIL results:
```markdown
# UAT: [Feature Name]

## Acceptance Criteria
- [ ] Criterion 1: description — PASS/FAIL
- [ ] Criterion 2: description — PASS/FAIL

## Test Results
| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| Happy path | ... | ... | PASS |

## Sign-off
- [ ] All acceptance criteria met
- [ ] No known blockers
- [ ] Ready for merge
```

### Step 4: Create PR

```bash
gh pr create \
  --title "Phase ${N}: ${NAME}" \
  --body "${PR_BODY}" \
  --base ${BASE_BRANCH}
```

If `gh` CLI unavailable: push branch manually, provide PR body template for user.

### Step 5: Track and Report

After creating PR:
1. Report: PR URL, branch name, commit count
2. Update `.flow-engine/iflow/STATE.md` with shipping status
3. Offer user options: Review PR / Request Review / Merge when ready / **Continue iteration**

## Preflight Failure Handling

| Failure | Action |
|---------|--------|
| Verification gaps_found | WARN user. If user confirms shipping anyway, note in PR body: "Shipped with unresolved gaps" |
| Dirty working tree | "Uncommitted changes detected. Please commit or stash before shipping." |
| On main branch | "You're on main. Feature branches required for PR. Create one with `git checkout -b feat/xxx`" |
| gh CLI unavailable | Proceed with manual PR instructions. Provide PR body template text. |

## After Shipping

### Report Format
```
───────────────────────────────────────────

## ✓ Phase {X}: {Name} — Shipped

PR: #{number} ({url})
Branch: {branch} → {base_branch}
Commits: {count}
Verification: ✓ Passed

Next steps:
- Review/approve PR
- Merge when CI passes
- Return to discuss for next iteration

───────────────────────────────────────────
```

### Transition
Return to **discussing** state by updating state.json:
```bash
# Update .flow-engine/iflow/STATE.md
Last Activity: YYYY-MM-DD
Status: Phase N shipped — PR #NNN
```

## Common Pitfalls

- **Skipping preflight checks**: Always run all 5 checks. Shipping with gaps or dirty tree causes confusion.
- **PR without context**: PR body must tell reviewers WHAT was done and WHY. Don't just list files.
- **gh CLI dependency**: Don't fail if gh unavailable — provide manual instructions.
- **Missing UAT.md**: UAT.md documents acceptance criteria for human testers. Always generate it.
- **Forgetting to iterate**: After shipping, explicitly offer "Continue iteration" as the next step.

## Matching Agent Prompt

This skill complements `iflow-shipper.ts` prompt (252 lines). The agent prompt contains the complete Ship Process, Preflight Checks (5 checks with bash commands), PR Body Format (6 sections), and After Shipping guidance.

## Tools

- `call_flow_agent` with `subagent_type="iflow-shipper"` (for shipping operations)
