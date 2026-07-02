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
function resolveSkillsDir(givenDir) {
    if (givenDir)
        return givenDir;
    let current = resolve(__dirname, '..');
    for (let i = 0; i < 10; i++) {
        const skillsPath = join(current, 'skills');
        if (existsSync(skillsPath)) {
            return skillsPath;
        }
        current = resolve(current, '..');
    }
    return join(__dirname, '..', '..', '..', '..', 'skills');
}
/**
 * Skill loader class
 */
export class SkillLoader {
    skills = new Map();
    skillsDir;
    constructor(skillsDir) {
        this.skillsDir = resolveSkillsDir(skillsDir);
    }
    /**
     * Load all skills from skills directory
     */
    async loadAllSkills() {
        const skills = [];
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
                }
                catch {
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
        }
        catch (error) {
            console.error(`Error loading skills from ${this.skillsDir}:`, error);
        }
        return skills;
    }
    /**
     * Load a single skill by name
     */
    async loadSkill(name) {
        const skillDir = join(this.skillsDir, name);
        const skillFile = join(skillDir, 'SKILL.md');
        if (!existsSync(skillFile)) {
            console.warn(`Skill file not found: ${skillFile}`);
            return null;
        }
        try {
            const content = await readFile(skillFile, 'utf-8');
            const metadata = this.parseMetadata(content);
            const skill = {
                metadata,
                content,
                path: skillFile,
            };
            this.skills.set(name, skill);
            return skill;
        }
        catch (error) {
            console.error(`Error loading skill ${name}:`, error);
            return null;
        }
    }
    /**
     * Get a loaded skill by name
     */
    getSkill(name) {
        return this.skills.get(name);
    }
    /**
     * Get all loaded skills
     */
    getAllSkills() {
        return Array.from(this.skills.values());
    }
    /**
     * Get skill names
     */
    getSkillNames() {
        return Array.from(this.skills.keys());
    }
    /**
     * Check if skill is loaded
     */
    hasSkill(name) {
        return this.skills.has(name);
    }
    /**
     * Parse YAML frontmatter from SKILL.md content
     */
    parseMetadata(content) {
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
            return {
                name: 'unknown',
                description: '',
            };
        }
        const frontmatterRaw = frontmatterMatch[1];
        if (!frontmatterRaw) {
            return { name: '', description: '' };
        }
        const metadata = {
            name: '',
            description: '',
        };
        try {
            const parsed = yaml.load(frontmatterRaw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                if (typeof parsed.name === 'string')
                    metadata.name = parsed.name;
                if (typeof parsed.description === 'string')
                    metadata.description = parsed.description;
                if (typeof parsed.version === 'string')
                    metadata.version = parsed.version;
                if (typeof parsed.author === 'string')
                    metadata.author = parsed.author;
                if (Array.isArray(parsed.tags)) {
                    metadata.tags = parsed.tags.map(t => String(t).trim()).filter(Boolean);
                }
                else if (typeof parsed.tags === 'string') {
                    metadata.tags = parsed.tags.split(',').map(t => t.trim()).filter(Boolean);
                }
                if (parsed.mcp && typeof parsed.mcp === 'object' && !Array.isArray(parsed.mcp)) {
                    metadata.mcp = parsed.mcp;
                }
            }
        }
        catch {
            // Fallback to simple regex-based parsing if YAML fails
            const lines = frontmatterRaw.split('\n');
            for (const line of lines) {
                const match = line.match(/^(\w+):\s*(.+)$/);
                if (match && match[1] && match[2]) {
                    const key = match[1];
                    const value = match[2];
                    switch (key) {
                        case 'name':
                            if (!metadata.name)
                                metadata.name = value;
                            break;
                        case 'description':
                            if (!metadata.description)
                                metadata.description = value;
                            break;
                        case 'version':
                            if (!metadata.version)
                                metadata.version = value;
                            break;
                        case 'author':
                            if (!metadata.author)
                                metadata.author = value;
                            break;
                        case 'tags':
                            if (!metadata.tags)
                                metadata.tags = value.split(',').map(t => t.trim());
                            break;
                    }
                }
            }
        }
        return metadata;
    }
    /**
     * Get skill content without frontmatter
     */
    getSkillContent(name) {
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
    getSkillsWithMcp() {
        return this.getAllSkills().filter(skill => skill.metadata.mcp);
    }
    /**
     * Get MCP servers for a skill
     */
    getSkillMcpServers(name) {
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
export async function createSkillLoader(skillsDir) {
    const loader = new SkillLoader(skillsDir);
    await loader.loadAllSkills();
    return loader;
}
/**
 * Parse skill metadata from content
 */
export function parseSkillMetadata(content) {
    const loader = new SkillLoader();
    return loader['parseMetadata'](content);
}
/**
 * Get skill content without frontmatter
 */
export function getSkillContentWithoutFrontmatter(content) {
    return content.replace(/^---\n[\s\S]*?\n---\n/, '');
}
//# sourceMappingURL=skill-loader.js.map