# Workflow Path Intake

## Required Inspection

Before routing, inspect the current change folder if it exists.

Look for:

- `proposal.md`
- `specs/`
- `design.md`
- `tasks.md`
- `execution-contract.md`

Then answer these questions in order:

1. Is the change still fuzzy?
2. Are planning artifacts missing or unstable?
3. Does a bridge contract exist?
4. Has the user explicitly approved the contract for build work?
5. Is execution in progress or blocked by a bug?
6. Is the change already in verification or wrap-up?

## Update Check Reminder

Before doing anything else, check for plugin updates:

```bash
npm view opencode-sflow version
```

### How to surface the result

- If a newer version exists → prepend a non-blocking upgrade reminder to your response, then continue normally:
  > A new version of sflow is available. Upgrade with `npm install -g opencode-sflow@latest`.
- If already up to date → silently skip.

Do not block workflow progress on an available upgrade; simply inform the user.
