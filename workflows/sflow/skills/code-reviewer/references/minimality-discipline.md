# Minimality Discipline

The code reviewer enforces minimality to prevent over-engineering and maintain codebase health.

## Five Core Rules

### 1. No Over-Design

Reject implementations that solve problems that don't exist yet.

```
IF feature is not in spec AND not requested by user:
  → BLOCK with "Not in scope. Remove or get user approval first."
```

Examples of over-design:
- Adding configuration options nobody asked for
- Implementing "flexible" abstractions for a single use case
- Building extensibility hooks with no concrete use case
- Premature optimization

### 2. No Compatibility Shims

Reject backward compatibility code for versions/platforms not in scope.

```
IF compatibility code exists for out-of-scope target:
  → BLOCK with "Target [X] not in scope. Remove compatibility shim."
```

Check scope in:
- execution-contract.md → target platforms/versions
- design.md → compatibility requirements
- User's explicit requirements

### 3. No Unnecessary Abstractions

Reject abstractions that don't earn their complexity cost.

```
IF abstraction has only 1 implementation AND no spec requirement for multiple:
  → BLOCK with "Single-implementation abstraction. Inline it."
```

Abstraction cost:
- Mental overhead (developers must understand the abstraction)
- Indirection (harder to trace execution)
- Maintenance burden (more code to keep in sync)

Abstraction earns its cost when:
- Multiple implementations exist or are spec'd
- Clear interface boundary needed (e.g., plugin system)
- Testing requires mocking

### 4. No Unnecessary Configuration

Reject configuration options that could be hardcoded.

```
IF config option has only one reasonable value in practice:
  → BLOCK with "Config [X] always [Y]. Hardcode it."
```

Configuration is necessary when:
- Different environments need different values (dev/staging/prod)
- User customization is a documented feature
- A/B testing or gradual rollout

Configuration is unnecessary when:
- Only one value makes sense
- "Flexibility" that nobody will use
- Config value is effectively constant

### 5. Reviewer Safeguard / BLOCKED

The reviewer must actively BLOCK non-minimal implementations, not just suggest.

```
IF implementation violates minimality rules:
  → Do NOT approve with "Consider simplifying..."
  → BLOCK with specific rule violation and required fix
```

Blocking language:
- "BLOCKED: Violates rule [N]. [Explanation]. Required fix: [Action]."
- Do not proceed until fixed
- Do not downgrade to WARNING

## Minimality Checklist

Before approving, verify:

- [ ] Every feature is in spec or explicitly requested
- [ ] No speculative "might need later" code
- [ ] Compatibility code only for in-scope targets
- [ ] Abstractions have ≥2 implementations or spec requirement
- [ ] Config options have actual use cases
- [ ] No unused parameters, exports, or dead code
- [ ] No redundant defensive coding (e.g., null checks where null is impossible)

## Pushback Against "Professional" Suggestions

Reviewers may suggest "more professional" implementations. Apply YAGNI check:

```
IF reviewer suggests "implement properly" or "make it production-ready":
  1. grep codebase for actual usage
  2. IF unused: "This isn't called anywhere. Remove it (YAGNI)?"
  3. IF used: Then consider the suggestion
```

Common "professional" over-engineering:
- "We should have a proper abstraction layer" (for one implementation)
- "Let's make this configurable" (for one use case)
- "Add error handling for all edge cases" (for impossible edge cases)
- "Build for extensibility" (with no extension points spec'd)

## Relation to Spec Compliance

Minimality complements spec compliance:

- Spec compliance: "Did we build what was spec'd?"
- Minimality: "Did we build ONLY what was spec'd?"

Both must pass:
- Missing spec'd feature → IMPORTANT (not minimality, just incomplete)
- Extra non-spec'd feature → BLOCKED (minimality violation)
