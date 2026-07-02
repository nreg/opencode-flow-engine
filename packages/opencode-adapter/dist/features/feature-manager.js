/**
 * Feature Manager - Manages all sFlow features
 */
import { createWorkflowManager } from './workflow-manager.js';
import { createStateManager } from './state-manager.js';
import { createSkillLoader } from './skill-loader.js';
import { createMcpManager } from './mcp-manager.js';
/**
 * Feature manager class
 */
export class FeatureManager {
    workflowManager;
    stateManager;
    skillLoader;
    mcpManager;
    config;
    constructor(config = {}) {
        this.config = config;
        this.workflowManager = createWorkflowManager(config.workflowManager);
        this.stateManager = createStateManager(config.stateManager);
        this.skillLoader = createSkillLoader(config.skillsDir);
        this.mcpManager = createMcpManager();
    }
    /**
     * Initialize all features
     */
    async initialize() {
        try {
            await this.workflowManager.initialize();
            await this.stateManager.initialize();
            // Load skills
            const skills = this.skillLoader.loadAllSkills();
            console.log(`Loaded ${skills.length} skills`);
            // Start MCP servers for skills with MCP config
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
                    skillsLoaded: skills.length,
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
    /**
     * Get workflow manager
     */
    getWorkflowManager() {
        return this.workflowManager;
    }
    /**
     * Get state manager
     */
    getStateManager() {
        return this.stateManager;
    }
    /**
     * Get skill loader
     */
    getSkillLoader() {
        return this.skillLoader;
    }
    /**
     * Get MCP manager
     */
    getMcpManager() {
        return this.mcpManager;
    }
    /**
     * Get all loaded skills
     */
    getSkills() {
        return this.skillLoader.getAllSkills();
    }
    /**
     * Get skill by name
     */
    getSkill(name) {
        return this.skillLoader.getSkill(name);
    }
    /**
     * Get feature status
     */
    getStatus() {
        return {
            workflowManager: this.workflowManager.config.enabled,
            stateManager: this.stateManager.config.enabled,
            skillsLoaded: this.skillLoader.getSkillNames().length,
            mcpServers: this.mcpManager.getServerCount(),
        };
    }
}
/**
 * Create a feature manager instance
 */
export function createFeatureManager(config) {
    return new FeatureManager(config);
}
//# sourceMappingURL=feature-manager.js.map