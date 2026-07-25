# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **AFK Mode for SFlow Workflow** - Away From Keyboard / 无人值守模式
  - Horizontal command registration: `开启afk` / `启动AFK` / `进入无人值守模式` / `/flow-afk`
  - Tier support: Tier 1 (default), Tier 2, Tier 3 with progressive automation
  - State.json AFK fields: `afk: boolean` + `afkTier: number`
  - Auto-close on terminal states: `closing` / `abandoned`
  - Phase 0 recognition in workflow-router
  - AFK Mode Rules in sFlow agent instructions
  - Comprehensive test coverage (6 test cases + non-interference verification)

### Changed

- Enhanced `writeStateFile` to support AFK fields and auto-close logic
- Enhanced `restoreState` to force-close AFK on terminal state detection
- Enhanced `workflow-router` Phase 0 to handle `set-afk-on` action
- Enhanced `spec-flow.ts` with AFK Intent Gate entry and AFK Mode Rules

### Fixed

- N/A (new feature, no fixes)

### Security

- N/A (no security implications)

---

## [1.0.0] - 2026-07-26

### Added

- Initial release of opencode-flow-engine
- SFlow workflow with 9 states and 9 specialized agents
- IFlow workflow with 6 states and 5 specialized subagents
- Shared horizontal commands system
- Comprehensive test suite (1963 tests)
- Plugin infrastructure for OpenCode

---

[Unreleased]: https://github.com/your-org/opencode-flow-engine/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/your-org/opencode-flow-engine/releases/tag/v1.0.0
