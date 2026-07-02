/**
 * Base types for spec-superflow core engine
 * Aligned with spec-superflow/src/schema/base.ts
 */

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

import type { WorkflowState } from '../constants.js';

/**
 * Represents the state of a workflow
 */
export interface WorkflowStateFile {
  state: WorkflowState;
  mode: WorkflowMode;
  changeDir: string;
  dp0Confirmed: boolean;
  contractApproved: boolean;
  verificationStatus: 'pending' | 'passed' | 'failed';
  timestamps: {
    createdAt: Date;
    updatedAt: Date;
    lastTransition?: Date;
  };
}
