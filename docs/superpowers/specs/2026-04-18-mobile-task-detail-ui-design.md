# Mobile Task Detail UI Design

## Goal

Refine the mobile task workspace in `apps/mobile` so opening a task feels like entering a focused Slack-style detail screen rather than staying inside the same tab shell. The task view should become terminal-first, remove persistent chrome that does not help the steady state, and keep task-scoped actions available without turning the screen back into a dashboard.

## Scope

This slice is limited to the existing Expo/React Native app in `apps/mobile`.

- Redesign the connected task detail screen in [`TaskScreen`](../../../apps/mobile/src/screens/TaskScreen.tsx).
- Adjust the app shell in [`App.tsx`](../../../apps/mobile/src/App.tsx) so the floating bottom toolbar is hidden while a task is open.
- Keep the existing controller/store model and `kanna-server` transport.
- Keep the existing read-only terminal `WebView` surface from the earlier terminal pass.

This slice does not add new task actions, new server endpoints, a native terminal renderer, push notifications, or a full navigation library.

## Product Direction

The mobile app should feel structurally similar to Slack mobile without copying it literally.

- `Tasks`, `Recent`, `Search`, and `More` remain shell-level destinations.
- Opening a task should feel like pushing into a focused detail view.
- The task detail screen should read more like a conversation or terminal session than a management panel.
- Healthy-state UI should stay quiet. Connection or terminal problems should be obvious only when they exist.

## Architecture

The current state/controller split remains the right boundary for this pass.

- Keep `createMobileController()` responsible for selecting tasks, starting and stopping the task terminal subscription, and sending task input.
- Keep `SessionStore` as the single source of truth for `selectedTaskId`, terminal output, and terminal status.
- Keep `TaskScreen` focused on presentation and local input draft state.
- Do not add React Navigation or a second navigation stack. The pushed-screen behavior is represented by existing selection state: when `selectedTaskId` is present, the app renders task detail instead of the shell body.

The main architectural change is shell behavior:

- When no task is selected, the floating toolbar remains visible.
- When a task is selected, the floating toolbar is hidden entirely.
- Backing out of the task screen clears `selectedTaskId` through the existing `closeTask()` controller path and returns the user to the previously active shell view.

## Screen Design

### Shell-Level Views

The shell-level destinations remain `Tasks`, `Recent`, `Search`, and `More`.

- These views keep the floating bottom toolbar.
- Search and create-task affordances remain shell-level concerns.
- Task-scoped commands no longer need to be visible from the task detail body itself except through the dedicated task action entrypoint.

### Task Detail

The task detail screen becomes a pushed, terminal-first workspace.

- Remove the floating bottom toolbar while task detail is visible.
- Replace the current top-row action cluster with a simple back affordance at the top.
- The top bar uses a single `Back` button and no additional destination label.
- Remove the current long summary copy, context chips, and terminal footer metadata.
- Remove the note/snippet block below the title.
- Keep stage visible above the title.
- Clamp the task title to one line and truncate with an ellipsis when it overflows.
- The terminal becomes the dominant visual region of the screen.
- Keep the native composer attached directly below the terminal region.

### Task Actions

Task-scoped actions stay available, but move closer to the composer instead of occupying the header.

- Remove the top-right overflow button from the task header.
- Add a circular `+` button above the composer, aligned to the right.
- Tapping the `+` button opens the task-scoped command palette.
- The task command palette remains the home for actions like stage promotion, merge-agent flows, and other task-level commands.

This keeps the header focused on navigation and identity while preserving an obvious action entrypoint near the input/composer area.

### Terminal Status Treatment

The task detail screen should not show a persistent “healthy” terminal status badge.

- In the healthy steady state, show no status pill or connection label.
- If the terminal is unhealthy or transitional, replace the terminal content with a skeleton/loading shell.
- Render a short overlay label over the terminal region, using states such as `Connecting`, `Reconnecting`, `Offline`, or `Error`.
- Keep the rest of the layout stable while the terminal is unhealthy.

### Terminal Scroll Behavior

The terminal should behave like the desktop terminal's sticky-bottom mode.

- Reserve a bottom reading zone equal to the floating bottom chrome height so the newest output sits above the composer when the user is at the bottom.
- If the user is at or near the bottom, new terminal output should keep the view pinned to the bottom reading zone automatically.
- If the user scrolls upward, sticky-bottom mode should turn off and new output must not yank the viewport back down.
- If the user manually scrolls back to the bottom threshold, sticky-bottom mode should turn back on automatically.
- While the user is scrolled up, terminal content may continue behind the floating composer and controls.

### Composer Behavior

The composer remains visible even when terminal connectivity is degraded.

- When the terminal is healthy, the composer behaves normally.
- When the terminal is unhealthy, the composer remains visible but disabled.
- Disabled state should be visually obvious without causing layout shifts.

## Data Flow

No new mobile API endpoints are required for this pass.

- `selectedTaskId` continues to control whether the app is showing shell content or task detail.
- `taskTerminalOutput` and `taskTerminalStatus` remain the source of truth for terminal rendering.
- `TaskSummary.stage` and `TaskSummary.title` provide the only persistent task header information needed in the new detail view.
- Task actions continue to flow through the existing controller methods and More/command-palette plumbing.
- Terminal scroll state should live inside the terminal `WebView` document rather than in React Native shell state.

The only new derived presentation logic needed in this slice is task-detail-specific:

- whether the shell toolbar should render
- whether the terminal is in a healthy state
- whether the composer should be disabled
- compact header display rules for one-line task titles

## Error Handling

Controller-level error handling remains the source of truth for failures, but the task screen gains a clearer degraded-state presentation.

- Continue surfacing request and transport failures through `store.setErrorMessage(...)`.
- Do not add per-component retry loops.
- If the task terminal reports an unhealthy state, the terminal area should switch to the skeleton-and-overlay treatment instead of showing stale “live” framing.
- Back navigation should remain available even if the terminal fails.

## Testing

This pass should stay within the existing Vitest-based mobile testing approach.

- Add or update pure-model tests if new task-detail display helpers are introduced.
- Add focused component or app-shell coverage for the conditional toolbar behavior if the current test harness supports it.
- Add coverage for task-detail unhealthy terminal states if that logic is extracted into a testable display model.
- Verify with:
  - `pnpm --dir apps/mobile run typecheck`
  - `pnpm --dir apps/mobile test -- --runInBand`

## Non-Goals

- Introducing React Navigation or a native iOS navigation stack
- Adding diff browsing, file preview, or other desktop-heavy workflows to task detail
- Changing the `kanna-server` terminal protocol
- Supporting cloud/remote desktop control in this slice
- Replacing the current `WebView` terminal renderer with `xterm.js` in this pass

## Success Criteria

- Opening a task hides the floating bottom toolbar and presents a focused detail screen.
- The task detail header contains only a back affordance, stage, and a one-line ellipsized title.
- Task actions are reachable from the circular `+` button above the composer rather than from the header.
- The terminal visually dominates the screen in the healthy state.
- The task screen shows no persistent healthy-state status badge.
- Unhealthy terminal states switch to a skeleton plus overlay treatment and disable the composer without hiding it.
- Healthy terminal output remains pinned above the composer only while the user stays near the bottom of the terminal.
