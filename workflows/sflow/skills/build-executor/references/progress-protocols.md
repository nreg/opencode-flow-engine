# Progress Protocols

## LESSONS Knowledge Base Check (Cross-Task Failure Prevention)

> Inspired by flow-kit LESSONS.md (R1.8). Every task must check `.flow-engine/sflow/lessons.md` before starting implementation.

### Before Each Task

Before dispatching or starting any task implementation:

1. **Check if `.flow-engine/sflow/lessons.md` exists**. If not, create an empty skeleton.
2. **Extract keywords** from the task:
   - File paths mentioned in `write_files` / `read_files`
   - Key nouns from `action` description
   - Programming languages / libraries involved
3. **Grep `.flow-engine/sflow/lessons.md`** with these keywords
4. **For each hit entry (L-NNN)**:
   - If the entry is `status: active` and matches your planned approach → **STOP**
   - Write to task plan: `"已查阅 L-NNN，本次方案与之的差异是 X"` or `"已查阅 L-NNN，本次确认仍适用，因此不重试该方案"`
   - If your approach is identical to a failed approach → trigger anti-repeat protocol below

### On Debug Exit

After bug-investigator completes diagnosis and before transitioning back to executing:

1. If the root cause is non-trivial (>30 min debug time, or likely to recur)
2. Use `.flow-engine/sflow-templates/LESSONS.md` as template
3. Call the `addLesson` method on state-manager to append to `.flow-engine/sflow/lessons.md`
4. Include: tags, title, problem scenario, what was attempted, why it failed, recommended approach, keywords for future grep

---

## Anti-Repeat Protocol (PROGRESS.md)

> Inspired by flow-kit R1.5/R1.6. Prevents repeated failed approaches across context resets.

### When to Write PROGRESS.md

Write a PROGRESS.md snapshot when ANY of these signals trigger:

- Input tokens > 50k
- AI repeats content already said (self-hinting symptom)
- Same error pattern appears ≥ 2 times
- User says the conversation is "spinning"
- Context needs compaction

### What to Include

Write to `.flow-engine/sflow/progress.md` using the template at `.flow-engine/sflow-templates/PROGRESS.md`:

1. **Completed sub-steps**: what's already done
2. **Current state**: exactly what's being worked on
3. **Excluded approaches (已排除的方案)**: ALL approaches tried and failed, with reasons
4. **Pending assumptions**: things that need confirmation
5. **Clues**: file locations, line numbers, discoveries

### On Context Resume (Recovery)

When resuming from a context break:

1. **Read `.flow-engine/sflow/progress.md`** — do NOT trust conversation history
2. **Read the EXCLUDED APPROACHES section** — this is the anti-repeat key
3. **Check your planned next step** against the excluded list:
   - If your step matches an excluded approach → **STOP**
   - You MUST write: "本次与第 N 次失败的差异是 X" — if you cannot, pause and ask the user
4. **If the task is too large** (was interrupted mid-task) → split it into ≥2 sub-tasks in TASK.md
5. If clean, resume from the "current state" description

### On Task Completion

After a task passes all reviews:
1. Delete `.flow-engine/sflow/progress.md`
2. Move task summary to `SUMMARY.md`

---

## Task Too Large Early Signal (R1.7)

> Inspired by flow-kit R1.7. When a task triggers context compaction mid-execution, it means the task was not decomposed finely enough.

### Detection Signal

If **any** of these occur during a single task execution:
- Input tokens > 50k
- AI repeats content already said (self-hinting symptom)
- Same error pattern appears ≥ 2 times
- User says the conversation is "spinning"

### Recovery Procedure

When resuming from context compaction:

1. **Do NOT continue the task as-is**
2. **Read `.flow-engine/sflow/progress.md`** to understand where you stopped
3. **Split the current task in `tasks.md`** into ≥ 2 sub-tasks:
   - Use the original task ID with suffix: `<task-id>-1`, `<task-id>-2`, etc.
   - Each sub-task must be completable within a single context window
   - Preserve the original task's `read_files` and `write_files` boundaries
4. **Update `.flow-engine/sflow/subagent-progress.md`** to reference the new sub-task
5. **Resume from the first incomplete sub-task**

### Example Split

Original task:
```
T03 - Implement authentication flow
```

After split:
```
T03-1 - Create login form component (depends on: T02)
T03-2 - Add form validation logic (depends on: T03-1)
T03-3 - Connect to auth API (depends on: T03-2)
T03-4 - Add error handling and loading states (depends on: T03-3)
```

### Why This Matters

- Prevents the same task from triggering compaction repeatedly
- Each sub-task can complete within a single context window
- Progress is preserved across compactions via PROGRESS.md
