# Severity Levels

Three severity levels for review issues:

| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Bugs, security issues, data loss risks, broken functionality | Fix immediately before anything else |
| IMPORTANT | Architecture problems, missing features, poor error handling, test gaps | Fix before proceeding to next batch |
| MINOR | Code style, optimization opportunities, documentation polish | Note and fix when convenient |

## Action Priority

1. CRITICAL issues — stop everything, fix immediately
2. IMPORTANT issues — fix before moving to next batch/task
3. MINOR issues — note for later, fix opportunistically

## Severity Assignment Guidelines

Assign CRITICAL when:
- Bug that breaks functionality
- Security vulnerability
- Data loss or corruption risk
- Breaking change without migration path
- Test failure in CI
- Type error in production code

Assign IMPORTANT when:
- Missing required feature from spec
- Architecture violation
- Poor error handling
- Missing test coverage for critical path
- Performance degradation
- Accessibility violation

Assign MINOR when:
- Code style inconsistency
- Minor optimization opportunity
- Documentation improvement
- Naming could be clearer
- Dead code (not breaking anything)
