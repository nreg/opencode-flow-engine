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
export { createSFlowPluginModule as createSFlowPlugin, default } from './packages/plugin-infra/src/sflow-plugin-factory.js';
