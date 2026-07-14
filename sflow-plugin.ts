/**
 * SFlow Plugin Module
 *
 * Exports only the SFlow workflow: OpenSpec planning engine + Superpowers execution discipline.
 * Can be used independently as `opencode-flow-engine/sflow`.
 *
 * Usage in opencode.json:
 * {
 *   "plugin": ["opencode-flow-engine/sflow"]
 * }
 */
export { default, createSFlowPluginModule as createSFlowPlugin } from './packages/plugin-infra/dist/sflow-plugin-factory.js';
