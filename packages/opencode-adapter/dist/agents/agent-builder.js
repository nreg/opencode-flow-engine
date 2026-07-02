/**
 * Agent Builder - Factory pattern for creating agents
 * Based on oh-my-openagent's agent builder pattern
 */
import { createSFlowAgent, createNeedExplorerAgent, createSpecWriterAgent, createContractBuilderAgent, createBuildExecutorAgent, createBugInvestigatorAgent, createCodeReviewerAgent, createReleaseArchivistAgent, createSpecMergerAgent, } from './index.js';
import { loadCascadedSFlowConfig, agentOverridesFromConfig, mergeOverrides, } from './config-loader.js';
/**
 * Agent mode registry — explicit mapping instead of static property on function
 * This avoids the unsafe pattern of assigning .mode to a function object
 */
const AGENT_MODES = {
    sflow: 'primary',
    'need-explorer': 'subagent',
    'spec-writer': 'subagent',
    'contract-builder': 'subagent',
    'build-executor': 'subagent',
    'bug-investigator': 'subagent',
    'code-reviewer': 'subagent',
    'release-archivist': 'subagent',
    'spec-merger': 'subagent',
};
/**
 * Default model for each agent
 * Uses OpenCode-compatible model identifiers with fallback support
 */
const DEFAULT_MODELS = {
    sflow: 'anthropic/claude-sonnet-4-20250514',
    'need-explorer': 'anthropic/claude-sonnet-4-20250514',
    'spec-writer': 'anthropic/claude-sonnet-4-20250514',
    'contract-builder': 'anthropic/claude-sonnet-4-20250514',
    'build-executor': 'anthropic/claude-sonnet-4-20250514',
    'bug-investigator': 'anthropic/claude-sonnet-4-20250514',
    'code-reviewer': 'anthropic/claude-sonnet-4-20250514',
    'release-archivist': 'anthropic/claude-sonnet-4-20250514',
    'spec-merger': 'anthropic/claude-sonnet-4-20250514',
};
/**
 * Agent registry with factory functions
 */
const AGENT_REGISTRY = {
    sflow: createSFlowAgent,
    'need-explorer': createNeedExplorerAgent,
    'spec-writer': createSpecWriterAgent,
    'contract-builder': createContractBuilderAgent,
    'build-executor': createBuildExecutorAgent,
    'bug-investigator': createBugInvestigatorAgent,
    'code-reviewer': createCodeReviewerAgent,
    'release-archivist': createReleaseArchivistAgent,
    'spec-merger': createSpecMergerAgent,
};
/**
 * Cached config to avoid redundant file I/O
 */
let _cascadedConfigCache = null;
let _cascadedConfigTimestamp = 0;
const CONFIG_CACHE_TTL_MS = 30_000; // 30 seconds
async function getCascadedConfig() {
    const now = Date.now();
    if (_cascadedConfigCache && now - _cascadedConfigTimestamp < CONFIG_CACHE_TTL_MS) {
        return _cascadedConfigCache;
    }
    _cascadedConfigCache = await loadCascadedSFlowConfig();
    _cascadedConfigTimestamp = now;
    return _cascadedConfigCache;
}
export function clearConfigCache() {
    _cascadedConfigCache = null;
    _cascadedConfigTimestamp = 0;
}
/**
 * Create an agent by name
 * Priority chain: AgentOverrides.model > model param > .sflow/config.json > DEFAULT_MODELS
 */
export async function createAgent(name, model, overrides, skillContent) {
    const factory = AGENT_REGISTRY[name];
    if (!factory) {
        throw new Error(`Unknown agent: ${name}`);
    }
    const config = await getCascadedConfig();
    const configOverrides = agentOverridesFromConfig(config);
    // Merge config + programmatic overrides
    const merged = mergeOverrides(configOverrides, overrides || {});
    const agentOverride = merged[name];
    // Model priority: AgentOverrides > model param > config file > default
    const programmaticModel = overrides?.[name]?.model;
    const configModel = configOverrides[name]?.model;
    const resolvedModel = programmaticModel || model || configModel || DEFAULT_MODELS[name];
    const agentConfig = factory(resolvedModel);
    // Use skill content if provided (from unified SkillLoader)
    if (skillContent) {
        agentConfig.instructions = skillContent;
    }
    if (agentOverride) {
        return {
            ...agentConfig,
            ...agentOverride,
            model: resolvedModel,
            id: agentConfig.id,
            name: agentConfig.name,
        };
    }
    return agentConfig;
}
/**
 * Create all agents
 */
export async function createAllAgents(model, overrides, skillContents) {
    const agents = {};
    const config = await getCascadedConfig();
    const configOverrides = agentOverridesFromConfig(config);
    for (const name of Object.keys(AGENT_REGISTRY)) {
        const factory = AGENT_REGISTRY[name];
        const programmaticModel = overrides?.[name]?.model;
        const configModel = configOverrides[name]?.model;
        const resolvedModel = programmaticModel || model || configModel || DEFAULT_MODELS[name];
        const agentConfig = factory(resolvedModel);
        // Use skill content from SkillLoader if available
        const content = skillContents?.[name];
        if (content) {
            agentConfig.instructions = content;
        }
        const merged = mergeOverrides(configOverrides, overrides || {});
        const agentOverride = merged[name];
        if (agentOverride) {
            agents[name] = {
                ...agentConfig,
                ...agentOverride,
                model: resolvedModel,
                id: agentConfig.id,
                name: agentConfig.name,
            };
        }
        else {
            agents[name] = agentConfig;
        }
    }
    return agents;
}
/**
 * Get agent by name
 */
export function getAgent(name) {
    return AGENT_REGISTRY[name];
}
/**
 * Get all agent names
 */
export function getAgentNames() {
    return Object.keys(AGENT_REGISTRY);
}
/**
 * Get agent mode — reads from explicit registry, not from function static property
 */
export function getAgentMode(name) {
    return AGENT_MODES[name] || 'subagent';
}
/**
 * Get primary agents (mode === 'primary')
 */
export function getPrimaryAgents() {
    return getAgentNames().filter(name => AGENT_MODES[name] === 'primary');
}
/**
 * Get subagent agents (mode === 'subagent')
 */
export function getSubagentAgents() {
    return getAgentNames().filter(name => AGENT_MODES[name] === 'subagent');
}
/**
 * Check if agent exists
 */
export function agentExists(name) {
    return name in AGENT_REGISTRY;
}
/**
 * Get default model for agent
 */
export function getDefaultModel(name) {
    return DEFAULT_MODELS[name];
}
/**
 * Get all default models
 */
export function getAllDefaultModels() {
    return { ...DEFAULT_MODELS };
}
//# sourceMappingURL=agent-builder.js.map