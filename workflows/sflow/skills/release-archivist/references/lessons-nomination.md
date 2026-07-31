# LESSONS Knowledge Base Nomination

> Inspired by flow-kit R1.8 提名条件 + 复核剪枝。Closing 阶段必须扫描本次 change 的所有 SUMMARY.md 和遗留 PROGRESS.md，按条件提名入库。

## Nomination Conditions（满足任一即提名）

- 调试/试错总耗时 > 30 分钟
- 错因不局限于本任务的微细节，其它任务也会撞上
- 未来 6 个月内有合理概率被再次尝试（含其他成员、其他 AI 会话）
- 否决理由不写在 design.md / ADR 里就会丢失

## Nomination Procedure

1. **Scan `.flow-engine/sflow/progress.md`**
   - Read the `excludedApproaches` table
   - Each entry with `failCount >= 1` is a candidate
   - Call `state-manager.addLessonsFromProgress()` to batch-nominate

2. **Scan all task summaries**
   - For each `*-SUMMARY.md` in the change directory
   - Extract sections: "调试过程" / "失败尝试" / "最终方案" / "耗时"
   - If debugging time > 30min or contains failed approaches → candidate

3. **For each candidate**, create a lesson entry with:
   - **Title**: From excluded approach name or failure description
   - **Tags**: Choose from `arch/lib/tool/data/perf/a11y/sec/ux/ops/proc`
   - **Keywords**: File paths + key nouns from the failure
   - **Problem**: What scenario would lead someone to try this approach
   - **Attempted**: The approach that failed
   - **Why Failed**: Specific, quantifiable reason
   - **Recommendation**: Better approach or reference
   - **Status**: `active`

4. **Record nomination in closing report**
   - List all nominated L-NNN entries
   - If none, write `LESSONS nomination: 0 entries (no debugging > 30min or reusable failures)`

## Pruning & Superseding

During closing, also do a lightweight LESSONS.md review:

1. **Check for superseded entries**
   - If a new nominated entry is a strictly better alternative to an existing active entry
   - Mark the old entry: `status: superseded-by:L-NNN`
   - (An entry with `superseded-by` set is logically inactive but not deleted for history)

2. **Check for deprecated entries**
   - If `package.json` / `Dockerfile` / DB schema had a major version change in this change
   - Scan all active LESSONS.md entries
   - For each entry whose `**适用栈**` no longer matches the current project stack
   - Mark it: `status: deprecated:<reason>`
   - This prevents stale lessons from blocking valid approaches

3. **Nominations use `state-manager.addLesson()`**
   - The addLesson method is available via the state-manager feature
   - If calling directly: `state-manager.addLesson(changeDir, lessonEntry)`
   - It auto-numbers (L-NNN) and appends to `.flow-engine/sflow/lessons.md`
