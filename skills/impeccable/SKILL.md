---
name: impeccable
description: Use when the user wants to design, redesign, shape, critique, audit, polish, clarify, distill, harden, optimize, adapt, animate, colorize, extract, or otherwise improve a frontend interface. Covers websites, landing pages, dashboards, product UI, app shells, components, forms, settings, onboarding, and empty states. Handles UX review, visual hierarchy, information architecture, cognitive load, accessibility, performance, responsive behavior, theming, anti-patterns, typography, fonts, spacing, layout, alignment, color, motion, micro-interactions, UX copy, error states, edge cases, i18n, and reusable design systems or tokens. Also use for bland designs that need to become bolder or more delightful, loud designs that should become quieter, live browser iteration on UI elements, or ambitious visual effects that should feel technically extraordinary. Not for backend-only or non-UI tasks.
version: 3.9.1
user-invocable: true
argument-hint: "[craft|shape · audit|critique · animate|bolder|colorize|delight|layout|overdrive|quieter|typeset · adapt|clarify|distill · harden|onboard|optimize|polish · init|document|extract|live] [target]"
license: Apache 2.0
allowed-tools:
  - Bash(npx impeccable *)
  - Bash(node .opencode/skills/impeccable/scripts/*)
---

Designs and iterates production-grade frontend interfaces. Real working code, committed design choices, exceptional craft.

## Core Workflow

1. **Setup**: Load project context, design system, and register. See [references/setup.md](references/setup.md) for the 6-step initialization process.

2. **Execute**: Apply design guidance, follow command-specific flows, and produce production-grade code. See [references/design-guidance.md](references/design-guidance.md) for rules and [references/commands.md](references/commands.md) for command routing.

3. **Manage**: Use pin/unpin for shortcuts and hooks for auto-detection. See [references/management.md](references/management.md).

## Key Rules

### Design Quality
- Verify contrast: body text ≥4.5:1, large text ≥3:1
- Cap line length at 65-75ch
- Use semantic z-index scales (no arbitrary 999/9999)
- Every animation needs `prefers-reduced-motion` alternative

### Anti-Patterns (Absolute Bans)
- Side-stripe borders (`border-left/right` > 1px as accent)
- Gradient text (`background-clip: text` + gradient)
- Glassmorphism as default decoration
- Hero-metric template (big number + small label + stats)
- Identical card grids (same-sized repeated endlessly)
- Eyebrows on every section (tiny uppercase tracked text)
- Numbered markers on every section (01/02/03)
- Text overflow at any breakpoint

### AI Slop Test
If someone could say "AI made that" without doubt, it's failed. Run category-reflex check at two altitudes:
- First-order: Can theme/palette be guessed from category alone?
- Second-order: Can aesthetic family be guessed from category + anti-references?

## References

- [Setup Process](references/setup.md) - Context loading, register selection, palette generation
- [Design Guidance](references/design-guidance.md) - Color, typography, layout, motion, interaction rules
- [Commands](references/commands.md) - Full command table and routing logic
- [Management](references/management.md) - Pin/unpin shortcuts, hooks configuration
