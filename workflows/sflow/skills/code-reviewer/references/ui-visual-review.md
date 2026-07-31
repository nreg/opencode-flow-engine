# UI Visual Review

Run this additional review round when the change includes UI files (`.css`, `.tsx`, `.vue`, `.html`, `.svelte`) or when `.flow-engine/sflow/ui-design.md` exists.

## Design Token Consistency

Check that implementation colors come from the design token system, not hardcoded values:

```bash
# Find hardcoded hex colors outside token files
grep -rn "#[0-9a-fA-F]\{3,8\}" src/ --include="*.{css,tsx,vue,scss}" | grep -v "tokens\|theme\|variables"
# Find hardcoded font-family declarations
grep -rn "font-family" src/ --include="*.{css,tsx,vue,scss}"
# Find hardcoded spacing values
grep -rn "margin:\|padding:" src/ --include="*.css" | grep -v "var(--"
```

Severity: Hardcoded colors/fonts that should use tokens → CRITICAL

## Anti-Pattern Scan

Common AI-generated UI anti-patterns to check:

- `border-left` as decorative stripe → CRITICAL
- Tags/labels starting with `#` → IMPORTANT
- Inter/Roboto/Arial as primary font → IMPORTANT
- Pure black (#000) or pure white (#fff) → IMPORTANT
- `const styles` object pattern (React) → IMPORTANT
- `scrollIntoView` without reduced-motion check → IMPORTANT
- Empty state flash (no `v-if` guard) → CRITICAL

## Accessibility Fast-Check

- Focus indicators visible (`:focus-visible`)
- Form labels associated (`<label>` or `aria-label`)
- `prefers-reduced-motion` respected
- Image alt text
