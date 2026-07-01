import { describe, it, expect, beforeEach } from 'bun:test';
import { ToolRegistry, createToolRegistry, getToolNames, toolExists } from './tool-registry.js';

describe('Tool Registry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createToolRegistry();
  });

  describe('initialize', () => {
    it('should initialize with default tools', () => {
      registry.initialize();
      const tools = registry.getEnabledTools();
      expect(tools).toContain('workflow_router');
      expect(tools).toContain('contract_validator');
      expect(tools).toContain('artifact_inspector');
    });

    it('should have correct tool count', () => {
      registry.initialize();
      const count = registry.getToolCount();
      expect(count.total).toBe(3);
      expect(count.enabled).toBe(3);
      expect(count.disabled).toBe(0);
    });
  });

  describe('getTool', () => {
    it('should return workflow_router tool', () => {
      registry.initialize();
      const tool = registry.getTool('workflow_router');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('workflow_router');
    });

    it('should return contract_validator tool', () => {
      registry.initialize();
      const tool = registry.getTool('contract_validator');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('contract_validator');
    });

    it('should return artifact_inspector tool', () => {
      registry.initialize();
      const tool = registry.getTool('artifact_inspector');
      expect(tool).toBeDefined();
      expect(tool!.name).toBe('artifact_inspector');
    });

    it('should return undefined for unknown tool', () => {
      registry.initialize();
      const tool = registry.getTool('unknown' as any);
      expect(tool).toBeUndefined();
    });
  });

  describe('disableTool', () => {
    it('should disable a tool', () => {
      registry.initialize();
      registry.disableTool('workflow_router');
      const count = registry.getToolCount();
      expect(count.enabled).toBe(2);
      expect(count.disabled).toBe(1);
    });

    it('should mark tool as disabled', () => {
      registry.initialize();
      registry.disableTool('workflow_router');
      expect(registry.isToolEnabled('workflow_router')).toBe(false);
    });

    it('should not affect other tools', () => {
      registry.initialize();
      registry.disableTool('workflow_router');
      expect(registry.isToolEnabled('contract_validator')).toBe(true);
      expect(registry.isToolEnabled('artifact_inspector')).toBe(true);
    });
  });

  describe('enableTool', () => {
    it('should enable a disabled tool', () => {
      registry.initialize();
      registry.disableTool('workflow_router');
      registry.enableTool('workflow_router');
      const count = registry.getToolCount();
      expect(count.enabled).toBe(3);
      expect(count.disabled).toBe(0);
    });

    it('should mark tool as enabled', () => {
      registry.initialize();
      registry.disableTool('workflow_router');
      registry.enableTool('workflow_router');
      expect(registry.isToolEnabled('workflow_router')).toBe(true);
    });
  });

  describe('isToolEnabled', () => {
    it('should return true for enabled tools', () => {
      registry.initialize();
      expect(registry.isToolEnabled('workflow_router')).toBe(true);
      expect(registry.isToolEnabled('contract_validator')).toBe(true);
      expect(registry.isToolEnabled('artifact_inspector')).toBe(true);
    });

    it('should return false for disabled tools', () => {
      registry.initialize();
      registry.disableTool('workflow_router');
      expect(registry.isToolEnabled('workflow_router')).toBe(false);
    });

    it('should return false for unknown tools', () => {
      registry.initialize();
      expect(registry.isToolEnabled('unknown' as any)).toBe(false);
    });
  });

  describe('getEnabledTools', () => {
    it('should return all enabled tools', () => {
      registry.initialize();
      const tools = registry.getEnabledTools();
      expect(tools).toHaveLength(3);
      expect(tools).toContain('workflow_router');
      expect(tools).toContain('contract_validator');
      expect(tools).toContain('artifact_inspector');
    });

    it('should exclude disabled tools', () => {
      registry.initialize();
      registry.disableTool('workflow_router');
      const tools = registry.getEnabledTools();
      expect(tools).toHaveLength(2);
      expect(tools).not.toContain('workflow_router');
    });
  });

  describe('getDisabledTools', () => {
    it('should return empty array when no tools disabled', () => {
      registry.initialize();
      const tools = registry.getDisabledTools();
      expect(tools).toHaveLength(0);
    });

    it('should return disabled tools', () => {
      registry.initialize();
      registry.disableTool('workflow_router');
      const tools = registry.getDisabledTools();
      expect(tools).toHaveLength(1);
      expect(tools).toContain('workflow_router');
    });
  });

  describe('getToolCount', () => {
    it('should return correct count', () => {
      registry.initialize();
      const count = registry.getToolCount();
      expect(count.total).toBe(3);
      expect(count.enabled).toBe(3);
      expect(count.disabled).toBe(0);
    });

    it('should update after disable', () => {
      registry.initialize();
      registry.disableTool('workflow_router');
      const count = registry.getToolCount();
      expect(count.total).toBe(3);
      expect(count.enabled).toBe(2);
      expect(count.disabled).toBe(1);
    });
  });

  describe('executeTool', () => {
    it('should execute workflow_router tool', async () => {
      registry.initialize();
      const result = await registry.executeTool(
        'workflow_router',
        { action: 'get_status' },
        { changeDir: '/path/to/change', stateFile: '', pluginRoot: '' }
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should execute contract_validator tool', async () => {
      registry.initialize();
      const result = await registry.executeTool(
        'contract_validator',
        { contractPath: '/path/to/contract.md' },
        { changeDir: '/path/to/change', stateFile: '', pluginRoot: '' }
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should execute artifact_inspector tool', async () => {
      registry.initialize();
      const result = await registry.executeTool(
        'artifact_inspector',
        { capability: 'auth', action: 'verify' },
        { changeDir: '/path/to/change', stateFile: '', pluginRoot: '' }
      );
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should return error for unknown tool', async () => {
      registry.initialize();
      const result = await registry.executeTool(
        'unknown' as any,
        {},
        { changeDir: '', stateFile: '', pluginRoot: '' }
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

describe('Utility Functions', () => {
  describe('createToolRegistry', () => {
    it('should create a new registry', () => {
      const registry = createToolRegistry();
      expect(registry).toBeDefined();
    });

    it('should create separate instances', () => {
      const registry1 = createToolRegistry();
      const registry2 = createToolRegistry();
      expect(registry1).not.toBe(registry2);
    });
  });

  describe('getToolNames', () => {
    it('should return all tool names', () => {
      const names = getToolNames();
      expect(names).toContain('workflow_router');
      expect(names).toContain('contract_validator');
      expect(names).toContain('artifact_inspector');
      expect(names).toHaveLength(3);
    });
  });

  describe('toolExists', () => {
    it('should return true for existing tools', () => {
      expect(toolExists('workflow_router')).toBe(true);
      expect(toolExists('contract_validator')).toBe(true);
      expect(toolExists('artifact_inspector')).toBe(true);
    });

    it('should return false for unknown tools', () => {
      expect(toolExists('unknown')).toBe(false);
      expect(toolExists('')).toBe(false);
    });
  });
});
