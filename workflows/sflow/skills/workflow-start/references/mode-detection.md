# Mode Detection

Before routing, determine the workflow mode.

## Auto-Detection

If `.flow-engine/sflow/state.json` workflow is `auto`, `null`, or unset:

1. Inspect `proposal.md` scope and `tasks.md` to infer `hotfix`, `tweak`, or `full`.
2. Update `.flow-engine/sflow/state.json` with the inferred `workflow` value.
3. Output the inferred mode and reason to the user.

Inference rules:

- **hotfix**: 2 or fewer tasks, 2 or fewer files, no schema/API changes, no new modules.
- **tweak**: 4 or fewer tasks, only config/doc files (`.md`, `.json`, `.yaml`, etc.), no schema/API changes, no new modules.
- **full**: anything larger, or changes that touch code files, schemas, APIs, or add new modules.

## Explicit Override

If workflow is already set to `hotfix`, `tweak`, or `full`, do **not** overwrite it unless the user explicitly asks to re-detect.

## Validation with Upgrade Criteria

After the mode is known, validate it against actual artifact content. Use the detailed criteria below — if **any** criterion fails, upgrade to `full`.

1. If workflow is `full` → standard routing (no fast-path)
2. If workflow is `hotfix`:
   - Validate against hotfix constraints:
     - [ ] 2 or fewer files changed
     - [ ] No new modules or new public API introduced
     - [ ] No database schema changes
     - [ ] No architectural changes (no new interfaces, no new dependencies)
     - [ ] Fix scope confined to a single function or module
     - [ ] No cross-module coordination required
   - **All pass** → use hotfix fast-path routing
   - **Any fail** → **upgrade to `full`**, update `.flow-engine/sflow/state.json`, output upgrade reason citing the specific failed criterion
3. If workflow is `tweak`:
   - Validate against tweak constraints:
     - [ ] 4 or fewer files changed
     - [ ] Only config/doc/prompt files (`.md`, `.json`, `.yaml`, `.txt`, `.toml`)
     - [ ] No schema/API/no new modules
     - [ ] Single module scope
     - [ ] 4 or fewer new test cases needed
     - [ ] No config item additions or deletions (value-only changes are OK)
     - [ ] No new capability required
     - [ ] No delta spec impact (existing specs not affected)
   - **All pass** → use tweak fast-path routing
   - **Any fail** → **upgrade to `full`**, update `.flow-engine/sflow/state.json`, output upgrade reason citing the specific failed criterion

## Upgrade Output Format

```
[SFLOW] Preset upgrade: <hotfix|tweak> → full
Reason: <specific criterion that failed>
"<human-readable explanation>"
Routing as full workflow.
```

## Example

- A one-line fix in `src/lib/utils.ts` with 2 or fewer tasks → infer `hotfix`.
- Updating `README.md` and `CHANGELOG.md` with 4 or fewer tasks → infer `tweak`.
- Adding a new feature with new files, tests, and schema changes → infer `full`.
