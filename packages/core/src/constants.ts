/**
 * Shared workflow constants
 */

/** Valid state transitions */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  exploring: ['specifying', 'abandoned'],
  specifying: ['ui-design', 'bridging', 'exploring', 'abandoned'],
  'ui-design': ['bridging', 'abandoned'],
  bridging: ['approved-for-build', 'specifying', 'abandoned'],
  'approved-for-build': ['executing', 'bridging', 'closing', 'abandoned'],
  executing: ['debugging', 'closing', 'abandoned'],
  debugging: ['executing', 'abandoned'],
  closing: ['abandoned'],
  abandoned: [],
};

/** All workflow states */
export const ALL_STATES = Object.keys(VALID_TRANSITIONS);

/** Workflow states */
export type WorkflowState =
  | 'exploring'
  | 'specifying'
  | 'ui-design'
  | 'bridging'
  | 'approved-for-build'
  | 'executing'
  | 'debugging'
  | 'closing'
  | 'abandoned';

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

// ─── Artifact Preflight Gate: State → Required Artifacts ───────────────────

/**
 * Artifact Preflight Gate table.
 * Maps workflow state to the artifacts that MUST exist before entering that state.
 * Used by guard.ts to enforce artifact-first discipline.
 *
 * Inspired by flow-kit's Artifact Preflight Gate (GO.md § 第二步前).
 */
export const ARTIFACT_PREFLIGHT: Record<string, { required: string[]; optional?: string[] }> = {
  exploring:          { required: [] },
  specifying:         { required: ['proposal.md'] },
  'ui-design':        { required: ['proposal.md', 'specs/'] },
  bridging:           { required: ['proposal.md', 'specs/', 'design.md', 'tasks.md'], optional: ['ui-design.md'] },
  'approved-for-build': { required: ['proposal.md', 'specs/', 'design.md', 'tasks.md', 'execution-contract.md'], optional: ['ui-design.md'] },
  executing:          { required: ['proposal.md', 'specs/', 'design.md', 'tasks.md', 'execution-contract.md'], optional: ['ui-design.md'] },
  debugging:          { required: ['proposal.md', 'specs/', 'design.md', 'tasks.md', 'execution-contract.md'], optional: ['ui-design.md'] },
  closing:            { required: ['proposal.md', 'specs/', 'design.md', 'tasks.md', 'execution-contract.md'], optional: ['ui-design.md'] },
  abandoned:          { required: [] },
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
