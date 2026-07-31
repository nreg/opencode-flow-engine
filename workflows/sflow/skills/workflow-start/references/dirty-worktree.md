# Dirty Worktree Protocol

When resuming or continuing in a change directory that may have uncommitted work, follow this protocol. This protocol defines how to detect, attribute, and handle uncommitted changes before advancing state or modifying code.

## Key Rule

A dirty worktree is code evidence only — it does not automatically advance `.flow-engine/sflow/state.json` state. Attribution must happen first.

## Detection

1. Run `git status --porcelain` to detect uncommitted changes
2. If the worktree is clean, proceed normally
3. If the worktree is dirty, continue to attribution

## Attribution

For each uncommitted change:

1. Check if the change matches a task in `tasks.md`
2. Check if the change is tracked in `.flow-engine/sflow/progress.md`
3. Check if the change is part of an active execution batch

### If change is attributed:

- The change is part of active work → proceed with execution recovery
- Update progress tracking if needed

### If change is unattributed:

- Prompt the user: "Found uncommitted changes that don't match any active task. What should I do?"
- Options:
  1. Attribute to a specific task
  2. Create a new task for these changes
  3. Discard the changes
  4. Abort and let user resolve manually

## Handling

After attribution:

1. Update `.flow-engine/sflow/progress.md` with attributed changes
2. Verify state consistency
3. Resume workflow from the correct state

## Guard

Do not advance state based solely on dirty worktree. Always perform attribution first.
