/**
 * Validation constants for spec-superflow core engine
 */
/** Minimum length for "Why" section in proposal.md */
export const MIN_WHY_SECTION_LENGTH = 50;
/** Maximum length for "Why" section */
export const MAX_WHY_SECTION_LENGTH = 5000;
/** Minimum length for purpose statement */
export const MIN_PURPOSE_LENGTH = 20;
/** Maximum length for requirement text */
export const MAX_REQUIREMENT_TEXT_LENGTH = 1000;
/** Maximum number of deltas per change */
export const MAX_DELTAS_PER_CHANGE = 10;
/** Minimum length for abandonment reason */
export const MIN_ABANDONMENT_REASON_LENGTH = 20;
/** Verification dimensions */
export const VERIFICATION_DIMENSIONS = [
    'Completeness',
    'Correctness',
    'Coherence',
];
/** Verification messages */
export const VERIFICATION_MESSAGES = {
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
/** Validation messages */
export const VALIDATION_MESSAGES = {
    proposal: {
        whyTooShort: `## Why section must be at least ${MIN_WHY_SECTION_LENGTH} characters`,
        whyTooLong: `## Why section must not exceed ${MAX_WHY_SECTION_LENGTH} characters`,
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
        crossSectionConflict: 'Cross-section conflict detected (e.g., MODIFIED and REMOVED in same spec)',
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
//# sourceMappingURL=constants.js.map