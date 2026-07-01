# sFlow API 参考

## 核心 API

### Validator

```typescript
import { Validator } from '@opencode-sflow/core';

class Validator {
  constructor(strictMode?: boolean);
  
  validateProposal(content: string): ValidationReport;
  validateSpec(content: string, specName: string): ValidationReport;
  validateDeltaSpec(content: string, changeName: string): ValidationReport;
  validateTasks(content: string): ValidationReport;
  validateExecutionContract(content: string): ValidationReport;
}
```

### 解析函数

```typescript
import {
  normalizeRequirementName,
  extractRequirementsSection,
  parseRequirementBlocks,
  parseDeltaSpec,
  parseChangeMarkdown,
} from '@opencode-sflow/core';

function normalizeRequirementName(name: string): string;
function extractRequirementsSection(content: string): RequirementsSectionParts | null;
function parseRequirementBlocks(content: string): RequirementBlock[];
function parseDeltaSpec(content: string): DeltaPlan;
function parseChangeMarkdown(content: string): ParsedChange;
```

## Agent API

### Agent Builder

```typescript
import {
  createAgent,
  createAllAgents,
  getAgent,
  getAgentNames,
  getAgentMode,
  getPrimaryAgents,
  getSubagentAgents,
  agentExists,
  getDefaultModel,
  getAllDefaultModels,
} from './agents/agent-builder.js';

function createAgent(
  name: BuiltinAgentName,
  model?: string,
  overrides?: AgentOverrides
): AgentConfig;

function createAllAgents(
  model?: string,
  overrides?: AgentOverrides
): Record<BuiltinAgentName, AgentConfig>;

function getAgent(name: BuiltinAgentName): AgentFactory | undefined;
function getAgentNames(): BuiltinAgentName[];
function getAgentMode(name: BuiltinAgentName): AgentMode;
function getPrimaryAgents(): BuiltinAgentName[];
function getSubagentAgents(): BuiltinAgentName[];
function agentExists(name: string): name is BuiltinAgentName;
function getDefaultModel(name: BuiltinAgentName): string;
function getAllDefaultModels(): Record<BuiltinAgentName, string>;
```

## 工具 API

### Tool Registry

```typescript
class ToolRegistry {
  initialize(): void;
  getTool(name: ToolName): ToolDefinition | undefined;
  executeTool(
    name: ToolName,
    params: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
  disableTool(name: ToolName): void;
  enableTool(name: ToolName): void;
  isToolEnabled(name: ToolName): boolean;
  getEnabledTools(): ToolName[];
  getDisabledTools(): ToolName[];
  getToolCount(): { total: number; enabled: number; disabled: number };
}

function createToolRegistry(): ToolRegistry;
function getToolNames(): ToolName[];
function toolExists(name: string): name is ToolName;
```

## 钩子 API

### Hook Composer

```typescript
class HookComposer {
  initialize(): void;
  getHook(name: HookName): HookHandler | undefined;
  executeHook(name: HookName, context: HookContext): Promise<HookResult>;
  executeAllHooks(
    context: HookContext
  ): Promise<{ success: boolean; results: Record<HookName, HookResult> }>;
  disableHook(name: HookName): void;
  enableHook(name: HookName): void;
  isHookEnabled(name: HookName): boolean;
  getEnabledHooks(): HookName[];
  getDisabledHooks(): HookName[];
  getHookCount(): { total: number; enabled: number; disabled: number };
  addHook(name: HookName, hook: HookHandler, position?: number): void;
  removeHook(name: HookName): void;
}

function createHookComposer(): HookComposer;
function getHookNames(): HookName[];
function hookExists(name: string): name is HookName;
```

## 功能 API

### Feature Manager

```typescript
class FeatureManager {
  constructor(config?: FeatureManagerConfig);
  
  initialize(): Promise<FeatureResult>;
  getWorkflowManager(): WorkflowManager;
  getStateManager(): StateManager;
  getSkillLoader(): SkillLoader;
  getMcpManager(): McpManager;
  getSkills(): Skill[];
  getSkill(name: string): Skill | undefined;
  getStatus(): Record<string, unknown>;
}

function createFeatureManager(config?: FeatureManagerConfig): FeatureManager;
```

### Skill Loader

```typescript
class SkillLoader {
  constructor(skillsDir?: string);
  
  loadAllSkills(): Skill[];
  loadSkill(name: string): Skill | null;
  getSkill(name: string): Skill | undefined;
  getAllSkills(): Skill[];
  getSkillNames(): string[];
  hasSkill(name: string): boolean;
  getSkillContent(name: string): string | null;
  getSkillsWithMcp(): Skill[];
  getSkillMcpServers(name: string): McpServer[];
}

function createSkillLoader(skillsDir?: string): SkillLoader;
function parseSkillMetadata(content: string): SkillMetadata;
function getSkillContentWithoutFrontmatter(content: string): string;
```

### MCP Manager

```typescript
class McpManager {
  startServer(name: string, config: McpServer, sessionId?: string): Promise<McpServerInstance>;
  stopServer(name: string, sessionId?: string): Promise<boolean>;
  stopSessionServers(sessionId: string): Promise<void>;
  getServerStatus(name: string, sessionId?: string): McpServerInstance | undefined;
  getSessionServers(sessionId: string): McpServerInstance[];
  getRunningServers(): McpServerInstance[];
  isServerRunning(name: string, sessionId?: string): boolean;
  getServerCount(): { total: number; running: number; stopped: number; error: number };
}

function createMcpManager(): McpManager;
```

## 类型定义

### Agent Types

```typescript
type AgentMode = 'primary' | 'subagent' | 'all';

type AgentFactory = ((model: string) => AgentConfig) & {
  mode: AgentMode;
};

type AgentCategory = 'exploration' | 'specialist' | 'advisor' | 'utility' | 'workflow';

type AgentCost = 'FREE' | 'CHEAP' | 'EXPENSIVE';

interface DelegationTrigger {
  domain: string;
  trigger: string;
}

interface AgentPromptMetadata {
  category: AgentCategory;
  cost: AgentCost;
  triggers: DelegationTrigger[];
  useWhen?: string[];
  avoidWhen?: string[];
  dedicatedSection?: string;
  promptAlias?: string;
  keyTrigger?: string;
}

type BuiltinAgentName =
  | 'sflow'
  | 'need-explorer'
  | 'spec-writer'
  | 'contract-builder'
  | 'build-executor'
  | 'bug-investigator'
  | 'code-reviewer'
  | 'release-archivist'
  | 'spec-merger';

type AgentOverrideConfig = Partial<AgentConfig> & {
  category?: string;
  prompt_append?: string;
  skills?: string[];
  tools?: Record<string, boolean>;
  variant?: string;
  fallback_models?: string | (string | { model: string; variant?: string })[];
};

type AgentOverrides = Partial<Record<BuiltinAgentName, AgentOverrideConfig>>;
```

### Tool Types

```typescript
type ToolName = 'workflow_router' | 'contract_validator' | 'artifact_inspector';

interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: Record<string, unknown>;
  execute: (params: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

interface ToolContext {
  changeDir: string;
  stateFile: string;
  pluginRoot: string;
}

interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  suggestions?: string[];
}
```

### Hook Types

```typescript
type HookName = 'state_transition' | 'artifact_validation' | 'guard';

interface HookHandler {
  name: HookName;
  description: string;
  execute: (context: HookContext) => Promise<HookResult>;
}

interface HookContext {
  changeDir: string;
  stateFile: string;
  pluginRoot: string;
  action: string;
  data?: Record<string, unknown>;
}

interface HookResult {
  success: boolean;
  data?: unknown;
  error?: string;
  block?: boolean;
  blockReason?: string;
}
```

### Schema Types

```typescript
interface Scenario {
  name: string;
  description: string;
  expectedBehavior: string;
}

interface Requirement {
  name: string;
  text: string;
  scenarios: Scenario[];
  priority?: 'high' | 'medium' | 'low';
  status?: 'draft' | 'approved' | 'implemented' | 'verified';
}

interface Spec {
  name: string;
  description: string;
  requirements: Requirement[];
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    version: string;
    author?: string;
  };
}

type DeltaOperationType = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';

interface Rename {
  from: string;
  to: string;
}

interface Delta {
  type: DeltaOperationType;
  requirementName: string;
  text?: string;
  scenarios?: Scenario[];
  rename?: Rename;
  reason?: string;
}

interface Change {
  name: string;
  description: string;
  deltas: Delta[];
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    author?: string;
  };
}

type WorkflowState =
  | 'exploring'
  | 'specifying'
  | 'bridging'
  | 'approved-for-build'
  | 'executing'
  | 'debugging'
  | 'closing'
  | 'abandoned';

type WorkflowMode = 'full' | 'hotfix' | 'tweak';
```

### Validation Types

```typescript
type ValidationLevel = 'ERROR' | 'WARNING' | 'INFO';

interface ValidationIssue {
  level: ValidationLevel;
  path: string;
  message: string;
  suggestion?: string;
}

interface ValidationReport {
  valid: boolean;
  issues: ValidationIssue[];
  summary: string;
}

type VerificationDimension = 'Completeness' | 'Correctness' | 'Coherence';

type VerificationStatus = 'PASS' | 'FAIL' | 'WARN';

interface VerificationFinding {
  dimension: VerificationDimension;
  status: VerificationStatus;
  description: string;
  files?: string[];
}

interface VerificationReport {
  status: VerificationStatus;
  findings: VerificationFinding[];
  summary: string;
}

interface SyncConflict {
  capability: string;
  description: string;
  sourceChange: string;
  targetSpec: string;
}

interface ConflictReport {
  hasConflicts: boolean;
  conflicts: SyncConflict[];
  summary: string;
}
```
