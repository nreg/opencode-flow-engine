/**
 * Validator for spec-superflow core engine
 * Ported from spec-superflow/src/validation/validator.ts
 */
import type { ValidationReport } from './types.js';
/**
 * Main validator class
 */
export declare class Validator {
    private strictMode;
    constructor(strictMode?: boolean);
    /**
     * Validate a proposal markdown content
     */
    validateProposal(content: string): ValidationReport;
    /**
     * Validate a spec markdown content
     */
    validateSpec(content: string, specName: string): ValidationReport;
    /**
     * Validate a delta spec (ADDED/MODIFIED/REMOVED/RENAMED)
     */
    validateDeltaSpec(content: string, changeName: string): ValidationReport;
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
}
//# sourceMappingURL=validator.d.ts.map