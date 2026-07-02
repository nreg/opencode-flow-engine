import { describe, it, expect } from 'bun:test';
import { BuiltinMcpRegistry, createValidatorMcpServer } from './builtin-mcp.js';

describe('BuiltinMcpRegistry', () => {
  it('should register validator MCP server on construction', () => {
    const registry = new BuiltinMcpRegistry();
    const servers = registry.getAll();
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('spec-validator');
  });

  it('should call validate-proposal method', async () => {
    const registry = new BuiltinMcpRegistry();
    const result = await registry.call('spec-validator', 'validate-proposal', {
      content: '# Why\n\nSome reason\n\n# What Changes\n\nSome changes',
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should call validate-spec method', async () => {
    const registry = new BuiltinMcpRegistry();
    const result = await registry.call('spec-validator', 'validate-spec', {
      content: '#### Requirement: Login\nSHALL support login\n\n### Scenario: Basic login\ngiven a user\nwhen they login\nthen they are authenticated',
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should call validate-contract method', async () => {
    const registry = new BuiltinMcpRegistry();
    const result = await registry.call('spec-validator', 'validate-contract', {
      content: '# Execution Contract\n\n## Test Plan\n\nTest cases defined\n\n## Acceptance Criteria\n\nCriteria defined',
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should return error for unknown method', async () => {
    const registry = new BuiltinMcpRegistry();
    const result = await registry.call('spec-validator', 'unknown-method', {});
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return error for unknown server', async () => {
    const registry = new BuiltinMcpRegistry();
    const result = await registry.call('non-existent', 'validate-proposal', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should support registering custom MCP servers', () => {
    const registry = new BuiltinMcpRegistry();
    const customServer = createValidatorMcpServer();
    registry.register(customServer);
    expect(registry.get('spec-validator')).toBeDefined();
  });

  it('should return error for missing content parameter', async () => {
    const registry = new BuiltinMcpRegistry();
    const result = await registry.call('spec-validator', 'validate-proposal', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing content');
  });
});
