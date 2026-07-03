import { describe, it, expect } from 'bun:test';
import { createValidatorTools } from './builtin-mcp.js';

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
    const result = await tools.validate_proposal.execute({
      content: '# Why\n\nSome reason\n\n# What Changes\n\nSome changes',
    });
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
  });

  it('should validate spec content', async () => {
    const tools = createValidatorTools();
    const result = await tools.validate_spec.execute({
      name: 'auth-service',
      content: '#### Requirement: Login\nSHALL support login\n\n### Scenario: Basic login\ngiven a user\nwhen they login\nthen they are authenticated',
    });
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
  });

  it('should validate delta spec content', async () => {
    const tools = createValidatorTools();
    const result = await tools.validate_delta_spec.execute({
      content: '## ADDED Requirements\n\n### Requirement: Login\nSHALL support login',
      changeName: 'test-change',
    });
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
  });

  it('should validate tasks content', async () => {
    const tools = createValidatorTools();
    const result = await tools.validate_tasks.execute({
      content: '- [ ] Task 1: description — completion criteria\n- [x] Task 2: done',
    });
    expect(result).toBeDefined();
    expect(result.output).toBeDefined();
  });
});
