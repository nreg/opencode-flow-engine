/**
 * Combined Plugin Module (default)
 *
 * Exports both SFlow and IFlow workflows under a single PluginModule.
 * This is the default export for `opencode-flow-engine`.
 */
export { createCombinedPluginModule as createCombinedPlugin, default } from './packages/plugin-infra/src/combined-plugin-factory.js';
