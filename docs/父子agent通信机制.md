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
| **`EventBus`** | `features/event-bus.ts` | 全局事件总线，Map<sessionID, listener> 模式 |
| **`handleSessionIdleEvent`** | `features/event-hook-handler.ts` | 共享 hook 处理函数，处理 session.idle/status 事件 |
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

### 3.1 事件驱动优先（事件总线 + 插件 Hooks.event）

**原理：** 通过全局事件总线 + 插件 `Hooks.event` hook 监听 `session.idle` 和 `session.status` 事件，子 agent 完成时即时唤醒父 agent。

**架构设计：**

1. **全局事件总线**（`features/event-bus.ts`）
   - 轻量级实现：`Map<sessionID, listener>` 模式
   - 无外部依赖：无消息队列（Redis/RabbitMQ）、无 EventEmitter、无 RxJS
   - 全局单例：`getGlobalEventBus()` 返回唯一实例，pollSessionCompletion 与插件 hook 共享
   - 操作：
     - `register(sessionID, listener)`: 注册监听器（非幂等，重复注册会覆盖并警告）
     - `dispatch(sessionID, event)`: 派发事件（幂等，单次 dispatch 只调用一次监听器）
     - `unregister(sessionID)`: 注销监听器（防泄漏）

2. **插件 Hooks.event 集成**
   - 插件在 `sflow-plugin-factory.ts` / `iflow-plugin-factory.ts` 注册 `Hooks.event` hook
   - Hook 监听 OpenCode runtime 的 `session.idle` 和 `session.status` 事件
   - 使用共享函数 `handleSessionIdleEvent(event, prefix)` 处理事件：
     - **session.idle 事件**：直接派发到事件总线
     - **session.status 事件**：检查 `status.type === 'idle'` 时派发（兜底机制）
   - 派发时调用 `eventBus.dispatch(sessionID, event)`
   - 事件总线调用已注册的监听器（wakeUp 回调）

3. **pollSessionCompletion 注册流程**
   - 启动时调用 `eventBus.register(sessionID, wakeUp)` 注册回调
   - 事件到达时，wakeUp 立即中断轮询循环
   - 无需 status 确认，直接读取最后一条消息并返回
   - 完成后调用 `eventBus.unregister(sessionID)` 清理

**关键代码（polling.ts:77-125）：**

```typescript
// Batch 3: Event bus driven polling
// R1: Register to global event bus for session.idle event
let eventReceived = false;
let wakeUp: (() => void) | null = null;
let eventBusRegistered = false;

if (eventDriven) {
  // R1: Register to global event bus
  const eventBus = getGlobalEventBus();
  eventBus.register(sessionID, (event: Event) => {
    // R1: Check if event is session.idle for this session
    if (
      event.type === 'session.idle' &&
      event.properties &&
      'sessionID' in event.properties &&
      event.properties.sessionID === sessionID
    ) {
      eventReceived = true;
      if (wakeUp) wakeUp();
      
      // R1: Log event arrival
      void activeLogger.log(sessionID, 'event received', {
        source: 'event.hook',
        type: event.type,
        eventSessionID: event.properties.sessionID,
        targetSessionID: sessionID,
        matched: true,
      });
    }
  });
  eventBusRegistered = true;
}

async function logExit(reason: string, result: string | null | ProbePending): Promise<string | null | ProbePending> {
  const elapsed = Date.now() - startTime;
  await activeLogger.log(sessionID, 'completed', { reason, elapsed: `${elapsed}ms` });
  
  // R1: Unregister from event bus (防泄漏)
  if (eventBusRegistered) {
    const eventBus = getGlobalEventBus();
    eventBus.unregister(sessionID);
    eventBusRegistered = false;
  }
  
  return result;
}
```

**插件 Hook 注册（sflow-plugin-factory.ts:432-476）：**

```typescript
event: async (input) => {
  const event = input.event;
  // P0-1: 诊断日志 - 记录所有收到的事件类型
  console.log(`[sFlow] event hook received: type=${event.type}`);

  if (event.type === 'session.created') {
    // 主 agent 启动时消费未读通知
    // ...
  } else if (event.type === 'session.deleted') {
    // session 结束处理
    // ...
  } else {
    // P1-2: 使用共享函数处理 session.idle 和 session.status 事件
    const handled = handleSessionIdleEvent(event, 'sFlow');
    if (handled) {
      console.log('[sFlow] session.idle/status event handled and dispatched to event bus');
    }
  }
}
```

**共享 Hook 处理函数（event-hook-handler.ts:37-82）：**

```typescript
export function handleSessionIdleEvent(event: Event, prefix: string): boolean {
  if (event.type === 'session.idle') {
    // Batch 2 Task 2.1: 监听 session.idle 事件并派发到事件总线
    const properties = event.properties as { sessionID?: string } | undefined;
    if (properties?.sessionID) {
      console.log(`[${prefix}] event hook received session.idle: sessionID=${properties.sessionID}`);
      const eventBus = getGlobalEventBus();
      const matched = eventBus.dispatch(properties.sessionID, event);
      console.log(`[${prefix}] eventBus.dispatch result: matched=${matched}`);
      return matched;
    }
    return false;
  } else if (event.type === 'session.status') {
    // P0-2: 兜底监听 session.status 事件（当插件不推送独立的 session.idle 时）
    const statusData = event.properties as { sessionID?: string; status?: { type?: string } };
    if (statusData.status?.type === 'idle' && statusData.sessionID) {
      console.log(`[${prefix}] event hook received session.status idle: sessionID=${statusData.sessionID}`);
      const eventBus = getGlobalEventBus();
      const idleEvent = { type: 'session.idle', properties: { sessionID: statusData.sessionID } };
      const matched = eventBus.dispatch(statusData.sessionID, idleEvent);
      console.log(`[${prefix}] eventBus.dispatch (from session.status) result: matched=${matched}`);
      return matched;
    }
    return false;
  }
  return false;
}
```

**事件总线实现（event-bus.ts）：**

```typescript
export function createEventBus(): EventBus {
  const listeners = new Map<string, EventBusListener>();
  const logger = new PollingLogger();

  return {
    register(sessionID: string, onComplete: EventBusListener): void {
      listeners.set(sessionID, onComplete);
      void logger.log(sessionID, 'event-bus register', {
        action: 'register',
        listenerCount: listeners.size,
      });
    },

    dispatch(sessionID: string, event: Event): boolean {
      const listener = listeners.get(sessionID);
      const matched = listener !== undefined;

      if (matched) {
        listener(event);
      }

      void logger.log(sessionID, 'event-bus dispatch', {
        action: 'dispatch',
        eventType: event.type,
        matched,
        listenerCount: listeners.size,
      });

      return matched;
    },

    unregister(sessionID: string): void {
      const existed = listeners.has(sessionID);
      listeners.delete(sessionID);
      void logger.log(sessionID, 'event-bus unregister', {
        action: 'unregister',
        existed,
        listenerCount: listeners.size,
      });
    },
  };
}
```

**性能提升：**
- 事件到达时立即返回，无需等待轮询间隔
- 唤醒延迟 < 50ms（原轮询间隔 200ms）
- 解决了 30s 超时问题（事件驱动 + 轮询降级双保险）
- 无外部依赖，轻量级实现

---

### 3.2 轮询降级机制

**触发条件：**
- 事件未在阈值时间内到达（超过 `fallbackThreshold`，默认 25s）

**降级逻辑（polling.ts:147-162）：**

```typescript
// Batch 3: Fallback to pure polling if event not received within threshold
if (eventBusRegistered && !eventReceived && elapsed > fallbackThreshold) {
  await activeLogger.log(sessionID, 'fallback to polling', {
    reason: 'event not received within threshold',
    elapsed: `${elapsed}ms`,
    threshold: `${fallbackThreshold}ms`,
  });

  // P1-2: Unregister from event bus (no longer needed)
  // Check eventReceived again to avoid race condition (event arrived just before unregister)
  if (!eventReceived) {
    const eventBus = getGlobalEventBus();
    eventBus.unregister(sessionID);
    eventBusRegistered = false;
  }
}
```

**降级后行为：**
- 注销事件总线监听器（防泄漏）
- 纯轮询模式，间隔 200ms
- 通过 `status()` 和 `messages()` 检测完成

**竞态条件保护：**
- 在注销前再次检查 `eventReceived`，避免事件刚到达就被注销（事件到达 → 注销 → 丢失）

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

### 3.5 事件到达检测与即时返回

**检测逻辑（polling.ts:164-185）：**

```typescript
// P0-2: Check eventReceived before sleep to detect events that arrived
// after register but before wakeUp assignment.
// Scenario 1: event after register, before wakeUp → caught here (no 200ms delay)
// Scenario 2: event during sleep → wakeUp interrupts sleep
// Scenario 3: event after unregister → polling fallback catches
if (eventReceived) {
  const result = await readSessionLastMessage(client, sessionID);
  return await logExit('event_hook', result);
}

await new Promise<void>((resolve) => {
  wakeUp = resolve;
  sleep(POLL_INTERVAL).then(resolve);
});
wakeUp = null;
pollCount++;

// P0-3: If event received, return directly without status confirmation
if (eventReceived) {
  const result = await readSessionLastMessage(client, sessionID);
  return await logExit('event_hook', result);
}
```

**三种事件到达场景：**
1. **事件在 register 后、wakeUp 赋值前到达**：在 sleep 前的检查中捕获（无 200ms 延迟）
2. **事件在 sleep 期间到达**：wakeUp 中断 sleep，立即返回
3. **事件在 unregister 后到达**：轮询降级模式捕获

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

## 6. 诊断日志系统

### 6.1 事件总线诊断日志

**日志文件：** `.flow-engine/sflow/polling.log`

**事件总线操作日志（event-bus.ts）：**

```typescript
// register 操作
await logger.log(sessionID, 'event-bus register', {
  action: 'register',
  listenerCount: listeners.size,
});

// dispatch 操作
await logger.log(sessionID, 'event-bus dispatch', {
  action: 'dispatch',
  eventType: event.type,
  matched,  // true if listener found
  listenerCount: listeners.size,
});

// unregister 操作
await logger.log(sessionID, 'event-bus unregister', {
  action: 'unregister',
  existed,  // true if listener existed
  listenerCount: listeners.size,
});
```

**日志示例：**

```text
[2024-01-15T10:30:00.000Z] [INFO] [ses_abc123] event-bus register | {"action":"register","listenerCount":1}
[2024-01-15T10:30:00.050Z] [INFO] [ses_abc123] event-bus dispatch | {"action":"dispatch","eventType":"session.idle","matched":true,"listenerCount":1}
[2024-01-15T10:30:00.051Z] [INFO] [ses_abc123] event-bus unregister | {"action":"unregister","existed":true,"listenerCount":0}
```

---

### 6.2 Hook 处理诊断日志

**控制台输出（event-hook-handler.ts）：**

```typescript
// session.idle 事件
console.log(`[sFlow] event hook received session.idle: type=${event.type}, sessionID=${properties.sessionID}`);
console.log(`[sFlow] eventBus.dispatch result: matched=${matched}`);

// session.status 事件（兜底）
console.log(`[sFlow] event hook received session.status idle: sessionID=${statusData.sessionID}`);
console.log(`[sFlow] eventBus.dispatch (from session.status) result: matched=${matched}`);
```

**日志示例：**

```text
[sFlow] event hook received: type=session.idle
[sFlow] event hook received session.idle: type=session.idle, sessionID=ses_abc123
[sFlow] eventBus.dispatch result: matched=true
[sFlow] session.idle/status event handled and dispatched to event bus
```

---

### 6.3 轮询诊断日志

**pollSessionCompletion 日志（polling.ts）：**

```typescript
// 启动日志
await activeLogger.log(sessionID, 'start polling', {
  maxWaitMs: MAX_WAIT,
  isNew,
  probeMode,
  eventDriven,
  fallbackThreshold
});

// 事件到达日志
await activeLogger.log(sessionID, 'event received', {
  source: 'event.hook',
  type: event.type,
  eventSessionID: event.properties.sessionID,
  targetSessionID: sessionID,
  matched: true,
});

// 轮询降级日志
await activeLogger.log(sessionID, 'fallback to polling', {
  reason: 'event not received within threshold',
  elapsed: `${elapsed}ms`,
  threshold: `${fallbackThreshold}ms`,
});

// 完成日志
await activeLogger.log(sessionID, 'completed', { reason, elapsed: `${elapsed}ms` });
```

**日志示例：**

```text
[2024-01-15T10:30:00.000Z] [INFO] [ses_abc123] start polling | {"maxWaitMs":30000,"isNew":true,"probeMode":false,"eventDriven":true,"fallbackThreshold":25000}
[2024-01-15T10:30:00.050Z] [INFO] [ses_abc123] event received | {"source":"event.hook","type":"session.idle","eventSessionID":"ses_abc123","targetSessionID":"ses_abc123","matched":true}
[2024-01-15T10:30:00.051Z] [INFO] [ses_abc123] completed | {"reason":"event_hook","elapsed":"51ms"}
```

---

## 7. 状态流

### 7.1 子 agent 生命周期

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

### 7.2 BackgroundTaskEntry 字段说明

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

## 8. 时序图

### 8.1 同步模式时序

```text
父 Agent         call_flow_agent      子 Session    pollSessionCompletion    EventBus    Hooks.event
  │                    │                  │                 │                  │              │
  ├─ call_flow_agent ─→│                  │                 │                  │              │
  │  (run_in_background=false)│            │                 │                  │              │
  │                    ├─ session.create ─→│                 │                  │              │
  │                    │  (parentID=父sessionID)│             │                  │              │
  │                    │←─── sessionID ───┤                 │                  │              │
  │                    │                  │                 │                  │              │
  │                    ├─ session.prompt ─→│                 │                  │              │
  │                    │  (prompt + model)│                 │                  │              │
  │                    │                  │                 │                  │              │
  │                    ├─ pollSessionCompletion ───────────→│                  │              │
  │                    │                  │                 ├─ eventBus.register(sessionID, wakeUp) ─→│
  │                    │                  │                 │                  │              │
  │                    │                  │←─ 执行任务 ─────┤                  │              │
  │                    │                  │                 │                  │              │
  │                    │                  ├─ session.idle ───────────────────────────────────→│
  │                    │                  │                 │                  │←─ event ─────┤
  │                    │                  │                 │                  ├─ dispatch(sessionID, event) ─→│
  │                    │                  │                 │←─ wakeUp() ──────┤              │
  │                    │                  │                 ├─ eventBus.unregister(sessionID) ────→│
  │                    │←─────────────────────────────────┤                  │              │
  │                    │  (output)        │                 │                  │              │
  │                    │                  │                 │                  │              │
  │                    ├─ writeNotification ────────────────┤                  │              │
  │                    │  (sync_completed)│                 │                  │              │
  │                    │                  │                 │                  │              │
  │←───── result ──────┤                  │                 │                  │              │
  │                    │                  │                 │                  │              │
```

---

### 8.2 异步模式时序（含 Watcher）

```text
父 Agent      call_flow_agent   子 Session   BackgroundTaskWatcher   pollSessionCompletion   EventBus   Hooks.event
  │                 │               │                │                      │                  │           │
  ├─ call_flow_agent ─→│             │                │                      │                  │           │
  │  (run_in_background=true)│        │                │                      │                  │           │
  │                 ├─ session.create ─→│             │                      │                  │           │
  │                 │←─── sessionID ───┤             │                      │                  │           │
  │                 ├─ session.prompt ─→│             │                      │                  │           │
  │                 │               │                │                      │                  │           │
  │←─── task_id ────┤               │                │                      │                  │           │
  │  (立即返回)     │               │                │                      │                  │           │
  │                 │               │                │                      │                  │           │
  │  （父 agent 继续执行其他任务）    │                │                      │                  │           │
  │                 │               │                │                      │                  │           │
  │                 │               │                ├─ setInterval(200ms) ─→│                  │           │
  │                 │               │                │                      │                  │           │
  │                 │               │←─ 执行任务 ────┤                      │                  │           │
  │                 │               │                │                      │                  │           │
  │                 │               │                ├─ pollSessionCompletion ─────────────────→│           │
  │                 │               │                │  (probeMode, 1s)     ├─ eventBus.register ────→│           │
  │                 │               │                │                      │                  │           │
  │                 │               ├─ session.idle ─────────────────────────────────────────────────────→│
  │                 │               │                │                      │                  │←─ event ──┤
  │                 │               │                │                      │                  ├─ dispatch ─→│
  │                 │               │                │                      │←─ wakeUp() ──────┤           │
  │                 │               │                │                      ├─ eventBus.unregister ──→│           │
  │                 │               │                ├─ 检测完成            │                  │           │
  │                 │               │                │                      │                  │           │
  │                 │               │                ├─ writeNotification ────────────────────────→│           │
  │                 │               │                │  (async_completed)   │                  │           │
  │                 │               │                │                      │                  │           │
  │  （后续通过 flowagent_output 取结果）│             │                      │                  │           │
  │                 │               │                │                      │                  │           │
```

---

### 8.3 交互模式时序

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

## 9. 关键改造点总结

### 9.1 事件驱动改造（事件总线 + 插件 Hooks.event）

**问题：** 纯轮询模式下，子 agent 完成后需要等待下一个轮询周期（200ms）才能检测到，导致延迟。

**解决方案：**
- 引入全局事件总线（`features/event-bus.ts`），Map<sessionID, listener> 模式
- 插件注册 `Hooks.event` hook 监听 OpenCode runtime 的 `session.idle` 和 `session.status` 事件
- 使用共享函数 `handleSessionIdleEvent(event, prefix)` 处理事件：
  - **session.idle 事件**：直接派发到事件总线
  - **session.status 事件**：检查 `status.type === 'idle'` 时派发（兜底机制）
- 事件到达时通过事件总线派发，立即唤醒 pollSessionCompletion（`wakeUp()`）
- 超过 `fallbackThreshold`（默认 25s）未收到事件时，自动降级到纯轮询
- 完成后注销监听器，防止内存泄漏

**影响：**
- 同步模式响应速度提升 4 倍（200ms → <50ms）
- 异步模式 watcher 探测更及时
- 解决了 30s 超时问题（事件驱动 + 轮询降级双保险）
- 无外部依赖，轻量级实现（无消息队列、无 EventEmitter、无 RxJS）
- 兜底机制：当插件不推送独立的 `session.idle` 事件时，通过 `session.status` 事件检测

---

### 9.2 完成检测增强（P3）

**问题：** 子 agent 输出可能不完整（截断、错误），导致父 agent 收到无效结果。

**解决方案：**
- STRICT agents（spec-writer, contract-builder）必须输出 `[TASK_COMPLETE]` 或 JSON
- 缺少完成信号时注入 system reminder 并重试（最多 2 次）
- LOOSE agents 使用宽松检测（报告关键词或输出长度）

**影响：**
- spec-writer/contract-builder 输出完整性保证
- 减少无效结果传递给下游 agent

---

### 9.3 并发保护增强（R1.4, P1-1）

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

## 10. 文件路径索引

| 功能 | 文件路径 |
|------|---------|
| 子 agent 调用入口 | `packages/plugin-infra/src/tools/call-flow-agent.ts` |
| 完成检测核心 | `packages/plugin-infra/src/helpers/polling.ts` |
| 完成信号检测 | `packages/plugin-infra/src/helpers/completion-detector.ts` |
| **全局事件总线** | `packages/plugin-infra/src/features/event-bus.ts` |
| **事件 Hook 处理函数** | `packages/plugin-infra/src/features/event-hook-handler.ts` |
| 通知管理 | `packages/plugin-infra/src/features/notification-manager.ts` |
| 子 agent 状态存储 | `packages/plugin-infra/src/features/subagent-store.ts` |
| 轮询日志 | `packages/plugin-infra/src/features/polling-logger.ts` |
| 类型定义 | `packages/plugin-infra/src/types.ts` |
| 插件入口 | `packages/plugin-infra/src/sflow-plugin-factory.ts` |

---

**文档版本：** v1.3.0
**最后更新：** 2026-08-11
**基于代码版本：** opencode-flow-engine main branch
**更新内容：** 补充 session.status 兜底机制、共享 hook 处理函数、竞态条件保护、事件到达检测场景
