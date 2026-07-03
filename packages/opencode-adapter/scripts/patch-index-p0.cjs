const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'index.ts');
let content = fs.readFileSync(file, 'utf8');

// 1. import createValidatorTools
if (!content.includes("import { createValidatorTools } from './features/builtin-mcp.js';")) {
  content = content.replace(
    "import { createMcpManager, loadProjectMcpConfig } from './features/mcp-manager.js';",
    "import { createMcpManager, loadProjectMcpConfig } from './features/mcp-manager.js';\nimport { createValidatorTools } from './features/builtin-mcp.js';"
  );
}

// 2. merge validator tools into plugin tools
if (!content.includes('const validatorTools = createValidatorTools();')) {
  content = content.replace(
    'const tools = createSFlowTools(workDir);',
    "const tools = createSFlowTools(workDir);\n  const validatorTools = createValidatorTools();\n  Object.assign(tools, validatorTools);"
  );
}

// 3. expand SFLOW_TOOLS
content = content.replace(
  "const SFLOW_TOOLS = new Set(['workflow_router', 'contract_validator', 'artifact_inspector']);",
  "const SFLOW_TOOLS = new Set(['workflow_router', 'contract_validator', 'artifact_inspector', 'validate_spec', 'validate_proposal', 'validate_delta_spec', 'validate_tasks', 'validate_contract', 'validate_design', 'validate_implementation', 'detect_sync_conflicts']);"
);

// 4. fix dispose to stop MCP servers
if (!content.includes('mcpManager.getRunningServers()')) {
  content = content.replace(
    'dispose: async () => {\n      console.log(\'[sFlow] Plugin disposed\');\n    },',
    `dispose: async () => {
      console.log('[sFlow] Plugin disposed');
      for (const [name, server] of mcpManager.getRunningServers().entries()) {
        try {
          await mcpManager.stopServer(name);
        } catch (err) {
          console.warn(\`[sFlow] Failed to stop MCP server \${name}: \`, err);
        }
      }
    },`
  );
}

fs.writeFileSync(file, content, 'utf8');
console.log('Patched index.ts successfully');
