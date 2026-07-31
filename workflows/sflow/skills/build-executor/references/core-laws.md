# Core Laws

## Law 1: Contract First

Do not treat chat history as the source of truth once implementation begins.

The execution contract is the approved handoff artifact.

## Law 2: No Production Code Without a Failing Test First (TDD Iron Law)

See `references/tdd-discipline.md` for the complete TDD discipline.

## Law 3: Review Before Drift

Use review gates between meaningful execution batches.

Block progress on:

- logic defects
- spec violations
- missing required tests
- unintended scope expansion

## Law 4: Rewind on Contract Break

Return to `specifying` or `bridging` if:

- new behavior appears
- interfaces change materially
- design assumptions fail
- the current artifacts no longer define the intended implementation
