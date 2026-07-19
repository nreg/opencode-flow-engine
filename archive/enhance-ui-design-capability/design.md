# Design: UI Design Capability Enhancement (Phase 1)

## Architecture Decision

For frontend projects in SFlow workflow, add a dedicated UI aesthetic decision phase between specifying and bridging. This ensures design quality and brand consistency before code implementation begins.

Decision: Create a new ui-director subagent that guides users through a structured 7-step aesthetic decision process, producing ui-design.md as input for the bridging phase.

## Design Constraints

1. Must integrate with existing SFlow agent registry
2. Must not change any existing agent APIs
3. Must support both greenfield (new) and brownfield (existing) projects
4. Must produce machine-readable design tokens (OKLCH format)
5. Must enforce anti-AI-slop rules to avoid generic aesthetics

## Implementation Approach

Agent Architecture:
- ui-director: Aesthetic decision specialist (temperature 0.7, strong profile)
- ui-implementer: Enhanced with 8-category quality checks (temperature 0.6, standard profile)

Routing Logic:
- Frontend projects: specifying -> ui-director -> bridging
- Non-frontend projects: specifying -> bridging (skip ui-design)

Tool Permissions:
- ui-director: read, write, edit, glob, grep, bash, skill, agnes_image_understand
- ui-implementer: read, write, edit, glob, grep, bash, skill, lsp_diagnostics, agnes tools

Design Tokens Output:
- Typography: Family + scale ratio with type scale consistency
- Color: OKLCH format with WCAG AA contrast
- Motion: Standard easing + duration with reduced motion fallback
- Space: 4px/8px grid multiples, no magic numbers
- Texture: Radius/shadow tokens, consistent within project
