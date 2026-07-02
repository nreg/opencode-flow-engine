/**
 * Validation constants for spec-superflow core engine
 * Aligned with spec-superflow/src/validation/constants.ts
 */
/** Minimum length for "Why" section in proposal.md */
export const MIN_WHY_SECTION_LENGTH = 50;
/** Minimum length for purpose statement */
export const MIN_PURPOSE_LENGTH = 50;
/** Maximum length for "Why" section */
export const MAX_WHY_SECTION_LENGTH = 1000;
/** Maximum length for requirement text */
export const MAX_REQUIREMENT_TEXT_LENGTH = 500;
/** Maximum number of deltas per change */
export const MAX_DELTAS_PER_CHANGE = 10;
/** Minimum length for abandonment reason */
export const MIN_ABANDONMENT_REASON_LENGTH = 50;
/** Verification dimensions */
export const VERIFICATION_DIMENSIONS = [
    'Completeness',
    'Correctness',
    'Coherence',
];
/** Validation messages — aligned with spec-superflow */
export const VALIDATION_MESSAGES = {
    SCENARIO_EMPTY: 'Scenario text cannot be empty',
    REQUIREMENT_EMPTY: 'Requirement text cannot be empty',
    REQUIREMENT_NO_SHALL: 'Requirement must contain SHALL or MUST keyword',
    REQUIREMENT_NO_SCENARIOS: 'Requirement must have at least one scenario',
    SPEC_NAME_EMPTY: 'Spec name cannot be empty',
    SPEC_PURPOSE_EMPTY: 'Purpose section cannot be empty',
    SPEC_NO_REQUIREMENTS: 'Spec must have at least one requirement',
    CHANGE_NAME_EMPTY: 'Change name cannot be empty',
    CHANGE_WHY_TOO_SHORT: `Why section must be at least ${MIN_WHY_SECTION_LENGTH} characters`,
    CHANGE_WHY_TOO_LONG: `Why section should not exceed ${MAX_WHY_SECTION_LENGTH} characters`,
    CHANGE_WHAT_EMPTY: 'What Changes section cannot be empty',
    CHANGE_NO_DELTAS: 'Change must have at least one delta',
    CHANGE_TOO_MANY_DELTAS: `Consider splitting changes with more than ${MAX_DELTAS_PER_CHANGE} deltas`,
    DELTA_SPEC_EMPTY: 'Spec name cannot be empty',
    DELTA_DESCRIPTION_EMPTY: 'Delta description cannot be empty',
    PURPOSE_TOO_BRIEF: `Purpose section is too brief (less than ${MIN_PURPOSE_LENGTH} characters)`,
    REQUIREMENT_TOO_LONG: `Requirement text is very long (>${MAX_REQUIREMENT_TEXT_LENGTH} characters). Consider breaking it down.`,
    DELTA_DESCRIPTION_TOO_BRIEF: 'Delta description is too brief',
    DELTA_MISSING_REQUIREMENTS: 'Delta should include requirements',
    GUIDE_NO_DELTAS: 'No deltas found. Ensure your change has a specs/ directory with capability folders (e.g. specs/http-server/spec.md) containing .md files that use delta headers (## ADDED/MODIFIED/REMOVED/RENAMED Requirements) and that each requirement includes at least one "#### Scenario:" block.',
    GUIDE_MISSING_SPEC_SECTIONS: 'Missing required sections. Expected headers: "## Purpose" and "## Requirements".',
    GUIDE_MISSING_CHANGE_SECTIONS: 'Missing required sections. Expected headers: "## Why" and "## What Changes".',
    GUIDE_SCENARIO_FORMAT: 'Scenarios must use level-4 headers. Convert bullet lists into: #### Scenario: Short name',
    proposal: {
        whyTooShort: `## Why section must be at least ${MIN_WHY_SECTION_LENGTH} characters`,
        whyTooLong: `## Why section should not exceed ${MAX_WHY_SECTION_LENGTH} characters`,
        whatChangesEmpty: '## What Changes section cannot be empty',
        purposeEmpty: 'Purpose statement cannot be empty',
    },
    spec: {
        requirementMissingShall: 'Each requirement must contain SHALL or MUST statement',
        requirementMissingScenario: 'Each requirement must have at least one scenario',
        requirementTextTooLong: `Requirement text must not exceed ${MAX_REQUIREMENT_TEXT_LENGTH} characters`,
    },
    deltaSpec: {
        addedMissingText: 'ADDED operation must have requirement text',
        addedMissingScenario: 'ADDED operation must have at least one scenario',
        modifiedMissingText: 'MODIFIED operation must have requirement text',
        modifiedMissingScenario: 'MODIFIED operation must have at least one scenario',
        crossSectionConflict: 'Cross-section conflict detected',
        tooManyDeltas: `Change must not have more than ${MAX_DELTAS_PER_CHANGE} deltas`,
    },
    tasks: {
        missingCompletionDefinition: 'Each task must have a completion definition',
    },
    general: {
        invalidState: 'Invalid state transition',
        missingArtifact: 'Required artifact is missing',
        staleContract: 'Execution contract is stale and needs regeneration',
    },
    design: {
        missingArchitecture: 'Design must include architecture decisions',
        missingConstraints: 'Design must include technical constraints',
        missingApproach: 'Design must include implementation approach',
    },
};
/** Verification messages — aligned with spec-superflow */
export const VERIFICATION_MESSAGES = {
    COMPLETENESS_MISSING_TASK: 'Task in tasks.md has no corresponding code change in diff summary',
    COMPLETENESS_MISSING_REQUIREMENT: 'SHALL/MUST requirement in spec has no matching implementation in diff summary: {requirement}',
    CORRECTNESS_TEST_FAILURE: 'Test suite has failures',
    CORRECTNESS_MISSING_SCENARIO: 'Spec scenario has no corresponding test assertion',
    COHERENCE_NAMING_MISMATCH: 'Design decision naming does not match implementation naming',
    COHERENCE_PATTERN_MISSING: 'Architecture pattern from design.md not found in implementation: {pattern}',
    VERIFICATION_PLACEHOLDER_DETECTED: 'Diff summary contains placeholder markers (TODO, FIXME, HACK)',
    CONFLICT_DETECTED: 'Requirement "{requirement}" is modified by multiple changes: {changes}',
    Completeness: {
        PASS: 'All requirements are covered',
        FAIL: 'Missing requirements or scenarios',
        WARN: 'Some requirements may need more detail',
    },
    Correctness: {
        PASS: 'All specifications are correct',
        FAIL: 'Incorrect or contradictory specifications',
        WARN: 'Some specifications may need clarification',
    },
    Coherence: {
        PASS: 'All artifacts are consistent',
        FAIL: 'Inconsistent artifacts detected',
        WARN: 'Some artifacts may need alignment',
    },
};
//# sourceMappingURL=constants.js.map