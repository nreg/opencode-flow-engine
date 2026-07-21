#!/usr/bin/env node

/**
 * sflow CLI - Command line interface for sflow
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Main CLI function
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
      await initCommand(args.slice(1));
      break;
    case 'status':
      await statusCommand(args.slice(1));
      break;
    case 'validate':
      await validateCommand(args.slice(1));
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    case 'version':
    case '--version':
    case '-v':
      showVersion();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

/**
 * Initialize sflow in a project
 */
async function initCommand(args) {
  const isUser = args.includes('--user');
  const projectDir = isUser ? null : (args[0] && args[0] !== '--user' ? args[0] : process.cwd());
  const homedir = (await import('os')).homedir();

  if (isUser) {
    const userDir = join(homedir, '.flow-engine/sflow');
    if (!existsSync(userDir)) {
      mkdirSync(userDir, { recursive: true });
      console.log(`Created user config directory: ${userDir}`);
    }
    const userConfigPath = join(userDir, 'config.json');
    if (!existsSync(userConfigPath)) {
      writeFileSync(userConfigPath, JSON.stringify(configTemplate(), null, 2));
      console.log('Created user-level config file: ~/.flow-engine/sflow/config.json');
    }
    console.log('sflow user config initialized successfully!');
    return;
  }

  console.log(`Initializing sflow in ${projectDir}...`);
  
  // Create directory structure
  const dirs = [
    '.flow-engine/sflow',
    '.flow-engine/sflow/changes',
    '.flow-engine/sflow/archive',
  ];
  
  for (const dir of dirs) {
    const fullPath = join(projectDir, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }
  
  // Create project-level config file
  const configPath = join(projectDir, '.flow-engine/sflow/config.json');
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(configTemplate(), null, 2));
    console.log('Created config file: .flow-engine/sflow/config.json');
  }

  // Also ensure user-level config exists
  const userDir = join(homedir, '.flow-engine/sflow');
  const userConfigPath = join(userDir, 'config.json');
  if (!existsSync(userConfigPath)) {
    mkdirSync(userDir, { recursive: true });
    writeFileSync(userConfigPath, JSON.stringify(configTemplate(), null, 2));
    console.log('Also created user-level config: ~/.flow-engine/sflow/config.json');
  }

  console.log('sflow initialized successfully!');
}

/**
 * Generate default config template
 */
function configTemplate() {
  return {
    version: '0.1.0',
    mode: 'full',
    agents: {
      sFlow: {
        model: 'your-provider/deepseek-v4-flash',
        temperature: 0.6,
        fallbackModels: ['your-provider/glm-5.1', 'your-provider/kimi-k2.6'],
      },
      'need-explorer': {
        model: 'your-provider/kimi-k2.6',
        temperature: 0.6,
        fallbackModels: ['your-provider/glm-5.1', 'your-provider/deepseek-v4-flash'],
      },
      'ui-director': {
        model: 'your-provider/glm-5.1',
        temperature: 0.7,
        fallbackModels: ['your-provider/kimi-k2.6', 'your-provider/minimax-m2.7'],
      },
      'spec-writer': {
        model: 'your-provider/glm-5.1',
        temperature: 0.6,
        fallbackModels: ['your-provider/kimi-k2.6', 'your-provider/deepseek-v4-flash'],
      },
      'contract-builder': {
        model: 'your-provider/glm-5',
        temperature: 0.6,
        fallbackModels: ['your-provider/glm-5.1', 'your-provider/deepseek-v4-flash'],
      },
      'build-executor': {
        model: 'your-provider/step-3.7-flash',
        temperature: 0.6,
        fallbackModels: ['your-provider/deepseek-v4-flash', 'your-provider/glm-5.1'],
      },
      'bug-investigator': {
        model: 'your-provider/minimax-m2.7',
        temperature: 0.6,
        fallbackModels: ['your-provider/deepseek-v4-flash', 'your-provider/glm-5.1'],
      },
      'code-reviewer': {
        model: 'your-provider/deepseek-v4-flash',
        temperature: 0.6,
        fallbackModels: ['your-provider/glm-5.1', 'your-provider/kimi-k2.6'],
      },
      'release-archivist': {
        model: 'your-provider/mimo-v2.5-pro',
        temperature: 0.6,
        fallbackModels: ['your-provider/mimo-v2.5', 'your-provider/glm-5.1'],
      },
      'spec-merger': {
        model: 'your-provider/mimo-v2.5',
        temperature: 0.6,
        fallbackModels: ['your-provider/mimo-v2.5-pro', 'your-provider/glm-5.1'],
      },
      // IFlow agents
      iFlow: {
        model: 'your-provider/deepseek-v4-flash',
        temperature: 0.6,
        fallbackModels: ['your-provider/glm-5.1', 'your-provider/kimi-k2.6'],
      },
      'iflow-discuss-planner': {
        model: 'your-provider/kimi-k2.6',
        temperature: 0.6,
        fallbackModels: ['your-provider/glm-5.1', 'your-provider/deepseek-v4-flash'],
      },
      'iflow-plan-executor': {
        model: 'your-provider/step-3.7-flash',
        temperature: 0.6,
        fallbackModels: ['your-provider/deepseek-v4-flash', 'your-provider/glm-5.1'],
      },
      'iflow-verifier': {
        model: 'your-provider/minimax-m2.7',
        temperature: 0.6,
        fallbackModels: ['your-provider/deepseek-v4-flash', 'your-provider/glm-5.1'],
      },
      'iflow-researcher': {
        model: 'your-provider/glm-5.1',
        temperature: 0.7,
        fallbackModels: ['your-provider/kimi-k2.6', 'your-provider/deepseek-v4-flash'],
      },
      'iflow-shipper': {
        model: 'your-provider/mimo-v2.5-pro',
        temperature: 0.6,
        fallbackModels: ['your-provider/mimo-v2.5', 'your-provider/glm-5.1'],
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
    modelProfiles: {
      mechanical: 'fast-cheap-model',
      standard: 'balanced-model',
      strong: 'powerful-model',
      review: 'review-specialized-model',
    },
  };
}

/**
 * Show workflow status
 */
async function statusCommand(args) {
  const projectDir = args[0] || process.cwd();
  const statePath = join(projectDir, '.flow-engine/sflow', 'state.json');
  const changesDir = join(projectDir, '.flow-engine/sflow', 'changes');
  
  if (!existsSync(join(projectDir, '.flow-engine/sflow'))) {
    console.log('sflow not initialized. Run "sflow init" first.');
    return;
  }
  
  console.log('Workflow Status:');
  console.log('================');
  
  if (existsSync(statePath)) {
    try {
      const raw = readFileSync(statePath, 'utf-8');
      const state = JSON.parse(raw);
      console.log(`  Mode:         ${state.mode || 'unknown'}`);
      console.log(`  State:        ${state.state || 'unknown'}`);
      console.log(`  Updated:      ${state.updatedAt || state.updated_at || 'unknown'}`);
      if (state.changeId || state.change_id) {
        console.log(`  Change ID:    ${state.changeId || state.change_id}`);
      }
      if (state.workflowMode || state.workflow_mode) {
        console.log(`  Workflow:     ${state.workflowMode || state.workflow_mode}`);
      }
      if (state.agent || state.currentAgent) {
        console.log(`  Agent:        ${state.agent || state.currentAgent}`);
      }
    } catch {
      console.log('  (state.json exists but is invalid JSON)');
    }
  } else {
    console.log('  No state file found (.flow-engine/sflow/state.json).');
  }
  
  if (existsSync(changesDir)) {
    const { readdirSync } = await import('fs');
    const changes = readdirSync(changesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    if (changes.length > 0) {
      console.log(`\nActive Changes (${changes.length}):`);
      for (const name of changes) {
        const changeStatePath = join(changesDir, name, 'state.json');
        let status = 'unknown';
        if (existsSync(changeStatePath)) {
          try {
            const raw = readFileSync(changeStatePath, 'utf-8');
            const s = JSON.parse(raw);
            status = s.state || s.status || 'unknown';
          } catch {}
        }
        console.log(`  - ${name} [${status}]`);
      }
    } else {
      console.log('\nNo active changes.');
    }
  } else {
    console.log('\nNo changes directory.');
  }
}

/**
 * Validate artifacts
 */
async function validateCommand(args) {
  const changeDir = args[0];
  
  if (!changeDir) {
    console.error('Usage: sflow validate <change-dir>');
    process.exit(1);
  }
  
  if (!existsSync(changeDir)) {
    console.error(`Directory not found: ${changeDir}`);
    process.exit(1);
  }
  
  console.log(`Validating artifacts in ${changeDir}...`);
  
  try {
    const { Validator } = await import('@opencode-sflow/core');
    
    if (!Validator) {
      console.error('Validator not found in @opencode-sflow/core');
      process.exit(1);
    }
    
    const validator = new Validator();
    let hasErrors = false;
    let hasWarnings = false;
    
    // Validate proposal
    const proposalPath = join(changeDir, 'proposal.md');
    if (existsSync(proposalPath)) {
      const content = readFileSync(proposalPath, 'utf-8');
      const report = validator.validateChangeContent('proposal', content);
      if (!report.valid) {
        hasErrors = true;
        console.log('\n✗ Proposal validation FAILED:');
        for (const issue of report.issues.filter(i => i.level === 'ERROR')) {
          console.log(`  ✗ ${issue.path}: ${issue.message}`);
        }
      }
      const warnings = report.issues.filter(i => i.level === 'WARNING');
      if (warnings.length > 0) {
        hasWarnings = true;
        console.log('\n⚠ Proposal warnings:');
        for (const w of warnings) {
          console.log(`  ⚠ ${w.path}: ${w.message}`);
        }
      }
    }
    
    // Validate execution contract
    const contractPath = join(changeDir, 'execution-contract.md');
    if (existsSync(contractPath)) {
      const content = readFileSync(contractPath, 'utf-8');
      const report = validator.validateExecutionContract(content);
      if (!report.valid) {
        hasErrors = true;
        console.log('\n✗ Contract validation FAILED:');
        for (const issue of report.issues.filter(i => i.level === 'ERROR')) {
          console.log(`  ✗ ${issue.path}: ${issue.message}`);
        }
      }
    }
    
    // Validate tasks
    const tasksPath = join(changeDir, 'tasks.md');
    if (existsSync(tasksPath)) {
      const content = readFileSync(tasksPath, 'utf-8');
      const report = validator.validateTasks(content);
      if (!report.valid) {
        hasErrors = true;
        console.log('\n✗ Tasks validation FAILED:');
        for (const issue of report.issues.filter(i => i.level === 'ERROR')) {
          console.log(`  ✗ ${issue.path}: ${issue.message}`);
        }
      }
    }
    
    // Validate design
    const designPath = join(changeDir, 'design.md');
    if (existsSync(designPath)) {
      const content = readFileSync(designPath, 'utf-8');
      const report = validator.validateDesign(content);
      if (!report.valid) {
        hasErrors = true;
        console.log('\n✗ Design validation FAILED:');
        for (const issue of report.issues.filter(i => i.level === 'ERROR')) {
          console.log(`  ✗ ${issue.path}: ${issue.message}`);
        }
      }
    }
    
    if (hasErrors) {
      console.log('\nValidation FAILED with errors.');
      process.exit(1);
    } else if (hasWarnings) {
      console.log('\nValidation passed with warnings.');
    } else {
      console.log('\nValidation passed. All artifacts are valid.');
    }
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.message?.includes('Cannot find')) {
      console.error('Cannot load @opencode-sflow/core. Ensure it is installed.');
      process.exit(1);
    }
    throw err;
  }
}

/**
 * Show help
 */
function showHelp() {
  console.log(`
sflow - OpenSpec planning engine + Superpowers execution discipline

Usage:
  sflow <command> [options]

Commands:
  init [dir]              Initialize sflow in a project
  init --user             Initialize user-level config (~/.flow-engine/sflow/config.json)
  status [dir]            Show workflow status
  validate <change-dir>   Validate artifacts
  help                    Show this help message
  version                 Show version

Options:
  --help, -h              Show help
  --version, -v           Show version

Examples:
  sflow init              Initialize in current directory
  sflow init ./my-project Initialize in specific directory
  sflow status            Show status of current project
  sflow validate ./changes/my-feature  Validate specific change
  `);
}

/**
 * Show version
 */
function showVersion() {
  console.log('sflow version 0.1.0');
}

// Run CLI
main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
