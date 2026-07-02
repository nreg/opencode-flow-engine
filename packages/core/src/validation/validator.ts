/**
 * Validator for spec-superflow core engine
 * Ported from spec-superflow/src/validation/validator.ts
 */

import type { Requirement, Spec, Change } from '../schema/base.js';
import type { ValidationReport, ValidationIssue } from './types.js';
import {
  VALIDATION_MESSAGES,
  MIN_WHY_SECTION_LENGTH,
  MAX_WHY_SECTION_LENGTH,
  MAX_REQUIREMENT_TEXT_LENGTH,
  MAX_DELTAS_PER_CHANGE,
} from './constants.js';

const DESIGN_REQUIRED_SECTIONS = [
  { key: 'Architecture Decision', pattern: /## Architecture\b|### Architecture\b/i },
  { key: 'Design Constraints', pattern: /## Constraints\b|## Design Constraints\b/i },
  { key: 'Implementation Approach', pattern: /## Approach\b|## Implementation\b/i },
] as const;

/**
 * Main validator class
 */
export class Validator {
  private strictMode: boolean;

  constructor(strictMode = false) {
    this.strictMode = strictMode;
  }

  /**
   * Validate a proposal markdown content
   */
  validateProposal(content: string): ValidationReport {
    const issues: ValidationIssue[] = [];

    // Check Why section
    const whyMatch = content.match(/## Why\n([\s\S]*?)(?=\n## |$)/);
    if (whyMatch) {
      const whyContent = whyMatch[1].trim();
      if (whyContent.length < MIN_WHY_SECTION_LENGTH) {
        issues.push({
          level: 'ERROR',
          path: 'proposal.md:## Why',
          message: VALIDATION_MESSAGES.proposal.whyTooShort,
          suggestion: `Add at least ${MIN_WHY_SECTION_LENGTH - whyContent.length} more characters to explain the motivation`,
        });
      }
      if (whyContent.length > MAX_WHY_SECTION_LENGTH) {
        issues.push({
          level: 'WARNING',
          path: 'proposal.md:## Why',
          message: VALIDATION_MESSAGES.proposal.whyTooLong,
          suggestion: 'Consider condensing the motivation section',
        });
      }
    } else {
      issues.push({
        level: 'ERROR',
        path: 'proposal.md:## Why',
        message: 'Missing ## Why section',
        suggestion: 'Add a ## Why section to explain the motivation',
      });
    }

    // Check What Changes section
    const whatChangesMatch = content.match(/## What Changes\n([\s\S]*?)(?=\n## |$)/);
    if (whatChangesMatch) {
      const whatChangesContent = whatChangesMatch[1].trim();
      if (whatChangesContent.length === 0) {
        issues.push({
          level: 'ERROR',
          path: 'proposal.md:## What Changes',
          message: VALIDATION_MESSAGES.proposal.whatChangesEmpty,
          suggestion: 'Add content to describe what changes will be made',
        });
      }
    } else {
      issues.push({
        level: 'ERROR',
        path: 'proposal.md:## What Changes',
        message: 'Missing ## What Changes section',
        suggestion: 'Add a ## What Changes section to describe the changes',
      });
    }

    return {
      valid: issues.filter(i => i.level === 'ERROR').length === 0,
      issues,
      summary: issues.length === 0 ? 'Proposal validation passed' : `Found ${issues.length} issues`,
    };
  }

  /**
   * Validate a spec markdown content
   */
  validateSpec(content: string, specName: string): ValidationReport {
    const issues: ValidationIssue[] = [];

    // Extract requirements (SHALL/MUST statements)
    const requirementRegex = /(?:SHALL|MUST)\s+([^\n]+)/g;
    let match;
    const requirements: string[] = [];

    while ((match = requirementRegex.exec(content)) !== null) {
      requirements.push(match[1]);
    }

    if (requirements.length === 0) {
      issues.push({
        level: 'ERROR',
        path: `specs/${specName}/spec.md`,
        message: 'No requirements found (SHALL/MUST statements)',
        suggestion: 'Add at least one requirement with SHALL or MUST statement',
      });
    }

    // Check for scenarios
    const scenarioRegex = /#### Scenario:\s*([^\n]+)/g;
    const scenarios: string[] = [];
    while ((match = scenarioRegex.exec(content)) !== null) {
      scenarios.push(match[1]);
    }

    if (requirements.length > 0 && scenarios.length === 0) {
      issues.push({
        level: 'ERROR',
        path: `specs/${specName}/spec.md`,
        message: VALIDATION_MESSAGES.spec.requirementMissingScenario,
        suggestion: 'Add at least one scenario for each requirement',
      });
    }

    // Check requirement text length
    requirements.forEach((req, index) => {
      if (req.length > MAX_REQUIREMENT_TEXT_LENGTH) {
        issues.push({
          level: 'WARNING',
          path: `specs/${specName}/spec.md:requirement[${index}]`,
          message: VALIDATION_MESSAGES.spec.requirementTextTooLong,
          suggestion: 'Consider shortening the requirement text',
        });
      }
    });

    return {
      valid: issues.filter(i => i.level === 'ERROR').length === 0,
      issues,
      summary: issues.length === 0 ? 'Spec validation passed' : `Found ${issues.length} issues`,
    };
  }

  /**
   * Validate a delta spec (ADDED/MODIFIED/REMOVED/RENAMED)
   */
  validateDeltaSpec(content: string, changeName: string): ValidationReport {
    const issues: ValidationIssue[] = [];
    let deltaCount = 0;

    const addedRegex = /#{2,3} ADDED:\s*([^\n]+)\n([\s\S]*?)(?=\n#{2,3} (?:ADDED|MODIFIED|REMOVED|RENAMED):|\n## |$)/g;
    let match;
    while ((match = addedRegex.exec(content)) !== null) {
      deltaCount++;
      const requirementText = match[2].trim();
      if (requirementText.length === 0) {
        issues.push({
          level: 'ERROR',
          path: `changes/${changeName}/specs:ADDED:${match[1]}`,
          message: VALIDATION_MESSAGES.deltaSpec.addedMissingText,
          suggestion: 'Add requirement text for the ADDED operation',
        });
      }
      if (!requirementText.includes('#### Scenario:')) {
        issues.push({
          level: 'ERROR',
          path: `changes/${changeName}/specs:ADDED:${match[1]}`,
          message: VALIDATION_MESSAGES.deltaSpec.addedMissingScenario,
          suggestion: 'Add at least one scenario for the ADDED requirement',
        });
      }
    }

    const modifiedRegex = /#{2,3} MODIFIED:\s*([^\n]+)\n([\s\S]*?)(?=\n#{2,3} (?:ADDED|MODIFIED|REMOVED|RENAMED):|\n## |$)/g;
    while ((match = modifiedRegex.exec(content)) !== null) {
      deltaCount++;
      const requirementText = match[2].trim();
      if (requirementText.length === 0) {
        issues.push({
          level: 'ERROR',
          path: `changes/${changeName}/specs:MODIFIED:${match[1]}`,
          message: VALIDATION_MESSAGES.deltaSpec.modifiedMissingText,
          suggestion: 'Add requirement text for the MODIFIED operation',
        });
      }
    }

    const removedRegex = /#{2,3} REMOVED:\s*([^\n]+)/g;
    const removedRequirements: string[] = [];
    while ((match = removedRegex.exec(content)) !== null) {
      removedRequirements.push(match[1]);
      deltaCount++;
    }

    const modifiedRequirements: string[] = [];
    const modifiedRegex2 = /#{2,3} MODIFIED:\s*([^\n]+)/g;
    while ((match = modifiedRegex2.exec(content)) !== null) {
      modifiedRequirements.push(match[1]);
    }

    // Check for conflicts (same requirement in both MODIFIED and REMOVED)
    const conflicts = removedRequirements.filter(req => modifiedRequirements.includes(req));
    if (conflicts.length > 0) {
      issues.push({
        level: 'ERROR',
        path: `changes/${changeName}/specs`,
        message: `${VALIDATION_MESSAGES.deltaSpec.crossSectionConflict}: ${conflicts.join(', ')}`,
        suggestion: 'Resolve conflicts by choosing either MODIFIED or REMOVED for each requirement',
      });
    }

    // Check delta count
    if (deltaCount > MAX_DELTAS_PER_CHANGE) {
      issues.push({
        level: 'WARNING',
        path: `changes/${changeName}/specs`,
        message: VALIDATION_MESSAGES.deltaSpec.tooManyDeltas,
        suggestion: 'Consider splitting the change into smaller, focused changes',
      });
    }

    return {
      valid: issues.filter(i => i.level === 'ERROR').length === 0,
      issues,
      summary: issues.length === 0 ? 'Delta spec validation passed' : `Found ${issues.length} issues`,
    };
  }

  /**
   * Validate a tasks.md file
   */
  validateTasks(content: string): ValidationReport {
    const issues: ValidationIssue[] = [];

    // Check for task completion definitions
    const taskRegex = /- \[.\]\s+([^\n]+)/g;
    let match;
    const tasks: string[] = [];

    while ((match = taskRegex.exec(content)) !== null) {
      tasks.push(match[1]);
    }

    if (tasks.length === 0) {
      issues.push({
        level: 'WARNING',
        path: 'tasks.md',
        message: 'No tasks found',
        suggestion: 'Add tasks with completion definitions',
      });
    }

    // Check each task has a completion definition
    tasks.forEach((task, index) => {
      if (!task.includes(':') && !task.includes('—') && !task.includes('-')) {
        issues.push({
          level: 'WARNING',
          path: `tasks.md:task[${index}]`,
          message: VALIDATION_MESSAGES.tasks.missingCompletionDefinition,
          suggestion: 'Add a completion definition (e.g., "Task: description — completion criteria")',
        });
      }
    });

    return {
      valid: issues.filter(i => i.level === 'ERROR').length === 0,
      issues,
      summary: issues.length === 0 ? 'Tasks validation passed' : `Found ${issues.length} issues`,
    };
  }

  /**
   * Validate a design markdown file
   */
  validateDesign(content: string): ValidationReport {
    const issues: ValidationIssue[] = [];

    for (const section of DESIGN_REQUIRED_SECTIONS) {
      if (!section.pattern.test(content)) {
        issues.push({
          level: 'ERROR',
          path: 'design.md',
          message: `Missing section: ${section.key}`,
          suggestion: `Add a section describing ${section.key.toLowerCase()}`,
        });
      }
    }

    return {
      valid: issues.filter(i => i.level === 'ERROR').length === 0,
      issues,
      summary: issues.length === 0 ? 'Design validation passed' : `Found ${issues.length} issues`,
    };
  }

  /**
   * Validate an execution contract
   */
  validateExecutionContract(content: string): ValidationReport {
    const issues: ValidationIssue[] = [];

    // Check for required sections
    const requiredSections = ['Intent Lock', 'Approved Behavior', 'Design Constraints', 'Task Batches'];
    
    requiredSections.forEach(section => {
      if (!content.includes(section)) {
        issues.push({
          level: 'ERROR',
          path: 'execution-contract.md',
          message: `Missing required section: ${section}`,
          suggestion: `Add a ## ${section} section to the execution contract`,
        });
      }
    });

    // Check for test obligations
    if (!content.includes('Test Obligations') && !content.includes('TDD')) {
      issues.push({
        level: 'WARNING',
        path: 'execution-contract.md',
        message: 'No test obligations defined',
        suggestion: 'Add test obligations to ensure quality implementation',
      });
    }

    return {
      valid: issues.filter(i => i.level === 'ERROR').length === 0,
      issues,
      summary: issues.length === 0 ? 'Execution contract validation passed' : `Found ${issues.length} issues`,
    };
  }
}
