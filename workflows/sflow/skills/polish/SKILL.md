---
name: polish
description: Final quality pass before shipping. Fixes alignment, spacing, consistency, and detail issues that separate good from great.
user-invokable: true
args:
  - name: target
    description: The feature or area to polish (optional)
    required: false
---

**First**: Use the frontend-design skill for design principles and anti-patterns.

Perform a meticulous final pass to catch all the small details that separate good work from great work. The difference between shipped and polished.

## Pre-Polish Assessment

Understand the current state and goals:

1. Review completeness:
   - Is it functionally complete?
   - Are there known issues to preserve (mark with TODOs)?
   - What's the quality bar? (MVP vs flagship feature?)
   - When does it ship? (How much time for polish?)

2. Identify polish areas:
   - Visual inconsistencies
   - Spacing and alignment issues
   - Interaction state gaps
   - Copy inconsistencies
   - Edge cases and error states
   - Loading and transition smoothness

**Polish is the last step, not the first.** Don't polish work that's not functionally complete.

## Polish Systematically

Work through these dimensions methodically. See `references/` for detailed standards:

### Visual Alignment & Spacing
See `references/spacing-system.md` for detailed standards:
- Pixel-perfect alignment to grid
- Consistent spacing using spacing scale
- Optical alignment for visual weight
- Responsive consistency at all breakpoints

### Typography Refinement
See `references/typography.md` for detailed standards:
- Hierarchy consistency throughout
- Line length 45-75 characters
- Appropriate line height
- No widows & orphans

### Color & Contrast
See `references/color-contrast.md` for detailed standards:
- WCAG contrast ratios
- Consistent design token usage
- Theme consistency
- Accessible focus indicators

### Interaction States
See `references/interaction-states.md` for detailed standards:
- Every interactive element needs: Default, Hover, Focus, Active, Disabled, Loading, Error, Success states
- Smooth transitions (150-300ms)
- Consistent easing (ease-out-quart/quint/expo)
- 60fps animations
- Respect `prefers-reduced-motion`

### Content & Copy
See `references/content-copy.md` for detailed standards:
- Consistent terminology
- Consistent capitalization
- Grammar & spelling
- Appropriate length

### Icons & Images
See `references/content-copy.md` for detailed standards:
- Consistent style
- Appropriate sizing
- Proper alignment
- Descriptive alt text

### Forms & Inputs
See `references/forms-inputs.md` for detailed standards:
- All inputs properly labeled
- Clear required indicators
- Helpful error messages
- Logical tab order

### Edge Cases & Error States
See `references/edge-cases.md` for detailed standards:
- Loading states for async actions
- Helpful empty states
- Clear error messages with recovery paths
- Handle long content gracefully

### Responsiveness
See `references/responsiveness.md` for detailed standards:
- Test all breakpoints
- Touch targets 44x44px minimum
- No text smaller than 14px on mobile
- No horizontal scroll

### Performance
See `references/performance.md` for detailed standards:
- Fast initial load
- No layout shift (CLS)
- Smooth interactions
- Optimized images

### Code Quality
See `references/code-quality.md` for detailed standards:
- Remove console logs and commented code
- Remove unused imports
- Consistent naming
- Type safety
- Accessibility (ARIA labels, semantic HTML)

## Polish Checklist

Go through systematically:

- [ ] Visual alignment perfect at all breakpoints
- [ ] Spacing uses design tokens consistently
- [ ] Typography hierarchy consistent
- [ ] All interactive states implemented
- [ ] All transitions smooth (60fps)
- [ ] Copy is consistent and polished
- [ ] Icons are consistent and properly sized
- [ ] All forms properly labeled and validated
- [ ] Error states are helpful
- [ ] Loading states are clear
- [ ] Empty states are welcoming
- [ ] Touch targets are 44x44px minimum
- [ ] Contrast ratios meet WCAG AA
- [ ] Keyboard navigation works
- [ ] Focus indicators visible
- [ ] No console errors or warnings
- [ ] No layout shift on load
- [ ] Works in all supported browsers
- [ ] Respects reduced motion preference
- [ ] Code is clean (no TODOs, console.logs, commented code)

**Polish is about details.** Zoom in. Squint at it. Use it yourself. The little things add up.

## **NEVER**

- Polish before it's functionally complete
- Spend hours on polish if it ships in 30 minutes (triage)
- Introduce bugs while polishing (test thoroughly)
- Ignore systematic issues (if spacing is off everywhere, fix the system)
- Perfect one thing while leaving others rough (consistent quality level)

## Final Verification

Before marking as done:

- Use it yourself: Actually interact with the feature
- Test on real devices: Not just browser DevTools
- Ask someone else to review: Fresh eyes catch things
- Compare to design: Match intended design
- Check all states: Don't just test happy path

Remember: You have impeccable attention to detail and exquisite taste. Polish until it feels effortless, looks intentional, and works flawlessly. Sweat the details - they matter.
