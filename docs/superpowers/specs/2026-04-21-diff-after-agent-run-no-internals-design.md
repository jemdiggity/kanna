# Diff After Agent Run Without App Internals Design

## Goal

Make `apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts` a real end-to-end test by removing app-internal control and inspection from the spec while still allowing direct filesystem and `git` checks from the test harness.

## Problem

The current `diff-after-agent-run` spec is only partially end to end. Task launch has already moved closer to the real user path, but the test still relies on app internals after launch:

- direct Vue state mutation to open the diff modal
- Tauri command invocation to check file existence
- Tauri command invocation to read git diff output
- helper behavior that writes directly to the PTY session via `send_input`

Those shortcuts make failures harder to interpret. A test that says it verifies the diff UI should interact with the UI like a user would, and it should verify repository state from outside the app rather than through app-owned inspection commands.

## Correct Boundary

For this spec:

- **Allowed:** WebDriver/browser interaction, visible DOM assertions, direct filesystem checks from the test runner, direct `git` commands from the test runner
- **Not allowed:** `queryDb`, `callVueMethod`, `tauriInvoke`, direct `window.__KANNA_E2E__` state mutation, Tauri commands such as `git_diff` or `file_exists`

This keeps the app under test as a black box while still allowing the harness to inspect the real worktree on disk.

## Recommended Approach

Keep the overall user journey the same:

1. import a real fixture repo
2. create a real task through the new-task modal UI
3. wait for the agent to do work
4. confirm externally that the worktree now contains the expected file or git change
5. open the diff through the real app shortcut/UI path
6. assert that the diff modal visibly shows the same change

The main change is how the spec observes and drives the system after task launch.

## UI Actions

### Task launch

The spec should continue using the visible new-task UI flow:

- `Shift+Cmd+N`
- enter prompt into the modal textarea
- cycle to the desired provider in the modal
- submit with `Cmd+Enter`

### Trust-folder handling

The trust-prompt helper must stop talking directly to the daemon session through `send_input`.

For this spec, trust handling should be performed through user-like keyboard input routed through the visible app surface, such as dispatching `Enter` key events against the active document or focused terminal path, not through Tauri `send_input`.

If that requires a dedicated helper, that helper should remain UI-driven and should not know about session IDs.

### Diff opening

The diff modal should be opened through the same user-facing mechanism the app exposes, for example `Cmd+D`, not by flipping `showDiffModal` directly.

## External State Checks

The spec may inspect the task worktree directly from the test runner process.

That means it can:

- read files on disk
- run `git diff`, `git status`, or similar commands
- poll for the appearance of `e2e-test-output.txt`

This is acceptable because it does not ask the app for privileged internal state; it verifies the actual repository on disk that the user cares about.

## Worktree Discovery

The current spec uses app internals to discover the created task’s branch/worktree. That must be replaced.

Recommended path:

- discover the newly created task worktree from the fixture repo’s `.kanna-worktrees/` directory using the known `task-*` naming convention
- compare the worktree directory listing before and after task creation
- once the new worktree appears, derive the task worktree path from the filesystem rather than the app

This avoids querying the app DB for branch IDs.

## Assertions

The spec should assert two separate things:

### 1. External repo truth

After waiting for the agent run:

- `e2e-test-output.txt` exists in the discovered task worktree
- optionally, its contents equal `E2E test content`
- `git diff` in that worktree contains the expected filename or patch content

### 2. Visible app behavior

After opening the diff UI through the real shortcut:

- the diff modal becomes visible
- the filename `e2e-test-output.txt` is visible in the diff UI
- ideally the changed text `E2E test content` is visible in the rendered diff

The second set of assertions should agree with the first.

## Scope

This design applies only to:

- `apps/desktop/tests/e2e/real/diff-after-agent-run.test.ts`

It does not require converting the rest of the real suite in this pass.

## Helper Boundaries

### Existing helpers that may remain

- fixture repo creation/cleanup
- WebDriver client
- generic startup overlay dismissal
- new-task modal UI launcher, provided it remains UI-driven

### Helpers that should be replaced or narrowed for this spec

- any trust helper that uses Tauri `send_input`
- any helper that opens the diff modal by mutating Vue state
- any helper or assertion path that queries app DB state to discover the task

### New helper candidates

A small harness-side helper is appropriate for:

- discovering the newly created worktree on disk
- polling for file creation in that worktree
- dispatching the diff keyboard shortcut through the browser document

These helpers should stay outside app internals.

## Alternatives Considered

### 1. Pure DOM-only with no harness-side filesystem checks

Pros:

- strongest black-box stance

Cons:

- hard to distinguish “agent did no work” from “UI failed to render it”
- weaker debugging signal

### 2. Keep Tauri/git/file commands because they are convenient

Pros:

- easiest migration from current spec

Cons:

- still relies on app-owned privileged commands
- violates the intended E2E boundary

### 3. Recommended: UI-driven app behavior plus harness-side filesystem/git inspection

Pros:

- clean app boundary
- strong debugging signal
- still proves the visible diff UI matches real repo state

Cons:

- a bit more harness code
- slower than internal shortcuts

## Risks

### Risk: worktree discovery races with setup scripts

The new worktree may appear before the agent is ready, while setup scripts such as `pnpm i` are still running.

Mitigation:

- separate “worktree appeared” from “expected file appeared”
- use bounded polling windows instead of one fixed sleep where practical

### Risk: trust prompt still blocks progress

Even with a proper worktree path, the agent may stall on a trust prompt before producing the file.

Mitigation:

- route trust handling through UI-like key input
- keep the external file-existence check as the source of truth for whether the run actually progressed

### Risk: diff UI assertions are too weak

If the test only checks that the diff modal opened, it does not prove the right change rendered.

Mitigation:

- assert visible filename and, where practical, visible changed content

## Acceptance Criteria

The design is satisfied when:

- `diff-after-agent-run.test.ts` no longer uses `queryDb`, `callVueMethod`, `tauriInvoke`, or direct Vue state mutation
- the test discovers and inspects the task worktree from the filesystem or `git` directly
- the diff modal is opened through the real UI shortcut path
- the test proves that visible diff UI content matches the actual on-disk worktree change
