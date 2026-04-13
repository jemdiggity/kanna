# Task Delete Teardown Selection Design

## Goal

When a user deletes a task, the UI should switch selection to the same next task that deletion would normally land on as soon as the task enters teardown. This must happen before teardown scripts finish and before the torndown task is fully closed.

## Current Behavior

`closeTask()` computes the eventual next task before any stage changes, but it only calls `selectNextItem(nextId)` after teardown finishes or after a second close of a lingering `torndown` task. While teardown is running, the just-deleted task remains selected.

## Desired Behavior

For normal task deletion with `selectNext !== false`:

- Compute the next task using the existing sidebar-order logic before any stage mutation.
- Persist `stage = "torndown"` exactly where it happens today.
- Immediately switch selection to that precomputed next task after the torndown stage is written.
- Leave the torndown task visible in the sidebar while lingering, but no longer selected.

For flows that already opt out of selection changes, keep existing behavior:

- `advanceStage()` still calls `closeTask(item.id, { selectNext: false })`.
- Blocked-task close behavior is unchanged.
- Final close of an already-`torndown` task should not force a second selection change if selection already moved away.

## Scope

The change should stay inside the store-level close flow. No sidebar sort changes, no new teardown states, and no changes to undo-close semantics.

## Data Flow Impact

- Source of truth for the next item remains `computeNextItemId()`.
- Selection handoff moves earlier in `closeTask()` for the normal teardown path.
- The sidebar and main panel continue to derive visibility from `stage !== "done"`, so `torndown` items remain visible but unselected.

## Testing

Add a targeted store-level test that proves:

- deleting a task with teardown transitions selection to the precomputed next item immediately after the task becomes `torndown`
- the torndown task can remain in the item list without staying selected
- `selectNext: false` continues to suppress the handoff

## Risks

- Moving selection too early could interfere with stage advancement if the opt-out path is ignored
- Current-item fallback behavior must not accidentally reselect the torndown task

The implementation should therefore reuse the existing `nextId` computation and guard all immediate selection changes behind the existing `selectNext !== false` condition.
