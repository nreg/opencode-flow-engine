# 父子 Agent 基于 OMO 加强借鉴说明

## 借鉴点

### P0 — Notification Manager（来自 kimi-cli）

**痛点**：主 agent 不知道子 agent 什么时候完成，需要轮询 10+ 秒。

**方案**：轻量级通知注入，不改底层通信协议。

子 agent 完成时 → 写入 `.flow-engine/sflow/notifications/<task-id>.json`：

```json
{
  "type": "subagent_complete",
  "subagent": "build-executor",
  "task_id": "sf_xxx",
  "session_id": "xxx",
  "completed_at": "2026-07-23T...",
  "summary": "Executed Wave 1: implemented auth service"
}
```

主 agent 启动时 → 读取未消费通知列表 → 注入到 system prompt，消费后 mark 为 consumed（移动到 `consumed/` 子目录）。

**工作量**：1 天（新增 notification-manager.ts + 修改 call-flow-agent.ts 完成时写入 + orchestrator prompt 增加通知段）

---

### P1 — Subagent 持久化与 Resume（来自 kimi-cli）

**痛点**：长任务（如 build-executor 批量实现）被中断后必须从头重跑。

**方案**：将 `task-tracker.json` 升级为 `subagent-store/` 目录结构：

```
.flow-engine/sflow/subagent-store/
├── <agent_id>/
│   ├── meta.json    # 元数据：subagent_type, prompt_hash, status
│   ├── prompt.md    # 原始 prompt
│   ├── output.md    # 输出摘要
│   └── events.log   # 事件流水
└── index.json       # agent_id 索引
```

**关键设计**：resume 时，将 `prompt.md` + `output.md`（已有部分）重新注入新 session，而不是从原始 session 恢复（因为 session 可能已过期）。

**工作量**：2 天（新增 subagent-store.ts + 修改 call-flow-agent.ts 写入 + 修改 orchestrator prompt 增加 resume 指令）

---

### P2 — 输出 Schema 结构化（来自 codebuff）

**痛点**：编排器需要 LLM 解析子 agent 的自由文本输出，不稳定。

**方案**：在 `call_flow_agent` 中增加 `output_mode` 参数，支持 `last_message`（默认）和 `structured` 两种模式。

**同步模式 structured 的逻辑**：
1. 子 agent 完成 → 获取完整输出文本
2. 尝试从输出中提取 JSON block（````json ... ````）
3. 如果成功提取 → 解析为结构化数据返回
4. 如果失败 → 回退到文本输出 + warning

**异步模式 structured 的逻辑**：
1. 子 agent 完成 → 同上提取 JSON
2. backgroundTaskRegistry 中存储结构化结果
3. `flowagent_output` 返回结构化结果

**起步范围**：先落在 build-executor 的输出上（返回 `{ files_changed: [], tests_passed: boolean, blockers: [] }`），再用到 verifier（返回 `{ blockers: [], warnings: [], score: number }`）。

**工作量**：1 天（修改 call-flow-agent.ts 增加输出解析 + build-executor / verifier 的 agent prompt 要求输出 JSON）

---

### P3 — 完成强制机制 + 系统提醒层（来自 grok-build）

**痛点**：子 agent 有时提前结束 turn 不返回结果，主 agent 等不到反馈。

**方案**：在 `call_flow_agent` 的后置处理中检测"子 agent 是否在非 idle 状态下结束 turn"，如果是 → 自动注入 `<system-reminder>` 到下一轮：

```
call_flow_agent 同步模式的后置处理：
  if session ended but output looks incomplete (无 JSON marker / 无完成信号):
    → 在 session 中注入一条 system message：
      "<system-reminder>你似乎没有完成任务。请继续，完成后用 markdown 输出结果。</system-reminder>"
    → 重新开始轮询（最多重试 2 次）
```

**与 isNew 问题的关系**：这个机制解决的是"子 agent 跑偏提前结束"的问题，而 isNew 解决的是"子 agent 已完成但主 agent 没检测到"的问题。两个正交，不冲突。

**工作量**：1 天（修改 call-flow-agent.ts + 新增输出完整性检测函数）

---

## 汇总：执行路线图

| 优先级 | 功能 | 来源 | 工作量 | 价值 |
|--------|------|------|--------|------|
| P0 | Notification Manager | kimi-cli | 1 天 | 消除 10s+ 轮询延迟 |
| P1 | Subagent Store + Resume | kimi-cli | 2 天 | 长任务中断可恢复 |
| P2 | 输出 Schema 结构化 | codebuff | 1 天 | 编排器稳定性提升 |
| P3 | 完成强制 + 系统提醒 | grok-build | 1 天 | 减少子 agent 提前终止 |

---

## 决策点

### P0 — Notification Manager

| 决策项 | 确认内容 |
|--------|----------|
| 存储路径 | `.flow-engine/sflow/notifications/` |
| 触发时机 | call-flow-agent.ts execute 后置处理（同步+异步全覆盖） |
| 通知内容 | type, subagent, task_id, session_id, completed_at, summary |
| 消费机制 | 主 agent 启动时自动扫描未消费通知 → 注入 system prompt → 移动到 consumed/ |
| 去重保证 | consumed/ 中已有同名文件则跳过 |

### P1 — Subagent 持久化与 Resume

| 决策项 | 确认内容 |
|--------|----------|
| 存储路径 | `.flow-engine/sflow/subagent-store/` |
| 目录结构 | `<agent_id>/{meta.json, prompt.md, output.md, events.log} + index.json` |
| Resume 触发 | `call_flow_agent` 增加 resume 模式，传入 agent_id |
| 上下文注入 | 新 session prompt = 原始 prompt + "\n\n--- 之前的工作摘要 ---\n" + output.md 内容 |

### P2 — 输出 Schema 结构化

| 决策项 | 确认内容 |
|--------|----------|
| 约束方式 | 软约束：prompt 建议输出 JSON，提取失败 fallback 到原始文本 |
| 提取位置 | `call_flow_agent` execute 后置处理（同步+异步统一） |
| 起步范围 | build-executor → `{ files_changed: [], tests_passed: boolean, blockers: [] }`；verifier → `{ blockers: [], warnings: [], score: number }` |

### P3 — 完成强制机制 + 系统提醒层

| 决策项 | 确认内容 |
|--------|----------|
| 检测规则 | 检查输出是否缺少完成信号（如 `[TASK_COMPLETE]`、完成、JSON block） |
| 提醒方式 | 在 session 中注入 system reminder 消息 |
| 重试策略 | 最多 2 次重试，间隔 1s → 2s（总共 3 次尝试） |