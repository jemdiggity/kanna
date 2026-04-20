# Real E2E Provider-Neutral Suite Design

## Goal

Make the default desktop `real/` E2E suite honest and stable by treating it as provider-neutral app-wiring coverage, while standardizing its current execution backend on `codex`.

## Problem

The current real desktop E2E suite runs through a real provider, but some filenames and test descriptions still imply Claude-specific behavior. That is no longer correct in this environment:

- Claude can launch, but it does not perform task work because it stops at login.
- The real E2E harness already defaults to `codex` with `gpt-5.4-mini`.
- Tests named around Claude semantics are now misleading even when the underlying app wiring being tested is still valid.

Leaving the suite as-is creates two problems:

1. the suite names misrepresent what is actually being exercised
2. future failures are harder to interpret because provider choice and product behavior are conflated

## Design Principles

### 1. Name tests by product behavior, not by the temporary provider choice

The default `real/` suite should describe behaviors such as:

- a PTY task is created
- terminal output appears
- a worktree diff can be observed after agent work

It should not describe those behaviors as Claude-specific when the default harness does not use Claude.

### 2. Keep one real provider for the default suite

A real E2E test needs a real provider to do meaningful work. For now, the default provider is `codex`.

That provider choice is test infrastructure, not the user-visible meaning of the suite.

### 3. Keep provider-specific behavior out of the default suite

The default `real/` suite is for end-to-end app wiring through one working provider backend.

Provider-specific behavior, such as:

- Claude login prompts
- Copilot-specific trust flows
- provider-specific output formats or quirks

should not be encoded into the default suite names or assertions.

## Recommended Structure

### Default suite semantics

The default `apps/desktop/tests/e2e/real/` suite should mean:

"These are real desktop end-to-end tests that exercise Kanna's PTY task flow against a real agent backend, currently `codex`."

This keeps the suite useful today while preserving a clean path for future expansion.

### Harness behavior

The real E2E harness continues to inject:

- provider: `codex`
- model: `gpt-5.4-mini`

This remains the default until another provider is intentionally added to the matrix.

The harness-level override stays the source of test policy for the default suite.

### Test naming

Files and test titles in `apps/desktop/tests/e2e/real/` should be renamed to describe provider-neutral behavior.

Examples:

- `claude-session.test.ts` should become something like `pty-session.test.ts`
- `diff-after-claude.test.ts` should become something like `diff-after-agent-run.test.ts`

The exact names should reflect the behavior under test, not the current provider implementation.

## Assertions

The default real suite should assert only provider-neutral outcomes, such as:

- the task record is created
- the terminal attaches and renders output
- agent work produces an observable repository change
- the diff view can display the resulting change

The suite should not assert:

- Claude-specific copy
- Claude-specific auth states
- Claude-specific prompt or idle semantics

If a helper is needed to get past generic startup interaction such as trust-folder prompts, that helper belongs in the E2E test layer and must remain provider-neutral in naming and behavior where possible.

## Future Expansion

When provider-specific coverage is needed later, it should be added as explicitly named opt-in suites or files, for example:

- `real/providers/claude-login.test.ts`
- `real/providers/copilot-trust-prompt.test.ts`

Those tests should be honest about their dependency and should not be part of the default provider-neutral real suite unless the environment guarantees they are runnable and meaningful.

## Implementation Boundaries

### `apps/desktop/tests/e2e/run.ts`

Responsibility:

- continue choosing the default real provider via environment injection
- keep that policy centralized

This file does not make the tests provider-specific in meaning. It only decides which backend powers the default real run.

### `apps/desktop/tests/e2e/real/*`

Responsibility:

- express provider-neutral product behaviors
- avoid provider-branded filenames and test titles unless the behavior is truly provider-specific

### E2E helpers

Responsibility:

- encapsulate generic launch and PTY interaction behavior needed by real tests
- remain named for the UI or session behavior they handle, not a specific provider, unless that coupling is real and intentional

## Non-Goals

This change does not:

- add multi-provider matrix testing to the default suite
- make Claude behavior meaningful without Claude authentication
- remove the existing `codex` test override
- solve provider-specific quirks beyond keeping them out of the provider-neutral suite contract

## Risks

### Risk: the suite becomes accidentally Codex-branded again

If new tests are named after the current provider, the suite will drift back into misleading semantics.

Mitigation:

- keep naming guidelines explicit in the spec and plan
- review new default-real tests for provider-neutral naming

### Risk: provider-neutral names hide genuine provider-specific assumptions

A test may keep provider-neutral naming while still relying on a backend-specific behavior.

Mitigation:

- keep assertions focused on product outcomes
- move truly provider-specific expectations into separately named coverage

### Risk: existing failures remain after renaming

Renaming and semantic cleanup will not automatically fix underlying real-E2E behavior bugs.

Mitigation:

- treat suite cleanup and behavior debugging as separate concerns
- after renaming, continue debugging remaining failures on their actual product behavior

## Acceptance Criteria

The design is satisfied when:

- the default `real/` suite is named and described as provider-neutral product coverage
- the default real harness still runs on `codex` with `gpt-5.4-mini`
- default real tests no longer refer to Claude unless the behavior is truly Claude-specific
- provider-specific behaviors are left for separately named future coverage rather than encoded into the default suite
