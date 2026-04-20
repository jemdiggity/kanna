# Real E2E Trust Prompt Nudge Design

## Goal

Allow real PTY-based desktop E2E tests to progress past agent CLI trust-folder prompts by sending a single follow-up `Enter` after task launch.

## Problem

The real desktop E2E suite creates PTY tasks through the normal application flow. Some agent CLIs prompt to trust the current folder before doing useful work. When that happens, the real test can create the task successfully but the agent never performs the requested file or terminal work.

This is currently visible in the real diff test: the task is created, but the expected file change never appears, leaving the git diff empty.

## Recommended Approach

Add a small real-E2E helper that sends one bare `Enter` to the selected PTY task session after a short delay once the terminal is mounted.

This should be used only by real PTY agent specs that need the agent to start acting immediately after task creation.

## Alternatives Considered

### 1. Prompt-text detection before sending input

Wait for specific terminal text that looks like a trust prompt, then send `Enter`.

Pros:

- more selective

Cons:

- brittle across providers, versions, and terminal rendering differences
- xterm text capture is not a stable source of truth for prompt wording

### 2. Global runner-level automatic Enter injection

Teach the real E2E runner to send `Enter` for every real PTY task launch.

Pros:

- centralized

Cons:

- too implicit
- touches tests that may not want unsolicited input
- wrong boundary because it hides per-test agent interaction policy inside the runner

### 3. Recommended: explicit helper used by affected real PTY specs

Add a helper in the E2E test layer and call it from the tests that need it.

Pros:

- minimal
- explicit
- provider-agnostic
- keeps policy in the test layer

Cons:

- uses a short time-based delay

## Behavior Contract

The helper will:

1. wait until the agent terminal container is visible
2. wait a short fixed delay
3. resolve the currently selected task id from `window.__KANNA_E2E__.setupState`
4. invoke the normal Tauri `send_input` command for that session with a single carriage return

The helper sends exactly one nudge. It does not retry, loop, or inspect prompt wording.

## Boundaries

### New helper

Expected file:

- `apps/desktop/tests/e2e/helpers/agentTrustPrompt.ts`

Responsibility:

- encapsulate the delayed `Enter` nudge for real PTY agent sessions

### Tests that use it

Initial consumers:

- `apps/desktop/tests/e2e/real/claude-session.test.ts`
- `apps/desktop/tests/e2e/real/diff-after-claude.test.ts`

These tests already create PTY tasks and wait for agent output. They are the correct first users of the helper.

## Data Flow

The helper should use existing E2E facilities:

- `WebDriverClient.waitForElement(".terminal-container")`
- `WebDriverClient.executeSync(...)` to read selected task/session state if needed
- `tauriInvoke(client, "send_input", { sessionId, data })` or the equivalent existing Tauri path

The helper must not add new product code paths or production-only behavior.

## Timing

The initial delay should be short and fixed, on the order of `1500ms` to `2500ms`.

The purpose of the delay is:

- let the task session spawn
- let the trust prompt appear
- avoid sending input before the PTY exists

The initial implementation should prefer simplicity over adaptive timing.

## Non-Goals

This change does not:

- detect or parse trust prompts semantically
- add provider-specific trust suppression flags
- modify app runtime behavior outside tests
- add retry logic for broader agent interaction problems

## Risks

### Input arrives too early

If the helper sends `Enter` before the PTY is ready, it may do nothing.

Mitigation:

- wait for the terminal container first
- include the fixed delay before sending input

### Input arrives when no prompt is present

If the agent is already past startup, the extra `Enter` may be interpreted as an empty input.

Mitigation:

- call the helper only in tests where the startup trust prompt is expected enough to justify it
- keep it to a single nudge, not repeated input

### Selected task/session lookup drifts

If the helper assumes the wrong selected task, it could send input to the wrong session.

Mitigation:

- use the currently selected task immediately after task creation in tests that do not switch selection

## Success Criteria

The change is successful when:

- the real PTY tests can progress past folder trust prompts without manual intervention
- the helper is contained to the E2E test layer
- `claude-session.test.ts` still passes
- `diff-after-claude.test.ts` advances past the trust-prompt stall and reaches its next meaningful assertion
