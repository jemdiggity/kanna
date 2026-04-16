# Blocked Tasks Preserve Live Agent Sessions

## Problem

The current blocked-task flow replaces the active task with a new blocked placeholder item. That replacement closes the live PTY session, removes the worktree, and later respawns a fresh session when blockers clear. This breaks the behavior we want for active agent work:

- the same task should remain selected and identifiable
- the same worktree should remain intact
- the same daemon PTY session should remain alive
- the same agent process should keep its current conversational and terminal state

We still need the agent to receive unblock context when the task can resume, but that context must arrive as a normal follow-up message into the existing session, not as a respawn prompt.

## Goal

When the user blocks an active task:

- do not create a replacement task
- do not close the agent PTY session
- do not remove the worktree
- do not change the task identity
- do record blocker relationships and render the task as blocked in the UI

When all blockers clear:

- keep using the same task record and same PTY
- remove the blocked state from that task
- send a follow-up message into the existing agent session that explains which blockers completed and which branches may contain relevant changes

## Non-Goals

- adding daemon-level pause or suspend semantics
- preserving hidden blocked terminals across app restarts beyond the existing daemon/session recovery behavior
- redesigning the blocked-task UX beyond the minimum lifecycle changes needed for correct behavior
- changing the semantics of tasks that are created already blocked as part of some future workflow

## Current Architecture Problem

Today `blockTask()` in [`apps/desktop/src/stores/kanna.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-63250bf9/apps/desktop/src/stores/kanna.ts:1961):

1. inserts a new `pipeline_item`
2. marks that new item as blocked
3. transfers dependent blocker edges to the replacement
4. kills the original PTY and shell sessions
5. runs teardown and removes the original worktree
6. closes the original task

Later `checkUnblocked()` calls `startBlockedTask()`, which creates or recreates a worktree, allocates ports, updates branch metadata, builds an augmented prompt, and spawns a fresh PTY.

That design was correct for the original "blocked tasks are inert placeholders" model, but it is the wrong layer for preserving a live agent. The architectural issue is that blocked state is currently modeled as task replacement instead of task suspension in application state.

## Proposed Model

Blocked state becomes an attribute of the existing task, not a replacement task lifecycle.

For tasks that are already running when the user invokes "Block Task":

- the existing `pipeline_item` remains the source of truth
- the existing daemon session remains the source of truth for terminal continuity
- the existing branch and worktree remain the source of truth for filesystem continuity
- `task_blocker` rows describe dependency state
- the blocked tag controls sidebar grouping and main-panel placeholder rendering

Unblocking is an in-place state transition:

- keep the same task id
- keep the same branch
- keep the same worktree
- keep the same `claude_session_id`
- keep the same PTY session id
- send unblock context into the already-running terminal session

## Data Model

No schema change is required.

Existing data remains sufficient:

- `pipeline_item.tags` continues to carry the temporary `"blocked"` marker used by current UI grouping
- `task_blocker` remains the source of truth for blocker relationships
- `pipeline_item.branch`, `port_env`, `port_offset`, and `claude_session_id` remain populated while blocked instead of being nulled out

## Store and Lifecycle Changes

### `blockTask()`

`blockTask()` should change from replacement semantics to in-place mutation semantics.

New behavior:

1. Validate the current item and selected blockers as today.
2. Insert `task_blocker` rows for the current task id.
3. Add the `"blocked"` tag to the current task.
4. Keep selection on the same task.
5. Do not kill the agent session.
6. Do not kill the shell session.
7. Do not run teardown.
8. Do not remove the worktree.
9. Do not close the task.
10. Do not transfer dependents, because the task id is unchanged.

This is the core architectural simplification. Once the task id no longer changes, several pieces of compensating logic disappear naturally.

### `editBlockedTask()`

`editBlockedTask()` keeps its current blocker diff behavior, but with two important semantics:

- if the task still has unresolved blockers, it remains blocked and its session stays untouched
- if blockers become fully resolved, the store must unblock the same task in place instead of spawning a new one

Removing all blockers is still the manual unblock path.

### `checkUnblocked()`

`checkUnblocked()` should stop assuming every blocked task needs startup work. It should branch by task state:

- if the task already has a live branch/session context, unblock in place
- if the task has no live session context, fall back to the existing startup path

This keeps the new behavior targeted to active tasks while preserving compatibility for any older blocked items that still have null branch/session fields.

### `resumeBlockedTaskInPlace()`

Add a focused helper in the store for the in-place unblock path. Responsibilities:

1. Read the task's blockers.
2. Build the unblock context message from blocker display names and branches.
3. Remove the `"blocked"` tag from the task.
4. Leave branch, worktree, ports, and session ids untouched.
5. Send the unblock context into the existing PTY session.
6. Update activity if needed so the task is visibly active again.

Suggested message body:

```text
This task was previously blocked by the following tasks, which have now completed:
- {display_name or prompt snippet} (branch: {branch})

Their changes may be on branches that haven't merged to main yet.
Please continue this task using that context where relevant.
```

This message is intentionally a follow-up instruction, not a fresh prompt prefix.

### `startBlockedTask()`

Retain `startBlockedTask()` for blocked tasks that genuinely have no live session to resume. This becomes the fallback path for legacy or non-live blocked items.

It should no longer be the only unblock implementation.

## UI Changes

### Main panel

The blocked placeholder in [`apps/desktop/src/components/MainPanel.vue`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-63250bf9/apps/desktop/src/components/MainPanel.vue:1) can remain conceptually the same:

- blocked tasks show the placeholder and blocker list
- terminal content is hidden while blockers are unresolved

No visual redesign is required.

The important behavioral change is that the hidden terminal is no longer equivalent to a destroyed terminal.

### Terminal lifecycle

Terminal mounting must not be the thing that destroys the PTY. That should already be true for daemon-owned sessions, but this change relies on that invariant explicitly:

- switching a blocked task to placeholder mode must not trigger session cleanup
- switching back to terminal view after unblock must reattach to the same session id

If the current component structure accidentally causes detach or cleanup on placeholder transitions, that cleanup must be removed from the component lifecycle and kept in explicit task-close paths only.

### Sidebar and selection

The same task remains selected when blocked. There is no selection handoff to a replacement item.

Sidebar grouping can continue using the existing blocked tag behavior. The visible item simply moves into the blocked section while keeping the same id and metadata.

## Close Semantics

The current blocked-task fast path in `closeTask()` assumes blocked tasks never started and therefore have nothing to clean up. That assumption becomes invalid.

New rule:

- if a blocked task still has a live branch/session context, closing it must behave like closing a normal active task
- only blocked tasks with no live session/worktree may use the inert fast path

In practice, the simplest check is whether the item has a live branch or session-backed resources to clean up. The code should not key this logic off the blocked tag alone.

## App Restart and Recovery

This change does not require new daemon behavior.

Expected behavior after restart:

- if the daemon session still exists, the normal reattach flow should reconnect to the same task session when the task is unblocked and shown again
- if a blocked task lost its PTY across restart, the existing terminal recovery path may respawn it when the terminal is shown
- `checkUnblocked()` still needs the fallback startup path for blocked items that do not have resumable live context

The key point is that blocking itself no longer destroys the session. Restart recovery remains handled by the existing terminal recovery architecture rather than by blocked-task orchestration.

## Testing

Add or update store tests for:

1. Blocking an active task keeps the same item id.
2. Blocking an active task does not call session kill commands.
3. Blocking an active task does not remove the worktree.
4. Blocking an active task keeps the same branch and `claude_session_id`.
5. Blocking an active task keeps the task selected and moves it into blocked grouping.
6. Unblocking an in-place blocked task removes the blocked tag without spawning a replacement task.
7. Unblocking an in-place blocked task sends the blocker context message through the existing session.
8. Closing a blocked task with a live branch/session follows the real cleanup path.
9. Legacy blocked tasks with no branch/session still use the old startup path.

Update or remove tests that assert replacement-task behavior, especially the existing coverage around "blocked replacement" creation.

## Files Affected

Primary changes:

- [`apps/desktop/src/stores/kanna.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-63250bf9/apps/desktop/src/stores/kanna.ts:1826)
- [`apps/desktop/src/stores/kanna.taskBaseBranch.test.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-63250bf9/apps/desktop/src/stores/kanna.taskBaseBranch.test.ts:698)
- [`apps/desktop/src/stores/taskCloseBehavior.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-63250bf9/apps/desktop/src/stores/taskCloseBehavior.ts:1)
- [`apps/desktop/src/stores/taskCloseBehavior.test.ts`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-63250bf9/apps/desktop/src/stores/taskCloseBehavior.test.ts:1)
- [`apps/desktop/src/components/MainPanel.vue`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-63250bf9/apps/desktop/src/components/MainPanel.vue:1)
- [`apps/desktop/src/components/TerminalTabs.vue`](/Users/jeremyhale/Documents/work/jemdiggity/kanna-tauri/.kanna-worktrees/task-63250bf9/apps/desktop/src/components/TerminalTabs.vue:1)

Likely supporting tests may also need updates where they assert blocked tasks are inert placeholders or replacement items.

## Risks and Mitigations

### Risk: duplicate unblock messages

If `checkUnblocked()` can run multiple times for the same task after blockers clear, the app could send repeated unblock context into the PTY.

Mitigation:

- remove the blocked tag before sending the message, and make unblock helpers no-op when the task is no longer blocked

### Risk: blocked close path leaks resources

If `closeTask()` still assumes blocked means inert, abandoned blocked tasks may leak worktrees or daemon sessions.

Mitigation:

- base cleanup behavior on actual live resources, not just on `hasTag(item, "blocked")`

### Risk: component lifecycle accidentally tears down hidden terminals

If hiding the terminal view causes cleanup, preserving the PTY in the store will still not preserve the user-visible session.

Mitigation:

- verify terminal mount/unmount behavior and keep destructive cleanup exclusively in explicit close actions

### Risk: mixed population of old and new blocked tasks

Existing data or tests may include blocked tasks with no branch/session because they were created under the old model.

Mitigation:

- keep the old `startBlockedTask()` path as a fallback for non-live blocked tasks

## Decision

Adopt the in-place blocked-task model for active tasks.

Blocking becomes a dependency/state transition on the current task, not task replacement. Unblocking becomes an in-session continuation message on the existing PTY, with the old respawn flow retained only as a compatibility fallback for blocked tasks that have no live session state to preserve.
