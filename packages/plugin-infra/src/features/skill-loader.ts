/**
 * Skill Loader - Loads and manages skills from SKILL.md files
 * Based on oh-my-openagent's skill loader pattern
 */

import { readFile, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve skills directory relative to package root.
 * Detected by looking for package.json in parent chain.
 */
function resolveSkillsDir(givenDir?: string): string {
  if (givenDir) return givenDir;
  const candidates = [
    // 方案 C: workflows/*/skills/ directories (3x .. from dist/ to root)
    join(__dirname, '..', '..', '..', 'workflows', 'sflow', 'skills'),
    join(__dirname, '..', '..', '..', 'workflows', 'iflow', 'skills'),
    // Fallback: process.cwd() based path
    join(process.cwd(), 'skills'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0]!;
}

/** Resolve workflow-specific template directories */
export function resolveTemplatesDir(workflow: 'sflow' | 'iflow'): string {
  const candidates = [
    join(__dirname, '..', '..', '..', 'workflows', workflow, 'templates'),
    join(process.cwd(), `.${workflow}-templates`),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0]!;
}

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
    this.skillsDir = resolveSkillsDir(skillsDir);
  }

  /**
   * Load all skills from skills directory
   */
  async loadAllSkills(): Promise<Skill[]> {
    const skills: Skill[] = [];

    if (!existsSync(this.skillsDir)) {
      console.warn(`Skills directory not found: ${this.skillsDir}`);
      return skills;
    }

    try {
      const entries = await readdir(this.skillsDir);
      const loadPromises = entries
        .filter(entry => entry !== '.gitkeep')
        .map(async (entry) => {
          const skillPath = join(this.skillsDir, entry);
          try {
            const entryStat = await stat(skillPath);
            if (entryStat.isDirectory()) {
              return this.loadSkill(entry);
            }
          } catch {
            return null;
          }
        });

      const results = await Promise.all(loadPromises);
      for (const skill of results) {
        if (skill) {
          skills.push(skill);
          this.skills.set(skill.metadata.name || 'unknown', skill);
        }
      }
    } catch (error) {
      console.error(`Error loading skills from ${this.skillsDir}:`, error);
    }

    return skills;
  }

  /**
   * Load a single skill by name
   */
  async loadSkill(name: string): Promise<Skill | null> {
    const skillDir = join(this.skillsDir, name);
    const skillFile = join(skillDir, 'SKILL.md');

if (!existsSync(skillFile)) {
      return null;
    }

    try {
      const content = await readFile(skillFile, 'utf-8');
      const metadata = this.parseMetadata(content);

      const skill: Skill = {
        metadata,
        content,
        path: skillFile,
      };

      this.skills.set(name, skill);
      return skill;
    } catch (error) {
      console.error(`Error loading skill ${name}:`, error);
      return null;
    }
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
    return parseFrontmatter(content);
  }

  /**
   * Get skill content without frontmatter
   */
  getSkillContent(name: string): string | null {
    const skill = this.getSkill(name);
    if (!skill) {
      return null;
    }

    // Remove frontmatter block plus the following blank line
    return skill.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
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
 * Create a skill loader instance (caller must await loadAllSkills)
 */
export async function createSkillLoader(skillsDir?: string): Promise<SkillLoader> {
  const loader = new SkillLoader(skillsDir);
  await loader.loadAllSkills();
  return loader;
}

function parseFrontmatter(content: string): SkillMetadata {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatterMatch) {
    return { name: 'unknown', description: '' };
  }

  const frontmatterRaw = frontmatterMatch[1];
  if (!frontmatterRaw) {
    return { name: '', description: '' };
  }

  const metadata: SkillMetadata = {
    name: '',
    description: '',
  };

  try {
    const parsed = yaml.load(frontmatterRaw) as Record<string, unknown> | undefined;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (typeof parsed.name === 'string') metadata.name = parsed.name;
      if (typeof parsed.description === 'string') metadata.description = parsed.description;
      if (typeof parsed.version === 'string') metadata.version = parsed.version;
      if (typeof parsed.author === 'string') metadata.author = parsed.author;
      if (Array.isArray(parsed.tags)) {
        metadata.tags = parsed.tags.map(t => String(t).trim()).filter(Boolean);
      } else if (typeof parsed.tags === 'string') {
        metadata.tags = parsed.tags.split(',').map(t => t.trim()).filter(Boolean);
      }
      if (parsed.mcp && typeof parsed.mcp === 'object' && !Array.isArray(parsed.mcp)) {
        metadata.mcp = parsed.mcp as McpConfig;
      }
    }
  } catch {
    const lines = frontmatterRaw.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match && match[1] && match[2]) {
        const key = match[1];
        const value = match[2];
        switch (key) {
          case 'name':
            if (!metadata.name) metadata.name = value;
            break;
          case 'description':
            if (!metadata.description) metadata.description = value;
            break;
          case 'version':
            if (!metadata.version) metadata.version = value;
            break;
          case 'author':
            if (!metadata.author) metadata.author = value;
            break;
          case 'tags':
            if (!metadata.tags) metadata.tags = value.split(',').map(t => t.trim());
            break;
        }
      }
    }
  }

  return metadata;
}

/**
 * Parse skill metadata from content
 */
export function parseSkillMetadata(content: string): SkillMetadata {
  return parseFrontmatter(content);
}

/**
 * Get skill content without frontmatter
 */
export function getSkillContentWithoutFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}
