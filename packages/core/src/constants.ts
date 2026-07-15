/**
 * Shared workflow constants
 *
 * Note: WorkflowState type is defined in schema/base.ts to avoid circular dependencies.
 */

/** Valid state transitions */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  exploring: ['specifying', 'abandoned'],
  specifying: ['ui-design', 'bridging', 'exploring', 'abandoned'],
  'ui-design': ['bridging', 'specifying', 'abandoned'],
  bridging: ['approved-for-build', 'specifying', 'abandoned'],
  'approved-for-build': ['executing', 'bridging', 'closing', 'abandoned'],
  executing: ['debugging', 'closing', 'abandoned'],
  debugging: ['executing', 'abandoned'],
  closing: ['abandoned'],
  abandoned: [],
};

/** All workflow states */
export const ALL_STATES = Object.keys(VALID_TRANSITIONS);

/** Check if a state transition is valid */
export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/** Get valid transitions from a state */
export function getValidTransitions(from: string): string[] {
  return VALID_TRANSITIONS[from] || [];
}

// ─── Preset Upgrade Thresholds ────────────────────────────────────────────────

/**
 * Hotfix → full upgrade thresholds
 * If ANY condition is met, upgrade to full workflow
 */
export const HOTFIX_UPGRADE_THRESHOLDS = {
  /** Max files before upgrade */
  MAX_FILES: 2,
  /** Max tasks before upgrade */
  MAX_TASKS: 2,
} as const;

/**
 * Tweak → full upgrade thresholds
 */
export const TWEAK_UPGRADE_THRESHOLDS = {
  MAX_FILES: 4,
  MAX_TASKS: 4,
} as const;

// ─── Execution Mode Thresholds ────────────────────────────────────────────────

/**
 * Task count thresholds for execution mode recommendation (DP-4).
 * - inline: 1–2 tasks, no dependencies
 * - batch-inline: 3–5 tasks, no dependencies
 * - sdd: 6+ tasks OR any cross-wave dependencies
 */
export const EXECUTION_MODE_THRESHOLDS = {
  inline: { maxTasks: 2 },
  'batch-inline': { maxTasks: 5 },
} as const;

// ─── Receipt Status ───────────────────────────────────────────────────────────

/**
 * Review receipt status values.
 * Used by checkReceiptIntegrity and checkClosingGate guards.
 */
export const RECEIPT_STATUS = {
  PASS: 'pass',
  FAIL: 'fail',
} as const;

// ─── Artifact Preflight Gate: State → Required Artifacts ───────────────────

/**
 * P2: Helper to extend a base state's required artifact list.
 * Reduces duplication when multiple states share the same base requirements.
 */
function expandFrom(base: string, extra: string[], extraOptional?: string[]): { required: string[]; optional?: string[] } {
  const baseEntry = ARTIFACT_PREFLIGHT_BASE[base];
  if (!baseEntry) return { required: [...extra], optional: extraOptional };
  const mergedOptional = [...(baseEntry.optional || []), ...(extraOptional || [])];
  return { required: [...baseEntry.required, ...extra], optional: mergedOptional.length > 0 ? mergedOptional : undefined };
}

/**
 * Base artifact preflight entries — defined separately so expandFrom can reference them.
 * P2: executing/debugging/closing inherit from approved-for-build via expandFrom.
 */
const ARTIFACT_PREFLIGHT_BASE: Record<string, { required: string[]; optional?: string[] }> = {
  exploring:            { required: [] },
  specifying:           { required: ['proposal.md'] },
  'ui-design':          { required: ['proposal.md', 'specs/'] },
  bridging:             { required: ['proposal.md', 'specs/', 'design.md', 'tasks.md'], optional: ['ui-design.md'] },
  'approved-for-build': { required: ['proposal.md', 'specs/', 'design.md', 'tasks.md', 'execution-contract.md'], optional: ['ui-design.md', 'execution-plan.json'] },
  abandoned:            { required: [] },
};

/**
 * Artifact Preflight Gate table.
 * Maps workflow state to the artifacts that MUST exist before entering that state.
 * Used by guard.ts to enforce artifact-first discipline.
 */
export const ARTIFACT_PREFLIGHT: Record<string, { required: string[]; optional?: string[] }> = {
  ...ARTIFACT_PREFLIGHT_BASE,
  executing:  expandFrom('approved-for-build', []),
  debugging:  expandFrom('approved-for-build', []),
  closing:    expandFrom('approved-for-build', []),
};

/** Save as named constant for reuse */
export const PREFLIGHT_ARTIFACT_TABLE = ARTIFACT_PREFLIGHT;

/**
 * Check if an artifact path indicates a directory.
 * Used by Artifact Preflight Gate to distinguish dir artifacts vs file artifacts.
 */
export function isDirectoryArtifact(artifact: string): boolean {
  return artifact.endsWith('/');
}
