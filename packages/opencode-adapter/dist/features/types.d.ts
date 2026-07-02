/**
 * Feature types for sFlow
 */
/**
 * Available feature names
 */
export type FeatureName = 'workflow_manager' | 'state_manager';
/**
 * Feature configuration
 */
export interface FeatureConfig {
    enabled: boolean;
    options?: Record<string, unknown>;
}
/**
 * Feature result
 */
export interface FeatureResult {
    success: boolean;
    data?: unknown;
    error?: string;
}
