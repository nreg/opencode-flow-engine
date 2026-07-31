# DP-2: Artifact Review Gate (Blind Reader Mechanism)

Before handing off to `contract-builder`, present a summary of all artifacts to the user for review. Do not assume the artifacts are correct just because validation passed — the user is the domain expert.

## Blind Reader Review Process

1. **Summarize each artifact** in 2-3 sentences:
   - `proposal.md`: what problem, what changes, scope boundaries
   - `specs/`: key requirements and scenarios
   - `ui-design.md` (frontend): visual direction, design tokens
   - `design.md`: architecture decisions and trade-offs
   - `tasks.md`: batch breakdown and dependency chain

2. **Ask the user** if anything needs adjustment before the contract is generated.

3. **Record DP-2** after user approval in `.flow-engine/sflow/state.json`:

```json
{
  "dp_2_result": "approved: <one-line summary>",
  "dp_2_timestamp": "<ISO-8601 timestamp>"
}
```

If the user requests changes, make them and re-present. Do not hand off until DP-2 is recorded.

## Why Blind Reader?

The DP-2 gate is called "blind reader" because:
- The spec-writer agent cannot see the actual implementation context
- Only the user (domain expert) can validate if the artifacts make sense for their specific project
- This prevents the agent from making assumptions that don't match reality
- It's a safety check before irreversible work begins

The blind reader mechanism ensures that planning artifacts are grounded in real project constraints, not just theoretical correctness.
