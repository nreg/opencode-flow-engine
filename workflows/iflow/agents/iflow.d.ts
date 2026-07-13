/**
 * iflow agent - Main orchestrator for IFlow (Iterative Flow)
 * GSD-style cyclic workflow: discussing → researching → planning → executing → verifying → shipping
 */
import type { AgentFactory } from '../../../packages/plugin-infra/src/agents/types.js';
export declare const createIFlowAgent: AgentFactory;
