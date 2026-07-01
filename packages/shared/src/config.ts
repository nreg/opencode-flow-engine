/**
 * sFlow Configuration
 */

export const defaultConfig = {
  version: '0.1.0',
  mode: 'full',
  agents: {
    sflow: {
      model: 'claude-opus-4-7',
      temperature: 0.1,
    },
    'need-explorer': {
      model: 'claude-sonnet-4-6',
      temperature: 0.3,
    },
    'spec-writer': {
      model: 'claude-sonnet-4-6',
      temperature: 0.2,
    },
    'contract-builder': {
      model: 'claude-sonnet-4-6',
      temperature: 0.2,
    },
    'build-executor': {
      model: 'claude-sonnet-4-6',
      temperature: 0.1,
    },
    'bug-investigator': {
      model: 'claude-sonnet-4-6',
      temperature: 0.1,
    },
    'code-reviewer': {
      model: 'claude-opus-4-7',
      temperature: 0.1,
    },
    'release-archivist': {
      model: 'claude-sonnet-4-6',
      temperature: 0.1,
    },
    'spec-merger': {
      model: 'claude-sonnet-4-6',
      temperature: 0.2,
    },
  },
  features: {
    workflow_manager: true,
    state_manager: true,
  },
  hooks: {
    state_transition: true,
    artifact_validation: true,
    guard: true,
  },
  tools: {
    workflow_router: true,
    contract_validator: true,
    artifact_inspector: true,
  },
};

export type Config = typeof defaultConfig;
