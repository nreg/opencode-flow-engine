/**
 * Hook Composer - Manages hook registration and execution
 * Based on oh-my-openagent's hook composition pattern
 */

import type { HookName, HookHandler, HookContext, HookResult } from './types.js';
import {
  createStateTransitionHook,
  createArtifactValidationHook,
  createGuardHook,
} from './index.js';

/**
 * Hook registry with factory functions
 */
const HOOK_REGISTRY: Record<HookName, () => HookHandler> = {
  state_transition: createStateTransitionHook,
  artifact_validation: createArtifactValidationHook,
  guard: createGuardHook,
};

/**
 * Hook tiers for composition order
 */
type HookTier = 'pre' | 'main' | 'post';

/**
 * Hook composer instance
 */
export class HookComposer {
  private hooks: Map<HookName, HookHandler> = new Map();
  private disabledHooks: Set<HookName> = new Set();
  private hookOrder: HookName[] = [];

  /**
   * Initialize the hook composer
   */
  initialize(): void {
    // Initialize hooks in order
    this.hookOrder = ['guard', 'artifact_validation', 'state_transition'];

    for (const name of this.hookOrder) {
      const factory = HOOK_REGISTRY[name];
      if (factory) {
        const hook = factory();
        this.hooks.set(name, hook);
      }
    }
  }

  /**
   * Get a hook by name
   */
  getHook(name: HookName): HookHandler | undefined {
    if (this.disabledHooks.has(name)) {
      return undefined;
    }
    return this.hooks.get(name);
  }

  /**
   * Execute a hook
   */
  async executeHook(
    name: HookName,
    context: HookContext
  ): Promise<HookResult> {
    if (!this.hooks.has(name)) {
      return {
        success: false,
        error: `Unknown hook: ${name}`,
      };
    }
    const hook = this.getHook(name);
    if (!hook) {
      return {
        success: true,
        data: { message: `Hook disabled: ${name}` },
      };
    }

    try {
      return await hook.execute(context);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute all hooks in order
   */
  async executeAllHooks(
    context: HookContext
  ): Promise<{ success: boolean; results: Record<HookName, HookResult> }> {
    const results: Record<string, HookResult> = {};
    let allSuccess = true;

    for (const name of this.hookOrder) {
      if (this.disabledHooks.has(name)) continue;

      const result = await this.executeHook(name, context);
      results[name] = result;

      if (!result.success) {
        allSuccess = false;
        if (result.block) {
          break;
        }
      }
    }

    return {
      success: allSuccess,
      results: results as Record<HookName, HookResult>,
    };
  }

  /**
   * Disable a hook
   */
  disableHook(name: HookName): void {
    this.disabledHooks.add(name);
  }

  /**
   * Enable a hook
   */
  enableHook(name: HookName): void {
    this.disabledHooks.delete(name);
  }

  /**
   * Check if hook is enabled
   */
  isHookEnabled(name: string): boolean {
    if (!this.hooks.has(name as HookName)) return false;
    return !this.disabledHooks.has(name as HookName);
  }

  /**
   * Get all enabled hooks
   */
  getEnabledHooks(): HookName[] {
    return this.hookOrder.filter(name => !this.disabledHooks.has(name));
  }

  /**
   * Get all disabled hooks
   */
  getDisabledHooks(): HookName[] {
    return Array.from(this.disabledHooks);
  }

  /**
   * Get hook count
   */
  getHookCount(): { total: number; enabled: number; disabled: number } {
    return {
      total: this.hooks.size,
      enabled: this.getEnabledHooks().length,
      disabled: this.getDisabledHooks().length,
    };
  }

  /**
   * Add a custom hook
   */
  addHook(name: HookName, hook: HookHandler, position?: number): void {
    this.hooks.set(name, hook);
    if (position !== undefined && position >= 0 && position <= this.hookOrder.length) {
      this.hookOrder.splice(position, 0, name);
    } else {
      this.hookOrder.push(name);
    }
  }

  /**
   * Remove a hook
   */
  removeHook(name: HookName): void {
    this.hooks.delete(name);
    this.hookOrder = this.hookOrder.filter(n => n !== name);
    this.disabledHooks.delete(name);
  }
}

/**
 * Create a hook composer instance
 */
export function createHookComposer(): HookComposer {
  const composer = new HookComposer();
  composer.initialize();
  return composer;
}

/**
 * Get all hook names
 */
export function getHookNames(): HookName[] {
  return Object.keys(HOOK_REGISTRY) as HookName[];
}

/**
 * Check if hook exists
 */
export function hookExists(name: string): name is HookName {
  return name in HOOK_REGISTRY;
}
