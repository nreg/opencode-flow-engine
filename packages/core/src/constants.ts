/**
 * Shared workflow constants
 */

/** Valid state transitions */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  exploring: ['specifying', 'abandoned'],
  specifying: ['bridging', 'exploring', 'abandoned'],
  bridging: ['approved-for-build', 'specifying', 'abandoned'],
  'approved-for-build': ['executing', 'bridging', 'abandoned'],
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
