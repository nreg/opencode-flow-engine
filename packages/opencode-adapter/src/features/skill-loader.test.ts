import { describe, it, expect, beforeEach } from 'bun:test';
import { SkillLoader, createSkillLoader, parseSkillMetadata, getSkillContentWithoutFrontmatter } from './skill-loader.js';
import type { Skill, SkillMetadata } from './skill-loader.js';

describe('Skill Loader', () => {
  let loader: SkillLoader;

  beforeEach(() => {
    loader = new SkillLoader();
  });

  describe('loadAllSkills', () => {
    it('should load all skills from skills directory', () => {
      const skills = loader.loadAllSkills();
      expect(skills).toBeDefined();
      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBeGreaterThan(0);
    });

    it('should load workflow-start skill', () => {
      const skills = loader.loadAllSkills();
      const workflowStart = skills.find(s => s.metadata.name === 'workflow-start');
      expect(workflowStart).toBeDefined();
    });

    it('should load all 9 core skills', () => {
      const skills = loader.loadAllSkills();
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
    it('should load a single skill', () => {
      const skill = loader.loadSkill('workflow-start');
      expect(skill).toBeDefined();
      expect(skill!.metadata.name).toBe('workflow-start');
      expect(skill!.content).toBeDefined();
      expect(skill!.path).toBeDefined();
    });

    it('should return null for non-existent skill', () => {
      const skill = loader.loadSkill('non-existent-skill');
      expect(skill).toBeNull();
    });
  });

  describe('getSkill', () => {
    it('should return loaded skill', () => {
      loader.loadAllSkills();
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
    it('should return all loaded skills', () => {
      loader.loadAllSkills();
      const skills = loader.getAllSkills();
      expect(skills.length).toBeGreaterThan(0);
    });
  });

  describe('getSkillNames', () => {
    it('should return skill names', () => {
      loader.loadAllSkills();
      const names = loader.getSkillNames();
      expect(names).toContain('workflow-start');
      expect(names).toContain('need-explorer');
    });
  });

  describe('hasSkill', () => {
    it('should return true for loaded skill', () => {
      loader.loadAllSkills();
      expect(loader.hasSkill('workflow-start')).toBe(true);
    });

    it('should return false for unloaded skill', () => {
      expect(loader.hasSkill('workflow-start')).toBe(false);
    });
  });

  describe('getSkillContent', () => {
    it('should return skill content without frontmatter', () => {
      loader.loadAllSkills();
      const content = loader.getSkillContent('workflow-start');
      expect(content).toBeDefined();
      expect(content).not.toContain('---');
      expect(content).toContain('# Workflow Start');
    });

    it('should return null for unloaded skill', () => {
      const content = loader.getSkillContent('workflow-start');
      expect(content).toBeNull();
    });
  });

  describe('getSkillsWithMcp', () => {
    it('should return skills with MCP config', () => {
      loader.loadAllSkills();
      const skillsWithMcp = loader.getSkillsWithMcp();
      expect(Array.isArray(skillsWithMcp)).toBe(true);
    });
  });

  describe('getSkillMcpServers', () => {
    it('should return MCP servers for skill', () => {
      loader.loadAllSkills();
      const servers = loader.getSkillMcpServers('workflow-start');
      expect(Array.isArray(servers)).toBe(true);
    });

    it('should return empty array for skill without MCP', () => {
      loader.loadAllSkills();
      const servers = loader.getSkillMcpServers('workflow-start');
      expect(servers).toHaveLength(0);
    });
  });
});

describe('Utility Functions', () => {
  describe('createSkillLoader', () => {
    it('should create and load skills', () => {
      const loader = createSkillLoader();
      expect(loader).toBeDefined();
      const skills = loader.getAllSkills();
      expect(skills.length).toBeGreaterThan(0);
    });
  });

  describe('parseSkillMetadata', () => {
    it('should parse metadata from frontmatter', () => {
      const content = `---
name: test-skill
description: Test skill description
version: 1.0.0
author: Test Author
tags: test, example
---

# Test Skill

This is a test skill.`;

      const metadata = parseSkillMetadata(content);
      expect(metadata.name).toBe('test-skill');
      expect(metadata.description).toBe('Test skill description');
      expect(metadata.version).toBe('1.0.0');
      expect(metadata.author).toBe('Test Author');
      expect(metadata.tags).toEqual(['test', 'example']);
    });

    it('should handle missing frontmatter', () => {
      const content = `# Test Skill

This is a test skill without frontmatter.`;

      const metadata = parseSkillMetadata(content);
      expect(metadata.name).toBe('unknown');
      expect(metadata.description).toBe('');
    });

    it('should handle partial frontmatter', () => {
      const content = `---
name: test-skill
---

# Test Skill

This is a test skill.`;

      const metadata = parseSkillMetadata(content);
      expect(metadata.name).toBe('test-skill');
      expect(metadata.description).toBe('');
    });
  });

  describe('getSkillContentWithoutFrontmatter', () => {
    it('should remove frontmatter from content', () => {
      const content = `---
name: test-skill
description: Test description
---

# Test Skill

This is the content.`;

      const result = getSkillContentWithoutFrontmatter(content);
      expect(result).not.toContain('---');
      expect(result).toContain('# Test Skill');
      expect(result).toContain('This is the content.');
    });

    it('should return original content if no frontmatter', () => {
      const content = `# Test Skill

This is the content.`;

      const result = getSkillContentWithoutFrontmatter(content);
      expect(result).toBe(content);
    });
  });
});
