# Archive Procedure

## Final Checks

- Are required tests passing? (cite the command and output)
- Are execution batches complete? (cite batch-by-batch status)
- Was any scope added without artifact updates? (cite specific files if yes)
- Are there unresolved blockers or known risks?
- Is the change ready to archive, or should it remain active?
- Do delta specs exist that need merging into main specs?
- Has `artifact_inspector` been run? If not, run it now and include the decision-point audit in the archive.

## Archive Rule

Do not archive blindly.

If implementation diverged from the contract, return to `bridging` before closure.

## Post-Verification Routing

After verification completes:

1. Update `.flow-engine/sflow/state.json` with `state: closing` and record the transition timestamp
2. If delta specs were created, route to `spec-merger` before final archiving
3. If no delta specs exist, the change is ready to archive

The closure is not complete until delta specs are merged. Specs that aren't synced become lies.

## Output Standard

Your response should include:

1. verification evidence (command run, output excerpt, exit code)
2. contract obligation status (which passed, which didn't)
3. delivered behavior summary
4. residual risks
5. delta spec status (exist or not)
6. recommended routing (to `spec-merger` or archive)

## Lightweight Closure (hotfix/tweak mode)

When workflow is `hotfix` or `tweak`, release-archivist performs lightweight verification:
1. Verify all changed files exist and are non-empty
2. Run syntax check on code files (`node --check` for .mjs/.js)
3. Skip the full 5-step three-dimensional verification
4. Still record DP-6 (验证失败) and DP-7 (归档确认) decision points
5. Delta specs are NOT generated in lightweight closure (no specs to sync)
