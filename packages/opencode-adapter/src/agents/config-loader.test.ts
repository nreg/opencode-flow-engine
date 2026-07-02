/**
 * Config Loader tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, writeFileSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import {
  loadSFlowConfig,
  loadUserSFlowConfig,
  loadCascadedSFlowConfig,
  agentOverridesFromConfig,
  mergeOverrides,
  generateConfigTemplate,
  USER_CONFIG_FILE,
} from './config-loader.js';
import { createAgent, createAllAgents } from './agent-builder.js';

const TEST_DIR = `${import.meta.dir}/../__test_cfg__`;
const TEST_CONFIG = join(TEST_DIR, '.sflow', 'config.json');

function writeTestConfig(data: unknown) {
  if (!existsSync(join(TEST_DIR, '.sflow'))) {
    mkdirSync(join(TEST_DIR, '.sflow'), { recursive: true });
  }
  writeFileSync(TEST_CONFIG, JSON.stringify(data, null, 2));
}

function cleanTestDir() {
  try { unlinkSync(TEST_CONFIG); } catch {}
  try { unlinkSync(join(TEST_DIR, '.sflow')); } catch {}
  try { unlinkSync(TEST_DIR); } catch {}
}

describe('Config Loader', () => {
  beforeEach(cleanTestDir);
  afterEach(cleanTestDir);

  describe('loadSFlowConfig', () => {
    it('should return empty object when no config file exists', async () => {
      const config = await loadSFlowConfig(TEST_DIR);
      expect(config).toEqual({});
    });

    it('should parse config file correctly', async () => {
      writeTestConfig({
        version: '0.1.0',
        agents: { sflow: { model: 'gpt-4o' } },
      });
      const config = await loadSFlowConfig(TEST_DIR);
      expect(config.version).toBe('0.1.0');
      expect(config.agents?.sflow?.model).toBe('gpt-4o');
    });

    it('should return empty object on malformed JSON', async () => {
      if (!existsSync(join(TEST_DIR, '.sflow'))) {
        mkdirSync(join(TEST_DIR, '.sflow'), { recursive: true });
      }
      writeFileSync(TEST_CONFIG, 'not json');
      const config = await loadSFlowConfig(TEST_DIR);
      expect(config).toEqual({});
    });
  });

  describe('loadUserSFlowConfig', () => {
    it('should return empty object when no user config exists', async () => {
      try { unlinkSync(USER_CONFIG_FILE); } catch {}
      const config = await loadUserSFlowConfig();
      expect(config).toEqual({});
    });

    it('should parse user config correctly', async () => {
      const userDir = join(USER_CONFIG_FILE, '..');
      if (!existsSync(userDir)) {
        mkdirSync(userDir, { recursive: true });
      }
      writeFileSync(USER_CONFIG_FILE, JSON.stringify({
        agents: { sflow: { model: 'user-model' } },
      }));
      try {
        const config = await loadUserSFlowConfig();
        expect(config.agents?.sflow?.model).toBe('user-model');
      } finally {
        try { unlinkSync(USER_CONFIG_FILE); } catch {}
        try { rmdirSync(userDir); } catch {}
      }
    });
  });

  describe('loadCascadedSFlowConfig', () => {
    it('should return project config when no user config exists', async () => {
      try { unlinkSync(USER_CONFIG_FILE); } catch {}
      writeTestConfig({
        agents: { sflow: { model: 'project-model' } },
      });
      const config = await loadCascadedSFlowConfig(TEST_DIR);
      expect(config.agents?.sflow?.model).toBe('project-model');
    });

    it('should merge user and project config with project winning', async () => {
      // Write user config first, then project config that overrides
      const userDir = join(USER_CONFIG_FILE, '..');
      if (!existsSync(userDir)) {
        mkdirSync(userDir, { recursive: true });
      }
      writeFileSync(USER_CONFIG_FILE, JSON.stringify({
        version: '0.1.0',
        agents: {
          sflow: { model: 'user-sflow', temperature: 0.8 },
          'need-explorer': { model: 'user-need' },
        },
      }));
      writeTestConfig({
        agents: {
          sflow: { model: 'project-sflow' },
          'spec-writer': { model: 'project-spec' },
        },
      });
      try {
        const config = await loadCascadedSFlowConfig(TEST_DIR);
        // Project overrides user for sflow
        expect(config.agents?.sflow?.model).toBe('project-sflow');
        // But user's temperature for sflow should merge through
        expect(config.agents?.sflow?.temperature).toBe(0.8);
        // User-only agent preserved
        expect(config.agents?.['need-explorer']?.model).toBe('user-need');
        // Project-only agent added
        expect(config.agents?.['spec-writer']?.model).toBe('project-spec');
      } finally {
        try { unlinkSync(USER_CONFIG_FILE); } catch {}
        try { rmdirSync(userDir); } catch {}
      }
    });
  });

  describe('agentOverridesFromConfig', () => {
    it('should return empty overrides when no agents configured', () => {
      const overrides = agentOverridesFromConfig({});
      expect(overrides).toEqual({});
    });

    it('should convert agent config to override format', () => {
      const overrides = agentOverridesFromConfig({
        agents: {
          sflow: { model: 'gpt-4o', temperature: 0.3, fallbackModels: ['claude-3-5-sonnet'] },
          'build-executor': { model: 'claude-sonnet-4-6' },
        },
      });
      expect(overrides.sflow?.model).toBe('gpt-4o');
      expect(overrides.sflow?.temperature).toBe(0.3);
      expect(overrides.sflow?.fallback_models).toEqual(['claude-3-5-sonnet']);
      expect(overrides['build-executor']?.model).toBe('claude-sonnet-4-6');
    });

    it('should skip agents with no meaningful overrides', () => {
      const overrides = agentOverridesFromConfig({
        agents: { 'some-unknown-agent': {} },
      });
      expect(overrides).toEqual({});
    });
  });

  describe('mergeOverrides', () => {
    it('should merge two override sets', () => {
      const base = { sflow: { model: 'claude-opus-4-7' } };
      const higher = { sflow: { temperature: 0.5 }, 'need-explorer': { model: 'gpt-4o' } };
      const merged = mergeOverrides(base as any, higher as any);
      expect(merged.sflow?.model).toBe('claude-opus-4-7');
      expect(merged.sflow?.temperature).toBe(0.5);
      expect(merged['need-explorer']?.model).toBe('gpt-4o');
    });

    it('should return base when higher is undefined', () => {
      const base = { sflow: { model: 'gpt-4o' } };
      expect(mergeOverrides(base as any, undefined)).toEqual(base);
    });
  });

  describe('generateConfigTemplate', () => {
    it('should include all 9 agents', () => {
      const tmpl = generateConfigTemplate();
      expect(tmpl.agents).toBeDefined();
      expect(Object.keys(tmpl.agents!)).toHaveLength(9);
    });

    it('should include fallbackModels for all agents', () => {
      const tmpl = generateConfigTemplate();
      for (const [name, cfg] of Object.entries(tmpl.agents!)) {
        expect(cfg.fallbackModels).toBeDefined();
        expect(cfg.fallbackModels!.length).toBeGreaterThan(0);
      }
    });

    it('should include features, hooks, and tools sections', () => {
      const tmpl = generateConfigTemplate();
      expect(tmpl.features).toBeDefined();
      expect(tmpl.hooks).toBeDefined();
      expect(tmpl.tools).toBeDefined();
    });
  });
});

describe('Config File Integration with Agent Builder', () => {
  const CWD_SFLOW = join(process.cwd(), '.sflow');
  const CWD_CONFIG = join(CWD_SFLOW, 'config.json');

  function writeCwdConfig(data: unknown) {
    if (!existsSync(CWD_SFLOW)) {
      mkdirSync(CWD_SFLOW, { recursive: true });
    }
    writeFileSync(CWD_CONFIG, JSON.stringify(data, null, 2));
  }

  function cleanCwdConfig() {
    try { unlinkSync(CWD_CONFIG); } catch {}
    try { rmdirSync(CWD_SFLOW); } catch {}
  }

  beforeEach(cleanCwdConfig);
  afterEach(cleanCwdConfig);

  it('should load config file and apply to agent when .sflow/config.json exists', () => {
    writeCwdConfig({
      agents: { sflow: { model: 'claude-3-opus-20240229' } },
    });
    const agent = createAgent('sflow');
    expect(agent.model).toBe('claude-3-opus-20240229');
  });

  it('should use fallbackModels from config file', () => {
    writeCwdConfig({
      agents: {
        sflow: {
          model: 'claude-opus-4-7',
          fallbackModels: ['gpt-4o', 'claude-sonnet-4-7'],
        },
      },
    });
    const agent = createAgent('sflow');
    expect(agent.model).toBe('claude-opus-4-7');
    expect(agent.fallback_models).toEqual(['gpt-4o', 'claude-sonnet-4-7']);
  });

  it('should prefer programmatic overrides over config file', async () => {
    writeCwdConfig({
      agents: { sflow: { model: 'from-config' } },
    });
    const config = await loadSFlowConfig();
    expect(config.agents?.sflow?.model).toBe('from-config');
    expect(config.agents?.sflow?.model).not.toBe('from-code');
    const agent = createAgent('sflow', 'from-code');
    expect(agent.model).toBe('from-code');
  });

  it('should prefer AgentOverrides over config file', async () => {
    writeCwdConfig({
      agents: { sflow: { model: 'from-config' } },
    });
    const agent = createAgent('sflow', undefined, {
      sflow: { model: 'from-override' },
    });
    expect(agent.model).toBe('from-override');
  });

  it('should use config file for createAllAgents', async () => {
    writeCwdConfig({
      agents: {
        sflow: { model: 'gpt-5' },
        'build-executor': { model: 'claude-4-opus' },
      },
    });
    const agents = await createAllAgents();
    expect(agents.sflow.model).toBe('gpt-5');
    expect(agents['build-executor'].model).toBe('claude-4-opus');
    expect(agents['code-reviewer'].model).toBe('deepseek-v4-flash');
  });
});
