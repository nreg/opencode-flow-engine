# opencode-flow-engine - OpenCode Plugin

OpenCode plugin engine with two workflow modes: **SFlow** (OpenSpec + Superpowers) and **IFlow** (GSD-style iterative development).

## What is opencode-flow-engine?

opencode-flow-engine provides two complementary workflows:

### SFlow (Spec Flow)
OpenSpec planning engine + Superpowers execution discipline:
- **OpenSpec** - A planning engine for creating proposals, specifications, designs, and tasks
- **Superpowers** - An execution discipline with TDD, code review, and systematic debugging

### IFlow (Iterative Flow)
GSD-style cyclic workflow for rapid iteration:
- discuss → research → plan → execute → verify → ship → repeat
- 6 specialized subagents for each phase
- Scope integrity enforcement, adversarial verification

> **Architecture Note**: The core validation engine (schema, validation, parsing) is ported from spec-superflow. The runtime architecture (agent factories, 5-tier hook system, MCP tool registration, boulder-state persistence) is newly designed to adapt to OpenCode's plugin mechanism, inspired by oh-my-openagent's architecture patterns. Workflows are defined under `workflows/{sflow,iflow}/` — a shared `packages/plugin-infra/` provides the plugin infrastructure.

## Features (SFlow)

- **8-State Workflow**: exploring → specifying → bridging → approved-for-build → executing → debugging → closing → abandoned
- **9 Specialized Agents**: Each agent is an expert in its domain
- **Guard Conditions**: Prevent invalid state transitions
- **TDD Enforcement**: No production code without failing tests
- **Code Review Gates**: Ensure quality at each batch
- **Delta Spec Management**: Track and merge specification changes

## Features (IFlow)

- **6-State Cyclic Workflow**: discussing → researching → planning → executing → verifying → shipping
- **5 Specialized Subagents**: discuss-planner, researcher, plan-executor, verifier, shipper
- **Scope Reduction Prohibition**: Never reduces requirements without user approval
- **Adversarial Verification**: Goal-backward verification with BLOCKER/WARNING classification
- **Claim Provenance**: Every factual claim tagged with source and confidence level

## Shared Cross-Workflow Agents

- **test-engineer**: Independent comprehensive testing (5-tier test pyramid). Triggered by user commands, not bound to any workflow state.
- **review-engineer**: Independent comprehensive review (3-round review: spec, code, UI). Triggered by user commands, not bound to any workflow state.

## Quick Start

### Installation

```bash
npm install -g opencode-flow-engine
```

### Configuration

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-flow-engine"]
}
```

Or for legacy compatibility:
```json
{
  "plugin": ["opencode-sflow"]
}
```

### Usage

Simply start a conversation with the agent you want to use:

```
"开始一个新功能" 或 "start a workflow"    → talks to sFlow
"开启迭代开发" 或 "start iterative flow" → talks to iFlow
```

The sFlow agent guides you through the OpenSpec-style linear workflow.
The iFlow agent guides you through the GSD-style cyclic workflow:

1. **Exploring**: Clarify requirements with need-explorer
2. **Specifying**: Generate artifacts with spec-writer
3. **Bridging**: Create execution contract with contract-builder
4. **Executing**: Implement with TDD using build-executor
5. **Closing**: Verify and archive with release-archivist

## Documentation

- [README.md](README.md) - Full documentation
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contributing guidelines
- [CHANGELOG.md](CHANGELOG.md) - Version history

## Development

### Prerequisites

- Node.js 20+
- npm or yarn

### Setup

```bash
git clone https://github.com/your-org/opencode-sflow.git
cd opencode-sflow
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
bun test
```

### Attention

> 新增智能体时需要同步白名单：BUILTIN_AGENTS

**Canonical 测试命令 = 仓库根 `bun test`（从仓库根目录执行）。**

原因（P2-1 Gate 修复）：Bun 的 bunfig.toml 只从 cwd 加载、无父目录遍历（官方实证）：

- 仓库根 `bunfig.toml` 的 `[test] preload`（`scripts/test-setup.ts`）把
  `FLOW_ENGINE_LOG_ROOT` 导向 tmpdir，避免测试向真实
  `%USERPROFILE%/.flow-engine/sflow` 写日志——该隔离只在 cwd = 仓库根时生效；
- `packages/plugin-infra/package.json` 自带 `"test": "bun test"`，从包目录跑测试时
  根 bunfig 不生效。该包已增补包级 `bunfig.toml` 挂载同一 preload 兜底，
  但包目录下仍有依赖 cwd = 仓库根的存量用例（如 skills 目录路径）会失败；
- 因此全量测试、CI、提交前验证一律从仓库根执行 `bun test`。

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [OpenSpec](https://github.com/Fission-AI/OpenSpec) - Planning engine
- [Superpowers](https://github.com/obra/superpowers) - Execution discipline
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) - Architecture inspiration
- [flow-kit](https://github.com/rihebty/flow-kit) — Test pyramid, review framework, lateral command system
