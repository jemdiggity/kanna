# Repo-Wide E2E Coverage Policy

## Goal

Establish a repo-wide testing guideline that pushes behavior-level confidence upward without requiring low-value E2E coverage for isolated logic.

The policy should make it clear that E2E tests are expected when a behavior depends on real wiring across boundaries, while still allowing unit and integration tests to carry pure logic and isolated rendering.

## Policy

Any behavior that crosses component or system boundaries should add or update at least one E2E test.

This applies when a behavior depends on real integration between parts of the system, including:

- UI flows, navigation, and interactive user journeys
- frontend or mobile client interactions with server or backend APIs
- daemon, PTY, process, filesystem, git, or network behavior
- persistence, reload, reconnect, or recovery behavior
- asynchronous coordination where isolated tests do not prove the real wiring

This does not require E2E coverage for:

- pure computation
- formatting or parsing logic
- isolated presentational changes with no meaningful interaction change
- small internal refactors that do not change observable behavior

## Expected Engineering Behavior

When a change introduces or modifies cross-boundary behavior, the author should:

1. Add a new E2E test for the behavior, or
2. Update an existing E2E test so the changed behavior is exercised

Unit and integration tests should still be added where they provide fast, precise coverage, but they do not replace E2E coverage when the risk is in the wiring between systems.

## Exceptions

If a behavior should have E2E coverage but cannot reasonably get it yet, the change should explicitly document:

- why the behavior is not currently testable end to end
- what infrastructure or product changes would be needed to make it testable
- what narrower tests were added in the meantime

This keeps exceptions visible and makes “not testable yet” a temporary engineering gap rather than an invisible omission.

## Placement

The policy should be added to `AGENTS.md` in the `## Testing` section as a repo-wide engineering rule.

It should be phrased as a default expectation:

- behavior crossing boundaries should have E2E coverage
- unit and integration tests remain important
- exceptions must be explained explicitly

## Scope

This policy is forward-looking. It applies to new behavior changes and behavior modifications going forward.

It does not require retroactively adding E2E coverage for the entire existing codebase before unrelated work can land.

## Verification Impact

This policy should change review and implementation behavior in a few concrete ways:

- PRs that change cross-boundary behavior should be expected to include E2E updates
- missing E2E coverage for those behaviors should be treated as a testing gap
- reviewers should ask for either the E2E test or an explicit exception note

## Implementation Note

The first implementation step after spec approval is to add this policy to `AGENTS.md`.
