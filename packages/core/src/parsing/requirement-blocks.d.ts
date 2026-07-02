/**
 * Parsing functions for spec-superflow core engine
 * Ported from spec-superflow/src/parsing/requirement-blocks.ts
 */
import type { RequirementBlock, RequirementsSectionParts, DeltaPlan, ParsedDelta } from './types.js';
/**
 * Regex for requirement headers (#### Requirement: Name)
 */
export declare const REQUIREMENT_HEADER_REGEX: RegExp;
/**
 * Normalize a requirement name (trim, lowercase)
 */
export declare function normalizeRequirementName(name: string): string;
/**
 * Extract the requirements section from a spec file
 */
export declare function extractRequirementsSection(content: string): RequirementsSectionParts | null;
/**
 * Parse requirement blocks from markdown content
 */
export declare function parseRequirementBlocks(content: string): RequirementBlock[];
/**
 * Parse a delta spec markdown into a DeltaPlan
 */
export declare function parseDeltaSpec(content: string): DeltaPlan;
/**
 * Parse a change markdown file
 */
export declare function parseChangeMarkdown(content: string): {
    why: string;
    whatChanges: string;
    deltas: ParsedDelta[];
};
//# sourceMappingURL=requirement-blocks.d.ts.map