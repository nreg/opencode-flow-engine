/**
 * Skill Loader - Loads and manages skills from SKILL.md files
 * Based on oh-my-openagent's skill loader pattern
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Skill metadata from YAML frontmatter
 */
export interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
  mcp?: McpConfig;
}

/**
 * MCP configuration for skill
 */
export interface McpConfig {
  servers?: McpServer[];
}

/**
 * MCP server definition
 */
export interface McpServer {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Loaded skill
 */
export interface Skill {
  metadata: SkillMetadata;
  content: string;
  path: string;
}

/**
 * Skill loader class
 */
export class SkillLoader {
  private skills: Map<string, Skill> = new Map();
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir || join(__dirname, '..', '..', '..', '..', 'skills');
  }

  /**
   * Load all skills from skills directory
   */
  loadAllSkills(): Skill[] {
    const skills: Skill[] = [];

    if (!existsSync(this.skillsDir)) {
      console.warn(`Skills directory not found: ${this.skillsDir}`);
      return skills;
    }

    const entries = readdirSync(this.skillsDir);
    for (const entry of entries) {
      const skillPath = join(this.skillsDir, entry);
      if (statSync(skillPath).isDirectory()) {
        const skill = this.loadSkill(entry);
        if (skill) {
          skills.push(skill);
          this.skills.set(entry, skill);
        }
      }
    }

    return skills;
  }

  /**
   * Load a single skill by name
   */
  loadSkill(name: string): Skill | null {
    const skillDir = join(this.skillsDir, name);
    const skillFile = join(skillDir, 'SKILL.md');

    if (!existsSync(skillFile)) {
      console.warn(`Skill file not found: ${skillFile}`);
      return null;
    }

    const content = readFileSync(skillFile, 'utf-8');
    const metadata = this.parseMetadata(content);

    const skill: Skill = {
      metadata,
      content,
      path: skillFile,
    };

    this.skills.set(name, skill);
    return skill;
  }

  /**
   * Get a loaded skill by name
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get all loaded skills
   */
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skill names
   */
  getSkillNames(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * Check if skill is loaded
   */
  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * Parse YAML frontmatter from SKILL.md content
   */
  private parseMetadata(content: string): SkillMetadata {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return {
        name: 'unknown',
        description: '',
      };
    }

    const frontmatter = frontmatterMatch[1];
    const metadata: SkillMetadata = {
      name: '',
      description: '',
    };

    // Parse simple key-value pairs
    const lines = frontmatter.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        switch (key) {
          case 'name':
            metadata.name = value;
            break;
          case 'description':
            metadata.description = value;
            break;
          case 'version':
            metadata.version = value;
            break;
          case 'author':
            metadata.author = value;
            break;
          case 'tags':
            metadata.tags = value.split(',').map(t => t.trim());
            break;
        }
      }
    }

    return metadata;
  }

  /**
   * Get skill content without frontmatter
   */
  getSkillContent(name: string): string | null {
    const skill = this.getSkill(name);
    if (!skill) {
      return null;
    }

    // Remove frontmatter
    return skill.content.replace(/^---\n[\s\S]*?\n---\n/, '');
  }

  /**
   * Get skills with MCP configuration
   */
  getSkillsWithMcp(): Skill[] {
    return this.getAllSkills().filter(skill => skill.metadata.mcp);
  }

  /**
   * Get MCP servers for a skill
   */
  getSkillMcpServers(name: string): McpServer[] {
    const skill = this.getSkill(name);
    if (!skill?.metadata.mcp?.servers) {
      return [];
    }
    return skill.metadata.mcp.servers;
  }
}

/**
 * Create a skill loader instance
 */
export function createSkillLoader(skillsDir?: string): SkillLoader {
  const loader = new SkillLoader(skillsDir);
  loader.loadAllSkills();
  return loader;
}

/**
 * Parse skill metadata from content
 */
export function parseSkillMetadata(content: string): SkillMetadata {
  const loader = new SkillLoader();
  return loader['parseMetadata'](content);
}

/**
 * Get skill content without frontmatter
 */
export function getSkillContentWithoutFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, '');
}
