/**
 * Parsing functions for spec-superflow core engine
 * Ported from spec-superflow/src/parsing/requirement-blocks.ts
 * Ported from spec-superflow/src/parsing/change-parser.ts
 */
import type { RequirementsSectionParts, DeltaPlan, ParsedChange } from './types.js';
/**
 * Regex for requirement headers (### Requirement: Name)
 */
export declare const REQUIREMENT_HEADER_REGEX: RegExp;
/**
 * Normalize a requirement name (trim)
 * Aligned with spec-superflow: only trim, do NOT lowercase
 * (lowercasing loses case information needed for cross-referencing)
 */
export declare function normalizeRequirementName(name: string): string;
/**
 * Extract the requirements section from a spec file
 * Aligned with spec-superflow: returns structured parts
 */
export declare function extractRequirementsSection(content: string): RequirementsSectionParts;
/**
 * Parse a delta spec markdown into a DeltaPlan
 * Aligned with spec-superflow: uses section-based parsing
 */
export declare function parseDeltaSpec(content: string): DeltaPlan;
/**
 * Parse a change markdown file
 * Aligned with spec-superflow/src/parsing/change-parser.ts
 */
export declare function parseChangeMarkdown(content: string, changeName: string): ParsedChange;
//# sourceMappingURL=requirement-blocks.d.ts.map