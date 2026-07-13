---
name: iflow-execute
description: IFlow executing state. Execute PLAN.md tasks with Deviation Rules, checkpoints, complexity validation, atomic commits, and SUMMARY.md generation.
---

# IFlow Execute

Invoke this skill when IFlow is in the **executing** state. The goal is to execute plan tasks atomically, handle deviations automatically, pause at checkpoints, and produce structured output.

## When to Use

- PLAN.md exists and is ready for execution
- Continuing interrupted execution (Pattern C — resume from git history)
- Re-executing after verification failure (gaps_found → re-execute)

## Entry Conditions

- `.iflow/PLAN.md` exists and is validated
- State is `"executing"`
- PLAN.md passes Nyquist Rule (every task has `<automated>` verification)

## Exit Conditions

- All tasks completed with atomic commits
- Deviations documented in SUMMARY.md
- SUMMARY.md generated with completion status and commit hashes
- Transition to **verifying** state (or back to **planning** if overload detected)

## Process

### Step 1: Load and Validate Plan
1. Read `.iflow/PLAN.md` — parse frontmatter + task list
2. **Pre-execution complexity check**: For each task, validate its Complexity/Score field
3. Load project context: read `./AGENTS.md` if exists for project-specific rules

### Step 2: Apply Complexity Overload Protection

| Planned Level | Executor Action |
|---------------|----------------|
| **XL** (16+) | REJECT. Return `[IFLOW-OVERLOAD]` — must be split, route back to discuss-planner |
| **L** (11-15) | WARN with `[IFLOW-COMPLEXITY]`. Insert mid-task checkpoint after ~50% of actions |
| **M** (6-10) | Execute normally. Insert checkpoint at module boundaries if cross-module |
| **S** (1-5) | Execute normally — no extra gating |

If actual complexity exceeds planned by 2+ levels → STOP, emit `[IFLOW-COMPLEXITY-DRIFT]`

### Step 3: Execute Tasks with Deviation Rules

Apply these rules automatically (no user permission needed for Rules 1-3):

| Rule | Trigger | Action | Example |
|------|---------|--------|---------|
| **R1** | Code doesn't work | Fix inline + tests | API returns 500 → fix error handling |
| **R2** | Missing critical functionality | Add without asking | No input validation → add validation |
| **R3** | Blocking issues | Fix inline | Broken import → fix path |
| **R4** | Architectural change | **STOP — ask user** | Need new DB table → ask before creating |

**Rule Priority**: R4 > R5 (complexity overload) > R1-R3

### Step 4: Atomic Commits
- **Per-task commits**: Each task gets its own atomic commit
- **Individual staging**: `git add <specific-files>`, NEVER `git add .`
- **Format**: `{type}({scope}): {description}`
- **Types**: feat / fix / test / refactor / docs

### Step 5: Checkpoint Protocol

| Pattern | When | Behavior |
|---------|------|----------|
| **A: Autonomous** | No checkpoints marked | Execute all tasks, create SUMMARY.md, return |
| **B: Has checkpoints** | `type: checkpoint` in task | Stop at checkpoint, return `[CHECKPOINT REACHED]` |
| **C: Continuation** | Resuming | Scan git log for task commits, skip completed, start from first pending |

### Step 6: Generate SUMMARY.md

Format:
```markdown
# Summary: [Phase Name]

## Completed Tasks
- [Task 1]: ✅ [commit hash]
- [Task 2]: ✅ [commit hash]

## Deviations
- [Rule N - Type]: Description of deviation

## Verification
- [ ] All tests pass
- [ ] No regressions
- [ ] Code review ready
```

## Common Pitfalls

- **git add .**: NEVER use this. Stage files one by one per task.
- **Partial commits**: If a task modifies 5 files but you commit 3, the commit is incomplete.
- **Silent deviations**: Applying Rule 2 (auto-add) without documenting in SUMMARY.md.
- **Checkpoint skipping**: When a task has `type: checkpoint`, you MUST stop. Don't auto-approve.
- **Not verifying AGENTS.md**: If project has AGENTS.md, its rules override plan defaults.

## Anti-Patterns to Avoid

- **Scope creep**: Deviation Rules allow bug fixes, not feature additions. Don't add unplanned features.
- **Premature optimization**: Don't optimize code that works. Fix what's broken, not what might break.
- **Over-engineering**: Implement what the plan says, not what you think it should say.
- **Skipping verification**: After each task, run the `<automated>` verification command.

## State Transition Detection

- **Trigger**: All tasks completed AND SUMMARY.md generated
- **→ verifying**: Standard path. Route to iflow-verifier.
- **→ planning**: If complexity overload detected. Route back to iflow-discuss-planner.

## Matching Agent Prompt

This skill complements `iflow-plan-executor.ts` prompt (260 lines). The agent prompt contains the full Complexity Overload Protection, Deviation Rules, Checkpoint Protocol, Atomic Commit Discipline, AGENTS.md Enforcement, and Threat Model Cross-Reference. This skill provides the concise contextual reference.

## Tools

- `call_flow_agent` with `subagent_type="iflow-plan-executor"` (for task execution)
