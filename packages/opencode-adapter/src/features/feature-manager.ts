/**
 * Feature Manager - Manages all sFlow features
 */

import type { FeatureConfig, FeatureResult } from './types.js';
import { createWorkflowManager } from './workflow-manager.js';
import { createStateManager } from './state-manager.js';
import { createSkillLoader, type Skill, type SkillLoader } from './skill-loader.js';
import { createMcpManager, type McpManager } from './mcp-manager.js';

export interface FeatureManagerConfig {
  workflowManager?: FeatureConfig;
  stateManager?: FeatureConfig;
  skillsDir?: string;
}

export class FeatureManager {
  private workflowManager;
  private stateManager;
  private skillLoader: SkillLoader | null = null;
  private mcpManager: McpManager;
  private config: FeatureManagerConfig;
  private initialized = false;

  constructor(config: FeatureManagerConfig = {}) {
    this.config = config;
    this.workflowManager = createWorkflowManager(config.workflowManager);
    this.stateManager = createStateManager(config.stateManager, this.workflowManager);
    this.mcpManager = createMcpManager();
  }

  async initialize(): Promise<FeatureResult> {
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
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private requireInitialized(): void {
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

  getSkillLoader(): SkillLoader | null {
    return this.skillLoader;
  }

  getMcpManager() {
    return this.mcpManager;
  }

  getSkills(): Skill[] {
    this.requireInitialized();
    return this.skillLoader!.getAllSkills();
  }

  getSkill(name: string): Skill | undefined {
    this.requireInitialized();
    return this.skillLoader!.getSkill(name);
  }

  getStatus(): Record<string, unknown> {
    return {
      workflowManager: this.workflowManager.config.enabled,
      stateManager: this.stateManager.config.enabled,
      skillsLoaded: this.skillLoader?.getSkillNames().length ?? 0,
      mcpServers: this.mcpManager.getServerCount(),
    };
  }
}

export function createFeatureManager(config?: FeatureManagerConfig): FeatureManager {
  return new FeatureManager(config);
}
