/**
 * Unit tests for requirement-blocks parser
 * Updated to match spec-superflow-aligned parsing API
 */

import { describe, it, expect } from 'bun:test';
import {
  extractRequirementsSection,
  parseDeltaSpec,
  parseChangeMarkdown,
  normalizeRequirementName,
  REQUIREMENT_HEADER_REGEX,
  scanMarkdownLines,
  requirementNameFromMatch,
} from './requirement-blocks.js';

describe('normalizeRequirementName', () => {
  it('should trim whitespace', () => {
    expect(normalizeRequirementName('  User Login  ')).toBe('User Login');
  });

  it('should preserve case (aligned with spec-superflow)', () => {
    expect(normalizeRequirementName('User Authentication')).toBe('User Authentication');
  });

  it('should handle empty string', () => {
    expect(normalizeRequirementName('')).toBe('');
  });
});

describe('extractRequirementsSection', () => {
  it('should extract requirements with block-level structure', () => {
    const content = `# Spec: Auth

## Purpose

Authentication spec.

## Requirements

### Requirement: User Login

The system SHALL allow users to log in.

#### Scenario: Successful Login

**Given:** Valid credentials

## Overview

Some overview.
`;

    const parts = extractRequirementsSection(content);
    expect(parts.bodyBlocks.length).toBe(1);
    expect(parts.bodyBlocks[0].name).toBe('User Login');
    expect(parts.bodyBlocks[0].raw).toContain('SHALL');
    expect(parts.bodyBlocks[0].raw).toContain('#### Scenario: Successful Login');
  });

  it('should return empty blocks when no Requirements section', () => {
    const content = `# Spec: Auth\n\n## Purpose\nTest.`;
    const parts = extractRequirementsSection(content);
    expect(parts.bodyBlocks.length).toBe(0);
  });

  it('should handle multiple requirement blocks', () => {
    const content = `## Requirements

### Requirement: Login

The system SHALL allow login.

#### Scenario: Login

**When:** User logs in

### Requirement: Logout

The system SHALL allow logout.

#### Scenario: Logout

**When:** User logs out
`;

    const parts = extractRequirementsSection(content);
    expect(parts.bodyBlocks.length).toBe(2);
    expect(parts.bodyBlocks[0].name).toBe('Login');
    expect(parts.bodyBlocks[1].name).toBe('Logout');
  });

  it('should separate preamble from body blocks', () => {
    const content = `## Requirements

Some preamble text.

### Requirement: Login

The system SHALL allow login.

#### Scenario: Login

**When:** User logs in
`;

    const parts = extractRequirementsSection(content);
    expect(parts.preamble).toContain('Some preamble text');
    expect(parts.bodyBlocks.length).toBe(1);
  });

  it('should ignore requirement headers inside fenced code blocks', () => {
    const content = `## Requirements

### Requirement: Real Requirement

The system SHALL do something real.

\`\`\`markdown
### Requirement: Fake Requirement

This should be ignored.
\`\`\`

### Requirement: Another Real One

The system SHALL do another thing.
`;

    const parts = extractRequirementsSection(content);
    expect(parts.bodyBlocks.length).toBe(2);
    expect(parts.bodyBlocks[0]?.name).toBe('Real Requirement');
    expect(parts.bodyBlocks[1]?.name).toBe('Another Real One');

    // 确保假标题没有被识别
    const names = parts.bodyBlocks.map(b => b.name);
    expect(names).not.toContain('Fake Requirement');
  });

  it('should handle fenced blocks with tilde markers', () => {
    const content = `## Requirements

### Requirement: Real

The system SHALL work.

~~~
### Requirement: Fake
~~~
`;

    const parts = extractRequirementsSection(content);
    expect(parts.bodyBlocks.length).toBe(1);
    expect(parts.bodyBlocks[0]?.name).toBe('Real');
  });
});

describe('parseDeltaSpec', () => {
  it('should parse ADDED Requirements section', () => {
    const content = `
# Delta Spec: Add Logout

## ADDED Requirements

### Requirement: User Logout

The system SHALL allow users to log out.

#### Scenario: Logout

**When:** The user logs out
`;

    const plan = parseDeltaSpec(content);
    expect(plan.added.length).toBe(1);
    expect(plan.added[0].name).toBe('User Logout');
    expect(plan.sectionPresence.added).toBe(true);
    expect(plan.sectionPresence.modified).toBe(false);
  });

  it('should parse MODIFIED and REMOVED sections', () => {
    const content = `
## MODIFIED Requirements

### Requirement: User Login

The system SHALL allow secure login.

#### Scenario: Secure Login

**When:** The user logs in securely

## REMOVED Requirements

### Requirement: Legacy Auth
`;

    const plan = parseDeltaSpec(content);
    expect(plan.modified.length).toBe(1);
    expect(plan.removed.length).toBe(1);
    expect(plan.sectionPresence.modified).toBe(true);
    expect(plan.sectionPresence.removed).toBe(true);
  });

  it('should parse RENAMED section', () => {
    const content = `
## RENAMED Requirements

- FROM: ### Requirement: Old Auth
- TO: ### Requirement: New Auth
`;

    const plan = parseDeltaSpec(content);
    expect(plan.renamed.length).toBe(1);
    expect(plan.renamed[0].from).toBe('Old Auth');
    expect(plan.renamed[0].to).toBe('New Auth');
  });

  it('should return empty plan for content without delta sections', () => {
    const content = `# Some Document\n\nJust text.`;
    const plan = parseDeltaSpec(content);
    expect(plan.added.length).toBe(0);
    expect(plan.modified.length).toBe(0);
    expect(plan.removed.length).toBe(0);
    expect(plan.renamed.length).toBe(0);
  });

  it('should track sectionPresence', () => {
    const content = `## ADDED Requirements\n\n### Requirement: X\nTest.\n\n#### Scenario: S\n**When:** test`;
    const plan = parseDeltaSpec(content);
    expect(plan.sectionPresence.added).toBe(true);
    expect(plan.sectionPresence.modified).toBe(false);
    expect(plan.sectionPresence.removed).toBe(false);
    expect(plan.sectionPresence.renamed).toBe(false);
  });
});

describe('parseChangeMarkdown', () => {
  it('should extract Why and What Changes sections', () => {
    const content = `
# Change: Add Authentication

## Why

We need authentication for security purposes. This is a critical requirement.

## What Changes

- Add login system
- Add session management

## ADDED Requirements

Added auth requirements.
`;

    const change = parseChangeMarkdown(content, 'add-auth');
    expect(change.name).toBe('add-auth');
    expect(change.why).toContain('authentication');
    expect(change.whatChanges).toContain('login');
    expect(change.deltas.length).toBeGreaterThan(0);
  });

  it('should handle empty change markdown', () => {
    const result = parseChangeMarkdown('', 'empty');
    expect(result.why).toBe('');
    expect(result.whatChanges).toBe('');
    expect(result.deltas).toHaveLength(0);
  });
});

describe('REQUIREMENT_HEADER_REGEX', () => {
  it('should match requirement headers', () => {
    const line = '### Requirement: User Login';
    const match = line.match(REQUIREMENT_HEADER_REGEX);
    expect(match).not.toBeNull();
    expect(match).toBeDefined();
    if (match) {
      expect(requirementNameFromMatch(match)).toBe('User Login');
    }
  });

  it('should be case-insensitive', () => {
    const line = '### requirement: User Login';
    const match = line.match(REQUIREMENT_HEADER_REGEX);
    expect(match).not.toBeNull();
  });

  it('should support Chinese colon（中文冒号支持）', () => {
    const line = '### 需求：用户登录';
    const match = line.match(REQUIREMENT_HEADER_REGEX);
    expect(match).not.toBeNull();
    expect(match).toBeDefined();
    if (match) {
      expect(requirementNameFromMatch(match)).toBe('用户登录');
    }
  });

  it('should support REQ-ID format（REQ-ID 格式支持）', () => {
    const line = '### REQ-AUTH-001 用户登录';
    const match = line.match(REQUIREMENT_HEADER_REGEX);
    expect(match).not.toBeNull();
    expect(match).toBeDefined();
    if (match) {
      expect(requirementNameFromMatch(match)).toBe('用户登录');
    }
  });

  it('should support REQ-ID with colon', () => {
    const line = '### REQ-AUTH-001: User Login';
    const match = line.match(REQUIREMENT_HEADER_REGEX);
    expect(match).not.toBeNull();
    expect(match).toBeDefined();
    if (match) {
      expect(requirementNameFromMatch(match)).toBe('User Login');
    }
  });

  it('should support mixed Chinese and English', () => {
    const line1 = '### Requirement: 用户登录';
    const match1 = line1.match(REQUIREMENT_HEADER_REGEX);
    expect(match1).not.toBeNull();
    expect(match1).toBeDefined();
    if (match1) {
      expect(requirementNameFromMatch(match1)).toBe('用户登录');
    }

    const line2 = '### 需求：User Login';
    const match2 = line2.match(REQUIREMENT_HEADER_REGEX);
    expect(match2).not.toBeNull();
    expect(match2).toBeDefined();
    if (match2) {
      expect(requirementNameFromMatch(match2)).toBe('User Login');
    }
  });
});

describe('scanMarkdownLines', () => {
  it('should mark lines inside fenced code blocks', () => {
    const content = `Some text

\`\`\`markdown
### Requirement: FakeTitle
\`\`\`

### Requirement: RealTitle`;
    const lines = scanMarkdownLines(content);
    expect(lines.length).toBeGreaterThan(0);

    // 找到 FakeTitle 所在行
    const fakeLine = lines.find(l => l.text.includes('FakeTitle'));
    expect(fakeLine).toBeDefined();
    expect(fakeLine?.fenced).toBe(true);

    // 找到 RealTitle 所在行
    const realLine = lines.find(l => l.text.includes('RealTitle'));
    expect(realLine).toBeDefined();
    expect(realLine?.fenced).toBe(false);
  });

  it('should handle nested fences with different markers', () => {
    const content = `\`\`\`
Inside backticks
~~~
Nested tildes
~~~
\`\`\`

Outside all fences`;
    const lines = scanMarkdownLines(content);
    const nestedLine = lines.find(l => l.text.includes('Nested tildes'));
    expect(nestedLine?.fenced).toBe(true);

    const outsideLine = lines.find(l => l.text.includes('Outside all fences'));
    expect(outsideLine?.fenced).toBe(false);
  });

  it('should handle tilde fences', () => {
    const content = `~~~
### Requirement: TildeFake
~~~

### Requirement: Real`;
    const lines = scanMarkdownLines(content);
    const tildeFake = lines.find(l => l.text.includes('TildeFake'));
    expect(tildeFake?.fenced).toBe(true);

    const real = lines.find(l => l.text.includes('Real'));
    expect(real?.fenced).toBe(false);
  });

  it('should preserve line numbers', () => {
    const content = `Line 1
Line 2
Line 3`;
    const lines = scanMarkdownLines(content);
    expect(lines[0]?.lineNumber).toBe(1);
    expect(lines[1]?.lineNumber).toBe(2);
    expect(lines[2]?.lineNumber).toBe(3);
  });

  it('should handle empty content', () => {
    const lines = scanMarkdownLines('');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('');
    expect(lines[0]?.fenced).toBe(false);
  });
});
