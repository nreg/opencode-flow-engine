---
name: ui-ux-pro-max
description: "AI-powered UI/UX design intelligence with 57 UI styles, 95+ color palettes, 56 font pairings, 25 chart types, and 100+ industry-specific reasoning rules across 12 tech stacks. Use when designing, building, creating, implementing, reviewing, fixing, or improving UI/UX code for websites, landing pages, dashboards, SaaS, e-commerce, portfolios, and mobile apps."
allowed-tools: Read,Bash
---

# UI/UX Pro Max - Design Intelligence

Comprehensive design guide for web and mobile applications. Contains 57 styles, 95+ color palettes, 56 font pairings, 99 UX guidelines, and 25 chart types across 12 technology stacks. Searchable database with BM25-based priority recommendations.

## Core Responsibilities

1. **Design System Generation** - Generate complete design systems with pattern, style, colors, typography, and effects
2. **Style Selection** - Match UI styles to product types with reasoning
3. **UX Compliance** - Enforce accessibility, performance, and interaction standards
4. **Stack Adaptation** - Provide implementation-specific best practices for 12 tech stacks

## When to Apply

Reference these guidelines when:
- Designing new UI components or pages
- Choosing color palettes and typography
- Reviewing code for UX issues
- Building landing pages or dashboards
- Implementing accessibility requirements

## Quick Start Workflow

### Step 1: Analyze Requirements

Extract from user request:
- Product type (SaaS, e-commerce, portfolio, dashboard, landing page)
- Style keywords (minimal, playful, professional, elegant, dark mode)
- Industry (healthcare, fintech, gaming, education)
- Stack (React, Vue, Next.js, or default to `html-tailwind`)

### Step 2: Generate Design System

**Always start with `--design-system`**:

```bash
python3 ${CODEBUDDY_PLUGIN_ROOT}/skills/ui-ux-pro-max/scripts/search.py "<product_type> <industry> <keywords>" --design-system [-p "Project Name"]
```

This searches 5 domains in parallel (product, style, color, landing, typography) and returns complete design system with reasoning.

**Example:**
```bash
python3 ${CODEBUDDY_PLUGIN_ROOT}/skills/ui-ux-pro-max/scripts/search.py "beauty spa wellness service" --design-system -p "Serenity Spa"
```

### Step 3: Supplement with Domain Searches

```bash
python3 ${CODEBUDDY_PLUGIN_ROOT}/skills/ui-ux-pro-max/scripts/search.py "<keyword>" --domain <domain> [-n <max_results>]
```

| Need | Domain | Example |
|------|--------|---------|
| More style options | `style` | `--domain style "glassmorphism dark"` |
| Chart recommendations | `chart` | `--domain chart "real-time dashboard"` |
| UX best practices | `ux` | `--domain ux "animation accessibility"` |
| Alternative fonts | `typography` | `--domain typography "elegant luxury"` |
| Landing structure | `landing` | `--domain landing "hero social-proof"` |

### Step 4: Stack Guidelines

Default to `html-tailwind` if not specified:

```bash
python3 ${CODEBUDDY_PLUGIN_ROOT}/skills/ui-ux-pro-max/scripts/search.py "<keyword>" --stack html-tailwind
```

Available stacks: `html-tailwind`, `react`, `nextjs`, `vue`, `nuxtjs`, `nuxt-ui`, `svelte`, `swiftui`, `react-native`, `flutter`, `shadcn`, `jetpack-compose`

## Decision Framework

### Priority-Based Rule Application

Apply rules in priority order:

1. **Accessibility** - Color contrast, focus states, alt text, ARIA labels, keyboard nav, form labels
2. **Touch & Interaction** - Touch targets (44x44px min), hover vs tap, loading states, error feedback, cursor pointer
3. **Performance** - Image optimization, reduced motion, content jumping prevention
4. **Layout & Responsive** - Viewport meta, readable font size (16px min), no horizontal scroll, z-index scale
5. **Typography & Color** - Line height (1.5-1.75), line length (65-75 chars), font pairing
6. **Animation** - Duration (150-300ms), transform performance, loading states
7. **Style Selection** - Match style to product, consistency, no emoji icons
8. **Charts & Data** - Match chart type to data, accessible colors, table alternatives

### Common Pitfalls to Avoid

- Using emojis as UI icons (use SVG instead)
- Hover states that cause layout shift
- Missing `cursor-pointer` on interactive elements
- Insufficient contrast in light mode
- Content hidden behind fixed navbars
- Inconsistent container widths

## Available Domains

| Domain | Use For | Example Keywords |
|--------|---------|------------------|
| `product` | Product type recommendations | SaaS, e-commerce, portfolio, healthcare, beauty |
| `style` | UI styles, colors, effects | glassmorphism, minimalism, dark mode, brutalism |
| `typography` | Font pairings, Google Fonts | elegant, playful, professional, modern |
| `color` | Color palettes by product type | saas, ecommerce, healthcare, beauty, fintech |
| `landing` | Page structure, CTA strategies | hero, testimonial, pricing, social-proof |
| `chart` | Chart types, library recommendations | trend, comparison, timeline, funnel |
| `ux` | Best practices, anti-patterns | animation, accessibility, z-index, loading |
| `icons` | Icon library guidance | lucide, heroicons, svg, glyph |
| `react` | React/Next.js performance | waterfall, bundle, suspense, memo, rerender |
| `web` | Web interface guidelines | aria, focus, keyboard, semantic, virtualize |

## Output Formats

```bash
# ASCII box (default) - terminal display
python3 ${CODEBUDDY_PLUGIN_ROOT}/skills/ui-ux-pro-max/scripts/search.py "fintech crypto" --design-system

# Markdown - documentation
python3 ${CODEBUDDY_PLUGIN_ROOT}/skills/ui-ux-pro-max/scripts/search.py "fintech crypto" --design-system -f markdown
```

## Tips for Better Results

1. Be specific with keywords - "healthcare SaaS dashboard" > "app"
2. Search multiple times - Different keywords reveal different insights
3. Combine domains - Style + Typography + Color = Complete design system
4. Always check UX - Search "animation", "z-index", "accessibility" for common issues
5. Use stack flag - Get implementation-specific best practices
6. Iterate - If first search doesn't match, try different keywords

## Detailed References

For comprehensive guidelines, see:

- **[UX Guidelines](./references/ux-guidelines.md)** - Complete priority-based rule catalog
- **[Workflow Guide](./references/workflow-guide.md)** - Detailed usage instructions and examples
- **[Common Rules](./references/common-rules.md)** - Professional UI standards and anti-patterns
- **[Pre-Delivery Checklist](./references/checklist.md)** - Verification checklist before delivery

## Pre-Delivery Verification

Before delivering UI code, verify:

**Visual Quality:**
- No emojis as icons (use SVG)
- Consistent icon set (Heroicons/Lucide)
- Correct brand logos (Simple Icons)
- Stable hover states
- Direct theme color usage

**Interaction:**
- `cursor-pointer` on all clickable elements
- Clear hover feedback
- Smooth transitions (150-300ms)
- Visible focus states

**Light/Dark Mode:**
- Sufficient contrast (4.5:1 min)
- Visible glass/transparent elements
- Visible borders in both modes

**Layout:**
- Proper floating element spacing
- No content behind fixed navbars
- Responsive at 375px, 768px, 1024px, 1440px
- No horizontal scroll on mobile

**Accessibility:**
- Alt text for images
- Labels for form inputs
- Color not sole indicator
- `prefers-reduced-motion` respected
