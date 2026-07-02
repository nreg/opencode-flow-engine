import { describe, it, expect, beforeEach } from 'bun:test';
import { SkillLoader, createSkillLoader, parseSkillMetadata, getSkillContentWithoutFrontmatter } from './skill-loader.js';
import type { Skill, SkillMetadata } from './skill-loader.js';

describe('Skill Loader', () => {
  let loader: SkillLoader;

  beforeEach(() => {
    loader = new SkillLoader();
  });

  describe('loadAllSkills', () => {
    it('should load all skills from skills directory', async () => {
      const skills = await loader.loadAllSkills();
      expect(skills).toBeDefined();
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBeGreaterThan(0);
    });

    it('should load workflow-start skill', async () => {
      const skills = await loader.loadAllSkills();
      const workflowStart = skills.find(s => s.metadata.name === 'workflow-start');
      expect(workflowStart).toBeDefined();
    });

    it('should load all 9 core skills', async () => {
      const skills = await loader.loadAllSkills();
      const skillNames = skills.map(s => s.metadata.name);
      expect(skillNames).toContain('workflow-start');
      expect(skillNames).toContain('need-explorer');
      expect(skillNames).toContain('spec-writer');
      expect(skillNames).toContain('contract-builder');
      expect(skillNames).toContain('build-executor');
      expect(skillNames).toContain('bug-investigator');
      expect(skillNames).toContain('code-reviewer');
      expect(skillNames).toContain('release-archivist');
      expect(skillNames).toContain('spec-merger');
    });
  });

  describe('loadSkill', () => {
    it('should load a single skill', async () => {
      const skill = await loader.loadSkill('workflow-start');
      expect(skill).toBeDefined();
      expect(skill!.metadata.name).toBe('workflow-start');
      expect(skill!.content).toBeDefined();
      expect(skill!.path).toBeDefined();
    });

    it('should return null for non-existent skill', async () => {
      const skill = await loader.loadSkill('non-existent-skill');
      expect(skill).toBeNull();
    });
  });

  describe('getSkill', () => {
    it('should return loaded skill', async () => {
      await loader.loadAllSkills();
      const skill = loader.getSkill('workflow-start');
      expect(skill).toBeDefined();
      expect(skill!.metadata.name).toBe('workflow-start');
    });

    it('should return undefined for unloaded skill', () => {
      const skill = loader.getSkill('workflow-start');
      expect(skill).toBeUndefined();
    });
  });

  describe('getAllSkills', () => {
    it('should return all loaded skills', async () => {
      await loader.loadAllSkills();
      const skills = loader.getAllSkills();
      expect(skills.length).toBeGreaterThan(0);
    });
  });

  describe('getSkillNames', () => {
    it('should return skill names', async () => {
      await loader.loadAllSkills();
      const names = loader.getSkillNames();
      expect(names).toContain('workflow-start');
    });
  });

  describe('hasSkill', () => {
    it('should return true for loaded skill', async () => {
      await loader.loadAllSkills();
      expect(loader.hasSkill('workflow-start')).toBe(true);
    });

    it('should return false for unloaded skill', () => {
      expect(loader.hasSkill('non-existent')).toBe(false);
    });
  });

  describe('getSkillContent', () => {
    it('should return skill content without frontmatter', async () => {
      await loader.loadAllSkills();
      const content = loader.getSkillContent('workflow-start');
      expect(content).toBeDefined();
      expect(content).not.toContain('---');
    });

    it('should return null for unloaded skill', () => {
      const content = loader.getSkillContent('workflow-start');
      expect(content).toBeNull();
    });
  });

  describe('getSkillsWithMcp', () => {
    it('should return skills with MCP config', () => {
      const skills = loader.getSkillsWithMcp();
      expect(Array.isArray(skills)).toBe(true);
    });
  });

  describe('getSkillMcpServers', () => {
    it('should return MCP servers for skill', () => {
      const servers = loader.getSkillMcpServers('workflow-start');
      expect(Array.isArray(servers)).toBe(true);
    });

    it('should return empty array for skill without MCP', () => {
      const servers = loader.getSkillMcpServers('non-existent');
      expect(Array.isArray(servers)).toBe(true);
      expect(servers).toHaveLength(0);
    });
  });
});

describe('Utility Functions', () => {
  describe('createSkillLoader', () => {
    it('should create and load skills', async () => {
      const loader = await createSkillLoader();
      expect(loader).toBeDefined();
      const skills = loader.getAllSkills();
      expect(skills.length).toBeGreaterThan(0);
    });
  });

  describe('parseSkillMetadata', () => {
    it('should parse metadata from frontmatter', () => {
      const content = `---
name: test-skill
description: "A test skill"
version: "1.0.0"
author: "test"
tags: "test, demo"
---

# Test Skill`;
      const metadata = parseSkillMetadata(content);
      expect(metadata.name).toBe('test-skill');
      expect(metadata.description).toBe('"A test skill"');
      expect(metadata.version).toBe('"1.0.0"');
      expect(metadata.author).toBe('"test"');
      expect(metadata.tags).toEqual(['"test', 'demo"']);
    });

    it('should handle missing frontmatter', () => {
      const content = `# Just content`;
      const metadata = parseSkillMetadata(content);
      expect(metadata.name).toBe('unknown');
      expect(metadata.description).toBe('');
    });

    it('should handle partial frontmatter', () => {
      const content = `---
name: partial-skill
---

# Partial`;
      const metadata = parseSkillMetadata(content);
      expect(metadata.name).toBe('partial-skill');
      expect(metadata.description).toBe('');
    });
  });

  describe('getSkillContentWithoutFrontmatter', () => {
    it('should remove frontmatter from content', () => {
      const content = `---
name: test
---

# Content`;
      const result = getSkillContentWithoutFrontmatter(content);
      expect(result).not.toContain('---');
      expect(result).toContain('# Content');
    });

    it('should return original content if no frontmatter', () => {
      const content = `# No frontmatter`;
      const result = getSkillContentWithoutFrontmatter(content);
      expect(result).toBe(content);
    });
  });
});
