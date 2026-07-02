/**
 * Hook types for sFlow
 */
/**
 * Available hook names
 */
export type HookName = 'state_transition' | 'artifact_validation' | 'guard';
/**
 * Hook handler interface
 */
export interface HookHandler {
    name: HookName;
    description: string;
    execute: (context: HookContext) => Promise<HookResult>;
}
/**
 * Hook context
 */
export interface HookContext {
    changeDir: string;
    stateFile: string;
    pluginRoot: string;
    action: string;
    data?: Record<string, unknown>;
}
/**
 * Hook result
 */
export interface HookResult {
    success: boolean;
    data?: unknown;
    error?: string;
    block?: boolean;
    blockReason?: string;
}
//# sourceMappingURL=types.d.ts.map