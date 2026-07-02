# sFlow - OpenCode Plugin

OpenSpec planning engine + Superpowers execution discipline for OpenCode.

## What is sFlow?

sFlow is an OpenCode plugin that combines:

- **OpenSpec** - A planning engine for creating proposals, specifications, designs, and tasks
- **Superpowers** - An execution discipline with TDD, code review, and systematic debugging

This integration provides a complete workflow from idea to implementation, with guard conditions to ensure quality and consistency.

## Features

- **8-State Workflow**: exploring → specifying → bridging → approved-for-build → executing → debugging → closing → abandoned
- **9 Specialized Agents**: Each agent is an expert in its domain
- **Guard Conditions**: Prevent invalid state transitions
- **TDD Enforcement**: No production code without failing tests
- **Code Review Gates**: Ensure quality at each batch
- **Delta Spec Management**: Track and merge specification changes

## Quick Start

### Installation

```bash
npm install -g opencode-sflow
```

### Configuration

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-sflow"]
}
```

### Usage

Simply start a conversation about what you want to build:

```
"开始一个新功能" 或 "start a workflow"
```

The sFlow agent will guide you through the workflow:

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
npm test
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [OpenSpec](https://github.com/Fission-AI/OpenSpec) - Planning engine
- [Superpowers](https://github.com/obra/superpowers) - Execution discipline
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) - Architecture inspiration
