/**
 * Execution plan feature module - Barrel re-export
 *
 * This file re-exports all public API from execution-plan/index.ts
 * to maintain backward compatibility with existing imports.
 *
 * Existing imports like:
 *   import { readExecutionPlan } from './execution-plan.js'
 * will continue to work through this barrel file.
 */

export * from './execution-plan/index.js';
