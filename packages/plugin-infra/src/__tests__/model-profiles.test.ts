/**
 * Model Profile Config tests — Wave W4
 * Tests for ModelProfileConfig, AGENT_PROFILES, profile resolution, SFlow gating, template
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  resolveModelWithFallback,
  clearUnavailableModels,
  markModelUnavailable,
  isModelAvailable,
  AGENT_PROFILES,
} from '../agents/agent-builder.js';
import type { ModelProvenance, AGENT_PROFILES_TYPE } from '../agents/agent-builder.js';
import {
} from '../agents/config-loader.js';
import type { SFlowConfig, ModelProfileConfig } from '../agents/config-loader.js';
import {
  getAvailabilityState,
  refreshAvailableModels,
  resetModelAvailability,
} from '../agents/model-availability.js';
import type { ProviderListClient } from '../agents/model-availability.js';
import {
  createFallbackState,
  getNextCandidate,
  resetAvailabilitySkipWarnFlag,
} from '../helpers/fallback-state.js';

// ─── Task 4.1: ModelProfileConfig interface ──────────────────────────────────

describe('ModelProfileConfig interface', () => {
  it('should accept 6 optional object fields with model and fallback_models', () => {
    const full: ModelProfileConfig = {
      lite: { model: 'fast-model', fallback_models: [] },
      quick: { model: 'quick-model', fallback_models: ['fallback1'] },
      standard: { model: 'default-model', fallback_models: [] },
      deep: { model: 'deep-model', fallback_models: ['fallback2'] },
      ultra: { model: 'ultra-model', fallback_models: [] },
      review: { model: 'review-model', fallback_models: ['fallback3'] },
    };
    expect(full.lite?.model).toBe('fast-model');
    expect(full.quick?.fallback_models).toEqual(['fallback1']);
    expect(full.standard?.model).toBe('default-model');
    expect(full.deep?.fallback_models).toEqual(['fallback2']);
    expect(full.ultra?.model).toBe('ultra-model');
    expect(full.review?.fallback_models).toEqual(['fallback3']);
  });

  it('should allow partial config', () => {
    const partial: ModelProfileConfig = {
      standard: { model: 'default-model', fallback_models: [] },
      deep: { model: 'deep-model', fallback_models: [] },
    };
    expect(partial.standard?.model).toBe('default-model');
    expect(partial.lite).toBeUndefined();
    expect(partial.quick).toBeUndefined();
  });

  it('should allow empty config', () => {
    const empty: ModelProfileConfig = {};
    expect(Object.keys(empty).length).toBe(0);
  });
});

describe('SFlowConfig with modelProfiles', () => {
  it('should accept modelProfiles as optional field', () => {
    const config: SFlowConfig = {
      modelProfiles: {
        lite: { model: 'fast', fallback_models: [] },
        quick: { model: 'quick', fallback_models: [] },
        standard: { model: 'default', fallback_models: [] },
        deep: { model: 'deep', fallback_models: [] },
        ultra: { model: 'ultra', fallback_models: [] },
        review: { model: 'review', fallback_models: [] },
      },
    };
    expect(config.modelProfiles?.lite?.model).toBe('fast');
  });

  it('should work without modelProfiles', () => {
    const config: SFlowConfig = {
      version: '0.1.0',
      mode: 'full',
    };
    expect(config.modelProfiles).toBeUndefined();
  });
});

// ─── Task 4.2: AGENT_PROFILES registry ───────────────────────────────────────

describe('AGENT_PROFILES registry', () => {
  it('should map all SFlow agents to profile names', () => {
    // SFlow agents - 6-tier mapping
    // sFlow is NOT in AGENT_PROFILES (primary agent bypasses tier resolution)
    expect(AGENT_PROFILES['sFlow']).toBeUndefined();
    // quick tier
    expect(AGENT_PROFILES['release-archivist']).toBe('quick');
    // standard tier
    expect(AGENT_PROFILES['need-explorer']).toBe('standard');
    expect(AGENT_PROFILES['ui-director']).toBe('standard');
    expect(AGENT_PROFILES['spec-merger']).toBe('standard');
    expect(AGENT_PROFILES['flow-intel']).toBe('standard');
    expect(AGENT_PROFILES['flow-evolve']).toBe('standard');
    // deep tier
    expect(AGENT_PROFILES['spec-writer']).toBe('deep');
    expect(AGENT_PROFILES['contract-builder']).toBe('deep');
    expect(AGENT_PROFILES['build-executor']).toBe('deep');
    expect(AGENT_PROFILES['bug-investigator']).toBe('deep');
    expect(AGENT_PROFILES['ui-implementer']).toBe('deep');
    expect(AGENT_PROFILES['flow-architect']).toBe('deep');
    expect(AGENT_PROFILES['flow-restyle']).toBe('deep');
    // review tier
    expect(AGENT_PROFILES['code-reviewer']).toBe('review');
    expect(AGENT_PROFILES['test-engineer']).toBe('review');
    expect(AGENT_PROFILES['review-engineer']).toBe('review');
    expect(AGENT_PROFILES['flow-health']).toBe('review');
  });

  it('should not map IFlow main agent', () => {
    // iFlow main agent bypasses profile resolution (like sFlow)
    expect(AGENT_PROFILES['iFlow']).toBeUndefined();
  });

  it('should map IFlow subagents to profiles', () => {
    // IFlow subagents now have profile mappings
    expect(AGENT_PROFILES['iflow-discuss-planner']).toBe('standard');
    expect(AGENT_PROFILES['iflow-researcher']).toBe('standard');
    expect(AGENT_PROFILES['iflow-plan-executor']).toBe('deep');
    expect(AGENT_PROFILES['iflow-verifier']).toBe('review');
    expect(AGENT_PROFILES['iflow-shipper']).toBe('quick');
  });
});

// ─── Task 4.3: ModelProvenance type with 'profile' ──────────────────────────

describe('ModelProvenance type', () => {
  it('should include profile as a valid provenance', () => {
    const provenance: ModelProvenance = 'profile';
    expect(provenance).toBe('profile');
  });

    it('should still support existing provenance values', () => {
      const override: ModelProvenance = 'override';
      const configOverride: ModelProvenance = 'config-override';
      const providerFallback: ModelProvenance = 'provider-fallback';
      const unconfigured: ModelProvenance = 'unconfigured';

      expect(override).toBe('override');
      expect(configOverride).toBe('config-override');
      expect(providerFallback).toBe('provider-fallback');
      expect(unconfigured).toBe('unconfigured');
    });
});

// ─── Task 4.4: Profile resolution in resolveModelWithFallback ────────────────

describe('resolveModelWithFallback — profile resolution', () => {
  beforeEach(() => {
    clearUnavailableModels();
  });

  it('should return profile model with provenance "profile" when no override/config', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'powerful-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('powerful-model');
    expect(result.provenance).toBe('profile');
  });

  it('should give override precedence over profile', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      'my-override-model',
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'powerful-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('my-override-model');
    expect(result.provenance).toBe('override');
  });

  it('should give config-level model precedence over profile', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      { 'spec-writer': { model: 'config-model' } },
      undefined,
      {
        modelProfiles: { deep: { model: 'powerful-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('config-model');
    expect(result.provenance).toBe('config-override');
  });

  it('should resolve lite profile model when model_type is "lite"', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { lite: { model: 'fast-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
      'lite', // model_type 显式指定 lite 档，优先级高于 spec-writer 的 deep 静态绑定
    );
    // model_type='lite' 应读取 modelProfiles.lite.model（fast-model），而非 deep 静态绑定
    expect(result.model).toBe('fast-model');
    expect(result.provenance).toBe('profile');
  });

  it('should skip profile when model from profile is unavailable', () => {
    markModelUnavailable('profile-model');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'profile-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.provenance).not.toBe('profile');
  });

  it('should resolve quick profile for release-archivist', () => {
    const result = resolveModelWithFallback(
      'release-archivist',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { quick: { model: 'fast-cheap-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('fast-cheap-model');
    expect(result.provenance).toBe('profile');
  });

  it('should resolve review profile for code-reviewer', () => {
    const result = resolveModelWithFallback(
      'code-reviewer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { review: { model: 'review-specialized-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('review-specialized-model');
    expect(result.provenance).toBe('profile');
  });
});

describe('resolveModelWithFallback — unconfigured (Wave 2 gate)', () => {
  it('should return { model: undefined, provenance: "unconfigured" } when no user config', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      { activeWorkflow: 'sflow' },
    );
    expect(result.model).toBeUndefined();
    expect(result.provenance).toBe('unconfigured');
  });
});

describe('resolveModelWithFallback — T2.3 user-config only (Wave 2)', () => {
  it('should return the user-configured deep tier model when configured', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'anthropic/claude-opus-4-7', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('anthropic/claude-opus-4-7');
    expect(result.provenance).toBe('profile');
  });

  it('should return unconfigured when the agent tier is not in user config', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { standard: { model: 'openai/gpt-5', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    // spec-writer → 'deep' tier, but only 'standard' is configured → no model resolved
    expect(result.model).toBeUndefined();
    expect(result.provenance).toBe('unconfigured');
  });
});


describe('resolveModelWithFallback — workflow gating', () => {
  beforeEach(() => {
    clearUnavailableModels();
  });

  it('should use profile when activeWorkflow is iflow', () => {
    const result = resolveModelWithFallback(
      'iflow-discuss-planner',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { standard: { model: 'kimi-k2.6', fallback_models: [] } },
        activeWorkflow: 'iflow',
      },
    );
    expect(result.model).toBe('kimi-k2.6');
    expect(result.provenance).toBe('profile');
  });

  it('should resolve to unconfigured when activeWorkflow is none (no built-in default)', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'powerful-model', fallback_models: [] } },
        activeWorkflow: 'none',
      },
    );
    expect(result.provenance).toBe('unconfigured');
    expect(result.model).toBeUndefined();
  });

  it('should resolve to unconfigured when no profileOptions provided (no built-in default)', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
    );
    expect(result.provenance).toBe('unconfigured');
    expect(result.model).toBeUndefined();
  });

  it('should use profile when activeWorkflow is sflow', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'powerful-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('powerful-model');
    expect(result.provenance).toBe('profile');
  });

  it('should resolve to unconfigured when activeWorkflow is undefined but modelProfiles present (no built-in default)', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      { modelProfiles: { deep: { model: 'deep-model', fallback_models: [] } } },
    );
    expect(result.provenance).toBe('unconfigured');
    expect(result.model).toBeUndefined();
  });

  it('should return tier fallback model with provenance "provider-fallback" when activeWorkflow is none and only fallback_models configured (P2-2 pinned)', () => {
    // 有意保留的行为（G1 评审 P2-2）：activeWorkflow 门控只作用于「档位解析」（P5 读取
    // modelProfiles[tier].model），不作用于「fallback 链」（P6 收集 modelProfiles[tier].fallback_models）。
    // 用户显式配置的 fallback_models 属于 fallback 链，不是内置档位兜底，故工作流未激活时依然生效。
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { fallback_models: ['tier-only-fallback'] } },
        activeWorkflow: 'none',
      },
    );
    expect(result.model).toBe('tier-only-fallback');
    expect(result.provenance).toBe('provider-fallback');
  });
});

// ─── Integration: config with modelProfiles → resolveModelWithFallback ──────

describe('Integration: modelProfiles through config pipeline', () => {
  beforeEach(() => {
    clearUnavailableModels();
  });

  it('should resolve model via profile when config has modelProfiles but no agent-level model', () => {
    const configOverrides = {
      'spec-writer': { temperature: 0.5 },
    };
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      configOverrides,
      undefined,
      {
        modelProfiles: { deep: { model: 'deep-profile-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('deep-profile-model');
    expect(result.provenance).toBe('profile');
  });

  it('should use profile for IFlow agent when mapped in AGENT_PROFILES', () => {
    // iflow-plan-executor is now mapped to 'deep' in AGENT_PROFILES
    // With sflow workflow, it should use profile resolution
    const result = resolveModelWithFallback(
      'iflow-plan-executor',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'deep-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    // iflow-plan-executor is in AGENT_PROFILES → use profile
    expect(result.model).toBe('deep-model');
    expect(result.provenance).toBe('profile');
  });
});

// ─── Wave 3: modelType parameter support ─────────────────────────────────────

describe('resolveModelWithFallback — modelType parameter', () => {
  beforeEach(() => {
    clearUnavailableModels();
  });

  it('should use modelType tier model when provided (highest priority)', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: {
          deep: { model: 'deep-model', fallback_models: [] },
          ultra: { model: 'ultra-model', fallback_models: [] },
        },
        activeWorkflow: 'sflow',
      },
      'ultra', // modelType parameter
    );
    // modelType='ultra' should override AGENT_PROFILES['spec-writer']='deep'
    expect(result.model).toBe('ultra-model');
    expect(result.provenance).toBe('profile');
  });

  it('should fall through to agent profile when modelType tier not in user config', () => {
    // Model tiers come only from user config. A modelType tier that is not
    // configured falls through to the agent's AGENT_PROFILES binding.
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'deep-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
      'ultra', // ultra not in user config → fall through to AGENT_PROFILES('spec-writer')='deep'
    );
    expect(result.model).toBe('deep-model');
    expect(result.provenance).toBe('profile');
  });

  it('should give programmatic override precedence over modelType', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      { 'spec-writer': { model: 'override-model' } },
      {
        modelProfiles: { ultra: { model: 'ultra-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
      'ultra',
    );
    // Programmatic override (overrides?.[name]?.model) is highest priority
    expect(result.model).toBe('override-model');
    expect(result.provenance).toBe('override');
  });

  it('should give model param precedence over modelType', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      'explicit-model', // model param
      {},
      undefined,
      {
        modelProfiles: { ultra: { model: 'ultra-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
      'ultra',
    );
    // model param is higher priority than modelType
    expect(result.model).toBe('explicit-model');
    expect(result.provenance).toBe('override');
  });

  it('should give modelType precedence over configModel', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      { 'spec-writer': { model: 'config-model' } },
      undefined,
      {
        modelProfiles: { ultra: { model: 'ultra-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
      'ultra',
    );
    // modelType is higher priority than configModel
    expect(result.model).toBe('ultra-model');
    expect(result.provenance).toBe('profile');
  });

  it('should give modelType precedence over AGENT_PROFILES tier', () => {
    const result = resolveModelWithFallback(
      'spec-writer', // AGENT_PROFILES['spec-writer'] = 'deep'
      undefined,
      {},
      undefined,
      {
        modelProfiles: {
          deep: { model: 'deep-model', fallback_models: [] },
          quick: { model: 'quick-model', fallback_models: [] },
        },
        activeWorkflow: 'sflow',
      },
      'quick', // modelType overrides static binding
    );
    expect(result.model).toBe('quick-model');
    expect(result.provenance).toBe('profile');
  });

  it('should use modelType fallback chain when primary model unavailable', () => {
    markModelUnavailable('ultra-model');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: {
          ultra: { model: 'ultra-model', fallback_models: ['ultra-fallback1', 'ultra-fallback2'] },
        },
        activeWorkflow: 'sflow',
      },
      'ultra',
    );
    // Should use tier fallback_models
    expect(result.model).toBe('ultra-fallback1');
    expect(result.provenance).toBe('provider-fallback');
  });

  it('should work without modelType (backward compatibility)', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'deep-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
      // no modelType parameter
    );
    // Should use AGENT_PROFILES['spec-writer'] = 'deep'
    expect(result.model).toBe('deep-model');
    expect(result.provenance).toBe('profile');
  });

  it('should use complete fallback chain: per-agent → tier (user-config only, Wave 2)', () => {
    markModelUnavailable('deep-model');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {
        'spec-writer': {
          fallback_models: ['per-agent-fallback1', 'per-agent-fallback2'],
        },
      },
      undefined,
      {
        modelProfiles: {
          deep: {
            model: 'deep-model',
            fallback_models: ['tier-fallback1', 'tier-fallback2'],
          },
        },
        activeWorkflow: 'sflow',
      },
    );
    // Should try: deep-model (unavailable) → per-agent-fallback1
    expect(result.model).toBe('per-agent-fallback1');
    expect(result.provenance).toBe('provider-fallback');
    expect(result.fallbackAttempted).toContain('deep-model');
    expect(result.fallbackAttempted).toContain('per-agent-fallback1');
  });

  it('should degrade to unconfigured when tier model unavailable and fallback chain empty (Wave 2)', () => {
    markModelUnavailable('deep-model');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: {
          deep: {
            model: 'deep-model',
            fallback_models: [], // empty array
          },
        },
        activeWorkflow: 'sflow',
      },
    );
    // Empty tier fallback_models + no per-agent fallback → no model configured → unconfigured
    expect(result.model).toBeUndefined();
    expect(result.provenance).toBe('unconfigured');
    expect(result.fallbackAttempted).toContain('deep-model');
  });



  it('should support all 6 tiers: lite/quick/standard/deep/ultra/review', () => {
    const tiers = ['lite', 'quick', 'standard', 'deep', 'ultra', 'review'] as const;
    for (const tier of tiers) {
      const result = resolveModelWithFallback(
        'spec-writer',
        undefined,
        {},
        undefined,
        {
          modelProfiles: {
            [tier]: { model: `${tier}-model`, fallback_models: [] },
          },
          activeWorkflow: 'sflow',
        },
        tier,
      );
      expect(result.model).toBe(`${tier}-model`);
      expect(result.provenance).toBe('profile');
    }
  });

  it('should use tier fallback_models when primary model unavailable', () => {
    markModelUnavailable('deep-model');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: {
          deep: {
            model: 'deep-model',
            fallback_models: ['deep-fallback1', 'deep-fallback2'],
          },
        },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('deep-fallback1');
    expect(result.provenance).toBe('provider-fallback');
    expect(result.fallbackAttempted).toEqual(['deep-model', 'deep-fallback1']);
  });

  // P1-1: Invalid model_type should be handled gracefully
  it('should ignore invalid model_type and continue with normal resolution', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'deep-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
      'invalid-tier' as any, // invalid model_type
    );
    // Should ignore invalid model_type and use AGENT_PROFILES['spec-writer'] = 'deep'
    expect(result.model).toBe('deep-model');
    expect(result.provenance).toBe('profile');
  });

  it('should use fallback chain when modelType primary model unavailable', () => {
    markModelUnavailable('ultra-model');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: {
          ultra: { model: 'ultra-model', fallback_models: ['ultra-fallback1', 'ultra-fallback2'] },
        },
        activeWorkflow: 'sflow',
      },
      'ultra',
    );
    // Should use tier fallback_models when primary unavailable
    expect(result.model).toBe('ultra-fallback1');
    expect(result.provenance).toBe('provider-fallback');
    expect(result.fallbackAttempted).toContain('ultra-model');
    expect(result.fallbackAttempted).toContain('ultra-fallback1');
  });

  // P0-1 regression test: modelType fallback chain order (per-agent should be tried BEFORE tier fallbacks)
  it('should prioritize per-agent fallbacks over tier fallbacks in modelType branch', () => {
    markModelUnavailable('ultra-model');
    markModelUnavailable('per-agent-fallback');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {
        'spec-writer': {
          fallback_models: ['per-agent-fallback'],
        },
      },
      undefined,
      {
        modelProfiles: {
          ultra: { model: 'ultra-model', fallback_models: ['ultra-fallback1'] },
        },
        activeWorkflow: 'sflow',
      },
      'ultra',
    );
    // R9 order: ultra-model → per-agent-fallback → ultra-fallback1
    // per-agent fallback should be tried BEFORE tier fallback
    expect(result.model).toBe('ultra-fallback1');
    expect(result.provenance).toBe('provider-fallback');
    expect(result.fallbackAttempted).toEqual(['ultra-model', 'per-agent-fallback', 'ultra-fallback1']);
  });

  // P0-1 regression test: modelType fallback chain completeness
  it('should use complete fallback chain when modelType primary and tier fallbacks unavailable', () => {
    markModelUnavailable('ultra-model');
    markModelUnavailable('ultra-fallback1');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {
        'spec-writer': {
          fallback_models: ['per-agent-fallback'],
        },
      },
      undefined,
      {
        modelProfiles: {
          ultra: { model: 'ultra-model', fallback_models: ['ultra-fallback1'] },
        },
        activeWorkflow: 'sflow',
      },
      'ultra',
    );
    // R9 order: ultra-model → per-agent-fallback (available, return)
    expect(result.model).toBe('per-agent-fallback');
    expect(result.provenance).toBe('provider-fallback');
    expect(result.fallbackAttempted).toEqual(['ultra-model', 'per-agent-fallback']);
  });

  // P0-2 regression test: configModel unavailable should try per-agent fallbacks
  it('should use per-agent fallbacks when configModel unavailable', () => {
    markModelUnavailable('config-model');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {
        'spec-writer': {
          model: 'config-model',
          fallback_models: ['per-agent-fallback1', 'per-agent-fallback2'],
        },
      },
      undefined,
      {
        modelProfiles: { deep: { model: 'deep-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    // Should try: config-model (unavailable) → per-agent-fallback1
    expect(result.model).toBe('per-agent-fallback1');
    expect(result.provenance).toBe('provider-fallback');
    expect(result.fallbackAttempted).toEqual(['config-model', 'per-agent-fallback1']);
  });


  // P1-2: model_type × activeWorkflow combination tests
  it('should use model_type profile when activeWorkflow is iflow', () => {
    const result = resolveModelWithFallback(
      'iflow-plan-executor',
      undefined,
      {},
      undefined,
      { modelProfiles: { deep: { model: 'deep-model', fallback_models: [] } }, activeWorkflow: 'iflow' },
      'deep',
    );
    expect(result.model).toBe('deep-model');
    expect(result.provenance).toBe('profile');
  });

  it('should use model_type profile when activeWorkflow is none', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      { modelProfiles: { ultra: { model: 'ultra-model', fallback_models: [] } }, activeWorkflow: 'none' },
      'ultra',
    );
    expect(result.model).toBe('ultra-model');
    expect(result.provenance).toBe('profile');
  });

  it('should use model_type review when activeWorkflow is iflow', () => {
    const result = resolveModelWithFallback(
      'iflow-verifier',
      undefined,
      {},
      undefined,
      { modelProfiles: { review: { model: 'review-model', fallback_models: [] } }, activeWorkflow: 'iflow' },
      'review',
    );
    expect(result.model).toBe('review-model');
    expect(result.provenance).toBe('profile');
  });
});

// ─── Wave 6: IFlow profile support ─────────────────────────────────────────────

describe('resolveModelWithFallback — IFlow profile support', () => {
  beforeEach(() => {
    clearUnavailableModels();
  });

  it('should use standard profile for iflow-discuss-planner', () => {
    const result = resolveModelWithFallback(
      'iflow-discuss-planner',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { standard: { model: 'kimi-k2.6', fallback_models: [] } },
        activeWorkflow: 'iflow',
      },
    );
    expect(result.model).toBe('kimi-k2.6');
    expect(result.provenance).toBe('profile');
  });

  it('should use standard profile for iflow-researcher', () => {
    const result = resolveModelWithFallback(
      'iflow-researcher',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { standard: { model: 'kimi-k2.6', fallback_models: [] } },
        activeWorkflow: 'iflow',
      },
    );
    expect(result.model).toBe('kimi-k2.6');
    expect(result.provenance).toBe('profile');
  });

  it('should use deep profile for iflow-plan-executor', () => {
    const result = resolveModelWithFallback(
      'iflow-plan-executor',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'deepseek-v4', fallback_models: [] } },
        activeWorkflow: 'iflow',
      },
    );
    expect(result.model).toBe('deepseek-v4');
    expect(result.provenance).toBe('profile');
  });

  it('should use review profile for iflow-verifier', () => {
    const result = resolveModelWithFallback(
      'iflow-verifier',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { review: { model: 'claude-sonnet-4', fallback_models: [] } },
        activeWorkflow: 'iflow',
      },
    );
    expect(result.model).toBe('claude-sonnet-4');
    expect(result.provenance).toBe('profile');
  });

  it('should use quick profile for iflow-shipper', () => {
    const result = resolveModelWithFallback(
      'iflow-shipper',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { quick: { model: 'gpt-4o-mini', fallback_models: [] } },
        activeWorkflow: 'iflow',
      },
    );
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.provenance).toBe('profile');
  });

  it('should degrade to unconfigured for iFlow main agent with no profile mapping (Wave 2)', () => {
    const result = resolveModelWithFallback(
      'iFlow',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { standard: { model: 'kimi-k2.6', fallback_models: [] } },
        activeWorkflow: 'iflow',
      },
    );
    // iFlow is not in AGENT_PROFILES → profile branch bypassed; no model configured → unconfigured (Wave 2, no built-in default)
    expect(result.model).toBeUndefined();
    expect(result.provenance).toBe('unconfigured');
  });
});

// ─── FIX-P2-2 (Wave 3): 可用性状态机接入换模判定（冷缓存 protection） ─────────
// omo 参考：model-resolution-pipeline.ts:121-130 的 {skipped:true} 信号——
// 缓存未就绪（cold）或查询失败（failed）时可用性快照不可信，getNextCandidate
// 跳过黑名单检查直接沿用户配置链取候选，并置位 availabilitySkipped 标注；
// state=ready 时走正常黑名单过滤、不置标记。

describe('FIX-P2-2: 冷缓存保护接入 getNextCandidate', () => {
  beforeEach(() => {
    clearUnavailableModels();
    resetModelAvailability();
    resetAvailabilitySkipWarnFlag();
  });

  const isAvailable = (m: string): boolean | undefined =>
    m === 'p1/m1' ? false : isModelAvailable(m);

  it('① state=cold 时跳过黑名单直接取链候选', () => {
    expect(getAvailabilityState()).toBe('cold');
    markModelUnavailable('p2/m2');
    const state = createFallbackState('p1/m1', ['p2/m2', 'p3/m3']);
    const next = getNextCandidate(state, isAvailable);
    expect(next).toBe('p2/m2');
    expect(state.availabilitySkipped).toBe(true);
  });

  it('② state=failed 时同样跳过黑名单 + availabilitySkipped 置位', async () => {
    const client: ProviderListClient = {
      provider: {
        list: async () => {
          throw new Error('provider.list failed');
        },
      },
    };
    await refreshAvailableModels(client);
    expect(getAvailabilityState()).toBe('failed');
    markModelUnavailable('p2/m2');
    const state = createFallbackState('p1/m1', ['p2/m2', 'p3/m3']);
    const next = getNextCandidate(state, isAvailable);
    expect(next).toBe('p2/m2');
    expect(state.availabilitySkipped).toBe(true);
  });

  it('③ state=ready 时走正常黑名单过滤、不置 availabilitySkipped', async () => {
    const client: ProviderListClient = {
      provider: {
        list: async () => ({
          data: { all: [{ id: 'p1', models: { m1: {}, m2: {}, m3: {} } }], connected: ['p1'] },
        }),
      },
    };
    await refreshAvailableModels(client);
    expect(getAvailabilityState()).toBe('ready');
    markModelUnavailable('p2/m2');
    const state = createFallbackState('p1/m1', ['p2/m2', 'p3/m3']);
    const next = getNextCandidate(state, isAvailable);
    expect(next).toBe('p3/m3');
    expect(state.availabilitySkipped).toBeUndefined();
  });
});
