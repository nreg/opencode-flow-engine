# PROGRESS: {{taskId}}

- **Change ID**: {{changeId}}
- **Task ID**: {{taskId}}
- **暂停时间**: {{pausedAt}}
- **触发清窗的信号**: {{trigger}}

---

## 已完成的子步骤

- [x] {{completedStep1}}
- [x] {{completedStep2}}

## 当前正在做（清窗那一刻的状态）

{{currentStateDescription}}

**下一步**: {{nextStep}}
**阻塞**: {{blockedBy}}

## 已排除的方案（反重复关键）

> 接手的 AI 必须读这一段。任何想再尝试这些方案的，必须先解释"本次与上次的差异"。

| # | 方案 | 排除理由 | 失败次数 |
|---|------|----------|----------|
| X-1 | {{approach}} | {{reason}} | {{failCount}} |

## 待确认的假设

- {{assumption1}}

## 临时记下的线索 / 文件位置

- {{clue1}}

---

## 恢复指引（给下一会话的 AI）

下一会话开始时，**第一步**：

1. 读完本文件「已排除的方案」
2. 检查接下来计划的方案是否撞车
3. 如果不撞车，从「当前正在做」的下一步起步
4. 完成本任务后，删除本 PROGRESS.md（产出迁移到 SUMMARY.md）

> PROGRESS.md 是**临时**文件，任务完成后必须清理。
