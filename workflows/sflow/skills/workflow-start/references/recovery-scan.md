# Recovery Scan

## Overlay Recovery Scan

On context resume, scan for overlay recovery indicators:

- Handoff markers in `.flow-engine/sflow/handoff.json`
- Checkpoint files in `.flow-engine/sflow/checkpoints/`
- Session resumption tokens in state

If overlay recovery is detected:
1. Load the recovery context
2. Verify the recovery point is still valid
3. Resume from the recovery point with full context

## Execution-Control Recovery Scan

On context resume, scan for execution-control recovery:

- In-progress tasks in `.flow-engine/sflow/progress.md`
- Uncommitted changes in the worktree (see `dirty-worktree.md`)
- Active execution locks

If execution-control recovery is detected:
1. Verify the execution state is still valid
2. Check for stale locks or abandoned executions
3. Resume execution or prompt user for resolution

## Recovery Priority

1. Overlay recovery takes precedence over execution-control recovery
2. If both are present, resolve overlay first, then execution-control
3. Always validate recovery points before resuming
