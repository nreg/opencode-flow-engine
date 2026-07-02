/**
 * Feature Manager - Manages all sFlow features
 */
import { createWorkflowManager } from './workflow-manager.js';
import { createStateManager } from './state-manager.js';
import { createSkillLoader } from './skill-loader.js';
import { createMcpManager } from './mcp-manager.js';
export class FeatureManager {
    workflowManager;
    stateManager;
    skillLoader = null;
    mcpManager;
    config;
    initialized = false;
    constructor(config = {}) {
        this.config = config;
        this.workflowManager = createWorkflowManager(config.workflowManager);
        this.stateManager = createStateManager(config.stateManager, this.workflowManager);
        this.mcpManager = createMcpManager();
    }
    async initialize() {
        try {
            await this.workflowManager.initialize();
            await this.stateManager.initialize();
            this.skillLoader = await createSkillLoader(this.config.skillsDir);
            this.initialized = true;
            const loadedSkills = this.skillLoader.getAllSkills();
            console.log(`Loaded ${loadedSkills.length} skills`);
            const skillsWithMcp = this.skillLoader.getSkillsWithMcp();
            for (const skill of skillsWithMcp) {
                const servers = skill.metadata.mcp?.servers || [];
                for (const server of servers) {
                    await this.mcpManager.startServer(server.name, server);
                }
            }
            return {
                success: true,
                data: {
                    skillsLoaded: loadedSkills.length,
                    mcpServersStarted: skillsWithMcp.length,
                },
            };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    requireInitialized() {
        if (!this.initialized || !this.skillLoader) {
            throw new Error('FeatureManager not initialized. Call initialize() first.');
        }
    }
    getWorkflowManager() {
        return this.workflowManager;
    }
    getStateManager() {
        return this.stateManager;
    }
    getSkillLoader() {
        return this.skillLoader;
    }
    getMcpManager() {
        return this.mcpManager;
    }
    getSkills() {
        this.requireInitialized();
        return this.skillLoader.getAllSkills();
    }
    getSkill(name) {
        this.requireInitialized();
        return this.skillLoader.getSkill(name);
    }
    getStatus() {
        return {
            workflowManager: this.workflowManager.config.enabled,
            stateManager: this.stateManager.config.enabled,
            skillsLoaded: this.skillLoader?.getSkillNames().length ?? 0,
            mcpServers: this.mcpManager.getServerCount(),
        };
    }
}
export function createFeatureManager(config) {
    return new FeatureManager(config);
}
//# sourceMappingURL=feature-manager.js.map