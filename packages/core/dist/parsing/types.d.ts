/**
 * Parsing types for spec-superflow core engine
 * Aligned with spec-superflow/src/parsing/requirement-blocks.ts
 */
/**
 * Represents a requirement block in markdown.
 * Uses raw text to preserve original content for validation.
 */
export interface RequirementBlock {
    headerLine: string;
    name: string;
    raw: string;
}
/**
 * Parts of a requirements section
 * Aligned with spec-superflow: before/headerLine/preamble/bodyBlocks/after
 */
export interface RequirementsSectionParts {
    before: string;
    headerLine: string;
    preamble: string;
    bodyBlocks: RequirementBlock[];
    after: string;
}
/**
 * Represents a delta plan (parsed from delta spec)
 * Aligned with spec-superflow: includes sectionPresence
 */
export interface DeltaPlan {
    added: RequirementBlock[];
    modified: RequirementBlock[];
    removed: string[];
    renamed: Array<{
        from: string;
        to: string;
    }>;
    sectionPresence: {
        added: boolean;
        modified: boolean;
        removed: boolean;
        renamed: boolean;
    };
}
/**
 * Parsed delta from change markdown
 */
export interface ParsedDelta {
    spec: string;
    operation: string;
    description: string;
}
/**
 * Parsed change markdown
 */
export interface ParsedChange {
    name: string;
    why: string;
    whatChanges: string;
    deltas: ParsedDelta[];
}
//# sourceMappingURL=types.d.ts.map