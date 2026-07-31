# DP-0: User Confirmation Gate (Design-Preparation)

Before routing to `spec-writer` for a new or incomplete change, confirm key decisions with the user. Do not generate planning artifacts until this gate is passed.

## When to run DP-0

Run DP-0 when **all** of the following are true:
- The change folder does not exist, OR
- Planning artifacts (`proposal.md`, `specs/`, `design.md`, `tasks.md`) are missing or empty, OR
- `.flow-engine/sflow/state.json` does not contain `dp_0_confirmed: true`.

If `dp_0_confirmed` is `true`, skip this gate and proceed with normal state detection.

## Required Questions

Ask the user at least these questions. Record the answers in `.flow-engine/sflow/state.json`.

1. **Scope**: What is the change name and one-sentence intent?
2. **Constraints**: Are there known constraints (naming style, compatibility policy, platforms affected)?
3. **Related optimizations**: Should this change include related optimizations or stay focused?
4. **Communication preference**: Do you prefer to be asked before each design decision, or receive a draft for review?

## Recording DP-0

After the user confirms, update `.flow-engine/sflow/state.json`:

```json
{
  "dp_0_decisions": "<summary>",
  "dp_0_confirmed": true,
  "dp_0_timestamp": "<ISO-8601 timestamp>"
}
```

Then proceed to normal state detection and routing.

## Config-Aware Routing

Before routing, check project configuration in `.flow-engine/sflow/config.json` (if it exists):
- If `artifacts.order` is specified, follow it when checking artifact completeness
- If `artifacts.skip` is specified, do not require those artifacts for state transitions
