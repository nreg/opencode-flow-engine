/**
 * Validation constants for spec-superflow core engine
 */
/** Minimum length for "Why" section in proposal.md */
export declare const MIN_WHY_SECTION_LENGTH = 50;
/** Maximum length for "Why" section */
export declare const MAX_WHY_SECTION_LENGTH = 5000;
/** Minimum length for purpose statement */
export declare const MIN_PURPOSE_LENGTH = 20;
/** Maximum length for requirement text */
export declare const MAX_REQUIREMENT_TEXT_LENGTH = 1000;
/** Maximum number of deltas per change */
export declare const MAX_DELTAS_PER_CHANGE = 10;
/** Minimum length for abandonment reason */
export declare const MIN_ABANDONMENT_REASON_LENGTH = 20;
/** Verification dimensions */
export declare const VERIFICATION_DIMENSIONS: readonly ["Completeness", "Correctness", "Coherence"];
/** Verification messages */
export declare const VERIFICATION_MESSAGES: {
    readonly Completeness: {
        readonly PASS: "All requirements are covered";
        readonly FAIL: "Missing requirements or scenarios";
        readonly WARN: "Some requirements may need more detail";
    };
    readonly Correctness: {
        readonly PASS: "All specifications are correct";
        readonly FAIL: "Incorrect or contradictory specifications";
        readonly WARN: "Some specifications may need clarification";
    };
    readonly Coherence: {
        readonly PASS: "All artifacts are consistent";
        readonly FAIL: "Inconsistent artifacts detected";
        readonly WARN: "Some artifacts may need alignment";
    };
};
/** Validation messages */
export declare const VALIDATION_MESSAGES: {
    readonly proposal: {
        readonly whyTooShort: "## Why section must be at least 50 characters";
        readonly whyTooLong: "## Why section must not exceed 5000 characters";
        readonly whatChangesEmpty: "## What Changes section cannot be empty";
        readonly purposeEmpty: "Purpose statement cannot be empty";
    };
    readonly spec: {
        readonly requirementMissingShall: "Each requirement must contain SHALL or MUST statement";
        readonly requirementMissingScenario: "Each requirement must have at least one scenario";
        readonly requirementTextTooLong: "Requirement text must not exceed 1000 characters";
    };
    readonly deltaSpec: {
        readonly addedMissingText: "ADDED operation must have requirement text";
        readonly addedMissingScenario: "ADDED operation must have at least one scenario";
        readonly modifiedMissingText: "MODIFIED operation must have requirement text";
        readonly modifiedMissingScenario: "MODIFIED operation must have at least one scenario";
        readonly crossSectionConflict: "Cross-section conflict detected (e.g., MODIFIED and REMOVED in same spec)";
        readonly tooManyDeltas: "Change must not have more than 10 deltas";
    };
    readonly tasks: {
        readonly missingCompletionDefinition: "Each task must have a completion definition";
    };
    readonly general: {
        readonly invalidState: "Invalid state transition";
        readonly missingArtifact: "Required artifact is missing";
        readonly staleContract: "Execution contract is stale and needs regeneration";
    };
    readonly design: {
        readonly missingArchitecture: "Design must include architecture decisions";
        readonly missingConstraints: "Design must include technical constraints";
        readonly missingApproach: "Design must include implementation approach";
    };
};
//# sourceMappingURL=constants.d.ts.map