/**
 * Combined Plugin Module (default)
 *
 * Exports both SFlow and IFlow workflows under a single PluginModule.
 * This is the default export for `opencode-flow-engine`.
 */
export { default, createCombinedPluginModule as createCombinedPlugin } from './packages/plugin-infra/dist/combined-plugin-factory.js';
