# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **GSAP Animation Skills Integration** - GSAP 动效能力整合
  - 8 GSAP skills (gsap-core, gsap-scrolltrigger, gsap-timeline, gsap-draggable, gsap-motionpath, gsap-scrollto, gsap-easepack, gsap-utils) added as distribution source in `workflows/sflow/skills/gsap-*/`
  - ui-implementer Phase 5: Motion & Animation stage with GSAP skill loading
  - install-skills CLI command (`flow-engine install-skills`) for automatic installation to `~/.agents/skills/`
  - Idempotent installation: skips existing skills, no errors on re-run
  - Track 2 mode: uses global skill directory, no Track 1 agent-same-name injection

- **Archive Cleanup Mechanism** - 归档清理机制
  - Auto-executed after DP-7 confirmation in `closing` state
  - Moves active artifacts (proposal.md, design.md, tasks.md, execution-contract.md, specs/) to `.flow-engine/sflow/archive/<change-name>/`
  - Preserves cross-change assets (lessons.md, subagent-store/, notifications/, verification-report.md, archive-metadata.json)
  - Resets state.json to initial state (state: "exploring")
  - Archive is moved, not deleted, preserving audit trail

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

- **listSpecFiles Dual-Path Fallback Removal** - specs 状态检测修复
  - Removed dual-path fallback in `listSpecFiles()` function
  - Now only detects change-specific specs (`.flow-engine/sflow/specs/`), not project root specs
  - Fixes `exploring` state reachability: new workflows can now start normally
  - Maintains backward compatibility: existing workflows unaffected
  - Unit test coverage: 3 test cases (change specs exist, empty change specs, no fallback to project root)

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
