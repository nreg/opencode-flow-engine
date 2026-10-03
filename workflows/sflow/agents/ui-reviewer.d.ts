/**
 * UI Reviewer agent - sFlow design-consistency acceptance specialist
 * Report-only subagent: produces a design-consistency report against
 * ui-design.md, with no edit/write authority (no fix loop).
 */
import type { AgentFactory } from '../../../packages/plugin-infra/src/agents/types.js';
/**
 * Create the ui-reviewer agent configuration
 */
export declare const createUiReviewerAgent: AgentFactory;
