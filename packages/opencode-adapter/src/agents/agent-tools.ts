/**
 * Centralized agent tool configurations
 * Each agent type defines which tools it has access to
 *
 * call_flow_agent + flowagent_output + flowagent_cancel are sFlow's native
 * subagent routing tools registered via the Hooks.tool path.
 *
 * When oh-my-openagent is installed (hasOmoPlugin=true):
 * - call_omo_agent: Explore codebase / research docs via named agents
 * - task: Full delegation with categories, skills, model fallback
 */

type AgentTools = Record<string, boolean>;

const COMMON_TOOLS = {
  read: true,
  glob: true,
  grep: true,
} as const;

/** Module-level flag: set once at plugin init by index.ts */
let _hasOmoPlugin = false;
let _hasAgnesProvider = false;

export function setHasOmoPlugin(v: boolean): void {
  _hasOmoPlugin = v;
}

export function getHasOmoPlugin(): boolean {
  return _hasOmoPlugin;
}

export function setHasAgnesProvider(v: boolean): void {
  _hasAgnesProvider = v;
}

export function getHasAgnesProvider(): boolean {
  return _hasAgnesProvider;
}

/**
 * oh-my-openagent tools that sFlow can leverage when available.
 * Includes both call_omo_agent (explore/librarian only) and task (full delegation).
 */
const OMO_TOOLS: AgentTools = {
  call_omo_agent: true,
  task: true,
};

export const AGENT_TOOLS: Record<string, AgentTools> = {
  /** Main orchestrator - delegates to subagents */
  sFlow: {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    call_flow_agent: true,
    flowagent_output: true,
    flowagent_cancel: true,
    skill: true,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true,
    session_list: true,
    session_read: true,
    session_search: true,
    session_info: true,
  },

  /** Need explorer - needs write but no bash */
  'need-explorer': {
    ...COMMON_TOOLS,
    write: true,
    edit: false,
    bash: false,
    skill: false,
  },

/** Spec writer - full file manipulation + validation tools */
  'spec-writer': {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    skill: false,
    validate_spec: true,
    validate_tasks: true,
    validate_design: true,
    validate_proposal: true,
    artifact_inspector: true,
  },

/** Contract builder - read/write/validate/contract validation */
  'contract-builder': {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    skill: false,
    validate_contract: true,
    artifact_inspector: true,
    contract_validator: true,
  },

  /**
   * Build executor - full dev tools + subagent dispatch
   * The build-executor agent can dispatch implementer/reviewer subagents
   * in Subagent-Driven Development mode via call_flow_agent.
   * When oh-my-openagent is available, also has access to task() and call_omo_agent().
   */
'build-executor': {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    skill: false,
    call_flow_agent: true,
    flowagent_output: true,
    flowagent_cancel: true,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true,
    validate_implementation: true,
    artifact_inspector: true,
    agnes_image_generate: true,
    agnes_video_generate: true,
    agnes_image_understand: true,
  },

  /** Bug investigator - debug tools */
  'bug-investigator': {
    ...COMMON_TOOLS,
    write: false,
    edit: true,
    bash: true,
    skill: false,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true,
  },

  /** Code reviewer - read-only + bash for tests */
  'code-reviewer': {
    ...COMMON_TOOLS,
    write: false,
    edit: false,
    bash: true,
    skill: false,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true,
  },

/** Release archivist - read/write + test runner + artifact inspection */
  'release-archivist': {
    ...COMMON_TOOLS,
    write: true,
    edit: false,
    bash: true,
    skill: false,
    artifact_inspector: true,
  },

  /** Spec merger - full file manipulation */
  'spec-merger': {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    skill: false,
  },

  /** UI Implementer - frontend UI code specialist */
  'ui-implementer': {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    skill: true,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true,
  },
};

/**
 * Get tool permissions for a specific agent.
 * When hasOmoPlugin=true, injects oh-my-openagent tools (call_omo_agent, task)
 * into sFlow and build-executor agents.
 */
export function getAgentTools(name: string, hasOmoPlugin?: boolean): Record<string, boolean> {
  const base = AGENT_TOOLS[name] || { ...COMMON_TOOLS };
  // Use passed-in flag or fall back to module-level flag
  const omoAvailable = hasOmoPlugin ?? _hasOmoPlugin;
  if (omoAvailable && (name === 'sFlow' || name === 'build-executor')) {
    return { ...base, ...OMO_TOOLS };
  }
  return { ...base };
}
