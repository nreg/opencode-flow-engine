# 父子 Agent 通信机制

本文档总结 opencode-flow-engine 插件引擎中"父 agent（sFlow 主 agent）与子 agent（subagent）通信"的完整逻辑，涵盖调用模式、完成检测、状态管理、通知机制等核心流程。

## 1. 架构总览

父 agent 通过 `call_flow_agent` 工具调用子 agent，子 agent 在独立的 session 中执行，通过 parentID 关联父子 session。

```text
┌─────────────────────────────────────────────────────────────┐
│                     父 Session (sFlow)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  call_flow_agent 工具                                 │  │
│  │  - 创建子 session (parentID = 父 sessionID)          │  │
│  │  - 发送 prompt 到子 session                          │  │
│  │  - 轮询/等待子 session 完成                          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ parentID 关联
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   子 Session (subagent)                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  子 agent 执行任务                                    │  │
│  │  - agent 参数指定子 agent 类型                       │  │
│  │  - model 参数指定模型                                │  │
│  │  - 独立的上下文和工具集                              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ 完成通知
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              BackgroundTaskWatcher (异步模式)                │
│  - 定期扫描 running 状态的任务                              │
│  - 检测完成/错误状态                                        │
│  - 写入通知文件                                             │
│  - 更新 subagent-store                                      │
└─────────────────────────────────────────────────────────────┘
```

**核心组件：**

| 组件 | 文件路径 | 职责 |
|------|---------|------|
| `call_flow_agent` | `tools/call-flow-agent.ts` | 子 agent 调用入口，支持同步/异步/交互模式 |
| `pollSessionCompletion` | `helpers/polling.ts` | 完成检测核心，事件驱动 + 轮询降级 |
| `BackgroundTaskWatcher` | `tools/call-flow-agent.ts` | 集中式后台任务监控器 |
| `NotificationManager` | `features/notification-manager.ts` | 子 agent 完成通知管理 |
| `SubagentStore` | `features/subagent-store.ts` | 子 agent 状态持久化与恢复 |
| `PollingLogger` | `features/polling-logger.ts` | 轮询日志落盘（诊断用） |

---

## 2. call_flow_agent 三种调用模式

### 2.1 同步模式（run_in_background=false）

**流程：**

```text
call_flow_agent(run_in_background=false)
  ↓
创建子 session (parentID = 父 sessionID)
  ↓
发送 prompt 到子 session
  ↓
pollSessionCompletion 等待（默认 30s 超时）
  ↓
检测完成信号（[TASK_COMPLETE] / JSON）
  ↓
返回结果给父 agent
```

**特点：**
- 父 agent 阻塞等待子 agent 完成
- 适用于需要立即获取结果的场景
- 超时时间：`DEFAULT_SYNC_MAX_WAIT_MS = 30_000`（30 秒）

**代码路径（call-flow-agent.ts:641-792）：**

```typescript
let lastOutput = await pollSessionCompletion(
  client,
  sessionID,
  { maxWaitMs: DEFAULT_SYNC_MAX_WAIT_MS },
);

// 完成检测与重试
const retryResult = await performCompletionRetry(
  lastOutput || '',
  injectReminder,
  pollOutput,
  undefined,
  subagent_type,
);

// 写入通知
await nm.writeNotification({
  type: 'sync_completed',
  subagent: subagent_type,
  task_id: syncTaskId,
  session_id: sessionID,
  summary: lastOutput.slice(0, 200),
  has_completion_signal: hasSignal,
});
```

---

### 2.2 异步模式（run_in_background=true）

**流程：**

```text
call_flow_agent(run_in_background=true)
  ↓
创建子 session
  ↓
发送 prompt
  ↓
立即返回 task_id 给父 agent
  ↓
父 agent 继续执行其他任务
  ↓
BackgroundTaskWatcher 自动检测完成
  ↓
写入通知文件（async_completed / async_error）
  ↓
父 agent 通过 flowagent_output 取结果
```

**特点：**
- 父 agent 不阻塞，立即返回 task_id
- BackgroundTaskWatcher 集中监控所有异步任务
- 父 agent 通过 `flowagent_output(task_id)` 获取结果
- 超时时间：`DEFAULT_MAX_WAIT_MS = 120_000`（120 秒）

**代码路径（call-flow-agent.ts:590-638）：**

```typescript
if (run_in_background) {
  // 检查并发限制（每种类型最多 3 个并行实例）
  if (!acquireSubagentSlot(subagent_type)) {
    return formatToolError('Concurrency limit reached');
  }

  const taskId = generateTaskId(backgroundTaskCounter);
  backgroundTaskRegistry.set(taskId, {
    sessionID,
    subagentType: subagent_type,
    status: 'running',
    createdAt: Date.now(),
    changeDir,
  });

  return {
    output: JSON.stringify({
      success: true,
      task_id: taskId,
      session_id: sessionID,
      status: 'running',
    }),
  };
}
```

---

### 2.3 交互模式（session_id 继续）

**流程：**

```text
call_flow_agent(session_id=existing_session_id)
  ↓
复用已有子 session
  ↓
发送新 prompt（追加到对话历史）
  ↓
pollSessionCompletion 等待
  ↓
返回结果
```

**特点：**
- 复用已有 session，保留对话历史
- 适用于多轮对话场景（如 need-explorer 逐问逐答）
- 仅支持同步模式（run_in_background=false）

**代码路径（call-flow-agent.ts:507-513）：**

```typescript
if (session_id) {
  if (run_in_background) {
    return formatToolError(
      'session_id is not supported in background mode. Use run_in_background=false to continue an existing session.'
    );
  }
  sessionID = session_id;
}
```

---

### 2.4 Resume 模式（agent_id 恢复）

**流程：**

```text
call_flow_agent(agent_id=existing_agent_id)
  ↓
从 subagent-store 恢复上下文
  ↓
合成 prompt = 恢复上下文 + 新 prompt
  ↓
创建新 session（或复用 session）
  ↓
执行任务
```

**特点：**
- 从 `.flow-engine/sflow/subagent-store/` 恢复 agent 上下文
- 合成 prompt 包含历史输出、事件记录
- 适用于长任务中断后恢复

**代码路径（call-flow-agent.ts:496-505）：**

```typescript
if (agent_id) {
  const resumeResult = await store.resumeAgent(agent_id, prompt);
  effectivePrompt = resumeResult.prompt;
  resolvedAgentId = agent_id;
}
```

---

## 3. 完成检测机制（核心）

### 3.1 事件驱动优先（Batch 2 改造）

**原理：** 订阅 SDK 的 `session.idle` SSE 事件，子 agent 完成时即时唤醒父 agent。

**关键代码（polling.ts:74-123）：**

```typescript
let eventSubscription: EventSubscription | null = null;
let eventReceived = false;
let wakeUp: (() => void) | null = null;

if (eventDriven && client.event && typeof client.event.subscribe === 'function') {
  try {
    // 订阅事件流，返回 Promise<{ stream: AsyncGenerator }>
    const abortController = new AbortController();
    const { stream } = await client.event.subscribe({ query: {} });

    // 异步消费事件流
    const consumeStream = async () => {
      try {
        for await (const event of stream) {
          // 检查取消信号
          if (abortController.signal.aborted) break;

          const payload = event.payload;
          // 检测 session.idle 事件
          if (
            payload.type === 'session.idle' &&
            payload.properties &&
            'sessionID' in payload.properties &&
            payload.properties.sessionID === sessionID
          ) {
            eventReceived = true;
            // 即时唤醒（<50ms）
            if (wakeUp) wakeUp();
          }
        }
      } catch (error) {
        // 事件流错误：记录日志，继续轮询（不重连）
        if (!abortController.signal.aborted) {
          await logger.log(sessionID, 'event stream error', {
            error: error instanceof Error ? error.message : String(error),
            fallback: 'continue polling',
          });
        }
      }
    };

    consumeStream();

    // 创建取消订阅句柄
    eventSubscription = {
      cancel: () => {
        abortController.abort();
        if (stream && typeof stream.return === 'function') {
          stream.return(undefined);
        }
      },
    };
    eventDrivenActive = true;
  } catch (error) {
    // 订阅失败：记录日志，降级到纯轮询
    await logger.log(sessionID, 'event subscription failed', {
      error: error instanceof Error ? error.message : String(error),
      fallback: 'pure polling',
    });
    eventDrivenActive = false;
  }
}
```

**事件订阅机制：**
- `client.event.subscribe()` 返回 `Promise<{ stream: AsyncGenerator }>`
- 通过 `for await (const event of stream)` 消费事件流
- 使用 `AbortController` 控制取消和清理
- 事件类型：`{ payload: { type: 'session.idle', properties: { sessionID: string } } }`

**错误处理：**
- 订阅失败：记录日志，立即降级到纯轮询
- 流中断/异常：记录日志，继续轮询（不尝试重连）
- 取消订阅：调用 `abortController.abort()` + `stream.return(undefined)` 清理资源

**性能提升：**
- 事件到达时立即返回，无需等待轮询间隔
- 唤醒延迟 < 50ms（原轮询间隔 200ms）
- 解决了 30s 超时问题（事件驱动 + 轮询降级双保险）

---

### 3.2 轮询降级机制

**触发条件：**
- 事件订阅失败（SDK 不支持或网络错误）
- 事件流超时（超过 `fallbackThreshold`，默认 25s）

**降级逻辑（polling.ts:125-133）：**

```typescript
async function logExit(reason: string, result: string | null | ProbePending): Promise<string | null | ProbePending> {
  const elapsed = Date.now() - startTime;
  await logger.log(sessionID, 'completed', { reason, elapsed: `${elapsed}ms` });
  // 取消事件订阅并清理资源
  if (eventSubscription) {
    eventSubscription.cancel();
    eventSubscription = null;
  }
  return result;
}
```

**降级后行为：**
- 纯轮询模式，间隔 200ms
- 通过 `status()` 和 `messages()` 检测完成

---

### 3.3 status 未命中容错

**问题：** `status()` 无法按 sessionID 命中时（返回空或错误），不应阻塞轮询。

**解决方案（polling.ts:151-215）：**

```typescript
let statusFailed = false;
try {
  const statusResult = await client.session.status();
  // 解析 status 结果，查找目标 sessionID
  if (statusEntry) {
    isIdle = statusEntry.type === 'idle';
    // 处理 retry 状态机...
  }
} catch {
  statusFailed = true;
}

// 如果 status 失败，靠 messages 检测兜底
if (statusFailed && messagesFailed) {
  consecutiveFailures++;
  if (consecutiveFailures >= 2) {
    // 双重失败，判定为 session 消失
    return await readSessionLastMessage(client, sessionID);
  }
}
```

---

### 3.4 超时兜底

**超时配置：**

| 模式 | 超时时间 | 常量 |
|------|---------|------|
| 同步模式 | 30s | `DEFAULT_SYNC_MAX_WAIT_MS` |
| 异步模式 | 120s | `DEFAULT_MAX_WAIT_MS` |
| Watcher 探测 | 1s | `probeMode: true, maxWaitMs: 1000` |

**超时处理（polling.ts:277-278）：**

```typescript
// 超时后读取最后一条消息
const result = await readSessionLastMessage(client, sessionID);
return await logExit('timeout', result);
```

---

### 3.5 迟到事件忽略

**问题：** 事件订阅已取消后，可能收到迟到的事件（网络延迟）。

**解决方案（polling.ts:72）：**

```typescript
const subscription = eventStream.on('data', (event: unknown) => {
  // P0-1: 检查订阅是否仍然活跃
  if (eventSubscription !== subscription) return; // 已清理，忽略迟到事件
  // ...
});
```

---

### 3.6 完成信号检测（P3 增强）

**检测策略（completion-detector.ts）：**

| Agent 类型 | 检测方式 | 触发重试 |
|-----------|---------|---------|
| **STRICT**（spec-writer, contract-builder） | `[TASK_COMPLETE]` 标记 / JSON 代码块 / 裸 JSON 对象 | ✅ 是 |
| **LOOSE**（build-executor, code-reviewer 等） | 报告关键词（Summary, 完成, Test Results）/ 输出长度 ≥ 200 字符 | ❌ 否 |
| 其他 | 无检测 | ❌ 否 |

**代码（completion-detector.ts:133-147）：**

```typescript
export function hasCompletionSignal(output: string): boolean {
  if (!output || output.trim().length === 0) return false;
  
  // 1. [TASK_COMPLETE] 标记
  if (output.includes('[TASK_COMPLETE]')) return true;
  
  // 2. JSON 代码块或裸 JSON 对象
  if (extractJsonBlock(output) !== null) return true;
  
  return false;
}
```

**重试机制（仅 STRICT agents）：**

```typescript
const retryResult = await performCompletionRetry(
  output,
  injectReminder,  // 注入 system reminder
  pollOutput,      // 重新轮询
  undefined,
  subagent_type,
);
```

---

## 4. BackgroundTaskWatcher

### 4.1 架构

**职责：** 集中式后台任务监控器，定期扫描 registry 中 running 状态的任务。

**代码（call-flow-agent.ts:113-302）：**

```typescript
export function createBackgroundTaskWatcher(options: CreateWatcherOptions): BackgroundTaskWatcher {
  const { client, registry, pollIntervalMs = 200 } = options;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function checkTasks(): Promise<void> {
    const runningTasks = Array.from(registry.entries()).filter(
      ([, task]) => task.status === 'running',
    );

    for (const [taskId, task] of runningTasks) {
      // P1-1: 检查 processing 标志，防止与 pollAndComplete 竞争
      if (currentTask._processing) continue;

      currentTask._processing = true;
      registry.set(taskId, currentTask);

      try {
        // F2: 使用 probe 模式探测（1s 超时）
        const probeResult = await pollSessionCompletion(
          client,
          task.sessionID,
          { maxWaitMs: 1000, probeMode: true },
        );

        if (probeResult === PROBE_PENDING) {
          // 仍在运行，跳过本轮
          currentTask._processing = false;
          continue;
        }

        // 更新状态、释放槽位、写通知...
      } finally {
        latest._processing = false;
        registry.set(taskId, latest);
      }
    }
  }

  return {
    start() {
      intervalId = setInterval(checkTasks, pollIntervalMs);
    },
    stop() {
      if (intervalId) clearInterval(intervalId);
    },
  };
}
```

---

### 4.2 并发保护

**机制：**
- `_processing` 标志：防止 watcher 与 `pollAndComplete` 竞争
- `slotReleased` 标志：防止双重释放槽位（R1.4）
- `_errorCount` 计数：监控失败重试，超过 3 次判定为错误

**代码（call-flow-agent.ts:245-279）：**

```typescript
catch (err) {
  const errorCount = currentTask._errorCount ?? 0;
  
  if (errorCount >= 3) {
    // 超过 3 次失败，判定为错误
    updated = {
      ...latestTaskBeforeUpdate,
      status: 'error',
      error: `Task monitoring failed after ${errorCount + 1} attempts`,
      completedAt: now,
      slotReleased: latestTaskBeforeUpdate.slotReleased ?? false,
    };
    registry.set(taskId, updated);
    
    if (!updated.slotReleased) {
      releaseSubagentSlot(latestTaskBeforeUpdate.subagentType);
      updated.slotReleased = true;
    }
  } else {
    // 递增错误计数
    latestTaskBeforeUpdate._errorCount = errorCount + 1;
    registry.set(taskId, latestTaskBeforeUpdate);
  }
}
```

---

### 4.3 自动释放并发槽位

**规则：** 每种子 agent 类型最多 3 个并行实例（`MAX_CONCURRENT_SUBAGENTS = 3`）。

**代码（call-flow-agent.ts:73-92）：**

```typescript
function acquireSubagentSlot(subagentType: string): boolean {
  const current = runningSubagentCounts.get(subagentType) ?? 0;
  if (current >= MAX_CONCURRENT_SUBAGENTS) {
    return false; // 超过限制，拒绝
  }
  runningSubagentCounts.set(subagentType, current + 1);
  return true;
}

function releaseSubagentSlot(subagentType: string): void {
  const current = runningSubagentCounts.get(subagentType) ?? 0;
  if (current <= 1) {
    runningSubagentCounts.delete(subagentType);
  } else {
    runningSubagentCounts.set(subagentType, current - 1);
  }
}
```

---

## 5. 通知机制

### 5.1 写入通知

**时机：**
- 同步模式完成时：`sync_completed`
- 异步模式完成时：`async_completed`
- 异步模式错误时：`async_error`

**存储路径：** `.flow-engine/sflow/notifications/{task_id}.json`

**代码（notification-manager.ts:121-143）：**

```typescript
async function writeNotification(params: WriteNotificationParams): Promise<void> {
  await ensureDir(notificationsDir);

  const entry: NotificationEntry = {
    type: params.type,
    subagent: params.subagent,
    task_id: params.task_id,
    session_id: params.session_id,
    completed_at: new Date().toISOString(),
    summary: params.summary,
    has_completion_signal: params.has_completion_signal,
  };

  const filePath = join(notificationsDir, `${params.task_id}.json`);
  await writeJsonFile(filePath, entry);
}
```

---

### 5.2 消费通知

**时机：** 主 agent 启动时（`session.created` 事件）。

**代码（sflow-plugin-factory.ts:432-443）：**

```typescript
if (event.type === 'session.created') {
  try {
    const nm = createNotificationManager({ changeDir: workDir });
    const notifications = await nm.consumeNotifications();
    if (notifications.length > 0) {
      const notifSummary = notifications.map(n => n.formatted).join('\n');
      console.log(`[sFlow] 消费 ${notifications.length} 条子 agent 通知:\n${notifSummary}`);
    }
  } catch {
    // 通知消费失败不阻塞 session 初始化
  }
}
```

**消费后处理：**
- 通知文件移动到 `consumed/` 子目录
- 通知内容格式化为 system prompt 片段，注入主 agent 上下文

---

### 5.3 诊断日志落盘

**目的：** 轮询事件日志写入 `.flow-engine/sflow/polling.log`，不污染 OpenCode 界面。

**代码（polling-logger.ts:37-66）：**

```typescript
async log(sessionId: string, message: string, metadata?: Record<string, unknown>): Promise<void> {
  this.writeQueue = this.writeQueue.then(async () => {
    const logDir = dirname(this.logFilePath);
    await mkdir(logDir, { recursive: true });

    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [INFO] [${sessionId}] ${message}`;

    if (metadata && Object.keys(metadata).length > 0) {
      logLine += ` | ${JSON.stringify(metadata)}`;
    }

    await appendFile(this.logFilePath, logLine + '\n', 'utf-8');
  }).catch((error) => {
    console.warn(`[PollingLogger] Write queue error (isolated):`, error);
  });
}
```

**日志示例：**

```text
[2024-01-15T10:30:00.000Z] [INFO] [ses_abc123] start polling | {"maxWaitMs":30000,"isNew":true,"eventDriven":true}
[2024-01-15T10:30:00.050Z] [INFO] [ses_abc123] completed | {"reason":"event_idle","elapsed":"50ms"}
```

---

## 6. 状态流

### 6.1 子 agent 生命周期

```text
创建 session (status: running)
  ↓
执行任务
  ↓
完成检测
  ↓
┌─────────────┬─────────────┐
│  成功       │  失败       │
│  ↓          │  ↓          │
│  completed  │  error      │
└─────────────┴─────────────┘
  ↓
释放并发槽位
  ↓
写入通知
  ↓
更新 subagent-store
```

---

### 6.2 BackgroundTaskEntry 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionID` | string | 子 session ID |
| `subagentType` | string | 子 agent 类型（如 "build-executor"） |
| `status` | 'running' \| 'completed' \| 'error' | 任务状态 |
| `result` | string? | 完成时的输出 |
| `error` | string? | 错误时的错误信息 |
| `createdAt` | number | 创建时间戳 |
| `completedAt` | number? | 完成时间戳 |
| `output_mode` | 'last_message' \| 'structured'? | 输出模式（P2） |
| `warning` | string? | 完成检测重试耗尽时的警告（P3） |
| `slotReleased` | boolean? | 并发槽位是否已释放（R1.4） |
| `changeDir` | string? | 项目根目录（R1） |
| `resolvedModel` | string? | 解析后的模型（P1-5） |
| `modelType` | string? | 原始 model_type 参数（P1-5） |
| `_errorCount` | number? | 监控失败计数（内部使用，P1-3） |
| `_processing` | boolean? | 处理中标志（防止竞争，P1-1） |

---

## 7. 时序图

### 7.1 同步模式时序

```text
父 Agent                call_flow_agent           子 Session           pollSessionCompletion
  │                          │                        │                        │
  ├─ call_flow_agent ───────→│                        │                        │
  │  (run_in_background=false)│                        │                        │
  │                          ├─ session.create ──────→│                        │
  │                          │  (parentID=父sessionID)│                        │
  │                          │←───── sessionID ───────┤                        │
  │                          │                        │                        │
  │                          ├─ session.prompt ──────→│                        │
  │                          │  (prompt + model)      │                        │
  │                          │                        │                        │
  │                          ├─ pollSessionCompletion ───────────────────────→│
  │                          │                        │                        ├─ event.subscribe (session.idle)
  │                          │                        │                        │
  │                          │                        │←─ 执行任务 ─────────────┤
  │                          │                        │                        │
  │                          │                        ├─ session.idle event ──→│
  │                          │                        │                        ├─ wakeUp()
  │                          │←───────────────────────────────────────────────┤
  │                          │  (output)              │                        │
  │                          │                        │                        │
  │                          ├─ writeNotification ────┤                        │
  │                          │  (sync_completed)      │                        │
  │                          │                        │                        │
  │←───── result ────────────┤                        │                        │
  │                          │                        │                        │
```

---

### 7.2 异步模式时序（含 Watcher）

```text
父 Agent         call_flow_agent      子 Session      BackgroundTaskWatcher      NotificationManager
  │                    │                  │                   │                        │
  ├─ call_flow_agent ─→│                  │                   │                        │
  │  (run_in_background=true)│             │                   │                        │
  │                    ├─ session.create ─→│                   │                        │
  │                    │←─── sessionID ───┤                   │                        │
  │                    ├─ session.prompt ─→│                   │                        │
  │                    │                  │                   │                        │
  │←─── task_id ───────┤                  │                   │                        │
  │  (立即返回)        │                  │                   │                        │
  │                    │                  │                   │                        │
  │  （父 agent 继续执行其他任务）         │                   │                        │
  │                    │                  │                   │                        │
  │                    │                  │                   ├─ setInterval(200ms) ──→│
  │                    │                  │                   │                        │
  │                    │                  │←─ 执行任务 ────────┤                        │
  │                    │                  │                   │                        │
  │                    │                  │                   ├─ pollSessionCompletion │
  │                    │                  │                   │  (probeMode, 1s)       │
  │                    │                  │                   │                        │
  │                    │                  ├─ session.idle ───→│                        │
  │                    │                  │                   ├─ 检测完成              │
  │                    │                  │                   │                        │
  │                    │                  │                   ├─ writeNotification ───→│
  │                    │                  │                   │  (async_completed)     │
  │                    │                  │                   │                        │
  │  （后续通过 flowagent_output 取结果） │                   │                        │
  │                    │                  │                   │                        │
```

---

### 7.3 交互模式时序

```text
父 Agent                call_flow_agent           子 Session           pollSessionCompletion
  │                          │                        │                        │
  ├─ call_flow_agent ───────→│                        │                        │
  │  (session_id=existing)   │                        │                        │
  │                          ├─ 复用 session ────────→│                        │
  │                          │                        │                        │
  │                          ├─ session.prompt ──────→│                        │
  │                          │  (新 prompt)           │                        │
  │                          │                        │                        │
  │                          ├─ pollSessionCompletion ───────────────────────→│
  │                          │                        │                        │
  │                          │                        │←─ 执行任务 ─────────────┤
  │                          │                        │                        │
  │                          │←───────────────────────────────────────────────┤
  │                          │  (output)              │                        │
  │                          │                        │                        │
  │←───── result ────────────┤                        │                        │
  │                          │                        │                        │
  │                          │                        │                        │
  ├─ call_flow_agent ───────→│                        │                        │
  │  (session_id=same)       │                        │                        │
  │                          ├─ session.prompt ──────→│                        │
  │                          │  (又一轮 prompt)       │                        │
  │                          │                        │                        │
  │                          ├─ pollSessionCompletion ───────────────────────→│
  │                          │                        │                        │
  │                          │                        │←─ 执行任务 ─────────────┤
  │                          │                        │                        │
  │                          │←───────────────────────────────────────────────┤
  │                          │  (output)              │                        │
  │                          │                        │                        │
  │←───── result ────────────┤                        │                        │
  │                          │                        │                        │
```

---

## 8. 关键改造点总结

### 8.1 事件驱动改造（Batch 2）

**问题：** 纯轮询模式下，子 agent 完成后需要等待下一个轮询周期（200ms）才能检测到，导致延迟。

**解决方案：**
- 订阅 SDK 的 `session.idle` SSE 事件
- 事件到达时立即唤醒（`wakeUp()`），延迟 < 50ms
- 事件流故障时自动降级到纯轮询

**影响：**
- 同步模式响应速度提升 4 倍（200ms → <50ms）
- 异步模式 watcher 探测更及时
- 解决了 30s 超时问题（事件驱动 + 轮询降级双保险）

---

### 8.2 完成检测增强（P3）

**问题：** 子 agent 输出可能不完整（截断、错误），导致父 agent 收到无效结果。

**解决方案：**
- STRICT agents（spec-writer, contract-builder）必须输出 `[TASK_COMPLETE]` 或 JSON
- 缺少完成信号时注入 system reminder 并重试（最多 2 次）
- LOOSE agents 使用宽松检测（报告关键词或输出长度）

**影响：**
- spec-writer/contract-builder 输出完整性保证
- 减少无效结果传递给下游 agent

---

### 8.3 并发保护增强（R1.4, P1-1）

**问题：**
- watcher 与 `pollAndComplete` 可能同时处理同一任务（竞争）
- 槽位可能被双重释放（watcher 释放 + pollAndComplete 释放）

**解决方案：**
- `_processing` 标志：防止竞争
- `slotReleased` 标志：防止双重释放

**影响：**
- 并发安全性保证
- 避免槽位计数错误

---

## 9. 文件路径索引

| 功能 | 文件路径 |
|------|---------|
| 子 agent 调用入口 | `packages/plugin-infra/src/tools/call-flow-agent.ts` |
| 完成检测核心 | `packages/plugin-infra/src/helpers/polling.ts` |
| 完成信号检测 | `packages/plugin-infra/src/helpers/completion-detector.ts` |
| 通知管理 | `packages/plugin-infra/src/features/notification-manager.ts` |
| 子 agent 状态存储 | `packages/plugin-infra/src/features/subagent-store.ts` |
| 轮询日志 | `packages/plugin-infra/src/features/polling-logger.ts` |
| 类型定义 | `packages/plugin-infra/src/types.ts` |
| 插件入口 | `packages/plugin-infra/src/sflow-plugin-factory.ts` |

---

**文档版本：** v1.0.0  
**最后更新：** 2024-01-15  
**基于代码版本：** opencode-flow-engine main branch
