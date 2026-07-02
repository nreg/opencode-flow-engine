/**
 * Core index exports for spec-superflow
 * Aligned with spec-superflow/src/index.ts
 */

// Schema types
export type { Scenario, Requirement, Spec, DeltaOperationType, Rename, Delta, Change, WorkflowMode, WorkflowStateFile } from './schema/base.js';
export type { WorkflowState } from './constants.js';

// Validation
export type { ValidationLevel, ValidationIssue, ValidationReport, VerificationDimension, VerificationStatus, VerificationFinding, VerificationReport, ConflictReport, SyncConflict } from './validation/types.js';
export { VALIDATION_MESSAGES, MIN_WHY_SECTION_LENGTH, MIN_PURPOSE_LENGTH, MAX_WHY_SECTION_LENGTH, MAX_REQUIREMENT_TEXT_LENGTH, MAX_DELTAS_PER_CHANGE, VERIFICATION_DIMENSIONS, VERIFICATION_MESSAGES, MIN_ABANDONMENT_REASON_LENGTH } from './validation/constants.js';
export { Validator, sharedValidator } from './validation/validator.js';

// Tokenizer
export { tokenize, detectLanguage } from './validation/tokenizer.js';

// Parsing
export type { RequirementBlock, RequirementsSectionParts, DeltaPlan, ParsedDelta, ParsedChange } from './parsing/types.js';
export { REQUIREMENT_HEADER_REGEX, normalizeRequirementName, extractRequirementsSection, parseDeltaSpec, parseChangeMarkdown } from './parsing/requirement-blocks.js';

// Workflow constants
export { VALID_TRANSITIONS, ALL_STATES, isValidTransition, getValidTransitions } from './constants.js';
