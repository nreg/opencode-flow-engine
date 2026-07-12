/**
 * Base types for spec-superflow core engine
 * Aligned with spec-superflow/src/schema/base.ts
 */

/**
 * Workflow states
 * Defined here (not in constants.ts) to avoid circular dependencies:
 * - schema/base.ts uses WorkflowState (defined here)
 * - constants.ts imports WorkflowState from here (no circular dependency)
 * - validator.ts imports from constants.ts and parsing (no circular dependency)
 */
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

/**
 * Represents a scenario in a requirement.
 * Uses rawText to preserve original content for downstream analysis.
 */
export interface Scenario {
  rawText: string;
}

/**
 * Represents a requirement in a spec
 */
export interface Requirement {
  text: string;
  scenarios: Scenario[];
}

/**
 * Represents a spec file
 * Aligned with spec-superflow/src/schema/spec.ts
 */
export interface Spec {
  name: string;
  overview: string;
  requirements: Requirement[];
  metadata?: {
    version?: string;
    format?: string;
    sourcePath?: string;
  };
}

/**
 * Represents a change (delta) operation type
 */
export type DeltaOperationType = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';

/**
 * Represents a rename operation
 */
export interface Rename {
  from: string;
  to: string;
}

/**
 * Represents a delta operation
 * Aligned with spec-superflow/src/schema/change.ts
 */
export interface Delta {
  spec: string;
  operation: DeltaOperationType;
  description: string;
  requirement?: Requirement;
  requirements?: Requirement[];
  rename?: Rename;
}

/**
 * Represents a change (set of deltas)
 * Aligned with spec-superflow/src/schema/change.ts
 */
export interface Change {
  name: string;
  why: string;
  whatChanges: string;
  deltas: Delta[];
  metadata?: {
    version?: string;
    format?: string;
    sourcePath?: string;
  };
}

/**
 * Workflow modes
 */
export type WorkflowMode = 'full' | 'hotfix' | 'tweak';

/**
 * A decision point record — captures a confirmed transition gate in the workflow.
 * DPs are persisted to .sflow/state.json for audit and cross-session recovery.
 */
export interface DecisionPoint {
  /** Unique identifier: 'dp-0' through 'dp-5' */
  id: string;
  /** Human-readable name */
  name: string;
  /** State the workflow was in when this DP was confirmed */
  confirmedInState: WorkflowState;
  /** State the workflow transitioned to after confirmation */
  targetState: WorkflowState;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Optional note about this decision point */
  metadata?: string;
}

/**
 * Represents the state of a workflow
 */
export interface WorkflowStateFile {
  state: WorkflowState;
  mode: WorkflowMode;
  changeDir: string;
  dp0Confirmed: boolean;
  decisionPoints: DecisionPoint[];
  contractApproved: boolean;
  verificationStatus: 'pending' | 'passed' | 'failed';
  timestamps: {
    createdAt: string;
    updatedAt: string;
    lastTransition?: string;
  };
}

/**
 * Minimal runtime state shape used for file I/O.
 * All fields optional since the file may be partially written.
 */
export interface WorkflowStateRecord {
  state?: string;
  mode?: string;
  changeDir?: string;
  dp0Confirmed?: boolean;
  decisionPoints?: DecisionPoint[];
  contractApproved?: boolean;
  verificationStatus?: string;
  dp_0_confirmed?: boolean;
  dp_1_result?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * Check if a raw JSON value conforms to WorkflowStateRecord shape.
 * This is a runtime validation, not a TypeScript type guard for the full interface.
 */
export function isValidStateRecord(value: unknown): value is WorkflowStateRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.state !== undefined && typeof record.state !== 'string') return false;
  if (record.mode !== undefined && !['full', 'hotfix', 'tweak'].includes(record.mode as string)) return false;
  return true;
}
