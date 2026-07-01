---
name: code-reviewer
description: Review code quality and spec compliance. Invoke when an execution batch has been completed.
---

# Code Reviewer

This skill reviews code quality and spec compliance.

## Use This Skill When

Invoke this skill when:

- an execution batch has been completed
- the build-executor has finished a group of related tasks
- a full batch is ready for spec-compliance and code-quality verification
- the user asks for a review checkpoint

## Review Process

### 1. Spec Compliance Check
- Compare implementation against specs/
- Verify all requirements are met
- Check for spec violations

### 2. Code Quality Review
- Check for code smells
- Verify naming conventions
- Review function complexity
- Check for proper error handling

### 3. Test Coverage Analysis
- Verify test coverage for new code
- Check for missing test cases
- Review test quality

### 4. Security Review
- Check for common vulnerabilities
- Review input validation
- Check for proper authentication/authorization

## Review Output

### Critical Issues
- Must be fixed before proceeding
- Spec violations
- Security vulnerabilities
- Breaking changes

### Important Issues
- Should be fixed
- Code quality concerns
- Missing tests
- Performance issues

### Minor Issues
- Nice to have
- Style improvements
- Documentation gaps

## Gate Rules

Block progress on:
- Logic defects
- Spec violations
- Missing required tests
- Unintended scope expansion

## Guardrails

- Do NOT approve code with critical issues
- Do NOT skip spec compliance check
- Do NOT ignore security concerns
- Do NOT approve without test coverage
