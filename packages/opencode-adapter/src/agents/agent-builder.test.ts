import { describe, it, expect } from 'bun:test';
import {
  createAgent,
  createAllAgents,
  getAgent,
  getAgentNames,
  getAgentMode,
  getPrimaryAgents,
  getSubagentAgents,
  agentExists,
  getDefaultModel,
  getAllDefaultModels,
} from './agent-builder.js';

describe('Agent Builder', () => {
  describe('createAgent', () => {
    it('should create sFlow agent', () => {
      const agent = createAgent('sflow', 'gpt-5.5');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('sflow');
      expect(agent.name).toBe('sFlow');
      expect(agent.model).toBe('gpt-5.5');
    });

    it('should create need-explorer agent', () => {
      const agent = createAgent('need-explorer', 'claude-opus-4-7');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('need-explorer');
      expect(agent.name).toBe('Need Explorer');
      expect(agent.model).toBe('claude-opus-4-7');
    });

    it('should create spec-writer agent', () => {
      const agent = createAgent('spec-writer', 'claude-opus-4-7');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('spec-writer');
      expect(agent.name).toBe('Spec Writer');
    });

    it('should create contract-builder agent', () => {
      const agent = createAgent('contract-builder');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('contract-builder');
      expect(agent.name).toBe('Contract Builder');
    });

    it('should create build-executor agent', () => {
      const agent = createAgent('build-executor');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('build-executor');
      expect(agent.name).toBe('Build Executor');
    });

    it('should create bug-investigator agent', () => {
      const agent = createAgent('bug-investigator');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('bug-investigator');
      expect(agent.name).toBe('Bug Investigator');
    });

    it('should create code-reviewer agent', () => {
      const agent = createAgent('code-reviewer');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('code-reviewer');
      expect(agent.name).toBe('Code Reviewer');
    });

    it('should create release-archivist agent', () => {
      const agent = createAgent('release-archivist');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('release-archivist');
      expect(agent.name).toBe('Release Archivist');
    });

    it('should create spec-merger agent', () => {
      const agent = createAgent('spec-merger');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('spec-merger');
      expect(agent.name).toBe('Spec Merger');
    });

    it('should use default model when not specified', () => {
      const agent = createAgent('sflow');
      expect(agent.model).toBe('deepseek-v4-flash');
    });
  });

  describe('createAllAgents', () => {
    it('should create all agents', () => {
      const agents = createAllAgents();
      expect(agents).toBeDefined();
      expect(Object.keys(agents)).toHaveLength(9);
    });

    it('should have all required agents', () => {
      const agents = createAllAgents();
      expect(agents.sflow).toBeDefined();
      expect(agents['need-explorer']).toBeDefined();
      expect(agents['spec-writer']).toBeDefined();
      expect(agents['contract-builder']).toBeDefined();
      expect(agents['build-executor']).toBeDefined();
      expect(agents['bug-investigator']).toBeDefined();
      expect(agents['code-reviewer']).toBeDefined();
      expect(agents['release-archivist']).toBeDefined();
      expect(agents['spec-merger']).toBeDefined();
    });

    it('should use specified model for all agents', () => {
      const agents = createAllAgents('gpt-5.5');
      expect(agents.sflow.model).toBe('gpt-5.5');
      expect(agents['need-explorer'].model).toBe('gpt-5.5');
      expect(agents['spec-writer'].model).toBe('gpt-5.5');
    });
  });

  describe('getAgent', () => {
    it('should return factory for sFlow agent', () => {
      const factory = getAgent('sflow');
      expect(factory).toBeDefined();
      expect(factory!.mode).toBe('primary');
    });

    it('should return factory for need-explorer agent', () => {
      const factory = getAgent('need-explorer');
      expect(factory).toBeDefined();
      expect(factory!.mode).toBe('subagent');
    });

    it('should return undefined for unknown agent', () => {
      const factory = getAgent('unknown' as any);
      expect(factory).toBeUndefined();
    });
  });

  describe('getAgentNames', () => {
    it('should return all agent names', () => {
      const names = getAgentNames();
      expect(names).toContain('sflow');
      expect(names).toContain('need-explorer');
      expect(names).toContain('spec-writer');
      expect(names).toContain('contract-builder');
      expect(names).toContain('build-executor');
      expect(names).toContain('bug-investigator');
      expect(names).toContain('code-reviewer');
      expect(names).toContain('release-archivist');
      expect(names).toContain('spec-merger');
      expect(names).toHaveLength(9);
    });
  });

  describe('getAgentMode', () => {
    it('should return primary for sFlow', () => {
      expect(getAgentMode('sflow')).toBe('primary');
    });

    it('should return subagent for other agents', () => {
      expect(getAgentMode('need-explorer')).toBe('subagent');
      expect(getAgentMode('spec-writer')).toBe('subagent');
      expect(getAgentMode('contract-builder')).toBe('subagent');
      expect(getAgentMode('build-executor')).toBe('subagent');
      expect(getAgentMode('bug-investigator')).toBe('subagent');
      expect(getAgentMode('code-reviewer')).toBe('subagent');
      expect(getAgentMode('release-archivist')).toBe('subagent');
      expect(getAgentMode('spec-merger')).toBe('subagent');
    });
  });

  describe('getPrimaryAgents', () => {
    it('should return only sFlow as primary', () => {
      const primaries = getPrimaryAgents();
      expect(primaries).toHaveLength(1);
      expect(primaries).toContain('sflow');
    });
  });

  describe('getSubagentAgents', () => {
    it('should return all subagents', () => {
      const subagents = getSubagentAgents();
      expect(subagents).toHaveLength(8);
      expect(subagents).toContain('need-explorer');
      expect(subagents).toContain('spec-writer');
      expect(subagents).toContain('contract-builder');
      expect(subagents).toContain('build-executor');
      expect(subagents).toContain('bug-investigator');
      expect(subagents).toContain('code-reviewer');
      expect(subagents).toContain('release-archivist');
      expect(subagents).toContain('spec-merger');
      expect(subagents).not.toContain('sflow');
    });
  });

  describe('agentExists', () => {
    it('should return true for existing agents', () => {
      expect(agentExists('sflow')).toBe(true);
      expect(agentExists('need-explorer')).toBe(true);
      expect(agentExists('spec-writer')).toBe(true);
    });

    it('should return false for unknown agents', () => {
      expect(agentExists('unknown')).toBe(false);
      expect(agentExists('')).toBe(false);
    });
  });

  describe('getDefaultModel', () => {
    it('should return default model for sFlow', () => {
      const model = getDefaultModel('sflow');
      expect(model).toBe('deepseek-v4-flash');
    });

    it('should return default model for other agents', () => {
      const model = getDefaultModel('need-explorer');
      expect(model).toBe('kimi-k2.6');
    });
  });

  describe('getAllDefaultModels', () => {
    it('should return models for all agents', () => {
      const models = getAllDefaultModels();
      expect(Object.keys(models)).toHaveLength(9);
      expect(models.sflow).toBe('deepseek-v4-flash');
      expect(models['need-explorer']).toBe('kimi-k2.6');
      expect(models['spec-writer']).toBe('glm-5.1');
    });
  });

  describe('Agent Configuration', () => {
    it('should have valid instructions', () => {
      const agent = createAgent('sflow');
      expect(agent.instructions).toBeDefined();
      expect(agent.instructions.length).toBeGreaterThan(0);
    });

    it('should have valid temperature', () => {
      const agent = createAgent('sflow');
      expect(agent.temperature).toBeDefined();
      expect(agent.temperature).toBeGreaterThanOrEqual(0);
      expect(agent.temperature).toBeLessThanOrEqual(1);
    });

    it('should have valid tools configuration', () => {
      const agent = createAgent('sflow');
      expect(agent.tools).toBeDefined();
      expect(typeof agent.tools).toBe('object');
    });
  });
});
