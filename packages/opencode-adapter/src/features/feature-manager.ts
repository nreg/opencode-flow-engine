/**
 * Feature Manager - Manages all sFlow features
 */

import type { FeatureConfig, FeatureResult } from './types.js';
import { createWorkflowManager } from './workflow-manager.js';
import { createStateManager } from './state-manager.js';
import { createSkillLoader, type Skill, type SkillLoader } from './skill-loader.js';
import { createMcpManager, type McpManager } from './mcp-manager.js';

/**
 * Feature manager configuration
 */
export interface FeatureManagerConfig {
  workflowManager?: FeatureConfig;
  stateManager?: FeatureConfig;
  skillsDir?: string;
}

/**
 * Feature manager class
 */
export class FeatureManager {
  private workflowManager;
  private stateManager;
  private skillLoader;
  private mcpManager: McpManager;
  private config: FeatureManagerConfig;

  constructor(config: FeatureManagerConfig = {}) {
    this.config = config;
    this.workflowManager = createWorkflowManager(config.workflowManager);
    this.stateManager = createStateManager(config.stateManager);
    this.skillLoader = null as unknown as SkillLoader;
    this.mcpManager = createMcpManager();
  }

  /**
   * Initialize all features
   */
  async initialize(): Promise<FeatureResult> {
    try {
      await this.workflowManager.initialize();
      await this.stateManager.initialize();

      this.skillLoader = await createSkillLoader(this.config.skillsDir);
      const loadedSkills = this.skillLoader.getAllSkills();
      console.log(`Loaded ${loadedSkills.length} skills`);

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
          skillsLoaded: loadedSkills.length,
          mcpServersStarted: skillsWithMcp.length,
        },
      };
    } catch (error) {
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
  getSkills(): Skill[] {
    return this.skillLoader.getAllSkills();
  }

  /**
   * Get skill by name
   */
  getSkill(name: string): Skill | undefined {
    return this.skillLoader.getSkill(name);
  }

  /**
   * Get feature status
   */
  getStatus(): Record<string, unknown> {
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
export function createFeatureManager(config?: FeatureManagerConfig): FeatureManager {
  return new FeatureManager(config);
}
