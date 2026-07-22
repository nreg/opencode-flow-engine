/**
 * Shared workflow - Agent factory exports
 * Independent agents callable by both iFlow and SFlow
 * Not bound to any workflow state
 */

export { createTestEngineerAgent } from './agents/test-engineer.js';
export { createReviewEngineerAgent } from './agents/review-engineer.js';
export { createFlowArchitectAgent } from './agents/flow-architect.js';
export { createFlowIntelAgent } from './agents/flow-intel.js';
export { createFlowEvolveAgent } from './agents/flow-evolve.js';
export { createFlowHealthAgent } from './agents/flow-health.js';
export { createFlowRestyleAgent } from './agents/flow-restyle.js';

/** Shared agent names for cross-workflow registration */
export const SHARED_AGENT_NAMES = [
  'test-engineer',
  'review-engineer',
  'flow-architect',
  'flow-intel',
  'flow-evolve',
  'flow-health',
  'flow-restyle',
] as const;

/** Shared horizontal command definitions (Phase 0 detection) */
export {
  HORIZONTAL_COMMANDS,
  matchHorizontalCommand,
} from './horizontal-commands.js';
export type { HorizontalCommandEntry } from './horizontal-commands.js';

/** Compaction context — preserves workflow state across session compaction */
export { createCompactionContext } from './compaction-context.js';
export type { CompactionState, TaskProgress } from './compaction-context.js';