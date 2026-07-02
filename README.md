# sFlow - OpenCode Plugin

OpenSpec planning engine + Superpowers execution discipline for OpenCode.

## Overview

sFlow is an OpenCode plugin that integrates:

- **OpenSpec** - Planning engine for requirements, specs, and proposals
- **Superpowers** - Execution discipline with TDD, code review, and systematic debugging

## Features

### Workflow Management

- 8-state workflow: exploring → specifying → bridging → approved-for-build → executing → debugging → closing → abandoned
- Automatic state detection and routing
- Guard conditions to prevent invalid transitions

### Agents

| Agent | Mode | Description |
|-------|------|-------------|
| sFlow | Primary | Main orchestrator, routes to subagents |
| need-explorer | Subagent | Requirement clarification |
| spec-writer | Subagent | Artifact generation with validation |
| contract-builder | Subagent | Bridge contract creation |
| build-executor | Subagent | TDD execution |
| bug-investigator | Subagent | Systematic debugging |
| code-reviewer | Subagent | Code quality review |
| release-archivist | Subagent | Closure and archiving |
| spec-merger | Subagent | Delta spec synchronization |

### Tools

- `workflow_router` - Detect current state and route to appropriate skill
- `contract_validator` - Validate execution contracts
- `artifact_inspector` - Inspect planning artifacts

### Hooks

- `state_transition` - Manage workflow state transitions
- `artifact_validation` - Validate artifacts on transitions
- `guard` - Guard state transitions and block invalid operations

### Features

- `workflow_manager` - Manage workflow execution
- `state_manager` - Manage workflow state

## Installation

### From npm

```bash
npm install -g opencode-sflow
```

### From source

```bash
git clone https://gitee.com/opencode-plugin/opencode-sflow.git
cd opencode-sflow
npm install
npm run build
```

## Configuration

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-sflow"]
}
```

Or create `.opencode/sflow.json`:

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

## Usage

### Starting a Workflow

```
"开始一个新功能" 或 "start a workflow"
```

The sFlow agent will:
1. Detect current state
2. Route to appropriate subagent
3. Guide you through the workflow

### Continuing a Workflow

```
/continue
```

### Checking Status

```
/status
```

## Workflow States

1. **exploring** - Requirement clarification with need-explorer
2. **specifying** - Artifact generation with spec-writer
3. **bridging** - Contract creation with contract-builder
4. **approved-for-build** - Contract approved, ready for execution
5. **executing** - Implementation with build-executor
6. **debugging** - Bug investigation with bug-investigator
7. **closing** - Verification with release-archivist
8. **abandoned** - Terminal state

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

### Lint

```bash
npm run lint
```

## Architecture

```
opencode-sflow/
├── packages/
│   ├── core/                    # Schema, validation, parsing
│   ├── opencode-adapter/        # Agents, hooks, tools, features
│   └── shared/                  # Shared utilities
├── skills/                      # Skill definitions
├── scripts/                     # Helper scripts
├── hooks/                       # Session hooks
└── templates/                   # Artifact templates
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run the test suite
6. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [OpenSpec](https://github.com/Fission-AI/OpenSpec) - Planning engine
- [Superpowers](https://github.com/obra/superpowers) - Execution discipline
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) - Architecture inspiration
