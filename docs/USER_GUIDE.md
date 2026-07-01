# sFlow 用户指南

## 快速开始

### 安装

```bash
npm install -g opencode-sflow
```

### 配置

在你的 `opencode.json` 中添加插件：

```json
{
  "plugin": ["opencode-sflow"]
}
```

或者创建 `.opencode/sflow.json` 配置文件：

```json
{
  "enabled": true,
  "agents": {
    "sflow": {
      "model": "claude-opus-4-7"
    }
  },
  "features": {
    "workflow_manager": true,
    "state_manager": true
  }
}
```

### 使用

启动 OpenCode 并开始对话：

```
/help me add a new feature
```

sFlow agent 会引导你完成整个工作流。

## 工作流状态

sFlow 使用 8 个状态来管理开发工作流：

| 状态 | 描述 | 下一个状态 |
|------|------|------------|
| `exploring` | 需求澄清 | `specifying`, `abandoned` |
| `specifying` | 工件生成 | `bridging`, `exploring`, `abandoned` |
| `bridging` | 桥接契约 | `approved-for-build`, `specifying`, `abandoned` |
| `approved-for-build` | 契约批准 | `executing`, `bridging`, `abandoned` |
| `executing` | 执行实现 | `debugging`, `closing`, `abandoned` |
| `debugging` | 调试问题 | `executing`, `abandoned` |
| `closing` | 验证收口 | `abandoned` |
| `abandoned` | 终止状态 | 无 |

## Agent 系统

### 主 Agent

| Agent | 模式 | 描述 |
|-------|------|------|
| sFlow | 主 agent | 编排器，负责状态检测和路由 |

### 子 Agent

| Agent | 描述 |
|-------|------|
| need-explorer | 需求澄清 |
| spec-writer | 工件生成 |
| contract-builder | 桥接契约 |
| build-executor | TDD 执行 |
| bug-investigator | 调试问题 |
| code-reviewer | 代码审查 |
| release-archivist | 验证收口 |
| spec-merger | 规格同步 |

## 技能系统

sFlow 包含 9 个核心技能：

1. **workflow-start** - 主入口点
2. **need-explorer** - 需求澄清
3. **spec-writer** - 工件生成
4. **contract-builder** - 桥接契约
5. **build-executor** - TDD 执行
6. **bug-investigator** - 调试问题
7. **code-reviewer** - 代码审查
8. **release-archivist** - 验证收口
9. **spec-merger** - 规格同步

## 工件结构

每个变更都有一个标准的工件结构：

```
.sflow/changes/<change-name>/
├── proposal.md              # 提案
├── specs/                   # 规格
│   └── <capability>/spec.md
├── design.md                # 设计
├── tasks.md                 # 任务
├── execution-contract.md    # 执行契约
└── .spec-superflow.yaml    # 状态文件
```

## 常见问题

### 如何开始一个新工作流？

```
/start a new workflow
```

### 如何继续之前的工作？

```
/continue
```

### 如何查看当前状态？

```
/status
```

### 如何验证工件？

```
/validate
```

## 故障排除

### 问题：状态转换被阻止

**解决方案**：检查是否满足所有前置条件。例如，不能在没有执行契约的情况下开始执行。

### 问题：工件验证失败

**解决方案**：查看验证错误信息，修复问题后重新验证。

### 问题：Agent 未响应

**解决方案**：检查 OpenCode 配置，确保 sFlow 插件已正确加载。

## 高级配置

### 自定义 Agent 模型

```json
{
  "agents": {
    "sflow": {
      "model": "gpt-5.5"
    },
    "code-reviewer": {
      "model": "claude-opus-4-7"
    }
  }
}
```

### 禁用特定功能

```json
{
  "features": {
    "workflow_manager": true,
    "state_manager": false
  }
}
```

### 禁用特定钩子

```json
{
  "hooks": {
    "state_transition": true,
    "artifact_validation": true,
    "guard": false
  }
}
```

## 获取帮助

- 查看 [README.md](README.md) 获取完整文档
- 查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解贡献指南
- 提交 GitHub Issue 报告问题
