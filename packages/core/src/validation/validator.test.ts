/**
 * Unit tests for Validator
 * Updated to match spec-superflow-aligned Validator API
 */

import { describe, it, expect } from 'bun:test';
import { Validator } from './validator.js';

describe('Validator', () => {
  const validator = new Validator();

  describe('validateProposal / validateChangeContent', () => {
    it('should pass for valid proposal', () => {
      const content = `
# Proposal: Add User Authentication

## Why

We need to add user authentication to protect sensitive data and ensure only authorized users can access the system. This is a critical security requirement for our application.

## What Changes

- Add login/logout functionality
- Implement JWT token-based authentication
- Add user session management
- Create protected routes
`;

      const report = validator.validateProposal(content);
      expect(report.valid).toBe(true);
      expect(report.issues.filter(i => i.level === 'ERROR')).toHaveLength(0);
    });

    it('should fail for missing Why section', () => {
      const content = `
# Proposal: Add User Authentication

## What Changes

- Add login/logout functionality
`;

      const report = validator.validateProposal(content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('Why'))).toBe(true);
    });

    it('should fail for Why section too short', () => {
      const content = `
# Proposal: Add User Authentication

## Why

Short.

## What Changes

- Add login/logout functionality
`;

      const report = validator.validateProposal(content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('at least 50'))).toBe(true);
    });

    it('should fail for missing What Changes section', () => {
      const content = `
# Proposal: Add User Authentication

## Why

We need to add user authentication to protect sensitive data and ensure only authorized users can access the system. This is a critical security requirement for our application.
`;

      const report = validator.validateProposal(content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('What Changes'))).toBe(true);
    });

    it('should fail for empty What Changes section', () => {
      const content = `
# Proposal: Add User Authentication

## Why

We need to add user authentication to protect sensitive data and ensure only authorized users can access the system. This is a critical security requirement for our application.

## What Changes

`;

      const report = validator.validateProposal(content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('cannot be empty'))).toBe(true);
    });

    it('should include structured summary', () => {
      const content = `
# Proposal: Add User Authentication

## Why

Short.

## What Changes
`;
      const report = validator.validateProposal(content);
      expect(report.summary).toBeDefined();
      expect(typeof report.summary.errors).toBe('number');
      expect(typeof report.summary.warnings).toBe('number');
      expect(typeof report.summary.info).toBe('number');
    });
  });

  describe('validateSpecContent', () => {
    it('should pass for valid spec with block-level validation', () => {
      const content = `
# Spec: User Authentication

## Purpose

This spec defines the user authentication requirements for the system.

## Requirements

### Requirement: User Login

The system SHALL allow users to log in with email and password.

#### Scenario: Successful Login

**Given:** A registered user with valid credentials

**When:** The user submits login form

**Then:** The system authenticates the user
`;

      const report = validator.validateSpecContent('auth', content);
      expect(report.valid).toBe(true);
    });

    it('should fail for missing Purpose section', () => {
      const content = `
# Spec: User Authentication

## Requirements

### Requirement: User Login

The system SHALL allow users to log in.
`;

      const report = validator.validateSpecContent('auth', content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('Purpose'))).toBe(true);
    });

    it('should fail for missing requirements', () => {
      const content = `
# Spec: User Authentication

## Purpose

This spec defines the user authentication requirements.
`;

      const report = validator.validateSpecContent('auth', content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('at least one requirement'))).toBe(true);
    });

    it('should fail per-block for missing SHALL/MUST', () => {
      const content = `
# Spec: User Authentication

## Purpose

This spec defines the user authentication requirements.

## Requirements

### Requirement: User Login

Users can log in with email and password.

#### Scenario: Login

**When:** The user submits login form
`;

      const report = validator.validateSpecContent('auth', content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('SHALL or MUST'))).toBe(true);
    });

    it('should warn per-block for missing scenarios', () => {
      const content = `
# Spec: User Authentication

## Purpose

This spec defines the user authentication requirements.

## Requirements

### Requirement: User Login

The system SHALL allow users to log in with email and password.
`;

      const report = validator.validateSpecContent('auth', content);
      // Missing scenarios is a WARNING, not ERROR
      expect(report.issues.some(i => i.message.includes('scenario') && i.level === 'WARNING')).toBe(true);
    });

    it('should fail for empty spec name', () => {
      const content = `## Purpose\nTest\n\n## Requirements\n### Requirement: Test\nThe system SHALL work.`;
      const report = validator.validateSpecContent('', content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('name cannot be empty'))).toBe(true);
    });
  });

  describe('validateDeltaSpec', () => {
    it('should pass for valid delta spec', () => {
      const content = `
# Delta Spec: User Authentication

## ADDED Requirements

### Requirement: User Logout

The system SHALL allow users to log out.

#### Scenario: Successful Logout

**Given:** A logged-in user

**When:** The user clicks logout

**Then:** The system destroys the session
`;

      const report = validator.validateDeltaSpec(content, 'add-logout');
      expect(report.valid).toBe(true);
    });

    it('should fail for ADDED without requirement text', () => {
      const content = `
# Delta Spec: User Authentication

## ADDED Requirements

### Requirement: User Logout

#### Scenario: Logout

**When:** The user clicks logout
`;

      const report = validator.validateDeltaSpec(content, 'add-logout');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('missing requirement text'))).toBe(true);
    });

    it('should fail for ADDED without SHALL/MUST', () => {
      const content = `
# Delta Spec: User Authentication

## ADDED Requirements

### Requirement: User Logout

Users can log out from the system.

#### Scenario: Logout

**When:** The user clicks logout
`;

      const report = validator.validateDeltaSpec(content, 'add-logout');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('SHALL or MUST'))).toBe(true);
    });

    it('should detect cross-section conflicts (MODIFIED and REMOVED)', () => {
      const content = `
# Delta Spec: User Authentication

## MODIFIED Requirements

### Requirement: User Login

The system SHALL allow users to log in securely.

#### Scenario: Login

**When:** The user logs in

## REMOVED Requirements

### Requirement: User Login
`;

      const report = validator.validateDeltaSpec(content, 'conflict-change');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('both MODIFIED and REMOVED'))).toBe(true);
    });

    it('should detect duplicate requirements in ADDED', () => {
      const content = `
# Delta Spec: User Authentication

## ADDED Requirements

### Requirement: User Login

The system SHALL allow users to log in.

#### Scenario: Login

**When:** The user logs in

### Requirement: User Login

The system SHALL allow users to log in again.

#### Scenario: Login Again

**When:** The user logs in again
`;

      const report = validator.validateDeltaSpec(content, 'dup-change');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('Duplicate'))).toBe(true);
    });

    it('should detect RENAMED TO colliding with ADDED', () => {
      const content = `
# Delta Spec: User Authentication

## ADDED Requirements

### Requirement: New Auth

The system SHALL support new auth.

#### Scenario: Auth

**When:** Auth runs

## RENAMED Requirements

- FROM: ### Requirement: Old Auth
- TO: ### Requirement: New Auth
`;

      const report = validator.validateDeltaSpec(content, 'rename-collision');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('collides with ADDED'))).toBe(true);
    });

    it('should fail for no deltas', () => {
      const content = `# Delta Spec: Empty Change`;
      const report = validator.validateDeltaSpec(content, 'empty-change');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('at least one delta'))).toBe(true);
    });
  });

  describe('validateTasks', () => {
    it('should pass for valid tasks', () => {
      const content = `
# Tasks: Add User Authentication

## Task Batch 1: Core Authentication

- [ ] Task 1.1: Create authentication module — Module created with login/logout functions
- [ ] Task 1.2: Implement JWT tokens — Tokens generated and validated correctly
`;

      const report = validator.validateTasks(content);
      expect(report.valid).toBe(true);
    });

    it('should warn for no tasks', () => {
      const content = `# Tasks: Add User Authentication\n\nNo tasks defined yet.`;
      const report = validator.validateTasks(content);
      expect(report.valid).toBe(true);
      expect(report.issues.some(i => i.message.includes('No tasks found'))).toBe(true);
    });
  });

  describe('validateExecutionContract', () => {
    it('should pass for valid contract', () => {
      const content = `
# Execution Contract: Add User Authentication

## Intent Lock

Add user authentication to protect sensitive data.

## Approved Behavior

- Users can log in with email and password

## Design Constraints

- Use JWT tokens

## Task Batches

### Batch 1: Core Authentication

- Create authentication module

## Test Obligations

- Write failing test first
`;

      const report = validator.validateExecutionContract(content);
      expect(report.valid).toBe(true);
    });

    it('should fail for missing required sections', () => {
      const content = `
# Execution Contract: Add User Authentication

## Intent Lock

Add user authentication.

## Approved Behavior

- Users can log in
`;

      const report = validator.validateExecutionContract(content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('Design Constraints'))).toBe(true);
      expect(report.issues.some(i => i.message.includes('Task Batches'))).toBe(true);
    });
  });

  describe('validateImplementation', () => {
    it('should return PASS verdict for complete implementation', () => {
      const specContent = `
### Requirement: User Login
The system SHALL allow users to log in.
`;
      const designContent = `- Choice: JWT token authentication`;
      const diffSummary = `Added user login with JWT token authentication`;

      const report = validator.validateImplementation(diffSummary, specContent, designContent);
      expect(report.verdict).toBe('PASS');
    });

    it('should return FAIL verdict when requirements not covered', () => {
      const specContent = `
### Requirement: User Login
The system SHALL allow users to log in with multi-factor authentication.
`;
      const designContent = `- Choice: Simple password authentication`;
      const diffSummary = `Added simple password check`;

      const report = validator.validateImplementation(diffSummary, specContent, designContent);
      expect(report.verdict).not.toBe('PASS');
    });

    it('should detect placeholder markers', () => {
      const specContent = `### Requirement: Auth\nThe system SHALL authenticate users.`;
      const designContent = ``;
      const diffSummary = `Added TODO: implement authentication`;

      const report = validator.validateImplementation(diffSummary, specContent, designContent);
      expect(report.dimensions.some(d => d.name === 'Correctness' && d.status !== 'PASS')).toBe(true);
    });
  });

  describe('detectSyncConflicts', () => {
    it('should detect conflicts across multiple changes', () => {
      const delta1 = `
## MODIFIED Requirements

### Requirement: User Login

The system SHALL allow users to log in with email.

#### Scenario: Login

**When:** The user logs in
`;

      const delta2 = `
## MODIFIED Requirements

### Requirement: User Login

The system SHALL allow users to log in with phone.

#### Scenario: Login

**When:** The user logs in
`;

      const report = validator.detectSyncConflicts([
        { changeName: 'change-1', content: delta1 },
        { changeName: 'change-2', content: delta2 },
      ]);

      expect(report.hasConflicts).toBe(true);
      expect(report.conflicts.length).toBeGreaterThan(0);
    });

    it('should not report conflicts for independent changes', () => {
      const delta1 = `
## ADDED Requirements

### Requirement: User Login

The system SHALL allow users to log in.

#### Scenario: Login

**When:** The user logs in
`;

      const delta2 = `
## ADDED Requirements

### Requirement: User Logout

The system SHALL allow users to log out.

#### Scenario: Logout

**When:** The user logs out
`;

      const report = validator.detectSyncConflicts([
        { changeName: 'change-1', content: delta1 },
        { changeName: 'change-2', content: delta2 },
      ]);

      expect(report.hasConflicts).toBe(false);
    });
  });
});
