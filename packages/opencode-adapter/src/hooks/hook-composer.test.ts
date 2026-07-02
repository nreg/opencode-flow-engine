import { describe, it, expect, beforeEach } from 'bun:test';
import { HookComposer, createHookComposer, getHookNames, hookExists } from './hook-composer.js';
import type { HookHandler, HookResult } from './types.js';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Hook Composer', () => {
  let composer: HookComposer;

  beforeEach(() => {
    composer = createHookComposer();
  });

  describe('initialize', () => {
    it('should initialize with default hooks', () => {
      composer.initialize();
      const hooks = composer.getEnabledHooks();
      expect(hooks).toContain('guard');
      expect(hooks).toContain('artifact_validation');
      expect(hooks).toContain('state_transition');
    });

    it('should have correct hook count', () => {
      composer.initialize();
      const count = composer.getHookCount();
      expect(count.total).toBe(3);
      expect(count.enabled).toBe(3);
      expect(count.disabled).toBe(0);
    });
  });

  describe('getHook', () => {
    it('should return guard hook', () => {
      composer.initialize();
      const hook = composer.getHook('guard');
      expect(hook).toBeDefined();
      expect(hook!.name).toBe('guard');
    });

    it('should return artifact_validation hook', () => {
      composer.initialize();
      const hook = composer.getHook('artifact_validation');
      expect(hook).toBeDefined();
      expect(hook!.name).toBe('artifact_validation');
    });

    it('should return state_transition hook', () => {
      composer.initialize();
      const hook = composer.getHook('state_transition');
      expect(hook).toBeDefined();
      expect(hook!.name).toBe('state_transition');
    });

    it('should return undefined for unknown hook', () => {
      composer.initialize();
      const hook = composer.getHook('unknown' as any);
      expect(hook).toBeUndefined();
    });
  });

  describe('disableHook', () => {
    it('should disable a hook', () => {
      composer.initialize();
      composer.disableHook('guard');
      const count = composer.getHookCount();
      expect(count.enabled).toBe(2);
      expect(count.disabled).toBe(1);
    });

    it('should mark hook as disabled', () => {
      composer.initialize();
      composer.disableHook('guard');
      expect(composer.isHookEnabled('guard')).toBe(false);
    });

    it('should not affect other hooks', () => {
      composer.initialize();
      composer.disableHook('guard');
      expect(composer.isHookEnabled('artifact_validation')).toBe(true);
      expect(composer.isHookEnabled('state_transition')).toBe(true);
    });
  });

  describe('enableHook', () => {
    it('should enable a disabled hook', () => {
      composer.initialize();
      composer.disableHook('guard');
      composer.enableHook('guard');
      const count = composer.getHookCount();
      expect(count.enabled).toBe(3);
      expect(count.disabled).toBe(0);
    });

    it('should mark hook as enabled', () => {
      composer.initialize();
      composer.disableHook('guard');
      composer.enableHook('guard');
      expect(composer.isHookEnabled('guard')).toBe(true);
    });
  });

  describe('isHookEnabled', () => {
    it('should return true for enabled hooks', () => {
      composer.initialize();
      expect(composer.isHookEnabled('guard')).toBe(true);
      expect(composer.isHookEnabled('artifact_validation')).toBe(true);
      expect(composer.isHookEnabled('state_transition')).toBe(true);
    });

    it('should return false for disabled hooks', () => {
      composer.initialize();
      composer.disableHook('guard');
      expect(composer.isHookEnabled('guard')).toBe(false);
    });

    it('should return false for unknown hooks', () => {
      composer.initialize();
      expect(composer.isHookEnabled('unknown' as any)).toBe(false);
    });
  });

  describe('getEnabledHooks', () => {
    it('should return all enabled hooks', () => {
      composer.initialize();
      const hooks = composer.getEnabledHooks();
      expect(hooks).toHaveLength(3);
      expect(hooks).toContain('guard');
      expect(hooks).toContain('artifact_validation');
      expect(hooks).toContain('state_transition');
    });

    it('should exclude disabled hooks', () => {
      composer.initialize();
      composer.disableHook('guard');
      const hooks = composer.getEnabledHooks();
      expect(hooks).toHaveLength(2);
      expect(hooks).not.toContain('guard');
    });
  });

  describe('getDisabledHooks', () => {
    it('should return empty array when no hooks disabled', () => {
      composer.initialize();
      const hooks = composer.getDisabledHooks();
      expect(hooks).toHaveLength(0);
    });

    it('should return disabled hooks', () => {
      composer.initialize();
      composer.disableHook('guard');
      const hooks = composer.getDisabledHooks();
      expect(hooks).toHaveLength(1);
      expect(hooks).toContain('guard');
    });
  });

  describe('getHookCount', () => {
    it('should return correct count', () => {
      composer.initialize();
      const count = composer.getHookCount();
      expect(count.total).toBe(3);
      expect(count.enabled).toBe(3);
      expect(count.disabled).toBe(0);
    });

    it('should update after disable', () => {
      composer.initialize();
      composer.disableHook('guard');
      const count = composer.getHookCount();
      expect(count.total).toBe(3);
      expect(count.enabled).toBe(2);
      expect(count.disabled).toBe(1);
    });
  });

  describe('executeHook', () => {
    it('should execute guard hook', async () => {
      composer.initialize();
      const result = await composer.executeHook('guard', {
        changeDir: '/path/to/change',
        stateFile: '',
        pluginRoot: '',
        action: 'transition',
        data: { newState: 'executing' },
      });
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should execute artifact_validation hook', async () => {
      composer.initialize();
      const result = await composer.executeHook('artifact_validation', {
        changeDir: '/path/to/change',
        stateFile: '',
        pluginRoot: '',
        action: 'validate',
        data: { capability: 'auth' },
      });
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should execute state_transition hook', async () => {
      composer.initialize();
      const tmpDir = mkdtempSync(join(tmpdir(), 'sflow-hook-test-'));
      const result = await composer.executeHook('state_transition', {
        changeDir: tmpDir,
        stateFile: '',
        pluginRoot: '',
        action: 'transition',
        data: { newState: 'specifying' },
      });
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should return error for unknown hook', async () => {
      composer.initialize();
      const result = await composer.executeHook('unknown' as any, {
        changeDir: '',
        stateFile: '',
        pluginRoot: '',
        action: 'test',
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('executeAllHooks', () => {
    it('should execute all enabled hooks', async () => {
      composer.initialize();
      const result = await composer.executeAllHooks({
        changeDir: '/path/to/change',
        stateFile: '',
        pluginRoot: '',
        action: 'validate',
      });
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.results).toBeDefined();
      expect(Object.keys(result.results)).toHaveLength(3);
    });

    it('should exclude disabled hooks', async () => {
      composer.initialize();
      composer.disableHook('guard');
      const result = await composer.executeAllHooks({
        changeDir: '/path/to/change',
        stateFile: '',
        pluginRoot: '',
        action: 'validate',
      });
      expect(Object.keys(result.results)).toHaveLength(2);
    });
  });

  describe('addHook', () => {
    it('should add a new hook', () => {
      composer.initialize();
      const customHook: HookHandler = {
        name: 'custom_hook' as any,
        description: 'Custom hook',
        execute: async (context) => ({ success: true }),
      };
      composer.addHook('custom_hook' as any, customHook);
      const count = composer.getHookCount();
      expect(count.total).toBe(4);
    });

    it('should add hook at specific position', () => {
      composer.initialize();
      const customHook: HookHandler = {
        name: 'custom_hook' as any,
        description: 'Custom hook',
        execute: async (context) => ({ success: true }),
      };
      composer.addHook('custom_hook' as any, customHook, 0);
      const hooks = composer.getEnabledHooks();
      expect(hooks[0]).toBe('custom_hook');
    });
  });

  describe('removeHook', () => {
    it('should remove a hook', () => {
      composer.initialize();
      composer.removeHook('guard');
      const count = composer.getHookCount();
      expect(count.total).toBe(2);
    });

    it('should not affect other hooks', () => {
      composer.initialize();
      composer.removeHook('guard');
      expect(composer.isHookEnabled('artifact_validation')).toBe(true);
      expect(composer.isHookEnabled('state_transition')).toBe(true);
    });
  });
});

describe('Utility Functions', () => {
  describe('createHookComposer', () => {
    it('should create a new composer', () => {
      const composer = createHookComposer();
      expect(composer).toBeDefined();
    });

    it('should create separate instances', () => {
      const composer1 = createHookComposer();
      const composer2 = createHookComposer();
      expect(composer1).not.toBe(composer2);
    });
  });

  describe('getHookNames', () => {
    it('should return all hook names', () => {
      const names = getHookNames();
      expect(names).toContain('guard');
      expect(names).toContain('artifact_validation');
      expect(names).toContain('state_transition');
      expect(names).toHaveLength(3);
    });
  });

  describe('hookExists', () => {
    it('should return true for existing hooks', () => {
      expect(hookExists('guard')).toBe(true);
      expect(hookExists('artifact_validation')).toBe(true);
      expect(hookExists('state_transition')).toBe(true);
    });

    it('should return false for unknown hooks', () => {
      expect(hookExists('unknown')).toBe(false);
      expect(hookExists('')).toBe(false);
    });
  });
});
