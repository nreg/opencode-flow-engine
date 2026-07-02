/**
 * Parsing types for spec-superflow core engine
 */

import type { Requirement, Scenario, Delta, Change } from '../schema/base.js';

/**
 * Represents a requirement block in markdown
 */
export interface RequirementBlock {
  /** Requirement name */
  name: string;
  /** Requirement text */
  text: string;
  /** Scenarios */
  scenarios: Scenario[];
  /** Line numbers in original file */
  lineStart: number;
  lineEnd: number;
}

/**
 * Parts of a requirements section
 */
export interface RequirementsSectionParts {
  /** Section header */
  header: string;
  /** Raw content */
  content: string;
  /** Parsed requirements */
  requirements: RequirementBlock[];
}

/**
 * Represents a delta plan (parsed from delta spec)
 */
export interface DeltaPlan {
  /** Added requirements */
  added: RequirementBlock[];
  /** Modified requirements */
  modified: RequirementBlock[];
  /** Removed requirements */
  removed: string[];
  /** Renamed requirements */
  renamed: Array<{ from: string; to: string }>;
}

/**
 * Parsed delta operation - extends base Delta with source locations
 */
export interface ParsedDelta extends Delta {
  /** Line numbers in original file */
  lineStart: number;
  lineEnd: number;
}

/**
 * Parsed change markdown
 */
export interface ParsedChange {
  /** Change name */
  name: string;
  /** Why section */
  why: string;
  /** What changes section */
  whatChanges: string;
  /** Deltas */
  deltas: ParsedDelta[];
  /** Metadata */
  metadata: {
    lineStart: number;
    lineEnd: number;
  };
}
