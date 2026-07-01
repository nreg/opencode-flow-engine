# sFlow 开发者指南

## 架构概述

sFlow 采用模块化架构，分为三个主要包：

```
opencode-sflow/
├── packages/
│   ├── core/                    # 核心引擎
│   ├── opencode-adapter/        # OpenCode 适配器
│   └── shared/                  # 共享工具
├── skills/                      # 技能定义
├── scripts/                     # 辅助脚本
├── hooks/                       # 会话钩子
└── templates/                   # 工件模板
```

## 核心引擎 (`packages/core`)

### Schema 类型

定义了所有核心数据类型：

```typescript
// 基础类型
interface Requirement {
  name: string;
  text: string;
  scenarios: Scenario[];
}

interface Spec {
  name: string;
  description: string;
  requirements: Requirement[];
}

interface Delta {
  type: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
  requirementName: string;
  text?: string;
  scenarios?: Scenario[];
}
```

### 验证器

验证所有工件：

```typescript
import { Validator } from '@opencode-sflow/core';

const validator = new Validator();

// 验证提案
const proposalReport = validator.validateProposal(proposalContent);

// 验证规格
const specReport = validator.validateSpec(specContent, 'auth');

// 验证执行契约
const contractReport = validator.validateExecutionContract(contractContent);
```

### 解析器

解析 Markdown 文件：

```typescript
import { 
  extractRequirementsSection,
  parseDeltaSpec,
  parseChangeMarkdown 
} from '@opencode-sflow/core';

// 提取需求部分
const requirements = extractRequirementsSection(specContent);

// 解析增量规格
const deltaPlan = parseDeltaSpec(deltaSpecContent);

// 解析变更 Markdown
const change = parseChangeMarkdown(changeContent);
```

## OpenCode 适配器 (`packages/opencode-adapter`)

### Agent 系统

#### Agent 工厂模式

```typescript
import { createAgent, createAllAgents } from './agents/agent-builder.js';

// 创建单个 agent
const sflowAgent = createAgent('sflow', 'claude-opus-4-7');

// 创建所有 agent
const allAgents = createAllAgents();
```

#### Agent 定义

每个 agent 都是一个工厂函数：

```typescript
import type { AgentFactory } from './types.js';

export const createSFlowAgent: AgentFactory = (model: string) => ({
  id: 'sflow',
  name: 'sFlow',
  model,
  instructions: `...`,
  temperature: 0.1,
  tools: {
    read: true,
    write: false,
    // ...
  },
});

createSFlowAgent.mode = 'primary';
```

### 工具系统

#### 工具注册

```typescript
import { ToolRegistry } from './tools/tool-registry.js';

const registry = new ToolRegistry();
registry.initialize();

// 获取工具
const tool = registry.getTool('workflow_router');

// 执行工具
const result = await registry.executeTool(
  'workflow_router',
  { changeDir: '/path/to/change' },
  { changeDir: '/path/to/change', stateFile: '', pluginRoot: '' }
);
```

#### 自定义工具

```typescript
import type { ToolDefinition } from './types.js';

export function createMyCustomTool(): ToolDefinition {
  return {
    name: 'my_custom_tool',
    description: 'My custom tool',
    parameters: {
      param1: { type: 'string', description: 'Parameter 1' },
    },
    execute: async (params, context) => {
      // 实现逻辑
      return { success: true, data: {} };
    },
  };
}
```

### 钩子系统

#### 钩子组合

```typescript
import { HookComposer } from './hooks/hook-composer.js';

const composer = new HookComposer();
composer.initialize();

// 执行钩子
const result = await composer.executeHook('guard', {
  changeDir: '/path/to/change',
  stateFile: '',
  pluginRoot: '',
  action: 'transition',
  data: { newState: 'executing' },
});

// 执行所有钩子
const allResults = await composer.executeAllHooks(context);
```

#### 自定义钩子

```typescript
import type { HookHandler } from './types.js';

export function createMyCustomHook(): HookHandler {
  return {
    name: 'my_custom_hook',
    description: 'My custom hook',
    execute: async (context) => {
      // 实现逻辑
      return { success: true };
    },
  };
}
```

### 功能模块

#### 功能管理器

```typescript
import { FeatureManager } from './features/feature-manager.js';

const manager = new FeatureManager({
  workflowManager: { enabled: true },
  stateManager: { enabled: true },
  skillsDir: './skills',
});

await manager.initialize();

// 获取状态
const status = manager.getStatus();
```

#### 技能加载

```typescript
import { SkillLoader } from './features/skill-loader.js';

const loader = new SkillLoader('./skills');
loader.loadAllSkills();

// 获取技能
const skill = loader.getSkill('workflow-start');

// 获取技能内容
const content = loader.getSkillContent('workflow-start');
```

#### MCP 管理

```typescript
import { McpManager } from './features/mcp-manager.js';

const manager = new McpManager();

// 启动 MCP 服务器
await manager.startServer('my-server', {
  name: 'my-server',
  command: 'node',
  args: ['server.js'],
});

// 检查状态
const status = manager.getServerStatus('my-server');
```

## 测试

### 单元测试

```bash
# 运行所有测试
bun test

# 运行特定测试
bun test packages/core/src/validation/validator.test.ts
```

### 测试结构

```typescript
import { describe, it, expect } from 'bun:test';
import { Validator } from './validator.js';

describe('Validator', () => {
  it('should validate proposal', () => {
    const validator = new Validator();
    const report = validator.validateProposal(content);
    expect(report.valid).toBe(true);
  });
});
```

## 构建

### 构建所有包

```bash
npm run build
```

### 构建单个包

```bash
cd packages/core && npm run build
cd packages/opencode-adapter && npm run build
cd packages/shared && npm run build
```

## 代码风格

### TypeScript

- 使用严格模式
- 使用 ESNext 模块
- 使用 NodeNext 模块解析

### 文件命名

- 使用 kebab-case
- 测试文件使用 `.test.ts` 后缀

### 导入顺序

1. 外部依赖
2. 内部模块
3. 相对导入

## 贡献指南

### 提交信息

使用 Conventional Commits：

```
feat: add new feature
fix: fix bug
docs: update documentation
refactor: refactor code
test: add tests
chore: update dependencies
```

### 分支策略

- `main` - 稳定版本
- `develop` - 开发分支
- `feature/*` - 功能分支
- `fix/*` - 修复分支

### 代码审查

所有代码变更都需要经过代码审查。

## 故障排除

### 问题：类型错误

**解决方案**：运行 `npm run typecheck` 检查类型错误。

### 问题：测试失败

**解决方案**：运行 `bun test` 查看详细错误信息。

### 问题：构建失败

**解决方案**：检查依赖是否正确安装，运行 `npm install`。
