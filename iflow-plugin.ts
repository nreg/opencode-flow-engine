/**
 * IFlow Plugin Module
 *
 * Exports only the IFlow workflow: GSD-style cyclic development lifecycle.
 * Can be used independently as `opencode-flow-engine/iflow`.
 *
 * Usage in opencode.json:
 * {
 *   "plugin": ["opencode-flow-engine/iflow"]
 * }
 */
export { default as default } from './packages/plugin-infra/dist/index.js';
export * from './packages/plugin-infra/dist/index.js';
