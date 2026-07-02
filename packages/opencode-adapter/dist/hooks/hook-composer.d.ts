/**
 * Hook Composer - Manages hook registration and execution
 * Based on oh-my-openagent's 5-tier hook composition pattern
 * Tiers: Session → ToolGuard → Transform → Continuation → Skill
 */
import type { HookName, HookHandler, HookContext, HookResult } from './types.js';
/**
 * Hook tiers for layered composition
 * Aligned with oh-my-openagent's 5-tier pattern
 */
type HookTier = 'session' | 'toolguard' | 'transform' | 'continuation' | 'skill';
/**
 * Hook composer instance
 */
export declare class HookComposer {
    private hooks;
    private disabledHooks;
    private hookOrder;
    /**
     * Initialize the hook composer with tiered ordering
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
     * Execute hooks for a specific tier
     */
    executeTier(tier: HookTier, context: HookContext): Promise<{
        success: boolean;
        results: Record<HookName, HookResult>;
    }>;
    /**
     * Execute all hooks in tier order
     */
    executeAllHooks(context: HookContext): Promise<{
        success: boolean;
        results: Record<HookName, HookResult>;
    }>;
    disableHook(name: HookName): void;
    enableHook(name: HookName): void;
    isHookEnabled(name: string): boolean;
    getEnabledHooks(): HookName[];
    getDisabledHooks(): HookName[];
    getHookCount(): {
        total: number;
        enabled: number;
        disabled: number;
    };
    /**
     * Add a custom hook at a specific tier
     */
    addHook(name: HookName, hook: HookHandler, tier?: HookTier, position?: number): void;
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
export declare function hookExists(name: string): boolean;
export {};
