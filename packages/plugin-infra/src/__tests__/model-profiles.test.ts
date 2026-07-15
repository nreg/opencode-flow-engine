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
} from '../agents/config-loader.js';
import type { SFlowConfig, ModelProfileConfig } from '../agents/config-loader.js';

// ─── Task 4.1: ModelProfileConfig interface ──────────────────────────────────

describe('ModelProfileConfig interface', () => {
  it('should accept 4 optional string fields', () => {
    const full: ModelProfileConfig = {
      mechanical: 'fast-model',
      standard: 'default-model',
      strong: 'powerful-model',
      review: 'review-model',
    };
    expect(full.mechanical).toBe('fast-model');
    expect(full.standard).toBe('default-model');
    expect(full.strong).toBe('powerful-model');
    expect(full.review).toBe('review-model');
  });

  it('should allow partial config', () => {
    const partial: ModelProfileConfig = {
      standard: 'default-model',
    };
    expect(partial.standard).toBe('default-model');
    expect(partial.mechanical).toBeUndefined();
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
        mechanical: 'fast',
        standard: 'default',
        strong: 'powerful',
        review: 'review',
      },
    };
    expect(config.modelProfiles?.mechanical).toBe('fast');
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
    
    // SFlow agents
    expect(AGENT_PROFILES['sFlow']).toBe('standard');
    expect(AGENT_PROFILES['need-explorer']).toBe('standard');
    expect(AGENT_PROFILES['spec-writer']).toBe('strong');
    expect(AGENT_PROFILES['contract-builder']).toBe('strong');
    expect(AGENT_PROFILES['build-executor']).toBe('strong');
    expect(AGENT_PROFILES['bug-investigator']).toBe('strong');
    expect(AGENT_PROFILES['code-reviewer']).toBe('review');
    expect(AGENT_PROFILES['release-archivist']).toBe('mechanical');
    expect(AGENT_PROFILES['spec-merger']).toBe('standard');
    expect(AGENT_PROFILES['ui-implementer']).toBe('standard');
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
      'spec-writer', // maps to 'strong' profile
      undefined,     // no model param
      {},            // no config overrides
      undefined,     // no programmatic overrides
      {
        modelProfiles: { strong: 'powerful-model' },
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
        modelProfiles: { strong: 'powerful-model' },
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
        modelProfiles: { strong: 'powerful-model' },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('config-model');
    expect(result.provenance).toBe('config-override');
  });

  it('should fall through to fallback chain when profile is not configured', () => {
    // spec-writer maps to 'strong', but modelProfiles has no 'strong' entry
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { mechanical: 'fast-model' },
        activeWorkflow: 'sflow',
      },
    );
    // Should fall through to provider-fallback since spec-writer has fallbacks
    expect(result.provenance).toBe('provider-fallback');
    expect(result.fallbackAttempted).toBeDefined();
  });

  it('should skip profile when model from profile is unavailable', () => {
    markModelUnavailable('profile-model');
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { strong: 'profile-model' },
        activeWorkflow: 'sflow',
      },
    );
    // Should fall through since profile model is unavailable
    expect(result.provenance).not.toBe('profile');
  });

  it('should resolve mechanical profile for release-archivist', () => {
    const result = resolveModelWithFallback(
      'release-archivist',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { mechanical: 'fast-cheap-model' },
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
        modelProfiles: { review: 'review-specialized-model' },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('review-specialized-model');
    expect(result.provenance).toBe('profile');
  });
});

// ─── Task 4.5: SFlow gating for profile resolution ──────────────────────────

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
        modelProfiles: { strong: 'powerful-model' },
        activeWorkflow: 'iflow',
      },
    );
    // Should NOT use profile — should fall through to provider-fallback
    expect(result.provenance).toBe('provider-fallback');
  });

  it('should skip profile step when activeWorkflow is none', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { strong: 'powerful-model' },
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
    // No profileOptions → no profile resolution → existing 3-layer chain
    expect(result.provenance).toBe('provider-fallback');
  });

  it('should use profile when activeWorkflow is sflow', () => {
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      {},
      undefined,
      {
        modelProfiles: { strong: 'powerful-model' },
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

  it('should have all 4 profile keys in modelProfiles', () => {
    const template = generateConfigTemplate();
    expect(template.modelProfiles?.mechanical).toBeDefined();
    expect(template.modelProfiles?.standard).toBeDefined();
    expect(template.modelProfiles?.strong).toBeDefined();
    expect(template.modelProfiles?.review).toBeDefined();
  });

  it('should have string values for each profile', () => {
    const template = generateConfigTemplate();
    expect(typeof template.modelProfiles?.mechanical).toBe('string');
    expect(typeof template.modelProfiles?.standard).toBe('string');
    expect(typeof template.modelProfiles?.strong).toBe('string');
    expect(typeof template.modelProfiles?.review).toBe('string');
  });
});

// ─── Integration: config with modelProfiles → resolveModelWithFallback ──────

describe('Integration: modelProfiles through config pipeline', () => {
  beforeEach(() => {
    clearUnavailableModels();
  });

  it('should resolve model via profile when config has modelProfiles but no agent-level model', () => {
    // Simulate: config has modelProfiles but agents section does not have model for spec-writer
    const configOverrides = {
      'spec-writer': { temperature: 0.5 }, // no model specified
    };
    const result = resolveModelWithFallback(
      'spec-writer',
      undefined,
      configOverrides,
      undefined,
      {
        modelProfiles: { strong: 'strong-profile-model' },
        activeWorkflow: 'sflow',
      },
    );
    expect(result.model).toBe('strong-profile-model');
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
