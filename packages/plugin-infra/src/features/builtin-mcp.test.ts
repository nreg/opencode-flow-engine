import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createValidatorTools } from './builtin-mcp.js';
import type { ToolContext } from '@opencode-ai/plugin';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '__test_mcp_tmp__');
const SFLOW_DIR = join(TEST_DIR, '.flow-engine/sflow');
const SPECS_DIR = join(SFLOW_DIR, 'specs');
const DELTA_DIR = join(SFLOW_DIR, 'delta-specs');

const mockContext = { directory: TEST_DIR } as ToolContext;

beforeAll(() => {
  mkdirSync(SPECS_DIR, { recursive: true });
  mkdirSync(DELTA_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('BuiltinValidatorTools', () => {
  it('should create validator tools with expected keys', () => {
    const tools = createValidatorTools();
    const keys = Object.keys(tools);
    expect(keys).toContain('validate_spec');
    expect(keys).toContain('validate_proposal');
    expect(keys).toContain('validate_delta_spec');
    expect(keys).toContain('validate_tasks');
  });

  it('should validate proposal content', async () => {
    const tools = createValidatorTools();
    writeFileSync(join(SFLOW_DIR, 'proposal.md'), '# Why\n\nSome reason\n\n# What Changes\n\nSome changes');
    const result = await tools.validate_proposal.execute({}, mockContext);
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
  });

  it('should validate spec content', async () => {
    const tools = createValidatorTools();
    writeFileSync(join(SPECS_DIR, 'auth-service.md'), '#### Requirement: Login\nSHALL support login\n\n### Scenario: Basic login\ngiven a user\nwhen they login\nthen they are authenticated\n\n## Purpose\n\nLogin spec');
    const result = await tools.validate_spec.execute({ name: 'auth-service' }, mockContext);
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
  });

  it('should validate delta spec content', async () => {
    const tools = createValidatorTools();
    writeFileSync(join(DELTA_DIR, 'test-change.md'), '## ADDED Requirements\n\n### Requirement: Login\nSHALL support login');
    const result = await tools.validate_delta_spec.execute({ changeName: 'test-change' }, mockContext);
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
  });

  it('should validate tasks content', async () => {
    const tools = createValidatorTools();
    writeFileSync(join(SFLOW_DIR, 'tasks.md'), '- [ ] Task 1: description — completion criteria\n- [x] Task 2: done');
    const result = await tools.validate_tasks.execute({}, mockContext);
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
  });
});

describe('validate_ui_design', () => {
  const validUiDesignContent = `---
tone: premium-minimalist
---

## Color System
  primary: oklch(0.7 0.15 250)
  background: oklch(0.99 0.005 260)

## Typography
  heading: Geist
  body: Geist

## 1. Component Architecture
├── Layout
│   ├── Header
│   ├── Footer
│   └── Sidebar
├── Navigation
│   ├── NavBar
│   └── Breadcrumb
├── Forms
│   ├── Input
│   └── Select
├── Feedback
│   ├── Toast
│   └── Alert
└── Data Display
    ├── Card
    └── Table

## 2. Placeholder Strategy
Use real content where possible. For images, use gradient placeholders.

## 3. Anti-AI-Slop Checklist
| # | Category | Status |
|---|----------|--------|
| 1 | Typography | Pass |
| 2 | Color | Pass |
| 3 | Shadow | Pass |
| 4 | Border | Pass |
| 5 | Motion | Pass |
| 6 | Layout | Pass |
| 7 | Copy | Pass |
| 8 | Component | Pass |

## 4. Accessibility Guidelines
All components must meet WCAG 2.1 AA standards.
`;

  const invalidUiDesignContent = `# Bad UI Design
No frontmatter, no tone, no OKLCH colors.
  primary: #3B82F6
  background: #FFFFFF
`;

  it('should validate valid ui-design file and return valid=true', async () => {
    const tools = createValidatorTools();
    writeFileSync(join(TEST_DIR, 'ui-design.md'), validUiDesignContent);
    const result = await tools.validate_ui_design.execute({ ui_design_path: join(TEST_DIR, 'ui-design.md') }, mockContext);
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
    const parsed = JSON.parse(result.output!);
    expect(parsed.valid).toBe(true);
    expect(Array.isArray(parsed.issues)).toBe(true);
  });

  it('should validate invalid ui-design file and return valid=false with issues', async () => {
    const tools = createValidatorTools();
    writeFileSync(join(TEST_DIR, 'ui-design.md'), invalidUiDesignContent);
    const result = await tools.validate_ui_design.execute({ ui_design_path: join(TEST_DIR, 'ui-design.md') }, mockContext);
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
    const parsed = JSON.parse(result.output!);
    expect(parsed.valid).toBe(false);
    expect(Array.isArray(parsed.issues)).toBe(true);
    expect(parsed.issues.length).toBeGreaterThan(0);
    const toneIssue = parsed.issues.find((i: { type: string }) => i.type === 'V3_TONE_DECLARATION');
    expect(toneIssue).toBeDefined();
    expect(toneIssue.level).toBe('ERROR');
  });

  it('should return file not found error when ui-design.md does not exist', async () => {
    const tools = createValidatorTools();
    const result = await tools.validate_ui_design.execute({ ui_design_path: join(TEST_DIR, 'nonexistent-ui-design.md') }, mockContext);
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
    const parsed = JSON.parse(result.output!);
    expect(parsed.valid).toBe(false);
    expect(parsed.issues.some((i: { type: string }) => i.type === 'FILE_NOT_FOUND')).toBe(true);
  });
});
