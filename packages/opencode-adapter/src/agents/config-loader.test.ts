/**
 * Config Loader tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  loadSFlowConfig,
  agentOverridesFromConfig,
  mergeOverrides,
  generateConfigTemplate,
} from './config-loader.js';
import { createAgent, createAllAgents } from './agent-builder.js';
import { unlinkSync, existsSync, writeFileSync, mkdirSync, rmdirSync } from 'fs';

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
    it('should return empty object when no config file exists', () => {
      const config = loadSFlowConfig(TEST_DIR);
      expect(config).toEqual({});
    });

    it('should parse config file correctly', () => {
      writeTestConfig({
        version: '0.1.0',
        agents: { sflow: { model: 'gpt-4o' } },
      });
      const config = loadSFlowConfig(TEST_DIR);
      expect(config.version).toBe('0.1.0');
      expect(config.agents?.sflow?.model).toBe('gpt-4o');
    });

    it('should return empty object on malformed JSON', () => {
      if (!existsSync(join(TEST_DIR, '.sflow'))) {
        mkdirSync(join(TEST_DIR, '.sflow'), { recursive: true });
      }
      writeFileSync(TEST_CONFIG, 'not json');
      const config = loadSFlowConfig(TEST_DIR);
      expect(config).toEqual({});
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

  it('should prefer programmatic overrides over config file', () => {
    writeCwdConfig({
      agents: { sflow: { model: 'from-config' } },
    });
    // Verify config file was written correctly
    const config = loadSFlowConfig();
    expect(config.agents?.sflow?.model).toBe('from-config');
    expect(config.agents?.sflow?.model).not.toBe('from-code');
    // Now test priority: model param > config file
    const agent = createAgent('sflow', 'from-code');
    expect(agent.model).toBe('from-code');
  });

  it('should prefer AgentOverrides over config file', () => {
    writeCwdConfig({
      agents: { sflow: { model: 'from-config' } },
    });
    const agent = createAgent('sflow', undefined, {
      sflow: { model: 'from-override' },
    });
    expect(agent.model).toBe('from-override');
  });

  it('should use config file for createAllAgents', () => {
    writeCwdConfig({
      agents: {
        sflow: { model: 'gpt-5' },
        'build-executor': { model: 'claude-4-opus' },
      },
    });
    const agents = createAllAgents();
    expect(agents.sflow.model).toBe('gpt-5');
    expect(agents['build-executor'].model).toBe('claude-4-opus');
    expect(agents['code-reviewer'].model).toBe('deepseek-v4-flash');
  });
});
