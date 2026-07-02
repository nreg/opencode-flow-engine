/**
 * Config Loader - Load agent configuration from .sflow/config.json
 */
import { access, readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { deepMerge } from '@opencode-sflow/shared';
/**
 * User-level config path: ~/.sflow/config.json
 */
export const USER_CONFIG_FILE = join(homedir(), '.sflow', 'config.json');
/**
 * Load sFlow config from a specific directory's .sflow/config.json
 */
export async function loadSFlowConfig(projectDir) {
    const dir = projectDir || process.cwd();
    const configPath = join(dir, '.sflow', 'config.json');
    try {
        await access(configPath);
    }
    catch {
        return {};
    }
    try {
        const raw = await readFile(configPath, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        console.warn(`[sflow] Failed to parse ${configPath}`);
        return {};
    }
}
/**
 * Load user-level config from ~/.sflow/config.json
 */
export async function loadUserSFlowConfig() {
    try {
        await access(USER_CONFIG_FILE);
    }
    catch {
        return {};
    }
    try {
        const raw = await readFile(USER_CONFIG_FILE, 'utf-8');
        return JSON.parse(raw);
    }
    catch {
        console.warn(`[sflow] Failed to parse user config: ${USER_CONFIG_FILE}`);
        return {};
    }
}
/**
 * Load cascading config: user-level (~/.sflow/config.json) as base,
 * project-level (.sflow/config.json) as higher-priority override.
 */
export async function loadCascadedSFlowConfig(projectDir) {
    const user = await loadUserSFlowConfig();
    const project = await loadSFlowConfig(projectDir);
    if (Object.keys(project).length === 0)
        return user;
    return deepMerge(user, project);
}
/**
 * Known built-in agent names
 */
const BUILTIN_AGENTS = [
    'sflow',
    'need-explorer',
    'spec-writer',
    'contract-builder',
    'build-executor',
    'bug-investigator',
    'code-reviewer',
    'release-archivist',
    'spec-merger',
];
/**
 * Convert SFlowConfig.agents to AgentOverrides format
 */
export function agentOverridesFromConfig(config) {
    const overrides = {};
    for (const name of BUILTIN_AGENTS) {
        const entry = config.agents?.[name];
        if (!entry)
            continue;
        const override = {};
        if (entry.model)
            override.model = entry.model;
        if (entry.temperature !== undefined)
            override.temperature = entry.temperature;
        const fb = entry.fallback_models || entry.fallbackModels;
        if (fb && fb.length > 0) {
            override.fallback_models = fb;
        }
        if (Object.keys(override).length > 0) {
            overrides[name] = override;
        }
    }
    return overrides;
}
/**
 * Merge two override configs. Higher-priority wins.
 * Uses proper typing instead of `as any`.
 */
export function mergeOverrides(base, higher) {
    if (!higher)
        return { ...base };
    const merged = { ...base };
    for (const [name, cfg] of Object.entries(higher)) {
        const baseEntry = base[name];
        merged[name] = baseEntry
            ? { ...baseEntry, ...cfg }
            : { ...cfg };
    }
    return merged;
}
/**
 * Generate a config file template with all agents
 */
export function generateConfigTemplate() {
    return {
        version: '0.1.0',
        mode: 'full',
        agents: {
            sflow: {
                model: 'anthropic/claude-sonnet-4-20250514',
                temperature: 0.6,
                fallback_models: ['anthropic/claude-haiku-4-20250514', 'openai/gpt-4o'],
            },
            'need-explorer': {
                model: 'anthropic/claude-sonnet-4-20250514',
                temperature: 0.6,
                fallback_models: ['anthropic/claude-haiku-4-20250514', 'openai/gpt-4o'],
            },
            'spec-writer': {
                model: 'anthropic/claude-sonnet-4-20250514',
                temperature: 0.6,
                fallback_models: ['anthropic/claude-haiku-4-20250514', 'openai/gpt-4o'],
            },
            'contract-builder': {
                model: 'anthropic/claude-sonnet-4-20250514',
                temperature: 0.6,
                fallback_models: ['anthropic/claude-haiku-4-20250514', 'openai/gpt-4o'],
            },
            'build-executor': {
                model: 'anthropic/claude-sonnet-4-20250514',
                temperature: 0.7,
                fallback_models: ['anthropic/claude-haiku-4-20250514', 'openai/gpt-4o'],
            },
            'bug-investigator': {
                model: 'anthropic/claude-sonnet-4-20250514',
                temperature: 0.6,
                fallback_models: ['anthropic/claude-haiku-4-20250514', 'openai/gpt-4o'],
            },
            'code-reviewer': {
                model: 'anthropic/claude-sonnet-4-20250514',
                temperature: 0.6,
                fallback_models: ['anthropic/claude-haiku-4-20250514', 'openai/gpt-4o'],
            },
            'release-archivist': {
                model: 'anthropic/claude-sonnet-4-20250514',
                temperature: 0.7,
                fallback_models: ['anthropic/claude-haiku-4-20250514', 'openai/gpt-4o'],
            },
            'spec-merger': {
                model: 'anthropic/claude-sonnet-4-20250514',
                temperature: 0.7,
                fallback_models: ['anthropic/claude-haiku-4-20250514', 'openai/gpt-4o'],
            },
        },
        features: {
            workflow_manager: true,
            state_manager: true,
        },
        hooks: {
            state_transition: true,
            artifact_validation: true,
            guard: true,
        },
        tools: {
            workflow_router: true,
            contract_validator: true,
            artifact_inspector: true,
        },
    };
}
//# sourceMappingURL=config-loader.js.map