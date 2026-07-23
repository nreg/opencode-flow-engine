在 OpenCode 插件机制的实现上，借鉴了成熟的插件项目 `@oh-my-openagent`。以下几点：

**1. Agent 定义和调用**

借鉴 oh-my-openagent 的 agent 工厂模式（`createXXXAgent`）和模式系统（primary/subagent/all）。

**2. 父子 agent 通信**

借鉴 oh-my-openagent 的 Team Mode 和 mailbox 系统。

**3. Skill 内置**

借鉴 oh-my-openagent 的 builtin-skills 模式：

- 将 spec-superflow 的技能转换为 `BuiltinSkill` 对象
- 实现 `BuiltinSkill` 接口：name、description、content、MCP 配置
- 注册到 `createBuiltinSkills()` 工厂

**4. MCP 内置**

借鉴 oh-my-openagent 的三层 MCP 系统：

- 将 spec-superflow 的验证引擎和解析器包装为 MCP 服务器
- 作为 Tier 1 (Built-in) MCP 注册
- 或者作为 Tier 3 (Skill-embedded) MCP，跟随特定技能加载

**5. 状态管理**

借鉴 oh-my-openagent 的 boulder-state 模式：

- 创建一个状态管理模块，类似 boulder-state
- 管理 spec-superflow 的 8 个状态
- 支持跨会话持久化

**6. 钩子系统**

借鉴 oh-my-openagent 的 5 层钩子组合：

- Session hooks — 会话生命周期
- ToolGuard hooks — 工具执行前/后
- Transform hooks — 消息转换
- Continuation hooks — 继续执行
- Skill hooks — 技能加载

**7. 模型绑定**

借鉴 oh-my-openagent 的模型解析管道（override → category-default → provider-fallback → system-default）。

> **注意**：oh-my-openagent 的 `BackgroundManager` 有 ~100 个文件，极其庞大（处理了并发限制、fallback、parent-wake、dedupe、compaction-aware 等）。
> sFlow 只借鉴模式（3 个工具接口），不复制 ~100 文件的 `BackgroundManager`：

```
┌─────────────────────────────────────────────────────┐
│  sflow 需要的 3 个工具（轻量版）                      │
│                                                     │
│  call_flow_agent(subagent, prompt, run_in_background)│
│    ├─ run_in_background=true → 返回 task_id          │
│    └─ run_in_background=false → 同步等待结果         │
│                                                     │
│  flowagent_output(task_id) → 取子 agent 结果        │
│  flowagent_cancel(task_id) → 取消子 agent           │
└─────────────────────────────────────────────────────┘
```

### 