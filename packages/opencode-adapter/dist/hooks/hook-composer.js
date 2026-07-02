/**
 * Hook Composer - Manages hook registration and execution
 * Based on oh-my-openagent's 5-tier hook composition pattern
 * Tiers: Session → ToolGuard → Transform → Continuation → Skill
 */
import { createStateTransitionHook, createArtifactValidationHook, createGuardHook, createSessionStartHook, createSessionEndHook, createPreProcessHook, createPostProcessHook, createContinuationHook, } from './index.js';
/**
 * Tiered hook registry
 * Each hook is assigned to a tier, and hooks execute in tier order
 */
const TIERED_HOOKS = [
    // Tier 1: Session hooks - lifecycle management
    { name: 'session_start', tier: 'session', factory: createSessionStartHook },
    { name: 'session_end', tier: 'session', factory: createSessionEndHook },
    // Tier 2: ToolGuard hooks - pre/post execution guards
    { name: 'guard', tier: 'toolguard', factory: createGuardHook },
    { name: 'artifact_validation', tier: 'toolguard', factory: createArtifactValidationHook },
    // Tier 3: Transform hooks - message transformation
    { name: 'pre_process', tier: 'transform', factory: createPreProcessHook },
    { name: 'post_process', tier: 'transform', factory: createPostProcessHook },
    // Tier 4: State & Continuation hooks - state management and auto-continue
    { name: 'state_transition', tier: 'continuation', factory: createStateTransitionHook },
    { name: 'continuation', tier: 'continuation', factory: createContinuationHook },
];
const TIER_ORDER = ['session', 'toolguard', 'transform', 'continuation', 'skill'];
/**
 * Hook composer instance
 */
export class HookComposer {
    hooks = new Map();
    disabledHooks = new Set();
    hookOrder = [];
    /**
     * Initialize the hook composer with tiered ordering
     */
    initialize() {
        // Build execution order from tier order
        this.hookOrder = [];
        for (const tier of TIER_ORDER) {
            for (const entry of TIERED_HOOKS) {
                if (entry.tier === tier) {
                    this.hookOrder.push(entry.name);
                    const hook = entry.factory();
                    this.hooks.set(entry.name, hook);
                }
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
     * Execute hooks for a specific tier
     */
    async executeTier(tier, context) {
        const results = {};
        let allSuccess = true;
        for (const entry of TIERED_HOOKS) {
            if (entry.tier !== tier)
                continue;
            if (this.disabledHooks.has(entry.name))
                continue;
            const result = await this.executeHook(entry.name, context);
            results[entry.name] = result;
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
     * Execute all hooks in tier order
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
    disableHook(name) {
        this.disabledHooks.add(name);
    }
    enableHook(name) {
        this.disabledHooks.delete(name);
    }
    isHookEnabled(name) {
        if (!this.hooks.has(name))
            return false;
        return !this.disabledHooks.has(name);
    }
    getEnabledHooks() {
        return this.hookOrder.filter(name => !this.disabledHooks.has(name));
    }
    getDisabledHooks() {
        return Array.from(this.disabledHooks);
    }
    getHookCount() {
        return {
            total: this.hooks.size,
            enabled: this.getEnabledHooks().length,
            disabled: this.getDisabledHooks().length,
        };
    }
    /**
     * Add a custom hook at a specific tier
     */
    addHook(name, hook, tier = 'skill', position) {
        this.hooks.set(name, hook);
        // Insert into hookOrder at the right tier boundary
        const tierStartIdx = this.hookOrder.findIndex(n => {
            const entry = TIERED_HOOKS.find(e => e.name === n);
            return entry && TIER_ORDER.indexOf(entry.tier) >= TIER_ORDER.indexOf(tier);
        });
        if (position !== undefined && position >= 0 && position <= this.hookOrder.length) {
            this.hookOrder.splice(position, 0, name);
        }
        else if (tierStartIdx >= 0) {
            this.hookOrder.splice(tierStartIdx, 0, name);
        }
        else {
            this.hookOrder.push(name);
        }
    }
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
    return TIERED_HOOKS.map(e => e.name);
}
/**
 * Check if hook exists
 */
export function hookExists(name) {
    return TIERED_HOOKS.some(e => e.name === name);
}
//# sourceMappingURL=hook-composer.js.map