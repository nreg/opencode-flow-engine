/**
 * Hook Composer - Manages hook registration and execution
 * Based on oh-my-openagent's hook composition pattern
 */
import { createStateTransitionHook, createArtifactValidationHook, createGuardHook, } from './index.js';
/**
 * Hook registry with factory functions
 */
const HOOK_REGISTRY = {
    state_transition: createStateTransitionHook,
    artifact_validation: createArtifactValidationHook,
    guard: createGuardHook,
};
/**
 * Hook composer instance
 */
export class HookComposer {
    hooks = new Map();
    disabledHooks = new Set();
    hookOrder = [];
    /**
     * Initialize the hook composer
     */
    initialize() {
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
    getHook(name) {
        if (this.disabledHooks.has(name)) {
            return undefined;
        }
        return this.hooks.get(name);
    }
    /**
     * Execute a hook
     */
    async executeHook(name, context) {
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
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    /**
     * Execute all hooks in order
     */
    async executeAllHooks(context) {
        const results = {};
        let allSuccess = true;
        for (const name of this.hookOrder) {
            if (this.disabledHooks.has(name))
                continue;
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
            results: results,
        };
    }
    /**
     * Disable a hook
     */
    disableHook(name) {
        this.disabledHooks.add(name);
    }
    /**
     * Enable a hook
     */
    enableHook(name) {
        this.disabledHooks.delete(name);
    }
    /**
     * Check if hook is enabled
     */
    isHookEnabled(name) {
        if (!this.hooks.has(name))
            return false;
        return !this.disabledHooks.has(name);
    }
    /**
     * Get all enabled hooks
     */
    getEnabledHooks() {
        return this.hookOrder.filter(name => !this.disabledHooks.has(name));
    }
    /**
     * Get all disabled hooks
     */
    getDisabledHooks() {
        return Array.from(this.disabledHooks);
    }
    /**
     * Get hook count
     */
    getHookCount() {
        return {
            total: this.hooks.size,
            enabled: this.getEnabledHooks().length,
            disabled: this.getDisabledHooks().length,
        };
    }
    /**
     * Add a custom hook
     */
    addHook(name, hook, position) {
        this.hooks.set(name, hook);
        if (position !== undefined && position >= 0 && position <= this.hookOrder.length) {
            this.hookOrder.splice(position, 0, name);
        }
        else {
            this.hookOrder.push(name);
        }
    }
    /**
     * Remove a hook
     */
    removeHook(name) {
        this.hooks.delete(name);
        this.hookOrder = this.hookOrder.filter(n => n !== name);
        this.disabledHooks.delete(name);
    }
}
/**
 * Create a hook composer instance
 */
export function createHookComposer() {
    const composer = new HookComposer();
    composer.initialize();
    return composer;
}
/**
 * Get all hook names
 */
export function getHookNames() {
    return Object.keys(HOOK_REGISTRY);
}
/**
 * Check if hook exists
 */
export function hookExists(name) {
    return name in HOOK_REGISTRY;
}
//# sourceMappingURL=hook-composer.js.map