/**
 * Validator for spec-superflow core engine
 * Aligned with spec-superflow/src/validation/validator.ts
 * Full port: block-level validation, implementation verification,
 * sync conflict detection, and language-aware tokenization.
 */
import type { ValidationReport, VerificationReport, ConflictReport } from './types.js';
/**
 * Main validator class
 * Aligned with spec-superflow: full block-level validation,
 * implementation verification, and sync conflict detection.
 */
export declare class Validator {
    private strictMode;
    constructor(strictMode?: boolean);
    /**
     * Validate spec content (block-level validation)
     * Replaces the old regex-based validateSpec with proper block parsing
     */
    validateSpecContent(specName: string, content: string): ValidationReport;
    /**
     * Validate a proposal markdown content (also used for change validation)
     * Aligned with spec-superflow: validateChangeContent
     */
    validateChangeContent(changeName: string, content: string): ValidationReport;
    /**
     * Validate a proposal markdown content
     * Alias for validateChangeContent for backward compatibility
     */
    validateProposal(content: string): ValidationReport;
    /**
     * Validate a spec markdown content
     * Backward-compatible wrapper around validateSpecContent
     */
    validateSpec(content: string, specName: string): ValidationReport;
    /**
     * Validate a delta spec (ADDED/MODIFIED/REMOVED/RENAMED)
     * Full cross-section conflict detection, duplicate detection, etc.
     * Aligned with spec-superflow: complete validation
     */
    validateDeltaSpec(content: string, changeName: string): ValidationReport;
    /**
     * Validate implementation against spec and design
     * Three-dimension verification: Completeness, Correctness, Coherence
     * Aligned with spec-superflow: uses language-aware tokenizer
     */
    validateImplementation(diffSummary: string, specContent: string, designContent: string, config?: {
        verification?: {
            language?: 'auto' | 'en' | 'zh';
        };
    }): VerificationReport;
    /**
     * Detect sync conflicts across multiple delta specs
     * Aligned with spec-superflow: detects requirements modified by multiple changes
     */
    detectSyncConflicts(deltaSpecs: Array<{
        changeName: string;
        content: string;
    }>): ConflictReport;
    /**
     * Validate a tasks.md file
     */
    validateTasks(content: string): ValidationReport;
    /**
     * Validate a design markdown file
     */
    validateDesign(content: string): ValidationReport;
    /**
     * Validate an execution contract
     */
    validateExecutionContract(content: string): ValidationReport;
    /**
     * Check if a report is valid
     */
    isValid(report: ValidationReport): boolean;
    private extractRequirementNames;
    private extractDecisionNames;
}
/**
 * Module-level singleton Validator instance
 * Validator is stateless; reuse the same instance across all tools and hooks.
 */
export declare const sharedValidator: Validator;
//# sourceMappingURL=validator.d.ts.map