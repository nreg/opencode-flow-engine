/**
 * Agent Builder - Factory pattern for creating agents
 * Based on oh-my-openagent's agent builder pattern
 */
import { createSFlowAgent, createNeedExplorerAgent, createSpecWriterAgent, createContractBuilderAgent, createBuildExecutorAgent, createBugInvestigatorAgent, createCodeReviewerAgent, createReleaseArchivistAgent, createSpecMergerAgent, } from './index.js';
import { loadCascadedSFlowConfig, agentOverridesFromConfig, mergeOverrides, } from './config-loader.js';
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
 * Default model for each agent
 */
const DEFAULT_MODELS = {
    sflow: 'deepseek-v4-flash',
    'need-explorer': 'kimi-k2.6',
    'spec-writer': 'glm-5.1',
    'contract-builder': 'glm-5',
    'build-executor': 'step-3.7-flash',
    'bug-investigator': 'minimax-m2.7',
    'code-reviewer': 'deepseek-v4-flash',
    'release-archivist': 'mimo-v2.5-pro',
    'spec-merger': 'mimo-v2.5',
};
/**
 * Create an agent by name
 * Priority chain: AgentOverrides.model > model param > .sflow/config.json > DEFAULT_MODELS
 */
export function createAgent(name, model, overrides) {
    const factory = AGENT_REGISTRY[name];
    if (!factory) {
        throw new Error(`Unknown agent: ${name}`);
    }
    const config = loadCascadedSFlowConfig();
    const configOverrides = agentOverridesFromConfig(config);
    // Merge config + programmatic overrides for non-model fields
    const merged = mergeOverrides(configOverrides, overrides || {});
    const agentOverride = merged[name];
    // Model priority: AgentOverrides > model param > config file > default
    const programmaticModel = overrides?.[name]?.model;
    const configModel = configOverrides[name]?.model;
    const resolvedModel = programmaticModel || model || configModel || DEFAULT_MODELS[name];
    const agentConfig = factory(resolvedModel);
    if (agentOverride) {
        return {
            ...agentConfig,
            ...agentOverride,
            model: resolvedModel, // preserve correct priority: overrides > param > config > default
            id: agentConfig.id,
            name: agentConfig.name,
        };
    }
    return agentConfig;
}
/**
 * Create all agents
 */
export function createAllAgents(model, overrides) {
    const agents = {};
    // Load config once for all agents
    const config = loadCascadedSFlowConfig();
    const configOverrides = agentOverridesFromConfig(config);
    for (const name of Object.keys(AGENT_REGISTRY)) {
        const factory = AGENT_REGISTRY[name];
        const merged = mergeOverrides(configOverrides, overrides || {});
        const agentOverride = merged[name];
        // Model priority: programmatic overrides > model param > config file > default
        const programmaticModel = overrides?.[name]?.model;
        const configModel = configOverrides[name]?.model;
        const resolvedModel = programmaticModel || model || configModel || DEFAULT_MODELS[name];
        const agentConfig = factory(resolvedModel);
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
 * Get agent mode
 */
export function getAgentMode(name) {
    const factory = AGENT_REGISTRY[name];
    return factory?.mode || 'subagent';
}
/**
 * Get primary agents (mode === 'primary')
 */
export function getPrimaryAgents() {
    return getAgentNames().filter(name => getAgentMode(name) === 'primary');
}
/**
 * Get subagent agents (mode === 'subagent')
 */
export function getSubagentAgents() {
    return getAgentNames().filter(name => getAgentMode(name) === 'subagent');
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