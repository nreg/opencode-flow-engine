/**
 * Skill Loader - Loads and manages skills from SKILL.md files
 * Based on oh-my-openagent's skill loader pattern
 */
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
export declare class SkillLoader {
    private skills;
    private skillsDir;
    constructor(skillsDir?: string);
    /**
     * Load all skills from skills directory
     */
    loadAllSkills(): Skill[];
    /**
     * Load a single skill by name
     */
    loadSkill(name: string): Skill | null;
    /**
     * Get a loaded skill by name
     */
    getSkill(name: string): Skill | undefined;
    /**
     * Get all loaded skills
     */
    getAllSkills(): Skill[];
    /**
     * Get skill names
     */
    getSkillNames(): string[];
    /**
     * Check if skill is loaded
     */
    hasSkill(name: string): boolean;
    /**
     * Parse YAML frontmatter from SKILL.md content
     */
    private parseMetadata;
    /**
     * Get skill content without frontmatter
     */
    getSkillContent(name: string): string | null;
    /**
     * Get skills with MCP configuration
     */
    getSkillsWithMcp(): Skill[];
    /**
     * Get MCP servers for a skill
     */
    getSkillMcpServers(name: string): McpServer[];
}
/**
 * Create a skill loader instance
 */
export declare function createSkillLoader(skillsDir?: string): SkillLoader;
/**
 * Parse skill metadata from content
 */
export declare function parseSkillMetadata(content: string): SkillMetadata;
/**
 * Get skill content without frontmatter
 */
export declare function getSkillContentWithoutFrontmatter(content: string): string;
//# sourceMappingURL=skill-loader.d.ts.map