/**
 * Centralized agent tool configurations
 * Each agent type defines which tools it has access to
 *
 * call_sub_agent + background_output + background_cancel are sFlow's native
 * subagent routing tools registered via the Hooks.tool path.
 */

type AgentTools = Record<string, boolean>;

const COMMON_TOOLS = {
  read: true,
  glob: true,
  grep: true,
} as const;

export const AGENT_TOOLS: Record<string, AgentTools> = {
  /** Main orchestrator - uses call_sub_agent + background_output + background_cancel */
  sFlow: {
    ...COMMON_TOOLS,
    write: false,
    edit: false,
    bash: true,
    call_sub_agent: true,
    background_output: true,
    background_cancel: true,
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

  /** Spec writer - full file manipulation */
  'spec-writer': {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    skill: false,
  },

  /** Contract builder - read/write/validate */
  'contract-builder': {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    skill: false,
  },

  /**
   * Build executor - full dev tools + subagent dispatch
   * R4-3: Added call_sub_agent/background_output/background_cancel for SDD mode support.
   * The build-executor agent can now dispatch implementer/reviewer subagents
   * in Subagent-Driven Development mode.
   */
  'build-executor': {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    skill: false,
    call_sub_agent: true,
    background_output: true,
    background_cancel: true,
    lsp_diagnostics: true,
    lsp_goto_definition: true,
    lsp_find_references: true,
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

  /** Release archivist - read/write + test runner */
  'release-archivist': {
    ...COMMON_TOOLS,
    write: true,
    edit: false,
    bash: true,
    skill: false,
  },

  /** Spec merger - full file manipulation */
  'spec-merger': {
    ...COMMON_TOOLS,
    write: true,
    edit: true,
    bash: true,
    skill: false,
  },
};

export function getAgentTools(name: string): Record<string, boolean> {
  return AGENT_TOOLS[name] || { ...COMMON_TOOLS };
}
