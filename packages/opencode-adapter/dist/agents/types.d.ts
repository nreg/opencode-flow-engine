/**
 * Agent types for opencode-spec-flow
 * Based on oh-my-openagent's agent system
 */
import type { AgentConfig } from '@opencode-ai/sdk';
/**
 * Agent mode determines UI model selection behavior
 */
export type AgentMode = 'primary' | 'subagent' | 'all';
/**
 * Agent factory function with static mode property
 */
export type AgentFactory = ((model: string, skillContent?: string) => AgentConfig) & {
    mode: AgentMode;
};
/**
 * Agent category for grouping in prompt sections
 */
export type AgentCategory = 'exploration' | 'specialist' | 'advisor' | 'utility' | 'workflow';
/**
 * Cost classification for Tool Selection table
 */
export type AgentCost = 'FREE' | 'CHEAP' | 'EXPENSIVE';
/**
 * Delegation trigger for prompt's Delegation Table
 */
export interface DelegationTrigger {
    /** Domain of work (e.g., "Specification Writing") */
    domain: string;
    /** When to delegate (e.g., "When creating specs...") */
    trigger: string;
}
/**
 * Metadata for generating prompt sections dynamically
 */
export interface AgentPromptMetadata {
    /** Category for grouping in prompt sections */
    category: AgentCategory;
    /** Cost classification for Tool Selection table */
    cost: AgentCost;
    /** Domain triggers for Delegation Table */
    triggers: DelegationTrigger[];
    /** When to use this agent (for detailed sections) */
    useWhen?: string[];
    /** When NOT to use this agent */
    avoidWhen?: string[];
    /** Optional dedicated prompt section (markdown) */
    dedicatedSection?: string;
    /** Nickname/alias used in prompt */
    promptAlias?: string;
    /** Key triggers that should appear in Phase 0 */
    keyTrigger?: string;
}
/**
 * Built-in agent names for sFlow
 */
export type BuiltinAgentName = 'sflow' | 'need-explorer' | 'spec-writer' | 'contract-builder' | 'build-executor' | 'bug-investigator' | 'code-reviewer' | 'release-archivist' | 'spec-merger';
/**
 * Agent override configuration
 */
export type AgentOverrideConfig = Partial<AgentConfig> & {
    category?: string;
    prompt_append?: string;
    skills?: string[];
    tools?: Record<string, boolean>;
    variant?: string;
    fallback_models?: string | (string | {
        model: string;
        variant?: string;
    })[];
};
/**
 * Agent overrides map
 */
export type AgentOverrides = Partial<Record<BuiltinAgentName, AgentOverrideConfig>>;
