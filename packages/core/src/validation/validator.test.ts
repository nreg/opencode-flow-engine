/**
 * Unit tests for Validator
 */

import { describe, it, expect } from 'bun:test';
import { Validator } from './validator.js';

describe('Validator', () => {
  const validator = new Validator();

  describe('validateProposal', () => {
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

## Scope

- Authentication module
- User management
- Route protection
      `;

      const report = validator.validateProposal(content);
      expect(report.valid).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    it('should fail for missing Why section', () => {
      const content = `
# Proposal: Add User Authentication

## What Changes

- Add login/logout functionality
      `;

      const report = validator.validateProposal(content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('Missing ## Why section'))).toBe(true);
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
      expect(report.issues.some(i => i.message.includes('Why section must be at least'))).toBe(true);
    });

    it('should fail for missing What Changes section', () => {
      const content = `
# Proposal: Add User Authentication

## Why

We need to add user authentication to protect sensitive data and ensure only authorized users can access the system. This is a critical security requirement for our application.
      `;

      const report = validator.validateProposal(content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('Missing ## What Changes section'))).toBe(true);
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
      expect(report.issues.some(i => i.message.includes('What Changes section cannot be empty'))).toBe(true);
    });
  });

  describe('validateSpec', () => {
    it('should pass for valid spec', () => {
      const content = `
# Spec: User Authentication

## Overview

This spec defines the user authentication requirements.

## Requirements

### Requirement: User Login

The system SHALL allow users to log in with email and password.

#### Scenario: Successful Login

**Given:** A registered user with valid credentials

**When:** The user submits login form

**Then:** The system authenticates the user and creates a session

#### Scenario: Failed Login

**Given:** A user with invalid credentials

**When:** The user submits login form

**Then:** The system rejects the login and shows error message
      `;

      const report = validator.validateSpec(content, 'auth');
      expect(report.valid).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    it('should fail for missing requirements', () => {
      const content = `
# Spec: User Authentication

## Overview

This spec defines the user authentication requirements.

## Requirements

No requirements defined here.
      `;

      const report = validator.validateSpec(content, 'auth');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('No requirements found'))).toBe(true);
    });

    it('should fail for requirements without scenarios', () => {
      const content = `
# Spec: User Authentication

## Overview

This spec defines the user authentication requirements.

## Requirements

### Requirement: User Login

The system SHALL allow users to log in with email and password.
      `;

      const report = validator.validateSpec(content, 'auth');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('must have at least one scenario'))).toBe(true);
    });
  });

  describe('validateDeltaSpec', () => {
    it('should pass for valid delta spec', () => {
      const content = `
# Delta Spec: User Authentication

## ADDED: User Logout

The system SHALL allow users to log out.

#### Scenario: Successful Logout

**Given:** A logged-in user

**When:** The user clicks logout

**Then:** The system destroys the session
      `;

      const report = validator.validateDeltaSpec(content, 'add-logout');
      expect(report.valid).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    it('should fail for ADDED without text', () => {
      const content = `
# Delta Spec: User Authentication

## ADDED: User Logout
      `;

      const report = validator.validateDeltaSpec(content, 'add-logout');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('ADDED operation must have requirement text'))).toBe(true);
    });

    it('should fail for ADDED without scenario', () => {
      const content = `
# Delta Spec: User Authentication

## ADDED: User Logout

The system SHALL allow users to log out.
      `;

      const report = validator.validateDeltaSpec(content, 'add-logout');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('ADDED operation must have at least one scenario'))).toBe(true);
    });

    it('should detect cross-section conflicts', () => {
      const content = `
# Delta Spec: User Authentication

## MODIFIED: User Login

Updated login requirements.

## REMOVED: User Login
      `;

      const report = validator.validateDeltaSpec(content, 'conflict-change');
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('Cross-section conflict'))).toBe(true);
    });
  });

  describe('validateTasks', () => {
    it('should pass for valid tasks', () => {
      const content = `
# Tasks: Add User Authentication

## Task Batch 1: Core Authentication

- [ ] Task 1.1: Create authentication module — Module created with login/logout functions
- [ ] Task 1.2: Implement JWT tokens — Tokens generated and validated correctly
- [ ] Task 1.3: Add session management — Sessions created and destroyed properly
      `;

      const report = validator.validateTasks(content);
      expect(report.valid).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    it('should warn for no tasks', () => {
      const content = `
# Tasks: Add User Authentication

No tasks defined yet.
      `;

      const report = validator.validateTasks(content);
      expect(report.valid).toBe(true); // Warning only
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
- Users can log out
- Sessions are managed securely

## Design Constraints

- Use JWT tokens
- Follow security best practices
- Support multiple authentication methods

## Task Batches

### Batch 1: Core Authentication
- Create authentication module
- Implement JWT tokens
- Add session management

## Test Obligations

### TDD Requirements

- **RED**: Write failing test first
- **GREEN**: Write minimal implementation
- **REFACTOR**: Clean up code

### Review Gates

- After each batch completion
      `;

      const report = validator.validateExecutionContract(content);
      expect(report.valid).toBe(true);
      expect(report.issues).toHaveLength(0);
    });

    it('should fail for missing required sections', () => {
      const content = `
# Execution Contract: Add User Authentication

## Intent Lock

Add user authentication to protect sensitive data.

## Approved Behavior

- Users can log in with email and password
      `;

      const report = validator.validateExecutionContract(content);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.message.includes('Missing required section: Design Constraints'))).toBe(true);
      expect(report.issues.some(i => i.message.includes('Missing required section: Task Batches'))).toBe(true);
    });
  });
});
