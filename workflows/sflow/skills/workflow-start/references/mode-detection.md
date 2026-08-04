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

## Path-Aware Quick Mode Detection (Two-Stage Judgment)

### Overview

The path-aware quick mode detection extends the existing quick mode logic with a two-stage judgment mechanism. This enables safe threshold relaxation for low-risk changes (tests, docs) while preserving the existing fallback for ambiguous or high-risk work.

### Stage ①: Relaxed Threshold (Path Whitelist + Exclusion Checks)

**Conditions for relaxed threshold (file≤10 && task≤8):**
1. **All affected paths are whitelisted**: All paths must match one of the whitelist prefixes:
   - `tests/` — Test files and test utilities
   - `docs/` — Documentation files
   - `test-support/` — Test support files (fixtures, mocks, etc.)

2. **All 9 exclusion checks pass (value = 'yes')**:
   - `production_behavior`: Does NOT affect production behavior
   - `public_boundary`: Does NOT cross public API boundaries
   - `installer`: Does NOT involve installer scripts
   - `state_machine`: Does NOT modify state machine logic
   - `external_side_effect`: Does NOT have external side effects
   - `data_permission_config_semantics`: Does NOT alter data permission or config semantics
   - `expected_behavior_clear`: Expected behavior IS clear and well-defined
   - `verification_reproducible`: Verification CAN be reproduced reliably
   - `impact_paths_complete`: All impact paths ARE identified and complete

**If both conditions are met:**
- Apply relaxed threshold: `file_count ≤ 10 && task_count ≤ 8`
- Recommend `quick` mode
- Ask user to confirm `verification_strategy` before proceeding

### Stage ②: Fallback to Existing Threshold

**Fallback conditions (any of the following):**
- At least one path is NOT whitelisted (e.g., `src/`, `lib/`, root files)
- At least one exclusion check is `'no'` or `'unknown'`
- File count exceeds relaxed threshold (> 10)
- Task count exceeds relaxed threshold (> 8)

**If fallback is triggered:**
- Use existing threshold: `task_count ≤ 3 && file_count ≤ 3`
- Apply standard mode detection logic

### Path Normalization Rules

**Rejected paths (treated as non-whitelisted):**
- Absolute paths (e.g., `/home/user/repo/src/foo.ts`, `C:\repo\src\foo.ts`)
- Parent traversal paths (e.g., `../scripts/setup.sh`)
- Empty or null paths

**Valid paths:**
- Repository-relative paths without `..` traversal
- Example: `tests/unit/foo.test.ts`, `docs/guide.md`, `test-support/fixtures/data.json`

### Exclusion Check Inference Guidelines

When delegating to the `explore` subagent to survey the 9 exclusion checks:

1. **production_behavior**: Check if the change affects runtime behavior in production
   - Test-only changes → `'yes'`
   - Doc-only changes → `'yes'`
   - Source code changes → `'no'` (unless proven otherwise)

2. **public_boundary**: Check if the change crosses public API boundaries
   - Private/internal changes → `'yes'`
   - Public API changes → `'no'`

3. **installer**: Check if the change involves installer scripts
   - No installer changes → `'yes'`
   - Installer script modifications → `'no'`

4. **state_machine**: Check if the change modifies state machine logic
   - No state machine changes → `'yes'`
   - State machine modifications → `'no'`

5. **external_side_effect**: Check if the change has external side effects
   - No external side effects → `'yes'`
   - External side effects (network, file I/O, etc.) → `'no'`

6. **data_permission_config_semantics**: Check if the change alters data permission or config semantics
   - No permission/config changes → `'yes'`
   - Permission/config changes → `'no'`
   - **Default**: `'no'` (user must explicitly confirm)

7. **expected_behavior_clear**: Check if the expected behavior is clear and well-defined
   - Clear requirements → `'yes'`
   - Ambiguous requirements → `'no'`

8. **verification_reproducible**: Check if the verification can be reproduced reliably
   - Deterministic tests → `'yes'`
   - Non-deterministic tests → `'no'`

9. **impact_paths_complete**: Check if all impact paths are identified and complete
   - All paths identified → `'yes'`
   - Incomplete path analysis → `'no'`

### Degradation Conditions

The system will degrade from Stage ① to Stage ② if:

1. **Path whitelist violation**: Any affected path is not under `tests/`, `docs/`, or `test-support/`
2. **Exclusion check failure**: Any of the 9 exclusion checks returns `'no'` or `'unknown'`
3. **Threshold exceeded**: File count > 10 or task count > 8
4. **Risk signals present**: Any risk signal (schema change, new module, etc.) takes precedence

### Backward Compatibility

- If `affected_paths` and `exclusion_checks` are not provided, the system uses the existing threshold logic (`task≤3 && file≤3`)
- Existing tests and behavior are preserved
- No new workflow mode (`lightweight`) is introduced
