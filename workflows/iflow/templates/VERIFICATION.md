---
phase: {{phase_name}}
verified: {{verified_timestamp}}
status: {{status}}  # passed | gaps_found | human_needed
score: {{verified_count}}/{{total_count}} must-haves verified
overrides_applied: {{override_count}}
overrides:
  - must_have: "{{must_have_text}}"
    reason: "{{override_reason}}"
    accepted_by: "{{accepted_by}}"
    accepted_at: "{{accepted_timestamp}}"
re_verification:
  previous_status: {{previous_status}}
  previous_score: {{previous_verified_count}}/{{previous_total_count}}
  gaps_closed:
    - "{{closed_gap}}"
  gaps_remaining: []
  regressions: []
gaps:
  - truth: "{{failed_truth}}"
    status: failed
    reason: "{{failure_reason}}"
    artifacts:
      - path: "{{file_path}}"
        issue: "{{issue_description}}"
    missing:
      - "{{specific_fix}}"
deferred:
  - truth: "{{deferred_truth}}"
    addressed_in: "{{phase_name}}"
    evidence: "{{matching_evidence}}"
human_verification:
  - test: "{{test_description}}"
    expected: "{{expected_behavior}}"
    why_human: "{{human_verification_reason}}"
---

# Verification: {{phase_name}}

**Phase Goal**: {{goal_description}}
**Verified**: {{verified_timestamp}}
**Status**: {{status}}

## Goal Achievement — Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | {{truth_description}} | {{VERIFIED/FAILED}} | {{evidence}} |

Score: {{verified_count}}/{{total_count}} truths verified.

## Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | {{deferred_item}} | {{addressed_in_phase}} | {{deferred_evidence}} |

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| {{file_path}} | {{purpose}} | {{EXISTS/STUB/MISSING}} | {{details}} |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| {{source}} | {{target}} | {{mechanism}} | {{WIRED/PARTIAL/NOT_WIRED}} | {{details}} |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| {{file_path}} | {{variable}} | {{source}} | {{yes/no}} | {{FLOWING/STATIC/DISCONNECTED}} |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| {{behavior}} | {{command}} | {{result}} | {{PASS/FAIL/SKIP}} |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| {{requirement}} | {{source_plan}} | {{description}} | {{COVERED/PARTIAL/MISSING}} | {{evidence}} |

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| {{file_path}} | {{line}} | {{pattern}} | {{BLOCKER/WARNING/INFO}} | {{impact}} |

## Human Verification Required

- **Test**: {{test_description}}
  **Expected**: {{expected_behavior}}
  **Why Human**: {{reason}}

## Gaps Summary

{{narrative_of_whats_missing}}

---

_Verified: {{verified_timestamp}}_
_Verifier: OpenCode (iflow-verifier)_
