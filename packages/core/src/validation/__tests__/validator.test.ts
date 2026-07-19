import { describe, it, expect } from 'bun:test';
import { Validator } from '../validator.js';

describe('Validator.validateUiDesignContent', () => {
  const validator = new Validator();

  const validUiDesign = `---
tone: minimal
colors:
  primary: "oklch(0.55 0.15 250) / #0066cc"
  background: "oklch(0.98 0.005 80) / #f5f5f7"
  foreground: "oklch(0.25 0.01 80) / #1d1d1f"
  accent: "oklch(0.65 0.18 230) / #0071e3"
  success: "oklch(0.65 0.15 145) / #34c759"
  error: "oklch(0.55 0.20 30) / #ff3b30"
  warning: "oklch(0.75 0.15 85) / #ff9500"
typography:
  display: "SF Pro Display, system-ui, sans-serif"
  body: "SF Pro Text, system-ui, sans-serif"
  mono: "SF Mono, monospace"
  scale: "1.25"
spacing:
  base: 4
  scale: [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96]
---

# UI Design Document

## 1. Visual Direction

Minimal tone with clean, purposeful design.

## 2. Design Tokens

Color and typography tokens defined above.

## 3. Component Architecture

\`\`\`
App
├── Layout
│   ├── Header
│   └── Navigation
├── Data Display
│   ├── Card
│   └── Table
├── Forms
│   ├── Input
│   └── Select
├── Feedback
│   ├── Toast
│   └── Spinner
└── Navigation
    ├── Button
    └── Link
\`\`\`

## 4. Interaction Patterns

Hover, focus, active, disabled, and loading states defined.

## 5. Responsive Breakpoints

360 / 768 / 1024 / 1440 breakpoints.

## 6. Accessibility Guidelines

- [ ] Color contrast >= 4.5:1
- [ ] Keyboard navigation
- [ ] Focus indicators

## 7. Placeholder Strategy

No emoji, no fabricated data, honest placeholders.

## 8. Anti-AI-Slop Checklist

| # | Category | Check | Result |
|---|----------|-------|--------|
| 1 | Typography | No Inter/Roboto/Arial | PASS |
| 2 | Colors | No pure black/white | PASS |
| 3 | Shadows | Layers <= 3 | PASS |
| 4 | Borders | No decorative border-left | PASS |
| 5 | Motion | Duration 150-300ms | PASS |
| 6 | Layout | Token multiples | PASS |
| 7 | Copy | No Lorem ipsum | PASS |
| 8 | Components | All states present | PASS |

## 9. Do's and Don'ts

Use OKLCH colors, no border-left decoration.
`;

  it('should pass for valid ui-design.md content', () => {
    const result = validator.validateUiDesignContent(validUiDesign);
    expect(result.valid).toBe(true);
    expect(result.issues.filter(i => i.level === 'ERROR')).toHaveLength(0);
  });

  it('should report ERROR for color format without OKLCH (V1)', () => {
    const hexOnlyDesign = `---
tone: minimal
colors:
  primary: "#0066cc"
  background: "#f5f5f7"
typography:
  display: "SF Pro Display, system-ui, sans-serif"
---

## 1. Visual Direction

Minimal.

## 3. Component Architecture

\`\`\`
App
├── Layout
├── Data Display
├── Forms
├── Feedback
└── Navigation
\`\`\`

## 6. Accessibility Guidelines

WCAG AA checklist.

## 7. Placeholder Strategy

No emoji, honest placeholders.

## 8. Anti-AI-Slop Checklist

| # | Category | Check | Result |
|---|----------|-------|--------|
| 1 | Typography | Check | PASS |
| 2 | Colors | Check | PASS |
| 3 | Shadows | Check | PASS |
| 4 | Borders | Check | PASS |
| 5 | Motion | Check | PASS |
| 6 | Layout | Check | PASS |
| 7 | Copy | Check | PASS |
| 8 | Components | Check | PASS |
`;
    const result = validator.validateUiDesignContent(hexOnlyDesign);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.type === 'V1_COLOR_FORMAT' && i.level === 'ERROR')).toBe(true);
  });

  it('should report WARNING for AI default fonts like Inter (V2)', () => {
    const interFontDesign = validUiDesign.replace(
      'SF Pro Display, system-ui, sans-serif',
      'Inter, system-ui, sans-serif',
    );
    const result = validator.validateUiDesignContent(interFontDesign);
    expect(result.issues.some(i => i.type === 'V2_FONT_COMPLIANCE' && i.level === 'WARNING')).toBe(true);
    expect(result.issues.some(i => i.message.includes('Inter'))).toBe(true);
  });

  it('should report WARNING for Roboto font (V2)', () => {
    const robotoFontDesign = validUiDesign.replace(
      'SF Pro Text, system-ui, sans-serif',
      'Roboto, system-ui, sans-serif',
    );
    const result = validator.validateUiDesignContent(robotoFontDesign);
    expect(result.issues.some(i => i.type === 'V2_FONT_COMPLIANCE' && i.level === 'WARNING')).toBe(true);
    expect(result.issues.some(i => i.message.includes('Roboto'))).toBe(true);
  });

  it('should report ERROR for missing tone field in frontmatter (V3)', () => {
    const noToneDesign = validUiDesign.replace('tone: minimal\n', '');
    const result = validator.validateUiDesignContent(noToneDesign);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.type === 'V3_TONE_DECLARATION' && i.level === 'ERROR')).toBe(true);
  });

  it('should report ERROR for missing frontmatter entirely (V3)', () => {
    const noFrontmatter = `
## 1. Visual Direction

Some content without frontmatter.

## 6. Accessibility Guidelines

WCAG AA.

## 7. Placeholder Strategy

No emoji.

## 8. Anti-AI-Slop Checklist

| 1 | Typography | Check | PASS |
| 2 | Colors | Check | PASS |
| 3 | Shadows | Check | PASS |
| 4 | Borders | Check | PASS |
| 5 | Motion | Check | PASS |
| 6 | Layout | Check | PASS |
`;
    const result = validator.validateUiDesignContent(noFrontmatter);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.type === 'V3_TONE_DECLARATION' && i.level === 'ERROR')).toBe(true);
  });

  it('should report WARNING for fewer than 5 component categories (V4)', () => {
    const fewComponentsDesign = validUiDesign.replace(
      /## 3\. Component Architecture[\s\S]*?(?=\n## 4\.)/,
      `## 3. Component Architecture

\`\`\`
App
├── Layout
└── Forms
\`\`\`

`,
    );
    const result = validator.validateUiDesignContent(fewComponentsDesign);
    expect(result.issues.some(i => i.type === 'V4_COMPONENT_COVERAGE' && i.level === 'WARNING')).toBe(true);
  });

  it('should report ERROR for missing Placeholder Strategy section (V5)', () => {
    const noPlaceholderDesign = validUiDesign.replace(/## 7\. Placeholder Strategy[\s\S]*?(?=\n## )/, '');
    const result = validator.validateUiDesignContent(noPlaceholderDesign);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.type === 'V5_PLACEHOLDER_STRATEGY' && i.level === 'ERROR')).toBe(true);
  });

  it('should report WARNING for fewer than 6 anti-AI-slop categories (V6)', () => {
    const fewSlopCategories = validUiDesign.replace(
      /## 8\. Anti-AI-Slop Checklist[\s\S]*?(?=\n## )/,
      `## 8. Anti-AI-Slop Checklist

| # | Category | Check | Result |
|---|----------|-------|--------|
| 1 | Typography | Check | PASS |
| 2 | Colors | Check | PASS |
| 3 | Shadows | Check | PASS |
| 4 | Borders | Check | PASS |

`,
    );
    const result = validator.validateUiDesignContent(fewSlopCategories);
    expect(result.issues.some(i => i.type === 'V6_ANTI_AI_SLOP_COVERAGE' && i.level === 'WARNING')).toBe(true);
  });

  it('should report ERROR for missing Accessibility Guidelines section (V7)', () => {
    const noA11yDesign = validUiDesign.replace(/## 6\. Accessibility Guidelines[\s\S]*?(?=\n## )/, '');
    const result = validator.validateUiDesignContent(noA11yDesign);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.type === 'V7_WCAG_AA' && i.level === 'ERROR')).toBe(true);
  });

  it('should report multiple issues for severely incomplete content', () => {
    const minimalContent = `---
colors:
  primary: "#000000"
typography:
  display: "Arial, sans-serif"
---

## 1. Visual Direction

Incomplete.
`;
    const result = validator.validateUiDesignContent(minimalContent);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(3);
    expect(result.issues.some(i => i.type === 'V3_TONE_DECLARATION')).toBe(true);
    expect(result.issues.some(i => i.type === 'V5_PLACEHOLDER_STRATEGY')).toBe(true);
    expect(result.issues.some(i => i.type === 'V7_WCAG_AA')).toBe(true);
  });

  it('should handle CRLF line endings in frontmatter (V3)', () => {
    // CRLF version of validUiDesign — frontmatter should still be parsed
    const crlfDesign = validUiDesign.replace(/\n/g, '\r\n');
    const result = validator.validateUiDesignContent(crlfDesign);
    // Should NOT report V3_TONE_DECLARATION error because tone is present
    expect(result.issues.some(i => i.type === 'V3_TONE_DECLARATION' && i.level === 'ERROR')).toBe(false);
  });

  it('should report WARNING for Arial font (V2)', () => {
    const arialFontDesign = validUiDesign.replace(
      'SF Pro Display, system-ui, sans-serif',
      'Arial, sans-serif',
    );
    const result = validator.validateUiDesignContent(arialFontDesign);
    expect(result.issues.some(i => i.type === 'V2_FONT_COMPLIANCE' && i.level === 'WARNING')).toBe(true);
    expect(result.issues.some(i => i.message.includes('Arial'))).toBe(true);
  });

  it('should report ERROR for missing Placeholder Strategy section when absent (V5)', () => {
    const noPlaceholder = validUiDesign.replace(/## 7\. Placeholder Strategy[\s\S]*?(?=\n## 8\.)/, '');
    const result = validator.validateUiDesignContent(noPlaceholder);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.type === 'V5_PLACEHOLDER_STRATEGY' && i.level === 'ERROR')).toBe(true);
  });

  it('should report ERROR for missing Accessibility Guidelines section when absent (V7)', () => {
    const noA11y = validUiDesign.replace(/## 6\. Accessibility Guidelines[\s\S]*?(?=\n## 7\.)/, '');
    const result = validator.validateUiDesignContent(noA11y);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.type === 'V7_WCAG_AA' && i.level === 'ERROR')).toBe(true);
  });
});
