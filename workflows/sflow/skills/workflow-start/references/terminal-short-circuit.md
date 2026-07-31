# Terminal-State Short Circuit

Terminal states (`closing`, `abandoned`) block recovery scanning and state transitions.

## Rules

- Do not allow any state transitions FROM `abandoned` — it is a terminal state.
- Do not allow transition to `abandoned` from `closing` or `abandoned` — these are already terminal.
- Do not auto-abandon without user confirmation — even if bug-investigator recommends it.
- When transitioning to `abandoned`, prompt for abandonment summary generation before confirming.
- Do not merge delta specs from an abandoned change — spec-merger must block this.

## Routing to Abandonment

Route to `abandonment` when:

- the user explicitly requests to abandon the change
- bug-investigator has escalated after 3+ consecutive fix failures AND the user chooses to abandon
- scope change during specifying makes the change no longer worthwhile AND the user confirms abandonment
- the current state is NOT `closing` or `abandoned` (terminal states block abandonment transition)
