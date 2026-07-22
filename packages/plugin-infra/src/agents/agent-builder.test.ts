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
    it('should create sFlow agent', async () => {
      const agent = await createAgent('sFlow', 'gpt-5.5');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('sFlow');
      expect(agent.name).toBe('SFlow');
      expect(agent.model).toBe('gpt-5.5');
    });

    it('should create need-explorer agent', async () => {
      const agent = await createAgent('need-explorer', 'claude-opus-4-7');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('need-explorer');
      expect(agent.name).toBe('Need Explorer');
      expect(agent.model).toBe('claude-opus-4-7');
    });

    it('should create spec-writer agent', async () => {
      const agent = await createAgent('spec-writer', 'claude-opus-4-7');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('spec-writer');
      expect(agent.name).toBe('Spec Writer');
    });

    it('should create contract-builder agent', async () => {
      const agent = await createAgent('contract-builder');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('contract-builder');
      expect(agent.name).toBe('Contract Builder');
    });

    it('should create build-executor agent', async () => {
      const agent = await createAgent('build-executor');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('build-executor');
      expect(agent.name).toBe('Build Executor');
    });

    it('should create bug-investigator agent', async () => {
      const agent = await createAgent('bug-investigator');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('bug-investigator');
      expect(agent.name).toBe('Bug Investigator');
    });

    it('should create code-reviewer agent', async () => {
      const agent = await createAgent('code-reviewer');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('code-reviewer');
      expect(agent.name).toBe('Code Reviewer');
    });

    it('should create release-archivist agent', async () => {
      const agent = await createAgent('release-archivist');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('release-archivist');
      expect(agent.name).toBe('Release Archivist');
    });

    it('should create spec-merger agent', async () => {
      const agent = await createAgent('spec-merger');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('spec-merger');
      expect(agent.name).toBe('Spec Merger');
    });

    it('should create ui-director agent', async () => {
      const agent = await createAgent('ui-director');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('ui-director');
      expect(agent.name).toBe('UI Director');
    });

    it('should create ui-implementer agent', async () => {
      const agent = await createAgent('ui-implementer');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('ui-implementer');
      expect(agent.name).toBe('UI 实现专家');
    });

    it('should create test-engineer agent', async () => {
      const agent = await createAgent('test-engineer');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('test-engineer');
      expect(agent.name).toBe('Test Engineer');
    });

    it('should create review-engineer agent', async () => {
      const agent = await createAgent('review-engineer');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('review-engineer');
      expect(agent.name).toBe('Review Engineer');
    });

    it('should use default model when not specified', async () => {
      const agent = await createAgent('sFlow');
      expect(agent.model).toBe('atomcode/deepseek-v4-flash');
    });
  });

  describe('createAllAgents', () => {
    it('should create all agents', async () => {
      const agents = await createAllAgents();
      expect(agents).toBeDefined();
      expect(Object.keys(agents)).toHaveLength(22);
    });

    it('should have all required agents', async () => {
      const agents = await createAllAgents();
      expect(agents.sFlow).toBeDefined();
      expect(agents['need-explorer']).toBeDefined();
      expect(agents['spec-writer']).toBeDefined();
      expect(agents['contract-builder']).toBeDefined();
      expect(agents['build-executor']).toBeDefined();
      expect(agents['bug-investigator']).toBeDefined();
      expect(agents['code-reviewer']).toBeDefined();
      expect(agents['release-archivist']).toBeDefined();
      expect(agents['spec-merger']).toBeDefined();
      expect(agents['ui-director']).toBeDefined();
      expect(agents['ui-implementer']).toBeDefined();
      // IFlow agents
      expect(agents.iFlow).toBeDefined();
      expect(agents['iflow-discuss-planner']).toBeDefined();
      expect(agents['iflow-plan-executor']).toBeDefined();
      expect(agents['iflow-verifier']).toBeDefined();
      expect(agents['iflow-researcher']).toBeDefined();
      expect(agents['iflow-shipper']).toBeDefined();
      // Shared agents (cross-workflow)
      expect(agents['test-engineer']).toBeDefined();
      expect(agents['review-engineer']).toBeDefined();
      // Horizontal commands (cross-workflow)
      expect(agents['flow-intel']).toBeDefined();
      expect(agents['flow-architect']).toBeDefined();
    });

    it('should use specified model for all agents', async () => {
      const agents = await createAllAgents('gpt-5.5');
      expect(agents.sFlow.model).toBe('gpt-5.5');
      expect(agents['need-explorer'].model).toBe('gpt-5.5');
      expect(agents['spec-writer'].model).toBe('gpt-5.5');
    });
  });

  describe('getAgent', () => {
    it('should return factory for sFlow agent', () => {
      const factory = getAgent('sFlow');
      expect(factory).toBeDefined();
      // Mode is managed by AGENT_MODES registry, tested via getAgentMode()
      expect(getAgentMode('sFlow')).toBe('primary');
    });

    it('should return factory for need-explorer agent', () => {
      const factory = getAgent('need-explorer');
      expect(factory).toBeDefined();
      expect(getAgentMode('need-explorer')).toBe('subagent');
    });

    it('should return undefined for unknown agent', () => {
      const factory = getAgent('unknown' as any);
      expect(factory).toBeUndefined();
    });
  });

  describe('getAgentNames', () => {
    it('should return all agent names', () => {
      const names = getAgentNames();
      expect(names).toContain('sFlow');
      expect(names).toContain('need-explorer');
      expect(names).toContain('spec-writer');
      expect(names).toContain('contract-builder');
      expect(names).toContain('build-executor');
      expect(names).toContain('bug-investigator');
      expect(names).toContain('code-reviewer');
      expect(names).toContain('release-archivist');
      expect(names).toContain('spec-merger');
      expect(names).toContain('ui-director');
      expect(names).toContain('ui-implementer');
      // IFlow agents
      expect(names).toContain('iFlow');
      expect(names).toContain('iflow-discuss-planner');
      expect(names).toContain('iflow-plan-executor');
      expect(names).toContain('iflow-verifier');
      expect(names).toContain('iflow-researcher');
      expect(names).toContain('iflow-shipper');
      // Shared agents (cross-workflow)
      expect(names).toContain('test-engineer');
      expect(names).toContain('review-engineer');
      // Horizontal commands (cross-workflow)
      expect(names).toContain('flow-intel');
      expect(names).toContain('flow-architect');
      expect(names).toHaveLength(22);
    });
  });

  describe('getAgentMode', () => {
    it('should return primary for sFlow', () => {
      expect(getAgentMode('sFlow')).toBe('primary');
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
      expect(getAgentMode('ui-director')).toBe('subagent');
      expect(getAgentMode('ui-implementer')).toBe('subagent');
      expect(getAgentMode('test-engineer')).toBe('subagent');
      expect(getAgentMode('review-engineer')).toBe('subagent');
    });
  });

  describe('getPrimaryAgents', () => {
    it('should return sFlow and iFlow as primary', () => {
      const primaries = getPrimaryAgents();
      expect(primaries).toHaveLength(2);
      expect(primaries).toContain('sFlow');
      expect(primaries).toContain('iFlow');
    });
  });

  describe('getSubagentAgents', () => {
    it('should return all subagents', () => {
      const subagents = getSubagentAgents();
      expect(subagents).toHaveLength(20);
      expect(subagents).toContain('need-explorer');
      expect(subagents).toContain('spec-writer');
      expect(subagents).toContain('contract-builder');
      expect(subagents).toContain('build-executor');
      expect(subagents).toContain('bug-investigator');
      expect(subagents).toContain('code-reviewer');
      expect(subagents).toContain('release-archivist');
      expect(subagents).toContain('spec-merger');
      expect(subagents).toContain('ui-director');
      expect(subagents).toContain('ui-implementer');
      // IFlow subagents
      expect(subagents).toContain('iflow-discuss-planner');
      expect(subagents).toContain('iflow-plan-executor');
      expect(subagents).toContain('iflow-verifier');
      expect(subagents).toContain('iflow-researcher');
      expect(subagents).toContain('iflow-shipper');
      // Shared subagents
      expect(subagents).toContain('test-engineer');
      expect(subagents).toContain('review-engineer');
      // Horizontal command subagents
      expect(subagents).toContain('flow-intel');
      expect(subagents).toContain('flow-architect');
      expect(subagents).not.toContain('sFlow');
      expect(subagents).not.toContain('iFlow');
    });
  });

  describe('agentExists', () => {
    it('should return true for existing agents', () => {
      expect(agentExists('sFlow')).toBe(true);
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
      const model = getDefaultModel('sFlow');
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
      expect(Object.keys(models)).toHaveLength(22);
      expect(models.sFlow).toBe('deepseek-v4-flash');
      expect(models['need-explorer']).toBe('kimi-k2.6');
      expect(models['spec-writer']).toBe('glm-5.1');
      // IFlow models
      expect(models.iFlow).toBe('deepseek-v4-flash');
      expect(models['iflow-discuss-planner']).toBe('kimi-k2.6');
      expect(models['iflow-plan-executor']).toBe('step-3.7-flash');
      expect(models['iflow-verifier']).toBe('minimax-m2.7');
      expect(models['iflow-researcher']).toBe('glm-5.1');
      expect(models['iflow-shipper']).toBe('mimo-v2.5-pro');
    });
  });

  describe('Agent Configuration', () => {
    it('should have valid instructions', async () => {
      const agent = await createAgent('sFlow');
      expect(agent.instructions).toBeDefined();
      expect(agent.instructions.length).toBeGreaterThan(0);
    });

    it('should have valid temperature', async () => {
      const agent = await createAgent('sFlow');
      expect(agent.temperature).toBeDefined();
      expect(agent.temperature).toBeGreaterThanOrEqual(0);
      expect(agent.temperature).toBeLessThanOrEqual(1);
    });

    it('should have valid tools configuration', async () => {
      const agent = await createAgent('sFlow');
      expect(agent.tools).toBeDefined();
      expect(typeof agent.tools).toBe('object');
    });
  });
});
