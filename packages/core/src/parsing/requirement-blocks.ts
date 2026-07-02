/**
 * Parsing functions for spec-superflow core engine
 * Ported from spec-superflow/src/parsing/requirement-blocks.ts
 */

import type { RequirementBlock, RequirementsSectionParts, DeltaPlan, ParsedDelta } from './types.js';
import type { Scenario } from '../schema/base.js';

/**
 * Regex for requirement headers (#### Requirement: Name)
 */
export const REQUIREMENT_HEADER_REGEX = /^#{3,4} (?:Requirement|SHALL|MUST):\s*(.+)$/gm;

/**
 * Normalize a requirement name (trim, lowercase)
 */
export function normalizeRequirementName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Extract the requirements section from a spec file
 */
export function extractRequirementsSection(content: string): RequirementsSectionParts | null {
  const sectionMatch = content.match(/## Requirements\n([\s\S]*?)(?=\n## |$)/);
  if (!sectionMatch) {
    return null;
  }

  const requirementsContent = sectionMatch[1];
  const requirements = parseRequirementBlocks(requirementsContent);

  return {
    header: '## Requirements',
    content: requirementsContent,
    requirements,
  };
}

/**
 * Parse requirement blocks from markdown content
 */
export function parseRequirementBlocks(content: string): RequirementBlock[] {
  const blocks: RequirementBlock[] = [];
  const lines = content.split('\n');
  
  let currentBlock: RequirementBlock | null = null;
  let lineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for requirement header
    const headerMatch = line.match(/^#{3,4} (?:Requirement|SHALL|MUST):\s*(.+)$/);
    if (headerMatch) {
      // Save previous block
      if (currentBlock) {
        currentBlock.lineEnd = i - 1;
        blocks.push(currentBlock);
      }
      
      // Start new block
      currentBlock = {
        name: headerMatch[1].trim(),
        text: '',
        scenarios: [],
        lineStart: i,
        lineEnd: i,
      };
      lineStart = i;
      continue;
    }

    // Check for scenario header
    const scenarioMatch = line.match(/^##### Scenario:\s*(.+)$/);
    if (scenarioMatch && currentBlock) {
      const scenario: Scenario = {
        name: scenarioMatch[1].trim(),
        description: '',
        expectedBehavior: '',
      };

      // Read scenario content
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith('#####') && !lines[j].startsWith('####')) {
        const scenarioLine = lines[j];
        if (scenarioLine.startsWith('**Expected:**') || scenarioLine.startsWith('**Behavior:**')) {
          scenario.expectedBehavior = scenarioLine.replace(/^\*\*.*?:\*\*\s*/, '').trim();
        } else if (scenarioLine.startsWith('**Given:**') || scenarioLine.startsWith('**Description:**')) {
          scenario.description = scenarioLine.replace(/^\*\*.*?:\*\*\s*/, '').trim();
        }
        j++;
      }

      currentBlock.scenarios.push(scenario);
      i = j - 1; // Adjust loop counter
      continue;
    }

    // Add content to current block
    if (currentBlock && line.trim()) {
      if (currentBlock.text) {
        currentBlock.text += '\n' + line;
      } else {
        currentBlock.text = line;
      }
    }
  }

  // Save last block
  if (currentBlock) {
    currentBlock.lineEnd = lines.length - 1;
    blocks.push(currentBlock);
  }

  return blocks;
}

/**
 * Parse a delta spec markdown into a DeltaPlan
 */
export function parseDeltaSpec(content: string): DeltaPlan {
  const plan: DeltaPlan = {
    added: [],
    modified: [],
    removed: [],
    renamed: [],
  };

  const lines = content.split('\n');
  let currentSection: 'added' | 'modified' | 'removed' | 'renamed' | null = null;
  let currentBlock: RequirementBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('### ADDED:')) {
      if (currentBlock && currentSection) {
        currentBlock.lineEnd = i - 1;
        if (currentSection === 'added') plan.added.push(currentBlock);
        else if (currentSection === 'modified') plan.modified.push(currentBlock);
      }
      currentSection = 'added';
      const name = line.replace('### ADDED:', '').trim();
      currentBlock = { name, text: '', scenarios: [], lineStart: i, lineEnd: i };
      continue;
    }
    if (line.startsWith('### MODIFIED:')) {
      if (currentBlock && currentSection) {
        currentBlock.lineEnd = i - 1;
        if (currentSection === 'added') plan.added.push(currentBlock);
        else if (currentSection === 'modified') plan.modified.push(currentBlock);
      }
      currentSection = 'modified';
      const name = line.replace('### MODIFIED:', '').trim();
      currentBlock = { name, text: '', scenarios: [], lineStart: i, lineEnd: i };
      continue;
    }
    if (line.startsWith('### REMOVED:')) {
      if (currentBlock && currentSection) {
        currentBlock.lineEnd = i - 1;
        if (currentSection === 'added') plan.added.push(currentBlock);
        else if (currentSection === 'modified') plan.modified.push(currentBlock);
      }
      currentSection = 'removed';
      const requirementName = line.replace('### REMOVED:', '').trim();
      plan.removed.push(requirementName);
      currentBlock = null;
      currentSection = null;
      continue;
    }
    if (line.startsWith('### RENAMED:')) {
      if (currentBlock && currentSection) {
        currentBlock.lineEnd = i - 1;
        if (currentSection === 'added') plan.added.push(currentBlock);
        else if (currentSection === 'modified') plan.modified.push(currentBlock);
      }
      currentSection = 'renamed';
      const renameMatch = line.match(/### RENAMED:\s*(.+)\s*->\s*(.+)/);
      if (renameMatch) {
        plan.renamed.push({
          from: renameMatch[1].trim(),
          to: renameMatch[2].trim(),
        });
      }
      currentBlock = null;
      currentSection = null;
      continue;
    }

    // Parse requirement blocks for added/modified sections
    if (currentSection === 'added' || currentSection === 'modified') {
      const headerMatch = line.match(/^#{3,4} (?:Requirement|SHALL|MUST):\s*(.+)$/);
      if (headerMatch) {
        // Save previous block
        if (currentBlock) {
          currentBlock.lineEnd = i - 1;
          if (currentSection === 'added') {
            plan.added.push(currentBlock);
          } else {
            plan.modified.push(currentBlock);
          }
        }

        // Start new block
        currentBlock = {
          name: headerMatch[1].trim(),
          text: '',
          scenarios: [],
          lineStart: i,
          lineEnd: i,
        };
        continue;
      }

      // Add content to current block
      if (currentBlock && line.trim()) {
        if (currentBlock.text) {
          currentBlock.text += '\n' + line;
        } else {
          currentBlock.text = line;
        }
      }
    }
  }

  // Save last block
  if (currentBlock) {
    currentBlock.lineEnd = lines.length - 1;
    if (currentSection === 'added') {
      plan.added.push(currentBlock);
    } else if (currentSection === 'modified') {
      plan.modified.push(currentBlock);
    }
  }

  return plan;
}

/**
 * Parse a change markdown file
 */
export function parseChangeMarkdown(content: string): {
  why: string;
  whatChanges: string;
  deltas: ParsedDelta[];
} {
  const whyMatch = content.match(/## Why\n([\s\S]*?)(?=\n## |$)/);
  const whatChangesMatch = content.match(/## What Changes\n([\s\S]*?)(?=\n## |$)/);

  const why = whyMatch ? whyMatch[1].trim() : '';
  const whatChanges = whatChangesMatch ? whatChangesMatch[1].trim() : '';

  // Parse deltas from What Changes section
  const deltas: ParsedDelta[] = [];
  
  if (whatChanges) {
    const lines = whatChanges.split('\n');
    let currentType: ParsedDelta['type'] | null = null;
    let currentRequirement = '';
    let currentText = '';
    let lineStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('- **ADDED:**')) {
        if (currentType && currentRequirement) {
          deltas.push({ type: currentType, requirementName: currentRequirement, text: currentText || undefined, lineStart, lineEnd: i - 1 });
        }
        currentType = 'ADDED';
        currentRequirement = line.replace(/- \*\*ADDED:\*\*\s*/, '').trim();
        currentText = '';
        lineStart = i;
        continue;
      }
      if (line.startsWith('- **MODIFIED:**')) {
        if (currentType && currentRequirement) {
          deltas.push({ type: currentType, requirementName: currentRequirement, text: currentText || undefined, lineStart, lineEnd: i - 1 });
        }
        currentType = 'MODIFIED';
        currentRequirement = line.replace(/- \*\*MODIFIED:\*\*\s*/, '').trim();
        currentText = '';
        lineStart = i;
        continue;
      }
      if (line.startsWith('- **REMOVED:**')) {
        if (currentType && currentRequirement) {
          deltas.push({ type: currentType, requirementName: currentRequirement, text: currentText || undefined, lineStart, lineEnd: i - 1 });
        }
        currentType = 'REMOVED';
        currentRequirement = line.replace(/- \*\*REMOVED:\*\*\s*/, '').trim();
        deltas.push({
          type: 'REMOVED',
          requirementName: currentRequirement,
          lineStart: i,
          lineEnd: i,
        });
        currentType = null;
        currentText = '';
        continue;
      }
      if (line.startsWith('- **RENAMED:**')) {
        if (currentType && currentRequirement) {
          deltas.push({ type: currentType, requirementName: currentRequirement, text: currentText || undefined, lineStart, lineEnd: i - 1 });
        }
        const renameMatch = line.match(/- \*\*RENAMED:\*\*\s*(.+)\s*->\s*(.+)/);
        if (renameMatch) {
          deltas.push({
            type: 'RENAMED',
            requirementName: renameMatch[1].trim(),
            rename: {
              from: renameMatch[1].trim(),
              to: renameMatch[2].trim(),
            },
            lineStart: i,
            lineEnd: i,
          });
        }
        currentType = null;
        currentText = '';
        continue;
      }

      // Add content to current delta
      if (currentType && line.trim()) {
        if (currentText) {
          currentText += '\n' + line;
        } else {
          currentText = line;
        }
      }
    }

    // Save last delta
    if (currentType && currentRequirement) {
      deltas.push({
        type: currentType,
        requirementName: currentRequirement,
        text: currentText || undefined,
        lineStart,
        lineEnd: lines.length - 1,
      });
    }
  }

  return {
    why,
    whatChanges,
    deltas,
  };
}
