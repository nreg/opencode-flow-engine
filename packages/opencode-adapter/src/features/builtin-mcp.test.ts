import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createValidatorTools } from './builtin-mcp.js';
import type { ToolContext } from '@opencode-ai/plugin';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '__test_mcp_tmp__');
const SFLOW_DIR = join(TEST_DIR, '.sflow');
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
