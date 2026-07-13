/**
 * UI Implementer agent - Frontend UI implementation specialist
 * Bridges the gap between ui-design.md and production frontend code.
 * Can be called by SFlow (direct) or build-executor (SDD mode).
 */
import type { AgentFactory } from '../../../packages/plugin-infra/src/agents/types.js';
/**
 * Create the ui-implementer agent configuration
 */
export declare const createUiImplementerAgent: AgentFactory;
