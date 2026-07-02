/**
 * Base types for spec-superflow core engine
 * Ported from spec-superflow/src/schema/base.ts
 */
/**
 * Represents a scenario in a requirement
 */
export interface Scenario {
    /** Scenario name */
    name: string;
    /** Scenario description */
    description: string;
    /** Expected behavior */
    expectedBehavior: string;
}
/**
 * Represents a requirement in a spec
 */
export interface Requirement {
    /** Requirement name (e.g., "User Authentication") */
    name: string;
    /** Requirement text containing SHALL or MUST statements */
    text: string;
    /** List of scenarios */
    scenarios: Scenario[];
    /** Priority level */
    priority?: 'high' | 'medium' | 'low';
    /** Status */
    status?: 'draft' | 'approved' | 'implemented' | 'verified';
}
/**
 * Represents a spec file
 */
export interface Spec {
    /** Spec name */
    name: string;
    /** Spec description */
    description: string;
    /** List of requirements */
    requirements: Requirement[];
    /** Metadata */
    metadata: {
        createdAt: Date;
        updatedAt: Date;
        version: string;
        author?: string;
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
    /** Original name */
    from: string;
    /** New name */
    to: string;
}
/**
 * Represents a delta operation
 */
export interface Delta {
    /** Operation type */
    type: DeltaOperationType;
    /** Requirement name */
    requirementName: string;
    /** New requirement text (for ADDED/MODIFIED) */
    text?: string;
    /** New scenarios (for ADDED/MODIFIED) */
    scenarios?: Scenario[];
    /** Rename details (for RENAMED) */
    rename?: Rename;
    /** Reason for change */
    reason?: string;
}
/**
 * Represents a change (set of deltas)
 */
export interface Change {
    /** Change name */
    name: string;
    /** Change description */
    description: string;
    /** List of deltas */
    deltas: Delta[];
    /** Metadata */
    metadata: {
        createdAt: Date;
        updatedAt: Date;
        author?: string;
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
    /** Current state */
    state: WorkflowState;
    /** Workflow mode */
    mode: WorkflowMode;
    /** Change directory path */
    changeDir: string;
    /** DP-0 confirmed flag */
    dp0Confirmed: boolean;
    /** Execution contract approved flag */
    contractApproved: boolean;
    /** Verification status */
    verificationStatus: 'pending' | 'passed' | 'failed';
    /** Timestamps */
    timestamps: {
        createdAt: Date;
        updatedAt: Date;
        lastTransition?: Date;
    };
}
//# sourceMappingURL=base.d.ts.map