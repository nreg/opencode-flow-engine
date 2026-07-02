/**
 * Validation types for spec-superflow core engine
 * Aligned with spec-superflow/src/validation/types.ts
 */
/**
 * Validation severity levels
 */
export type ValidationLevel = 'ERROR' | 'WARNING' | 'INFO';
/**
 * Validation issue
 */
export interface ValidationIssue {
    level: ValidationLevel;
    path: string;
    message: string;
    line?: number;
    suggestion?: string;
}
/**
 * Validation report
 * Aligned with spec-superflow: includes structured summary
 */
export interface ValidationReport {
    valid: boolean;
    issues: ValidationIssue[];
    summary: {
        errors: number;
        warnings: number;
        info: number;
    };
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
    level: 'CRITICAL' | 'IMPORTANT' | 'INFO';
    dimension: VerificationDimension;
    message: string;
}
/**
 * Verification report
 * Aligned with spec-superflow: structured dimensions + verdict
 */
export interface VerificationReport {
    dimensions: {
        name: VerificationDimension;
        status: VerificationStatus;
        findings: VerificationFinding[];
    }[];
    verdict: 'PASS' | 'CONDITIONAL' | 'FAIL';
}
/**
 * Sync conflict
 */
export interface SyncConflict {
    requirement: string;
    spec: string;
    changes: string[];
}
/**
 * Conflict report
 */
export interface ConflictReport {
    hasConflicts: boolean;
    conflicts: SyncConflict[];
}
//# sourceMappingURL=types.d.ts.map