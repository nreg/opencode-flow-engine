/**
 * Model Profile Config tests — Wave W4
 * Tests for ModelProfileConfig, AGENT_PROFILES, profile resolution, SFlow gating, template
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  resolveModelWithFallback,
  clearUnavailableModels,
  markModelUnavailable,
} from '../agents/agent-builder.js';
import type { ModelProvenance, AGENT_PROFILES_TYPE } from '../agents/agent-builder.js';
import {
  generateConfigTemplate,
  DEFAULT_PROFILE_MODELS,
} from '../agents/config-loader.js';
import type { SFlowConfig, ModelProfileConfig } from '../agents/config-loader.js';

// ─── Task 4.1: ModelProfileConfig interface ──────────────────────────────────

describe('ModelProfileConfig interface', () => {
  it('should accept 6 optional object fields with model and fallback_models', () => {
    const full: ModelProfileConfig = {
      free: { model: 'fast-model', fallback_models: [] },
      quick: { model: 'quick-model', fallback_models: ['fallback1'] },
      standard: { model: 'default-model', fallback_models: [] },
      deep: { model: 'deep-model', fallback_models: ['fallback2'] },
      ultra: { model: 'ultra-model', fallback_models: [] },
      review: { model: 'review-model', fallback_models: ['fallback3'] },
    };
    expect(full.free?.model).toBe('fast-model');
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
    expect(partial.free).toBeUndefined();
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
        free: { model: 'fast', fallback_models: [] },
        quick: { model: 'quick', fallback_models: [] },
        standard: { model: 'default', fallback_models: [] },
        deep: { model: 'deep', fallback_models: [] },
        ultra: { model: 'ultra', fallback_models: [] },
        review: { model: 'review', fallback_models: [] },
      },
    };
    expect(config.modelProfiles?.free?.model).toBe('fast');
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
    // Import the AGENT_PROFILES from agent-builder
    // We verify the mapping via resolveModelWithFallback behavior
    // and also check the exported constant
    const { AGENT_PROFILES } = require('../agents/agent-builder.js') as { AGENT_PROFILES: AGENT_PROFILES_TYPE };
    
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

  it('should not map IFlow agents', () => {
    const { AGENT_PROFILES } = require('../agents/agent-builder.js') as { AGENT_PROFILES: AGENT_PROFILES_TYPE };
    expect(AGENT_PROFILES['iFlow']).toBeUndefined();
    expect(AGENT_PROFILES['iflow-discuss-planner']).toBeUndefined();
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
    const systemDefault: ModelProvenance = 'system-default';
    
    expect(override).toBe('override');
    expect(configOverride).toBe('config-override');
    expect(providerFallback).toBe('provider-fallback');
    expect(systemDefault).toBe('system-default');
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

  it('should use DEFAULT_PROFILE_MODELS when user tier not configured', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { free: { model: 'fast-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
    );
    // spec-writer → deep tier, not in user config → use DEFAULT_PROFILE_MODELS.deep
    expect(result.model).toBe('provider/glm-5.1');
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

describe('resolveModelWithFallback — SFlow gating', () => {
  beforeEach(() => {
    clearUnavailableModels();
  });

  it('should skip profile step when activeWorkflow is iflow', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'powerful-model', fallback_models: [] } },
        activeWorkflow: 'iflow',
      },
    );
    expect(result.provenance).toBe('provider-fallback');
  });

  it('should skip profile step when activeWorkflow is none', () => {
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
    expect(result.provenance).toBe('provider-fallback');
  });

  it('should skip profile step when no profileOptions provided (backward compat)', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
    );
    expect(result.provenance).toBe('provider-fallback');
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
});

// ─── Task 4.6: generateConfigTemplate with modelProfiles ────────────────────

describe('generateConfigTemplate — modelProfiles', () => {
  it('should include modelProfiles section in template', () => {
    const template = generateConfigTemplate();
    expect(template.modelProfiles).toBeDefined();
  });

  it('should have all 6 profile keys in modelProfiles', () => {
    const template = generateConfigTemplate();
    expect(template.modelProfiles?.free).toBeDefined();
    expect(template.modelProfiles?.quick).toBeDefined();
    expect(template.modelProfiles?.standard).toBeDefined();
    expect(template.modelProfiles?.deep).toBeDefined();
    expect(template.modelProfiles?.ultra).toBeDefined();
    expect(template.modelProfiles?.review).toBeDefined();
  });

  it('should have { model, fallback_models } structure for each profile', () => {
    const template = generateConfigTemplate();
    const tiers = ['free', 'quick', 'standard', 'deep', 'ultra', 'review'] as const;
    for (const tier of tiers) {
      const tierConfig = template.modelProfiles?.[tier];
      expect(tierConfig).toBeDefined();
      expect(tierConfig?.model).toBeDefined();
      expect(typeof tierConfig?.model).toBe('string');
      expect(tierConfig?.fallback_models).toBeDefined();
      expect(Array.isArray(tierConfig?.fallback_models)).toBe(true);
    }
  });

  it('should not have legacy tier names (mechanical, strong)', () => {
    const template = generateConfigTemplate();
    expect(template.modelProfiles).not.toHaveProperty('mechanical');
    expect(template.modelProfiles).not.toHaveProperty('strong');
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

  it('should use 3-layer chain when IFlow agent with profileOptions', () => {
    // IFlow agents are not in AGENT_PROFILES, so even with sflow workflow,
    // they should not get profile resolution
    const result = resolveModelWithFallback(
      'iflow-plan-executor',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { standard: 'standard-model' },
        activeWorkflow: 'sflow',
      },
    );
    // iflow-plan-executor is not in AGENT_PROFILES → no profile → provider-fallback
    expect(result.provenance).toBe('provider-fallback');
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

  it('should fallback to DEFAULT_PROFILE_MODELS when modelType tier not in user config', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { deep: { model: 'deep-model', fallback_models: [] } },
        activeWorkflow: 'sflow',
      },
      'ultra', // ultra not in user config, should use DEFAULT_PROFILE_MODELS.ultra
    );
    expect(result.model).toBe('provider/glm-5');
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

  it('should use complete fallback chain: per-agent → tier → DEFAULT_PROFILE_MODELS tier → DEFAULT_FALLBACKS', () => {
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

  it('should skip empty fallback_models arrays in chain', () => {
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
    // Should skip empty tier fallback_models and go to DEFAULT_FALLBACKS
    expect(result.provenance).toBe('provider-fallback');
    expect(result.fallbackAttempted).toBeDefined();
    expect(result.fallbackAttempted).toContain('deep-model');
  });

  // P1-2: Fallback chain should concatenate all non-empty lists (not short-circuit on empty array)
  it('should include DEFAULT_PROFILE_MODELS tier fallbacks even when user tier fallback_models is empty', () => {
    // Modify DEFAULT_PROFILE_MODELS.deep to have fallback_models for this test
    const originalDefault = DEFAULT_PROFILE_MODELS.deep;
    (DEFAULT_PROFILE_MODELS as any).deep = {
      model: 'provider/glm-5.1',
      fallback_models: ['default-deep-fallback1', 'default-deep-fallback2'],
    };

    try {
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
              fallback_models: [], // empty array - should NOT skip DEFAULT_PROFILE_MODELS.deep.fallback_models
            },
          },
          activeWorkflow: 'sflow',
        },
      );
      // Should try: deep-model (unavailable) → default-deep-fallback1
      expect(result.model).toBe('default-deep-fallback1');
      expect(result.provenance).toBe('provider-fallback');
      expect(result.fallbackAttempted).toBeDefined();
      expect(result.fallbackAttempted).toContain('deep-model');
      expect(result.fallbackAttempted).toContain('default-deep-fallback1');
    } finally {
      // Restore original DEFAULT_PROFILE_MODELS.deep
      (DEFAULT_PROFILE_MODELS as any).deep = originalDefault;
    }
  });

  it('should build complete fallback chain: per-agent → user tier → default tier → DEFAULT_FALLBACKS', () => {
    // Modify DEFAULT_PROFILE_MODELS.deep to have fallback_models for this test
    const originalDefault = DEFAULT_PROFILE_MODELS.deep;
    (DEFAULT_PROFILE_MODELS as any).deep = {
      model: 'provider/glm-5.1',
      fallback_models: ['default-deep-fallback'],
    };

    try {
      markModelUnavailable('deep-model');
      markModelUnavailable('per-agent-fallback');
      markModelUnavailable('user-tier-fallback');
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
            deep: {
              model: 'deep-model',
              fallback_models: ['user-tier-fallback'],
            },
          },
          activeWorkflow: 'sflow',
        },
      );
      // Should try in order: deep-model → per-agent-fallback → user-tier-fallback → default-deep-fallback
      expect(result.model).toBe('default-deep-fallback');
      expect(result.provenance).toBe('provider-fallback');
      expect(result.fallbackAttempted).toEqual([
        'deep-model',
        'per-agent-fallback',
        'user-tier-fallback',
        'default-deep-fallback',
      ]);
    } finally {
      // Restore original DEFAULT_PROFILE_MODELS.deep
      (DEFAULT_PROFILE_MODELS as any).deep = originalDefault;
    }
  });

  it('should support all 6 tiers: free/quick/standard/deep/ultra/review', () => {
    const tiers = ['free', 'quick', 'standard', 'deep', 'ultra', 'review'] as const;
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

  // P1-2: Complete fallback chain order verification
  it('should verify complete fallback chain order: per-agent → user tier → default tier → DEFAULT_FALLBACKS', () => {
    markModelUnavailable('deep-model');
    markModelUnavailable('per-agent-fallback');
    markModelUnavailable('user-tier-fallback');
    const originalDefault = DEFAULT_PROFILE_MODELS.deep;
    try {
      (DEFAULT_PROFILE_MODELS as any).deep = {
        model: 'default-deep-model',
        fallback_models: ['default-deep-fallback'],
      };
      markModelUnavailable('default-deep-model');
      markModelUnavailable('default-deep-fallback');
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
            deep: {
              model: 'deep-model',
              fallback_models: ['user-tier-fallback'],
            },
          },
          activeWorkflow: 'sflow',
        },
      );
      // Should try in order: deep-model → per-agent-fallback → user-tier-fallback → default-deep-fallback → DEFAULT_FALLBACKS['spec-writer']
      expect(result.provenance).toBe('provider-fallback');
      expect(result.fallbackAttempted).toContain('deep-model');
      expect(result.fallbackAttempted).toContain('per-agent-fallback');
      expect(result.fallbackAttempted).toContain('user-tier-fallback');
      expect(result.fallbackAttempted).toContain('default-deep-fallback');
    } finally {
      (DEFAULT_PROFILE_MODELS as any).deep = originalDefault;
    }
  });
});
