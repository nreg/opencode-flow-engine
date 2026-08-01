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
export { createIFlowPluginModule as createIFlowPlugin, default } from './packages/plugin-infra/src/iflow-plugin-factory.js';
