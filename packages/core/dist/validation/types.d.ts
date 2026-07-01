/**
 * Validation types for spec-superflow core engine
 */
/**
 * Validation severity levels
 */
export type ValidationLevel = 'ERROR' | 'WARNING' | 'INFO';
/**
 * Validation issue
 */
export interface ValidationIssue {
    /** Severity level */
    level: ValidationLevel;
    /** Path to the issue (e.g., "specs/auth/spec.md:requirements[0]") */
    path: string;
    /** Issue message */
    message: string;
    /** Suggested fix */
    suggestion?: string;
}
/**
 * Validation report
 */
export interface ValidationReport {
    /** Whether validation passed */
    valid: boolean;
    /** List of issues */
    issues: ValidationIssue[];
    /** Summary of validation */
    summary: string;
}
/**
 * Verification dimensions
 */
export type VerificationDimension = 'Completeness' | 'Correctness' | 'Coherence';
/**
 * Verification status
 */
export type VerificationStatus = 'PASS' | 'FAIL' | 'WARN';
/**
 * Verification finding
 */
export interface VerificationFinding {
    /** Dimension */
    dimension: VerificationDimension;
    /** Status */
    status: VerificationStatus;
    /** Description */
    description: string;
    /** Related files */
    files?: string[];
}
/**
 * Verification report
 */
export interface VerificationReport {
    /** Overall status */
    status: VerificationStatus;
    /** Findings */
    findings: VerificationFinding[];
    /** Summary */
    summary: string;
}
/**
 * Sync conflict
 */
export interface SyncConflict {
    /** Capability name */
    capability: string;
    /** Conflict description */
    description: string;
    /** Source change */
    sourceChange: string;
    /** Target spec */
    targetSpec: string;
}
/**
 * Conflict report
 */
export interface ConflictReport {
    /** Whether conflicts exist */
    hasConflicts: boolean;
    /** List of conflicts */
    conflicts: SyncConflict[];
    /** Summary */
    summary: string;
}
//# sourceMappingURL=types.d.ts.map