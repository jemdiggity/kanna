# Task Close Teardown Visibility Design

## Goal

When a user closes a task, the task should only enter a visible `teardown` stage if there is actual teardown work to run. Tasks with teardown commands must remain visible in the sidebar until teardown completes successfully. Tasks with no teardown commands can close immediately and disappear from the sidebar.

## Current Behavior

`closeTask()` already has a two-step close model in the store:

- normal tasks enter `teardown` on first close
- blocked tasks close immediately
- tasks already in `teardown` close immediately on second close
- successful teardown session exits auto-close the task when terminal lingering is disabled

The gap is that the first close path still routes normal tasks through `teardown` before deciding whether they should immediately disappear. That makes the lifecycle harder to reason about and leaves the mock E2E test asserting an outdated behavior.

## Desired Behavior

For a user-initiated close:

- If the task is blocked, close it immediately.
- If the task is already in `teardown`, close it immediately.
- If teardown commands exist, stop the agent, move the task to `teardown`, keep it visible, and auto-close it only after teardown exits successfully.
- If no teardown commands exist, skip `teardown` entirely and close the task immediately.

Visibility remains driven by `stage`:

- `stage === "done"` means hidden
- `stage === "teardown"` means still visible

This keeps the UI rule simple and matches the user-facing expectation: visible while cleanup is still happening, hidden once cleanup is complete.

## Scope

This change stays within the existing close-task lifecycle and its tests:

- store-level close flow in `kanna.ts`
- teardown auto-close helpers in `kannaCleanup.ts`
- sidebar and current-item visibility assumptions
- mock E2E coverage for task closing

Out of scope:

- changing stage advancement into a new task
- introducing a separate closing-status column
- changing undo-close semantics
- changing lingering-terminal behavior beyond the close decision point

## Data Flow

### Store

`closeTask()` should determine teardown commands before it commits to the first-close transition.

Decision flow:

1. Compute `nextId` up front using the existing sidebar-order logic.
2. Preserve the current stage in `previous_stage` as it does today.
3. Resolve `closeBehavior` from the current stage and blocked state.
4. If the result is immediate finish, close the task directly.
5. If the task is a first-close candidate, load teardown commands.
6. If teardown commands exist:
   - send `SIGINT` to the agent session
   - spawn and attach the teardown session
   - write `stage = "teardown"`
   - select the next item immediately when the existing selection rules allow it
7. If teardown commands do not exist:
   - skip writing `stage = "teardown"`
   - close the task directly to `done`
   - release ports and run the existing unblock checks

This makes the lifecycle explicit instead of entering `teardown` and then immediately collapsing to `done`.

### Sidebar And Selection

The sidebar and current-item logic should continue to treat only `stage === "done"` as hidden. No separate visibility exceptions should be added for `teardown`.

Selection behavior should remain:

- move away immediately when a task enters visible `teardown`
- move away immediately when a task closes directly to `done`
- avoid a second forced selection change when a `teardown` task later auto-closes

### Auto Progression

The existing teardown session-exit listener remains the source of truth for automatic completion:

- exit code `0` with lingering disabled closes the task to `done`
- non-zero exit leaves the task visible in `teardown`
- lingering enabled leaves the task visible in `teardown` even on success

No polling or retry logic is added.

## Testing

Update the close-task coverage to match the intended lifecycle:

- store test: first close with teardown commands enters `teardown`
- store test: first close without teardown commands finishes immediately
- store test: second close from `teardown` still finishes immediately
- E2E test: closing a task with teardown commands keeps it visible in the sidebar while in `teardown`
- E2E test: closing a task without teardown commands removes it from the sidebar

The existing mock `task-lifecycle` test should stop assuming that all first closes immediately hide the task.

## Risks

- If teardown commands are resolved too late, selection and stage changes can still reflect the old indirect flow.
- If direct-close and teardown-close paths drift apart, unblock checks or port release could become inconsistent.
- Existing tests or docs may still use the legacy `torndown` name and need to be normalized to canonical `teardown`.

## Recommendation

Keep `stage` as the only visibility source of truth and tighten `closeTask()` so it chooses between `teardown` and direct `done` before mutating the task. This preserves the current architecture, avoids adding new state, and matches the intended behavior with minimal surface area.
