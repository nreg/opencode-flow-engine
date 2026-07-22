/**
 * Shared workflow - Agent factory exports
 * Independent agents callable by both iFlow and SFlow
 * Not bound to any workflow state
 */

export { createTestEngineerAgent } from './agents/test-engineer.js';
export { createReviewEngineerAgent } from './agents/review-engineer.js';
export { createFlowArchitectAgent } from './agents/flow-architect.js';
export { createFlowIntelAgent } from './agents/flow-intel.js';

/** Shared agent names for cross-workflow registration */
export const SHARED_AGENT_NAMES = [
  'test-engineer',
  'review-engineer',
  'flow-architect',
  'flow-intel',
] as const;

/** Shared horizontal command definitions (Phase 0 detection) */
export {
  HORIZONTAL_COMMANDS,
  matchHorizontalCommand,
} from './horizontal-commands.js';
export type { HorizontalCommandEntry } from './horizontal-commands.js';