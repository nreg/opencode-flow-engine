# File Boundary Control (read_files / write_files)

> Inspired by flow-kit B3 brownfield safety rail (R7.3 / R6.5). Prevents scope drift by enforcing strict file boundaries per task.

## Task Boundary Fields

Each task in the execution contract MUST include two boundary fields:

- **read_files**: Files/directories the implementer is ALLOWED to read for context
- **write_files**: Files the implementer is ALLOWED to create or modify

## Task-Level Isolation

File boundaries are checked at the **task level**, not globally. The guard hook:

1. Reads `.flow-engine/sflow/subagent-progress.md` to determine the **active task ID** (e.g., T03)
2. Extracts that task's `write_files` from the execution contract
3. Validates every file write against ONLY that task's boundary

This means **Task A cannot write files belonging to Task B**, even if both are in the same contract. This prevents scope drift between parallel or sequential tasks.

**Format support**: Boundaries can be defined in the contract in multiple formats:

**XML-style task blocks** (preferred — explicit task isolation):
```xml
<!-- Task T01 -->
<write_files>
src/module-a/feature.ts
src/module-a/__tests__/feature.test.ts
</write_files>
<!-- /Task T01 -->

<!-- Task T02 -->
<write_files>
src/module-b/helper.ts
src/module-b/__tests__/helper.test.ts
</write_files>
<!-- /Task T02 -->
```

**Task table** (write_files column):
```
| Task | Description | Dependencies | write_files                  |
|------|-------------|--------------|------------------------------|
| T01  | Add feature | -            | `src/module-a/feature.ts`, `src/module-a/__tests__/` |
| T02  | Add helper  | T01          | `src/module-b/helper.ts`     |
```

**Global write_files** (fallback — no task isolation, applies to all tasks):
```xml
<write_files>
src/components/*
src/utils/*
</write_files>
```

If both task-level and global boundaries exist, the **task-level boundary takes priority**. Global boundaries are only used as fallback when no active task is detected or the task has no explicit write_files.

## Caching

Parsed boundary patterns are **cached in memory** (keyed by contract content hash) to avoid re-reading and re-parsing the contract on every file write. The cache is invalidated automatically when the contract file changes. At most 3 cache entries per change directory are retained (LRU-eviction).

## Implementation Rules

1. **Task brief must include** the read_files and write_files from the execution contract
2. **Before writing any code**, verify the target file is in the task's write_files list
3. **If a needed file is NOT in write_files**:
   - Do NOT modify it — this is scope drift
   - Stop and report: "File X is not in task write_files. Need to either update the task boundary or create a new task."
4. **Before commit**, run boundary verification:
   ```bash
   git diff --name-only
   ```
   Compare against the task's write_files list

## Commit Boundary Enforcement

Before any commit in the progress ledger:

1. Run: `git diff --name-only` (or similar command)
2. Compare against current task's `write_files` list
3. **If boundary violated** (files outside write_files were modified):
   - Report all out-of-bound files
   - Do NOT commit — either:
     a. Roll back the unintended changes
     b. OR escalate to user for scope expansion
4. **Report clean or violated** in the progress checkpoint:
   - `✅ Boundary check: 0 files out of bounds` or
   - `❌ Boundary violation: <files> are not in write_files`

## Example Task Boundary

```
Task: T03 - Add ThemeContext provider
read_files:
  src/theme/*
  src/lib/api-client.ts
  src/utils/storage.ts
write_files:
  src/theme/ThemeContext.tsx
  src/theme/__tests__/ThemeContext.test.tsx
  
Boundary check: Only modify files under src/theme/ and src/theme/__tests__/
```

## Scope Drift Response

If scope drift is detected during execution:

1. **Stop immediately** — do not continue
2. Report which files were changed outside the boundary
3. Offer options:
   - "Update the task boundary to include these files"
   - "Roll back the unintended changes"
   - "Split this into a new task for the out-of-bound files"
4. Do NOT proceed until the user or contract-builder resolves the boundary
