# sFlow 项目总结

## 项目概述

sFlow 是一个 OpenCode 插件，集成了 OpenSpec 规划引擎和 Superpowers 执行纪律。

## 项目结构

```
opencode-sflow/
├── packages/
│   ├── core/                    # 核心引擎（从 spec-superflow 移植）
│   │   ├── src/
│   │   │   ├── schema/         # 类型定义
│   │   │   ├── validation/     # 验证器
│   │   │   └── parsing/        # 解析器
│   │   └── package.json
│   ├── opencode-adapter/        # OpenCode 适配器（借鉴 oh-my-openagent）
│   │   ├── src/
│   │   │   ├── agents/         # Agent 定义
│   │   │   ├── hooks/          # 钩子
│   │   │   ├── tools/          # 工具
│   │   │   └── features/       # 功能模块
│   │   └── package.json
│   └── shared/                  # 共享工具
├── skills/                      # 工作流技能（从 spec-superflow 移植）
│   ├── workflow-start/
│   ├── need-explorer/
│   ├── spec-writer/
│   ├── contract-builder/
│   ├── build-executor/
│   ├── bug-investigator/
│   ├── code-reviewer/
│   ├── release-archivist/
│   └── spec-merger/
├── scripts/                     # 辅助脚本
├── hooks/                       # 会话钩子
├── templates/                   # 工件模板
├── bin/                         # CLI 入口
└── package.json
```

## 核心模块

### 1. 核心引擎 (`packages/core`)

从 spec-superflow 移植的核心功能：

- **Schema 类型定义**：Requirement, Spec, Delta, Change 等
- **验证器**：验证 proposal, spec, delta spec, tasks, execution contract
- **解析器**：解析 markdown 文件，提取 requirement blocks

### 2. OpenCode 适配器 (`packages/opencode-adapter`)

借鉴 oh-my-openagent 的架构：

#### Agent 系统

- **sFlow** (主 agent)：编排器，负责状态检测和路由
- **need-explorer**：需求澄清
- **spec-writer**：工件生成
- **contract-builder**：桥接契约
- **build-executor**：TDD 执行
- **bug-investigator**：调试
- **code-reviewer**：代码审查
- **release-archivist**：收口
- **spec-merger**：同步

#### 工具系统

- `workflow_router`：状态检测和路由
- `contract_validator`：契约验证
- `artifact_inspector`：工件检查
- `sflow_delegate`：子 agent 任务路由（原生，无外部依赖）
- `validate_*` 系列：制品校验工具集
- `record_decision_point`：决策点记录

#### 钩子系统

- `state_transition`：状态转换管理
- `artifact_validation`：工件验证
- `guard`：守卫条件

#### 功能模块

- `workflow_manager`：工作流管理
- `state_manager`：状态管理

### 3. 技能系统 (`skills`)

从 spec-superflow 移植的 9 个技能：

1. `workflow-start`：主入口点
2. `need-explorer`：需求澄清
3. `spec-writer`：工件生成
4. `contract-builder`：桥接契约
5. `build-executor`：TDD 执行
6. `bug-investigator`：调试
7. `code-reviewer`：代码审查
8. `release-archivist`：收口
9. `spec-merger`：同步

## 工作流状态

8 个状态：

1. `exploring` - 需求澄清
2. `specifying` - 工件生成
3. `bridging` - 桥接契约
4. `approved-for-build` - 契约批准
5. `executing` - 执行实现
6. `debugging` - 调试问题
7. `closing` - 验证收口
8. `abandoned` - 终止状态

## 下一步计划

### 1. 完善核心引擎

- [ ] 实现完整的验证逻辑
- [ ] 实现完整的解析逻辑
- [ ] 添加单元测试

### 2. 完善 OpenCode 适配器

- [ ] 实现 agent 工厂模式
- [ ] 实现工具注册系统
- [ ] 实现钩子组合系统
- [ ] 实现功能模块

### 3. 完善技能系统

- [ ] 实现技能加载机制
- [ ] 实现技能 MCP 集成
- [ ] 添加技能测试

### 4. 完善 CLI

- [ ] 实现 init 命令
- [ ] 实现 status 命令
- [ ] 实现 validate 命令

### 5. 测试和文档

- [ ] 编写单元测试
- [ ] 编写集成测试
- [ ] 编写用户文档
- [ ] 编写开发者文档

## 架构优势

### 1. 借鉴 oh-my-openagent

- **模块化架构**：清晰的包结构
- **Agent 工厂模式**：易于扩展和维护
- **钩子系统**：灵活的生命周期管理
- **工具系统**：可插拔的工具注册

### 2. 移植 spec-superflow

- **自包含引擎**：不依赖外部运行时
- **类型安全**：完整的 TypeScript 类型定义
- **验证系统**：Schema 验证确保质量
- **解析系统**：自动解析 markdown 文件

### 3. 插件内置

- **零外部依赖**：子 agent 路由使用自注册的 `sflow_delegate` 工具，无需 oh-my-openagent
- **自包含**：所有功能内置到插件中，仅需 OpenCode 本体
- **隔离性**：每个 agent 有自己的工具和钩子

## 技术栈

- **运行时**：Bun
- **语言**：TypeScript
- **包管理**：npm workspaces
- **构建**：tsc
- **测试**：bun test
- **代码风格**：biome

## 参考项目

- [spec-superflow](https://github.com/MageByte-Zero/spec-superflow) - 核心逻辑来源
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) - 架构参考
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) - 规划引擎
- [Superpowers](https://github.com/obra/superpowers) - 执行纪律
