import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  createAgent,
  createAllAgents,
  getAgent,
  getAgentNames,
  getAgentMode,
  getPrimaryAgents,
  getSubagentAgents,
  agentExists,
  getAlternativeModel,
  markModelUnavailable,
  clearUnavailableModels,
  AGENT_PROFILES,
  resolveModelWithFallback,
  clearConfigCache,
} from './agent-builder.js';
import { USER_CONFIG_FILE } from './config-loader.js';
import { join } from 'path';

// 隔离真实用户配置（~/.config/opencode/opencode-flow-engine.json），
// 指向不存在的临时文件，使测试结果确定性
const ISOLATED_USER_CONFIG = join(
  process.env.TEMP || '/tmp',
  'opencode-flow-engine-test-isolated.json',
);

describe('Agent Builder', () => {
  beforeEach(() => {
    process.env.FLOW_ENGINE_USER_CONFIG_FILE = ISOLATED_USER_CONFIG;
    clearConfigCache();
  });

  afterEach(() => {
    delete process.env.FLOW_ENGINE_USER_CONFIG_FILE;
    clearConfigCache();
  });
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
      // Wave 4: Verify platform-layer permission config denies subagent task tool
      expect(agent.permission?.task?.['*']).toBe('deny');
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

    it('should not inject a model when unconfigured (Wave 2: no built-in default)', async () => {
      const agent = await createAgent('sFlow');
      // sFlow 无 AGENT_PROFILES 绑定，且无用户配置 → 解析为 unconfigured → 不写 model 字段
      expect(agent.model).toBeUndefined();
    });

    it('T2.5: createAgent without config produces no model field', async () => {
      const agent = await createAgent('spec-writer');
      expect(agent.model).toBeUndefined();
      // 钉死"字段缺失"语义：不仅是 undefined，而是 model 键根本不存在
      expect('model' in agent).toBe(false);
    });
  });

  describe('createAllAgents', () => {
    it('should create all agents', async () => {
      const agents = await createAllAgents();
      expect(agents).toBeDefined();
      expect(Object.keys(agents)).toHaveLength(25);
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
      expect(agents['ui-reviewer']).toBeDefined();
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
      expect(agents['flow-evolve']).toBeDefined();
      expect(agents['flow-health']).toBeDefined();
      expect(agents['flow-restyle']).toBeDefined();
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
      expect(names).toContain('ui-reviewer');
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
      expect(names).toContain('flow-evolve');
      expect(names).toContain('flow-health');
      expect(names).toContain('flow-restyle');
      expect(names).toHaveLength(25);
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
      expect(getAgentMode('ui-reviewer')).toBe('subagent');
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
      expect(subagents).toHaveLength(23);
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
      expect(subagents).toContain('ui-reviewer');
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
      expect(subagents).toContain('flow-evolve');
      expect(subagents).toContain('flow-health');
      expect(subagents).toContain('flow-restyle');
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

  describe('getAlternativeModel', () => {
    // Wave 2: getAlternativeModel reads ONLY the explicitly-provided user-config fallback
    // chain (extraFallbacks). There is no built-in default list anymore — each test
    // injects its own fallback list (neutral model strings, not built-in defaults).
    const REVIEW_FB = ['provider/alt-a', 'provider/alt-b'];
    const SFLOW_FB = ['provider/alt-a', 'provider/alt-b'];
    const NEED_FB = ['provider/alt-a', 'provider/alt-b'];
    const CURRENT = 'provider/alt-current';

    it('should return first fallback model different from current model', () => {
      const alt = getAlternativeModel(CURRENT, 'review-engineer', REVIEW_FB);
      expect(alt).toBe('provider/alt-a');
    });

    it('should skip fallback that matches current model', () => {
      const alt = getAlternativeModel('provider/alt-a', 'sFlow', SFLOW_FB);
      expect(alt).toBe('provider/alt-b');
    });

    it('should return null when all fallbacks match current model', () => {
      const alt = getAlternativeModel('provider/alt-a', 'x', ['provider/alt-a']);
      expect(alt).toBeNull();
    });

    it('should return null for empty fallback list', () => {
      const alt = getAlternativeModel(CURRENT, 'x', []);
      expect(alt).toBeNull();
    });

    it('should return first fallback when current differs', () => {
      const alt = getAlternativeModel('provider/alt-b', 'need-explorer', NEED_FB);
      expect(alt).toBe('provider/alt-a');
    });

    it('should work for cross-model spot-check scenario', () => {
      const defaultModel = CURRENT;
      const alt = getAlternativeModel(defaultModel, 'review-engineer', REVIEW_FB);
      expect(alt).not.toBeNull();
      expect(alt).not.toBe(defaultModel);
    });
  });

  describe('getAlternativeModel — Wave 2 (no built-in defaults)', () => {
    it('returns null when no user fallback chain is provided', () => {
      const alt = getAlternativeModel('provider/x', 'build-executor', []);
      expect(alt).toBeNull();
    });

    it('returns the provided fallback when available', () => {
      const alt = getAlternativeModel('provider/x', 'build-executor', ['openai/gpt-5']);
      expect(alt).toBe('openai/gpt-5');
    });
  });

  describe('getAlternativeModel — F5 可用性检查', () => {
    // Wave 2: fallbacks are injected explicitly via extraFallbacks (user-config chain).
    const REVIEW_FB = ['provider/alt-a', 'provider/alt-b'];
    const SFLOW_FB = ['provider/alt-a', 'provider/alt-b'];
    const NEED_FB = ['provider/alt-a', 'provider/alt-b'];
    const CURRENT = 'provider/alt-current';

    it('应跳过不可用的 fallback 模型，返回下一个可用模型', () => {
      clearUnavailableModels();
      markModelUnavailable('provider/alt-a');
      const alt = getAlternativeModel(CURRENT, 'review-engineer', REVIEW_FB);
      expect(alt).toBe('provider/alt-b');
      clearUnavailableModels();
    });

    it('应在所有 fallback 都不可用时返回 null', () => {
      clearUnavailableModels();
      markModelUnavailable('provider/alt-a');
      markModelUnavailable('provider/alt-b');
      const alt = getAlternativeModel(CURRENT, 'review-engineer', REVIEW_FB);
      expect(alt).toBeNull();
      clearUnavailableModels();
    });

    it('应在可用模型与当前模型不同时返回该模型', () => {
      clearUnavailableModels();
      const alt = getAlternativeModel(CURRENT, 'sFlow', SFLOW_FB);
      expect(alt).toBe('provider/alt-a');
      clearUnavailableModels();
    });

    it('应在可用模型与当前模型相同时跳过继续查找', () => {
      clearUnavailableModels();
      const alt = getAlternativeModel('provider/alt-a', 'need-explorer', NEED_FB);
      expect(alt).toBe('provider/alt-b');
      clearUnavailableModels();
    });

    it('应在当前模型匹配且后续 fallback 不可用时返回 null', () => {
      clearUnavailableModels();
      markModelUnavailable('provider/alt-b');
      const alt = getAlternativeModel('provider/alt-a', 'need-explorer', NEED_FB);
      expect(alt).toBeNull();
      clearUnavailableModels();
    });

    it('应在当前模型不可用但与 fallback 不同时仍返回可用 fallback', () => {
      clearUnavailableModels();
      markModelUnavailable(CURRENT);
      const alt = getAlternativeModel(CURRENT, 'review-engineer', REVIEW_FB);
      expect(alt).toBe('provider/alt-a');
      clearUnavailableModels();
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

  describe('Wave 2 - Config Passing', () => {
    it('should pass config to sFlow agent factory', async () => {
      const agent = await createAgent('sFlow');
      expect(agent).toBeDefined();
      expect(agent.id).toBe('sFlow');
      expect(agent.instructions).toBeDefined();
    });

    it('should include Review Gate constraints when config.features.reviewGate is true', async () => {
      const agent = await createAgent('sFlow');
      const instructions = String(agent.instructions);
      expect(instructions).toContain('Single Wave per build-executor Call');
      expect(instructions).toContain('Execution Contract Wave Structure');
    });
  });

  describe('Wave 3 - activeWorkflow Parameter', () => {
    describe('createAgent', () => {
      it('should accept activeWorkflow parameter with sflow value', async () => {
        const agent = await createAgent('sFlow', undefined, undefined, undefined, 'sflow');
        expect(agent).toBeDefined();
        expect(agent.id).toBe('sFlow');
      });

      it('should accept activeWorkflow parameter with iflow value', async () => {
        const agent = await createAgent('iFlow', undefined, undefined, undefined, 'iflow');
        expect(agent).toBeDefined();
        expect(agent.id).toBe('IFlow');
      });

      it('should accept activeWorkflow parameter with none value', async () => {
        const agent = await createAgent('sFlow', undefined, undefined, undefined, 'none');
        expect(agent).toBeDefined();
        expect(agent.id).toBe('sFlow');
      });

      it('should default to sflow when activeWorkflow is not provided', async () => {
        // This tests backward compatibility - existing code should work unchanged
        const agent = await createAgent('sFlow');
        expect(agent).toBeDefined();
        expect(agent.id).toBe('sFlow');
        // The default behavior should be the same as passing 'sflow' explicitly
      });
    });

    describe('createAllAgents', () => {
      it('should accept activeWorkflow parameter with sflow value', async () => {
        const agents = await createAllAgents(undefined, undefined, undefined, 'sflow');
        expect(agents).toBeDefined();
        expect(agents.sFlow).toBeDefined();
      });

      it('should accept activeWorkflow parameter with iflow value', async () => {
        const agents = await createAllAgents(undefined, undefined, undefined, 'iflow');
        expect(agents).toBeDefined();
        expect(agents.iFlow).toBeDefined();
      });

      it('should accept activeWorkflow parameter with none value', async () => {
        const agents = await createAllAgents(undefined, undefined, undefined, 'none');
        expect(agents).toBeDefined();
        expect(agents.sFlow).toBeDefined();
      });

      it('should default to sflow when activeWorkflow is not provided', async () => {
        // This tests backward compatibility - existing code should work unchanged
        const agents = await createAllAgents();
        expect(agents).toBeDefined();
        expect(agents.sFlow).toBeDefined();
      });
    });
  });
});

// ─── Wave 6: AGENT_PROFILES IFlow agents ───────────────────────────────────────

describe('AGENT_PROFILES — IFlow agents', () => {
  it('should map iflow-discuss-planner to standard', () => {
    expect(AGENT_PROFILES['iflow-discuss-planner']).toBe('standard');
  });

  it('should map iflow-researcher to standard', () => {
    expect(AGENT_PROFILES['iflow-researcher']).toBe('standard');
  });

  it('should map iflow-plan-executor to deep', () => {
    expect(AGENT_PROFILES['iflow-plan-executor']).toBe('deep');
  });

  it('should map iflow-verifier to review', () => {
    expect(AGENT_PROFILES['iflow-verifier']).toBe('review');
  });

  it('should map iflow-shipper to quick', () => {
    expect(AGENT_PROFILES['iflow-shipper']).toBe('quick');
  });

  it('should not map iFlow main agent', () => {
    expect(AGENT_PROFILES['iFlow']).toBeUndefined();
  });
});

// ─── Wave 6 Fix: iFlow activeWorkflow tier resolution ───────────────────────────

describe('createAgent — iFlow activeWorkflow tier resolution', () => {
  it('should resolve iflow-plan-executor via deep tier when activeWorkflow is iflow', async () => {
    // Construct modelProfiles config with deep tier (maps to iflow-plan-executor)
    const modelProfiles = {
      deep: {
        model: 'provider/test-deep-model',
        fallback_models: ['provider/test-deep-fallback'],
      },
    };

    // Call resolveModelWithFallback with activeWorkflow: 'iflow'
    const result = resolveModelWithFallback(
      'iflow-plan-executor',
      undefined, // model
      undefined, // configOverrides
      undefined, // overrides
      {
        modelProfiles,
        activeWorkflow: 'iflow',
      },
    );

    // Verify provenance is 'profile' (user-configured tier resolution), not any built-in default
    expect(result.provenance).toBe('profile');
    expect(result.model).toBe('provider/test-deep-model');
  });

  it('should resolve iflow-discuss-planner via standard tier when activeWorkflow is iflow', async () => {
    // Construct modelProfiles config with standard tier (maps to iflow-discuss-planner)
    const modelProfiles = {
      standard: {
        model: 'provider/test-standard-model',
        fallback_models: ['provider/test-standard-fallback'],
      },
    };

    const result = resolveModelWithFallback(
      'iflow-discuss-planner',
      undefined,
      undefined,
      undefined,
      {
        modelProfiles,
        activeWorkflow: 'iflow',
      },
    );

    expect(result.provenance).toBe('profile');
    expect(result.model).toBe('provider/test-standard-model');
  });

  it('should resolve iflow-verifier via review tier when activeWorkflow is iflow', async () => {
    // Construct modelProfiles config with review tier (maps to iflow-verifier)
    const modelProfiles = {
      review: {
        model: 'provider/test-review-model',
        fallback_models: ['provider/test-review-fallback'],
      },
    };

    const result = resolveModelWithFallback(
      'iflow-verifier',
      undefined,
      undefined,
      undefined,
      {
        modelProfiles,
        activeWorkflow: 'iflow',
      },
    );

    expect(result.provenance).toBe('profile');
    expect(result.model).toBe('provider/test-review-model');
  });

  it('should skip tier resolution when activeWorkflow is none', async () => {
    // Even with modelProfiles, tier resolution should be skipped when activeWorkflow is 'none'
    const modelProfiles = {
      deep: {
        model: 'provider/test-deep-model',
        fallback_models: ['provider/test-deep-fallback'],
      },
    };

    const result = resolveModelWithFallback(
      'iflow-plan-executor',
      undefined,
      undefined,
      undefined,
      {
        modelProfiles,
        activeWorkflow: 'none',
      },
    );

    // Should NOT use tier resolution (provenance should NOT be 'profile')
    // It may fall back to system default or provider-fallback, but not from modelProfiles tier
    expect(result.provenance).not.toBe('profile');
  });

  it('should use default tier resolution when activeWorkflow is sflow', async () => {
    // sFlow activeWorkflow should also enable tier resolution
    const modelProfiles = {
      deep: {
        model: 'provider/test-deep-model',
        fallback_models: ['provider/test-deep-fallback'],
      },
    };

    const result = resolveModelWithFallback(
      'iflow-plan-executor',
      undefined,
      undefined,
      undefined,
      {
        modelProfiles,
        activeWorkflow: 'sflow',
      },
    );

    expect(result.provenance).toBe('profile');
    expect(result.model).toBe('provider/test-deep-model');
  });
});
