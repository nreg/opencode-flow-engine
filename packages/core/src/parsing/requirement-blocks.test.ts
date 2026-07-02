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
    expect(match?.[1]).toBe('User Login');
  });

  it('should be case-insensitive', () => {
    const line = '### requirement: User Login';
    const match = line.match(REQUIREMENT_HEADER_REGEX);
    expect(match).not.toBeNull();
  });
});
