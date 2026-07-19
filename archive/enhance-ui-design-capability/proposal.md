# Proposal: UI Design Capability Enhancement (Phase 1)

## Why

Frontend projects in SFlow workflow currently lack dedicated aesthetic decision-making. This leads to:
- Generic AI-generated UI aesthetics (templates, defaults, lack of brand character)
- Inconsistent design decisions across implementation
- No systematic approach to align new features with existing visual vocabulary (brownfield projects)
- Missing quality gates for UI code before production

## What Changed

### 1. New ui-director Subagent
Created a specialized agent for UI aesthetic decisions with:
- 7-step guided process from tone selection to design documentation
- 9 tone cards (Minimal, Editorial, Brutalist, Corporate, Playful, Retro, Organic, Futuristic, Artisan)
- 4-question aesthetic framework
- Brownfield visual alignment for existing projects
- 5-dimension design token decision matrix
- 8-category anti-AI-slop checklist (42 rules)

### 2. Enhanced ui-implementer
Added comprehensive quality checks to the frontend implementation agent:
- 8-category checks: Typography, Color, Shadow, Border, Motion, Layout, Copy, Component
- 42 specific rules for detecting and fixing AI-generated aesthetic patterns
- WCAG AA compliance validation
- Design token to code translation

### 3. Workflow Routing Update
- Added ui-design as state #3 in the workflow (frontend projects only)
- Frontend projects route: specifying -> ui-director -> bridging
- Non-frontend projects skip ui-design and go directly to bridging
- ui-design.md becomes required input for bridging in frontend projects

## Benefits
- Consistent, brand-aligned UI design decisions
- Reduced AI aesthetic homogenization
- Better handling of brownfield projects
- Systematic design token production for implementation
