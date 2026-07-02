# sFlow - OpenCode 插件

OpenSpec 规划引擎 + Superpowers 执行纪律，集成于 OpenCode。

## 概述

sFlow 是一个 OpenCode 插件，融合了两大核心能力：

- **OpenSpec** — 需求、规格说明书与提案的规划引擎
- **Superpowers** — TDD、代码审查与系统化调试的执行纪律

## 功能特性

### 工作流管理

- 8 状态工作流：探索 → 规格说明 → 桥接 → 批准构建 → 执行 → 调试 → 关闭 → 废弃
- 自动状态检测与路由
- 守卫条件防止非法状态转换

### 智能体

| 智能体 | 模式 | 说明 |
|--------|------|------|
| sFlow | 主智能体 | 工作流总控，路由到子智能体 |
| need-explorer | 子智能体 | 需求澄清 |
| spec-writer | 子智能体 | 制品生成与校验 |
| contract-builder | 子智能体 | 执行合约创建 |
| build-executor | 子智能体 | TDD 驱动执行 |
| bug-investigator | 子智能体 | 系统化调试 |
| code-reviewer | 子智能体 | 代码质量审查 |
| release-archivist | 子智能体 | 关闭与归档 |
| spec-merger | 子智能体 | 增量规格同步 |

### 工具

- `workflow_router` — 检测当前状态并路由到对应技能
- `contract_validator` — 校验执行合约
- `artifact_inspector` — 审查规划制品

### 钩子

- `state_transition` — 管理工作流状态转换
- `artifact_validation` — 状态转换时校验制品
- `guard` — 守卫状态转换，拦截非法操作

### 功能开关

- `workflow_manager` — 管理工作流执行
- `state_manager` — 管理工作流状态

## 安装

### 通过 npm

```bash
npm install -g opencode-sflow
```

### 从源码编译

```bash
git clone https://gitee.com/opencode-plugin/opencode-sflow.git
cd opencode-sflow
npm install
npm run build
```

## 配置

### OpenCode 配置

在 `opencode.json` 中添加插件：

```json
{
  "plugin": ["opencode-sflow"]
}
```

### 创建 .sflow/config.json

运行初始化命令生成完整配置文件：

```bash
sflow init
```

该命令会在项目根目录创建 `.sflow/config.json`，包含全部 9 个智能体的模型配置。

### 用户级全局配置

如果你希望所有项目共享同一套模型配置，可以设置用户级配置：

```bash
sflow init --user
```

该命令会在用户目录创建 `~/.sFlow/config.json`。配置加载优先级如下（从高到低）：

1. **项目级 `.sflow/config.json`** — 覆盖用户级配置
2. **用户级 `~/.sFlow/config.json`** — 全局默认

这样你只需配置一次模型，每个项目按需覆盖即可。

### 自定义智能体模型

编辑 `.sflow/config.json`，可单独为每个智能体指定模型、温度参数和备用模型：

```json
{
  "agents": {
    "sflow": {
      "model": "deepseek-v4-flash",
      "temperature": 0.6,
      "fallbackModels": ["glm-5.1", "kimi-k2.6"]
    }
  }
}
```

## 使用方式

### 1. 构建插件

```bash
cd opencode-sflow
npm run build
```

### 2. 注册为本地包

```bash
cd opencode-sflow
npm link
```

### 3. 在目标项目中链接

进入你想使用 sFlow 工作流的项目目录，链接插件包：

```bash
cd /path/to/your-project
npm link opencode-sflow
```

### 4. 配置 opencode.json

在目标项目的 `opencode.json` 中添加插件：

```json
{
  "plugin": ["opencode-sflow"]
}
```

### 5. 初始化工作流配置

```bash
# 项目级配置（推荐）
node bin/sflow.js init

# 或用户级全局配置（所有项目共享）
node bin/sflow.js init --user
```

项目级会在当前目录生成 `.sflow/config.json`，用户级会在 `~/.sFlow/config.json` 生成。两者叠加生效，项目级优先。

### 开启工作流

在 OpenCode 聊天框输入：

```
"开始一个新功能" 或 "start a workflow"
```

sFlow 主智能体会：
1. 检测当前工作流状态
2. 路由到对应的子智能体
3. 引导你逐步完成工作流

### 继续工作流

```
/continue
```

### 查看状态

```
/status
```

## 工作流状态

1. **exploring（探索）** — need-explorer 负责需求澄清
2. **specifying（规格说明）** — spec-writer 负责制品生成
3. **bridging（桥接）** — contract-builder 负责合约创建
4. **approved-for-build（批准构建）** — 合约已批准，准备执行
5. **executing（执行）** — build-executor 负责实现
6. **debugging（调试）** — bug-investigator 负责缺陷排查
7. **closing（关闭）** — release-archivist 负责验收
8. **abandoned（废弃）** — 终止状态

## 智能体默认模型

| 智能体 | 默认模型 | 备用模型 |
|--------|----------|----------|
| sFlow | deepseek-v4-flash | glm-5.1, kimi-k2.6 |
| need-explorer | kimi-k2.6 | glm-5.1, deepseek-v4-flash |
| spec-writer | glm-5.1 | kimi-k2.6, deepseek-v4-flash |
| contract-builder | glm-5 | glm-5.1, deepseek-v4-flash |
| build-executor | step-3.7-flash | deepseek-v4-flash, glm-5.1 |
| bug-investigator | minimax-m2.7 | deepseek-v4-flash, glm-5.1 |
| code-reviewer | deepseek-v4-flash | glm-5.1, kimi-k2.6 |
| release-archivist | mimo-v2.5-pro | mimo-v2.5, glm-5.1 |
| spec-merger | mimo-v2.5 | mimo-v2.5-pro, glm-5.1 |

## 模型优先级

模型选择遵循以下优先级（从高到低）：

1. **AgentOverrides**（编程传入的覆写参数）
2. **createAgent 的 model 参数**
3. **.sflow/config.json 配置文件**
4. **代码内建的 DEFAULT_MODELS**

## 项目结构

```
opencode-sflow/
├── packages/
│   ├── core/                    # 模式、校验、解析
│   ├── opencode-adapter/        # 智能体、钩子、工具、功能
│   └── shared/                  # 共享工具
├── skills/                      # 技能定义
├── scripts/                     # 辅助脚本
├── hooks/                       # 会话钩子
├── templates/                   # 制品模板
├── config.example.json          # 配置示例
└── .sflow/
    └── config.json              # 实际配置文件（由 sflow init 生成）
```

## 开发

### 前置条件

- Node.js 20+
- npm 或 yarn

### 本地开发

```bash
git clone https://github.com/your-org/opencode-sflow.git
cd opencode-sflow
npm install
```

### 构建

```bash
npm run build
```

### 测试

```bash
npm test
```

### 代码检查

```bash
npm run lint
```

## 贡献

1. Fork 本仓库
2. 创建功能分支
3. 提交你的变更
4. 编写测试用例
5. 运行完整测试套件
6. 提交 Pull Request

## 许可证

MIT License — 详见 [LICENSE](LICENSE)

## 致谢

- [OpenSpec](https://github.com/Fission-AI/OpenSpec) — 规划引擎
- [Superpowers](https://github.com/obra/superpowers) — 执行纪律
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) — 架构灵感
