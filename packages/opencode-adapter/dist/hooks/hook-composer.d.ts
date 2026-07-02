/**
 * Hook Composer - Manages hook registration and execution
 * Based on oh-my-openagent's hook composition pattern
 */
import type { HookName, HookHandler, HookContext, HookResult } from './types.js';
/**
 * Hook composer instance
 */
export declare class HookComposer {
    private hooks;
    private disabledHooks;
    private hookOrder;
    /**
     * Initialize the hook composer
     */
    initialize(): void;
    /**
     * Get a hook by name
     */
    getHook(name: HookName): HookHandler | undefined;
    /**
     * Execute a hook
     */
    executeHook(name: HookName, context: HookContext): Promise<HookResult>;
    /**
     * Execute all hooks in order
     */
    executeAllHooks(context: HookContext): Promise<{
        success: boolean;
        results: Record<HookName, HookResult>;
    }>;
    /**
     * Disable a hook
     */
    disableHook(name: HookName): void;
    /**
     * Enable a hook
     */
    enableHook(name: HookName): void;
    /**
     * Check if hook is enabled
     */
    isHookEnabled(name: string): boolean;
    /**
     * Get all enabled hooks
     */
    getEnabledHooks(): HookName[];
    /**
     * Get all disabled hooks
     */
    getDisabledHooks(): HookName[];
    /**
     * Get hook count
     */
    getHookCount(): {
        total: number;
        enabled: number;
        disabled: number;
    };
    /**
     * Add a custom hook
     */
    addHook(name: HookName, hook: HookHandler, position?: number): void;
    /**
     * Remove a hook
     */
    removeHook(name: HookName): void;
}
/**
 * Create a hook composer instance
 */
export declare function createHookComposer(): HookComposer;
/**
 * Get all hook names
 */
export declare function getHookNames(): HookName[];
/**
 * Check if hook exists
 */
export declare function hookExists(name: string): name is HookName;
//# sourceMappingURL=hook-composer.d.ts.map