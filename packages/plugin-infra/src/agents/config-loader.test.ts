/**
 * Config Loader tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadSFlowConfig,
  loadUserSFlowConfig,
  loadCascadedSFlowConfig,
  agentOverridesFromConfig,
  mergeOverrides,
  generateConfigTemplate,
  USER_CONFIG_FILE,
} from './config-loader.js';
import { createAgent, createAllAgents, clearConfigCache } from './agent-builder.js';

const TEST_DIR = `${import.meta.dir}/../__test_cfg__`;
const TEST_CONFIG = join(TEST_DIR, '.flow-engine/sflow', 'config.json');

function writeTestConfig(data: unknown) {
  if (!existsSync(join(TEST_DIR, '.flow-engine/sflow'))) {
    mkdirSync(join(TEST_DIR, '.flow-engine/sflow'), { recursive: true });
  }
  writeFileSync(TEST_CONFIG, JSON.stringify(data, null, 2));
}

function cleanTestDir() {
  try { unlinkSync(TEST_CONFIG); } catch {}
  try { rmSync(join(TEST_DIR, '.flow-engine/sflow'), { recursive: true, force: true }); } catch {}
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
}

/**
 * Create a temp directory for user-level config tests.
 * Returns { dir, file } where file is the full path to sflow.json.
 */
function createTempUserConfigDir(): { dir: string; file: string } {
  const dir = join(tmpdir(), `sflow-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'opencode-flow-engine.json');
  return { dir, file };
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
        agents: { sFlow: { model: 'gpt-4o' } },
      });
      const config = await loadSFlowConfig(TEST_DIR);
      expect(config.version).toBe('0.1.0');
      expect(config.agents?.sFlow?.model).toBe('gpt-4o');
    });

    it('should return empty object on malformed JSON', async () => {
      if (!existsSync(join(TEST_DIR, '.flow-engine/sflow'))) {
        mkdirSync(join(TEST_DIR, '.flow-engine/sflow'), { recursive: true });
      }
      writeFileSync(TEST_CONFIG, 'not json');
      const config = await loadSFlowConfig(TEST_DIR);
      expect(config).toEqual({});
    });
  });

  describe('loadUserSFlowConfig', () => {
    it('should return empty object when no user config exists', async () => {
      // Use a non-existent path — temp dir so we never touch the real user config
      const { dir, file } = createTempUserConfigDir();
      try {
        const config = await loadUserSFlowConfig(file);
        expect(config).toEqual({});
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('should parse user config correctly', async () => {
      const { dir, file } = createTempUserConfigDir();
      try {
        writeFileSync(file, JSON.stringify({
          agents: { sFlow: { model: 'user-model' } },
        }));
        const config = await loadUserSFlowConfig(file);
        expect(config.agents?.sFlow?.model).toBe('user-model');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('loadCascadedSFlowConfig', () => {
    it('should return project config when no user config exists', async () => {
      // Use environment variable to point to a non-existent temp path
      const { dir, file } = createTempUserConfigDir();
      process.env.FLOW_ENGINE_USER_CONFIG_FILE = file;
      try {
        writeTestConfig({
          agents: { sFlow: { model: 'project-model' } },
        });
        const config = await loadCascadedSFlowConfig(TEST_DIR);
        expect(config.agents?.sFlow?.model).toBe('project-model');
      } finally {
        delete process.env.FLOW_ENGINE_USER_CONFIG_FILE;
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('should merge user and project config with project winning', async () => {
      const { dir, file } = createTempUserConfigDir();
      writeFileSync(file, JSON.stringify({
        version: '0.1.0',
        agents: {
          sFlow: { model: 'user-sFlow', temperature: 0.8 },
          'need-explorer': { model: 'user-need' },
        },
      }));
      process.env.FLOW_ENGINE_USER_CONFIG_FILE = file;
      try {
        writeTestConfig({
          agents: {
            sFlow: { model: 'project-sFlow' },
            'spec-writer': { model: 'project-spec' },
          },
        });
        const config = await loadCascadedSFlowConfig(TEST_DIR);
        // Project overrides user for sFlow
        expect(config.agents?.sFlow?.model).toBe('project-sFlow');
        // But user's temperature for sFlow should merge through
        expect(config.agents?.sFlow?.temperature).toBe(0.8);
        // User-only agent preserved
        expect(config.agents?.['need-explorer']?.model).toBe('user-need');
        // Project-only agent added
        expect(config.agents?.['spec-writer']?.model).toBe('project-spec');
      } finally {
        delete process.env.FLOW_ENGINE_USER_CONFIG_FILE;
        rmSync(dir, { recursive: true, force: true });
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
          sFlow: { model: 'gpt-4o', temperature: 0.3, fallback_models: ['claude-3-5-sonnet'] },
          'build-executor': { model: 'claude-sonnet-4-6' },
        },
      });
      expect(overrides.sFlow?.model).toBe('gpt-4o');
      expect(overrides.sFlow?.temperature).toBe(0.3);
      expect(overrides.sFlow?.fallback_models).toEqual(['claude-3-5-sonnet']);
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
      const base = { sFlow: { model: 'claude-opus-4-7' } };
      const higher = { sFlow: { temperature: 0.5 }, 'need-explorer': { model: 'gpt-4o' } };
      const merged = mergeOverrides(base as any, higher as any);
      expect(merged.sFlow?.model).toBe('claude-opus-4-7');
      expect(merged.sFlow?.temperature).toBe(0.5);
      expect(merged['need-explorer']?.model).toBe('gpt-4o');
    });

    it('should return base when higher is undefined', () => {
      const base = { sFlow: { model: 'gpt-4o' } };
      expect(mergeOverrides(base as any, undefined)).toEqual(base);
    });
  });

  describe('generateConfigTemplate', () => {
    it('should include all 17 agents', () => {
      const tmpl = generateConfigTemplate();
      expect(tmpl.agents).toBeDefined();
      expect(Object.keys(tmpl.agents!)).toHaveLength(17);
    });

    it('should include fallback_models for all agents', () => {
      const tmpl = generateConfigTemplate();
      for (const [name, cfg] of Object.entries(tmpl.agents!)) {
        expect(cfg.fallback_models).toBeDefined();
        expect(cfg.fallback_models!.length).toBeGreaterThan(0);
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
  const CWD_SFLOW = join(process.cwd(), '.flow-engine/sflow');
  const CWD_CONFIG = join(CWD_SFLOW, 'config.json');
  const USER_CONFIG_DIR = join(tmpdir(), `sflow-test-user-${Date.now()}`);
  const USER_CONFIG_FILE = join(USER_CONFIG_DIR, 'opencode-flow-engine.json');

  function writeCwdConfig(data: unknown) {
    if (!existsSync(CWD_SFLOW)) {
      mkdirSync(CWD_SFLOW, { recursive: true });
    }
    writeFileSync(CWD_CONFIG, JSON.stringify(data, null, 2));
  }

  function cleanCwdConfig() {
    try { unlinkSync(CWD_CONFIG); } catch {}
    // Only remove .flow-engine/sflow if it's empty (i.e., only our test config file was in it)
    try { rmSync(CWD_SFLOW, { recursive: true, force: true }); } catch {}
    try { rmSync(USER_CONFIG_DIR, { recursive: true, force: true }); } catch {}
  }

  beforeEach(() => {
    cleanCwdConfig();
    clearConfigCache();
    // Isolate from user-level config: point to a temp empty config
    mkdirSync(USER_CONFIG_DIR, { recursive: true });
    writeFileSync(USER_CONFIG_FILE, JSON.stringify({}, null, 2));
    process.env.FLOW_ENGINE_USER_CONFIG_FILE = USER_CONFIG_FILE;
  });
  afterEach(() => {
    cleanCwdConfig();
    clearConfigCache();
    delete process.env.FLOW_ENGINE_USER_CONFIG_FILE;
  });

  it('should load config file and apply to agent when .flow-engine/sflow/config.json exists', async () => {
    writeCwdConfig({
      agents: { sFlow: { model: 'claude-3-opus-20240229' } },
    });
    const agent = await createAgent('sFlow');
    expect(agent.model).toBe('claude-3-opus-20240229');
  });

  it('should use fallback_models from config file', async () => {
    writeCwdConfig({
      agents: {
        sFlow: {
          model: 'claude-opus-4-7',
          fallback_models: ['gpt-4o', 'claude-sonnet-4-7'],
        },
      },
    });
    const agent = await createAgent('sFlow');
    expect(agent.model).toBe('claude-opus-4-7');
    expect(agent.fallback_models).toEqual(['gpt-4o', 'claude-sonnet-4-7']);
  });

  it('should prefer programmatic overrides over config file', async () => {
    writeCwdConfig({
      agents: { sFlow: { model: 'from-config' } },
    });
    const config = await loadSFlowConfig();
    expect(config.agents?.sFlow?.model).toBe('from-config');
    expect(config.agents?.sFlow?.model).not.toBe('from-code');
    const agent = await createAgent('sFlow', 'from-code');
    expect(agent.model).toBe('from-code');
  });

  it('should prefer AgentOverrides over config file', async () => {
    writeCwdConfig({
      agents: { sFlow: { model: 'from-config' } },
    });
    const agent = await createAgent('sFlow', undefined, {
      sFlow: { model: 'from-override' },
    });
    expect(agent.model).toBe('from-override');
  });

  it('should use config file for createAllAgents', async () => {
    writeCwdConfig({
      agents: {
        sFlow: { model: 'gpt-5' },
        'build-executor': { model: 'claude-4-opus' },
      },
    });
    const agents = await createAllAgents();
    expect(agents.sFlow.model).toBe('gpt-5');
    expect(agents['build-executor'].model).toBe('claude-4-opus');
    expect(agents['code-reviewer'].model).toBe('provider/glm-5.1');
  });
});
