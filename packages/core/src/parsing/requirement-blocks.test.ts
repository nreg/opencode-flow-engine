/**
 * Unit tests for parsing functions
 */

import { describe, it, expect } from 'bun:test';
import {
  normalizeRequirementName,
  extractRequirementsSection,
  parseRequirementBlocks,
  parseDeltaSpec,
  parseChangeMarkdown,
} from './requirement-blocks.js';

describe('Parsing Functions', () => {
  describe('normalizeRequirementName', () => {
    it('should trim whitespace', () => {
      expect(normalizeRequirementName('  User Login  ')).toBe('user login');
    });

    it('should convert to lowercase', () => {
      expect(normalizeRequirementName('USER LOGIN')).toBe('user login');
    });

    it('should handle empty string', () => {
      expect(normalizeRequirementName('')).toBe('');
    });
  });

  describe('extractRequirementsSection', () => {
    it('should extract requirements section', () => {
      const content = `
# Spec: User Authentication

## Overview

This spec defines authentication.

## Requirements

### Requirement: User Login

The system SHALL allow users to log in.

#### Scenario: Successful Login

**Given:** Valid credentials

**When:** User submits form

**Then:** User is authenticated

## Design Decisions

Use JWT tokens.
      `;

      const result = extractRequirementsSection(content);
      expect(result).not.toBeNull();
      expect(result!.header).toBe('## Requirements');
      expect(result!.requirements).toHaveLength(1);
      expect(result!.requirements[0].name).toBe('User Login');
    });

    it('should return null if no requirements section', () => {
      const content = `
# Spec: User Authentication

## Overview

This spec defines authentication.

## Design Decisions

Use JWT tokens.
      `;

      const result = extractRequirementsSection(content);
      expect(result).toBeNull();
    });
  });

  describe('parseRequirementBlocks', () => {
    it('should parse requirement blocks', () => {
      const content = `
### Requirement: User Login

The system SHALL allow users to log in.

#### Scenario: Successful Login

**Given:** Valid credentials

**When:** User submits form

**Then:** User is authenticated

### Requirement: User Logout

The system SHALL allow users to log out.

#### Scenario: Successful Logout

**Given:** Logged-in user

**When:** User clicks logout

**Then:** Session is destroyed
      `;

      const blocks = parseRequirementBlocks(content);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].name).toBe('User Login');
      expect(blocks[1].name).toBe('User Logout');
    });

    it('should handle empty content', () => {
      const blocks = parseRequirementBlocks('');
      expect(blocks).toHaveLength(0);
    });
  });

  describe('parseDeltaSpec', () => {
    it('should parse delta spec with all operation types', () => {
      const content = `
# Delta Spec: User Authentication

### ADDED: User Registration

The system SHALL allow users to register.

#### Scenario: Successful Registration

**Given:** New user

**When:** User submits registration form

**Then:** Account is created

### MODIFIED: User Login

Updated login requirements.

### REMOVED: Password Reset

### RENAMED: User Session -> User Token
      `;

      const plan = parseDeltaSpec(content);
      expect(plan.added).toHaveLength(1);
      expect(plan.added[0].name).toBe('User Registration');
      expect(plan.modified).toHaveLength(1);
      expect(plan.modified[0].name).toBe('User Login');
      expect(plan.removed).toHaveLength(1);
      expect(plan.removed[0]).toBe('Password Reset');
      expect(plan.renamed).toHaveLength(1);
      expect(plan.renamed[0].from).toBe('User Session');
      expect(plan.renamed[0].to).toBe('User Token');
    });

    it('should handle empty delta spec', () => {
      const plan = parseDeltaSpec('');
      expect(plan.added).toHaveLength(0);
      expect(plan.modified).toHaveLength(0);
      expect(plan.removed).toHaveLength(0);
      expect(plan.renamed).toHaveLength(0);
    });
  });

  describe('parseChangeMarkdown', () => {
    it('should parse change markdown', () => {
      const content = `
# Change: Add User Authentication

## Why

We need to add user authentication to protect sensitive data.

## What Changes

- **ADDED:** User Login — The system SHALL allow users to log in
- **MODIFIED:** User Session — Updated session management
- **REMOVED:** Password Reset — No longer needed
- **RENAMED:** User Token -> User Auth Token
      `;

      const result = parseChangeMarkdown(content);
      expect(result.why).toContain('We need to add user authentication');
      expect(result.whatChanges).toContain('ADDED');
      expect(result.deltas).toHaveLength(4);
      expect(result.deltas[0].type).toBe('ADDED');
      expect(result.deltas[1].type).toBe('MODIFIED');
      expect(result.deltas[2].type).toBe('REMOVED');
      expect(result.deltas[3].type).toBe('RENAMED');
    });

    it('should handle empty change markdown', () => {
      const result = parseChangeMarkdown('');
      expect(result.why).toBe('');
      expect(result.whatChanges).toBe('');
      expect(result.deltas).toHaveLength(0);
    });
  });
});
