/**
 * Core index exports for spec-superflow
 */
export { VALIDATION_MESSAGES, MIN_WHY_SECTION_LENGTH, MIN_PURPOSE_LENGTH, MAX_WHY_SECTION_LENGTH, MAX_REQUIREMENT_TEXT_LENGTH, MAX_DELTAS_PER_CHANGE, VERIFICATION_DIMENSIONS, VERIFICATION_MESSAGES, MIN_ABANDONMENT_REASON_LENGTH } from './validation/constants.js';
export { Validator } from './validation/validator.js';
export { REQUIREMENT_HEADER_REGEX, normalizeRequirementName, extractRequirementsSection, parseDeltaSpec, parseRequirementBlocks, parseChangeMarkdown } from './parsing/requirement-blocks.js';
//# sourceMappingURL=index.js.map