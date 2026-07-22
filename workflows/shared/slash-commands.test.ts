/**
 * Tests for Slash Command Registration
 *
 * Covers:
 * - All 7 slash commands are registered
 * - Each command has description and template
 * - Templates contain correct subagent_type references
 * - Idempotency: calling registerFlowCommands twice doesn't overwrite
 * - Existing commands are preserved
 * - Command name constants are exported correctly
 */
import { describe, it, expect } from 'bun:test';
import {
  registerFlowCommands,
  FLOW_TEST_COMMAND,
  FLOW_REVIEW_COMMAND,
  FLOW_INTEL_COMMAND,
  FLOW_ARCHITECT_COMMAND,
  FLOW_EVOLVE_COMMAND,
  FLOW_HEALTH_COMMAND,
  FLOW_RESTYLE_COMMAND,
} from './slash-commands.js';

/** Minimal config mock matching @opencode-ai/plugin Config type */
function createMockConfig(): Record<string, unknown> {
  return {};
}

describe('Command name constants', () => {
  it('should export all 7 command name constants', () => {
    expect(FLOW_TEST_COMMAND).toBe('flow-test');
    expect(FLOW_REVIEW_COMMAND).toBe('flow-review');
    expect(FLOW_INTEL_COMMAND).toBe('flow-intel');
    expect(FLOW_ARCHITECT_COMMAND).toBe('flow-architect');
    expect(FLOW_EVOLVE_COMMAND).toBe('flow-evolve');
    expect(FLOW_HEALTH_COMMAND).toBe('flow-health');
    expect(FLOW_RESTYLE_COMMAND).toBe('flow-restyle');
  });
});

describe('registerFlowCommands', () => {
  it('should register all 7 slash commands on empty config', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    expect(config.command).toBeDefined();
    expect(Object.keys(config.command!)).toHaveLength(7);
    expect(config.command!['flow-test']).toBeDefined();
    expect(config.command!['flow-review']).toBeDefined();
    expect(config.command!['flow-intel']).toBeDefined();
    expect(config.command!['flow-architect']).toBeDefined();
    expect(config.command!['flow-evolve']).toBeDefined();
    expect(config.command!['flow-health']).toBeDefined();
    expect(config.command!['flow-restyle']).toBeDefined();
  });

  it('should provide descriptions for all commands', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    expect(config.command!['flow-test'].description).toContain('全面测试');
    expect(config.command!['flow-review'].description).toContain('全面审查');
    expect(config.command!['flow-intel'].description).toContain('入场扫描');
    expect(config.command!['flow-architect'].description).toContain('架构文档');
    expect(config.command!['flow-evolve'].description).toContain('架构增量同步');
    expect(config.command!['flow-health'].description).toContain('健康巡检');
    expect(config.command!['flow-restyle'].description).toContain('一键换调性');
  });

  it('should provide templates for all commands', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    for (const cmd of Object.values(config.command!)) {
      expect(cmd.template).toBeDefined();
      expect(cmd.template.length).toBeGreaterThan(0);
    }
  });

  it('should reference correct subagent_type in flow-test template', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    const template = config.command!['flow-test'].template;
    expect(template).toContain('subagent_type="test-engineer"');
    expect(template).toContain('call_flow_agent');
  });

  it('should reference correct subagent_type in flow-review template', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    const template = config.command!['flow-review'].template;
    expect(template).toContain('subagent_type="review-engineer"');
    expect(template).toContain('call_flow_agent');
  });

  it('should reference correct subagent_type in flow-intel template', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    const template = config.command!['flow-intel'].template;
    expect(template).toContain('subagent_type="flow-intel"');
    expect(template).toContain('I-intel-scan');
  });

  it('should reference correct subagent_type in flow-architect template', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    const template = config.command!['flow-architect'].template;
    expect(template).toContain('subagent_type="flow-architect"');
    expect(template).toContain('A-architect');
  });

  it('should reference correct subagent_type in flow-evolve template', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    const template = config.command!['flow-evolve'].template;
    expect(template).toContain('subagent_type="flow-evolve"');
    expect(template).toContain('A-evolve');
  });

  it('should reference correct subagent_type in flow-health template', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    const template = config.command!['flow-health'].template;
    expect(template).toContain('subagent_type="flow-health"');
    expect(template).toContain('M-health');
  });

  it('should reference correct subagent_type in flow-restyle template', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    const template = config.command!['flow-restyle'].template;
    expect(template).toContain('subagent_type="flow-restyle"');
    expect(template).toContain('L-restyle');
  });

  it('should be idempotent — does not overwrite existing commands', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    // First call: registers all 7
    registerFlowCommands(config as any);
    const firstSnapshot = { ...config.command };

    // Manually modify one command
    config.command!['flow-test'] = {
      description: '自定义描述',
      template: '自定义模板',
    };

    // Second call: should NOT overwrite the modified command
    registerFlowCommands(config as any);

    expect(config.command!['flow-test'].description).toBe('自定义描述');
    expect(config.command!['flow-test'].template).toBe('自定义模板');
  });

  it('should preserve pre-existing commands not managed by this module', () => {
    const config = createMockConfig() as {
      command?: Record<string, { description: string; template: string }>;
    };
    config.command = {
      'my-custom-command': {
        description: '自定义命令',
        template: '自定义模板',
      },
    };

    registerFlowCommands(config as any);

    // Custom command should be preserved
    expect(config.command['my-custom-command']).toBeDefined();
    expect(config.command['my-custom-command'].description).toBe('自定义命令');
    // New commands should also be added
    expect(config.command['flow-test']).toBeDefined();
    expect(config.command['flow-health']).toBeDefined();
    expect(config.command['flow-restyle']).toBeDefined();
    // Total should be 1 custom + 7 new = 8
    expect(Object.keys(config.command)).toHaveLength(8);
  });

  it('should handle config with no command property', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    // config has no command property
    expect(config.command).toBeUndefined();

    registerFlowCommands(config as any);

    // After registration, command should be created
    expect(config.command).toBeDefined();
    expect(Object.keys(config.command!)).toHaveLength(7);
  });

  it('should include $ARGUMENTS placeholder in all templates', () => {
    const config = createMockConfig() as { command?: Record<string, { description: string; template: string }> };

    registerFlowCommands(config as any);

    for (const [name, cmd] of Object.entries(config.command!)) {
      expect(cmd.template).toContain('$ARGUMENTS', `Command ${name} template is missing $ARGUMENTS`);
    }
  });
});