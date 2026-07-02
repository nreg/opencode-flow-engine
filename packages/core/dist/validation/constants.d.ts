/**
 * Validation constants for spec-superflow core engine
 * Aligned with spec-superflow/src/validation/constants.ts
 */
/** Minimum length for "Why" section in proposal.md */
export declare const MIN_WHY_SECTION_LENGTH = 50;
/** Minimum length for purpose statement */
export declare const MIN_PURPOSE_LENGTH = 50;
/** Maximum length for "Why" section */
export declare const MAX_WHY_SECTION_LENGTH = 1000;
/** Maximum length for requirement text */
export declare const MAX_REQUIREMENT_TEXT_LENGTH = 500;
/** Maximum number of deltas per change */
export declare const MAX_DELTAS_PER_CHANGE = 10;
/** Minimum length for abandonment reason */
export declare const MIN_ABANDONMENT_REASON_LENGTH = 50;
/** Verification dimensions */
export declare const VERIFICATION_DIMENSIONS: readonly ["Completeness", "Correctness", "Coherence"];
/** Validation messages — aligned with spec-superflow */
export declare const VALIDATION_MESSAGES: {
    readonly SCENARIO_EMPTY: "Scenario text cannot be empty";
    readonly REQUIREMENT_EMPTY: "Requirement text cannot be empty";
    readonly REQUIREMENT_NO_SHALL: "Requirement must contain SHALL or MUST keyword";
    readonly REQUIREMENT_NO_SCENARIOS: "Requirement must have at least one scenario";
    readonly SPEC_NAME_EMPTY: "Spec name cannot be empty";
    readonly SPEC_PURPOSE_EMPTY: "Purpose section cannot be empty";
    readonly SPEC_NO_REQUIREMENTS: "Spec must have at least one requirement";
    readonly CHANGE_NAME_EMPTY: "Change name cannot be empty";
    readonly CHANGE_WHY_TOO_SHORT: "Why section must be at least 50 characters";
    readonly CHANGE_WHY_TOO_LONG: "Why section should not exceed 1000 characters";
    readonly CHANGE_WHAT_EMPTY: "What Changes section cannot be empty";
    readonly CHANGE_NO_DELTAS: "Change must have at least one delta";
    readonly CHANGE_TOO_MANY_DELTAS: "Consider splitting changes with more than 10 deltas";
    readonly DELTA_SPEC_EMPTY: "Spec name cannot be empty";
    readonly DELTA_DESCRIPTION_EMPTY: "Delta description cannot be empty";
    readonly PURPOSE_TOO_BRIEF: "Purpose section is too brief (less than 50 characters)";
    readonly REQUIREMENT_TOO_LONG: "Requirement text is very long (>500 characters). Consider breaking it down.";
    readonly DELTA_DESCRIPTION_TOO_BRIEF: "Delta description is too brief";
    readonly DELTA_MISSING_REQUIREMENTS: "Delta should include requirements";
    readonly GUIDE_NO_DELTAS: "No deltas found. Ensure your change has a specs/ directory with capability folders (e.g. specs/http-server/spec.md) containing .md files that use delta headers (## ADDED/MODIFIED/REMOVED/RENAMED Requirements) and that each requirement includes at least one \"#### Scenario:\" block.";
    readonly GUIDE_MISSING_SPEC_SECTIONS: "Missing required sections. Expected headers: \"## Purpose\" and \"## Requirements\".";
    readonly GUIDE_MISSING_CHANGE_SECTIONS: "Missing required sections. Expected headers: \"## Why\" and \"## What Changes\".";
    readonly GUIDE_SCENARIO_FORMAT: "Scenarios must use level-4 headers. Convert bullet lists into: #### Scenario: Short name";
    readonly proposal: {
        readonly whyTooShort: "## Why section must be at least 50 characters";
        readonly whyTooLong: "## Why section should not exceed 1000 characters";
        readonly whatChangesEmpty: "## What Changes section cannot be empty";
        readonly purposeEmpty: "Purpose statement cannot be empty";
    };
    readonly spec: {
        readonly requirementMissingShall: "Each requirement must contain SHALL or MUST statement";
        readonly requirementMissingScenario: "Each requirement must have at least one scenario";
        readonly requirementTextTooLong: "Requirement text must not exceed 500 characters";
    };
    readonly deltaSpec: {
        readonly addedMissingText: "ADDED operation must have requirement text";
        readonly addedMissingScenario: "ADDED operation must have at least one scenario";
        readonly modifiedMissingText: "MODIFIED operation must have requirement text";
        readonly modifiedMissingScenario: "MODIFIED operation must have at least one scenario";
        readonly crossSectionConflict: "Cross-section conflict detected";
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
/** Verification messages — aligned with spec-superflow */
export declare const VERIFICATION_MESSAGES: {
    readonly COMPLETENESS_MISSING_TASK: "Task in tasks.md has no corresponding code change in diff summary";
    readonly COMPLETENESS_MISSING_REQUIREMENT: "SHALL/MUST requirement in spec has no matching implementation in diff summary: {requirement}";
    readonly CORRECTNESS_TEST_FAILURE: "Test suite has failures";
    readonly CORRECTNESS_MISSING_SCENARIO: "Spec scenario has no corresponding test assertion";
    readonly COHERENCE_NAMING_MISMATCH: "Design decision naming does not match implementation naming";
    readonly COHERENCE_PATTERN_MISSING: "Architecture pattern from design.md not found in implementation: {pattern}";
    readonly VERIFICATION_PLACEHOLDER_DETECTED: "Diff summary contains placeholder markers (TODO, FIXME, HACK)";
    readonly CONFLICT_DETECTED: "Requirement \"{requirement}\" is modified by multiple changes: {changes}";
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
//# sourceMappingURL=constants.d.ts.map