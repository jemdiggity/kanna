# New Window Design

## Summary

Add a real multi-window workspace to Kanna. Each window shows the same live repo/task data, but each window owns its own presentation state, including selected repo and selected task. Opening a new window should bootstrap from the source window's current selection. Quitting and reopening the app should restore the set of open windows and each window's selected repo/task.

## Goals

- Support opening additional Kanna windows from the current window.
- Keep repo and task data live and shared across all windows.
- Keep selected repo/task local to each window.
- Restore the open window set and each window's presentation state after app relaunch.
- Keep SQLite and existing daemon events as the shared source of truth for task data.

## Non-Goals

- Persist every transient UI detail across relaunch.
- Share modal state, focus state, terminal focus, or search text between windows.
- Push presentation state directly from one window into another.
- Change task business logic to become window-aware.

## Product Behavior

### New Window

- A user can open a new Kanna window from an existing window.
- The new window starts with the source window's selected repo/task when possible.
- After opening, both windows can change selection independently.

### Shared Data

- All windows show the same repos and tasks.
- Shared mutations are reflected live in every window.
- Examples: creating a task, closing a task, stage changes, renames, pinning, blocker changes, and repo visibility changes.

### Restore On Relaunch

- On quit, Kanna persists a lightweight workspace snapshot describing open windows and each window's saved presentation state.
- On relaunch, Kanna restores the main window plus additional windows from that snapshot.
- Restore is best-effort. Missing repos or tasks fall back cleanly instead of blocking startup.

## State Model

### Shared App State

The following remain shared across all windows:

- Repo list
- Task list
- Task runtime activity and daemon-driven events
- Shared settings and preferences
- All DB-backed task mutations

### Window-Local Presentation State

The following belong to a single window and must not be stored as app-global selection:

- `selectedRepoId`
- `selectedItemId`
- Navigation history
- Sidebar search text
- Modal visibility
- Maximize/sidebar layout toggles
- Diff/file/shell presentation state

`selectedRepoId` and `selectedItemId` are presentation state, not shared app state.

## Architecture

### Window Workspace Layer

Introduce a small window-workspace layer alongside the existing `kanna` store.

Responsibilities:

- Assign and track a `windowId` for each window
- Parse bootstrap state when a window starts
- Persist restorable workspace snapshots
- Own per-window presentation persistence
- Provide an explicit cross-window invalidation event for shared data refresh

### Existing Kanna Store

The existing `kanna` store continues to own:

- Repo and task loading
- DB reads and writes
- Daemon event handling
- Task lifecycle and business logic
- Shared data refresh and reconciliation

The store should stop persisting `selected_repo_id` and `selected_item_id` as global app settings.

### Rust / Tauri Layer

Rust owns:

- Native window creation
- Recreating saved windows on app startup
- Passing bootstrap payloads into each created window
- Emitting app-level events to all windows when shared frontend mutations occur

## Data Flow

### Open New Window

1. The source window requests a new window.
2. Rust allocates a `windowId`.
3. Rust records the window in the persisted workspace snapshot.
4. Rust creates the webview window and passes bootstrap parameters:
   - `windowId`
   - `selectedRepoId`
   - `selectedItemId`
5. The new window initializes its local presentation state from the bootstrap payload.
6. After initialization, the new window owns its selection independently.

### Shared Live Updates

Shared data updates come from two paths:

- Daemon-driven changes already arrive through app events and continue to refresh shared task data.
- Frontend-originated shared mutations emit a lightweight app-level invalidation event after the DB write succeeds.

Each window responds to invalidation by:

1. Reloading shared repo/task data from SQLite
2. Reconciling its local selection against the refreshed data
3. Falling back if the selected repo/task no longer exists

The invalidation event should not carry full shared state payloads. Windows should re-read from the DB instead of trying to synchronize in-memory state with each other.

### Restore On Relaunch

1. App startup reads the persisted workspace snapshot.
2. The initial main window claims the first saved window record.
3. Rust recreates additional windows in saved order.
4. Each restored window receives the same bootstrap format used by newly opened windows.
5. Each window initializes local presentation state, then reconciles it against live repo/task data.

There should be one bootstrap path for both newly opened windows and restored windows.

## Persistence

Persist the restorable workspace snapshot in SQLite `settings`, not in webview storage.

Recommended key:

- `window_workspace_v1`

Recommended JSON shape:

```json
{
  "windows": [
    {
      "windowId": "main",
      "selectedRepoId": "repo-1",
      "selectedItemId": "task-1",
      "sidebarHidden": false,
      "order": 0
    }
  ]
}
```

Rules:

- Runtime selection remains local in memory while the app is running.
- The snapshot is only for restore-on-relaunch.
- Persist only lightweight presentation state that makes restore useful and stable.
- Do not persist modal state, search text, transient focus, or terminal interaction state.

## Failure Handling

Restore must be best-effort.

Fallback rules:

- If `selectedRepoId` no longer exists, select the first visible repo.
- If `selectedItemId` is missing, closed, or does not belong to the restored repo, clear it and select the first visible task for the restored repo.
- If there are no repos, open the window with no repo/task selection.
- If one restored window fails to open, log the failure and continue restoring the remaining windows.

Cross-window updates should also be resilient:

- Treat refresh events as invalidation only.
- Re-read shared state from SQLite after invalidation.
- Let successful DB writes determine final shared state.
- Never try to make one window the source of truth for another window's presentation state.

## Testing

### Frontend Store Tests

- Window-local selection is initialized from bootstrap state.
- Selection changes in one window do not overwrite another window's selection.
- Selection fallback works when a saved repo/task disappears.
- Shared invalidation reloads repo/task data without mutating unrelated local presentation state.

### Rust / Tauri Tests

- Workspace snapshot restore recreates windows in saved order.
- Window bootstrap payloads include the expected `windowId` and selection state.
- Restore tolerates invalid saved repo/task references.

### End-to-End Tests

- Open a second window from the current selection.
- Change selection independently in both windows.
- Create, close, rename, or pin a task in one window and verify the other window updates live.
- Quit and relaunch, then verify both windows are restored with their saved selections.

## Open Questions Resolved

- Selected repo/task is presentation state and should be local to each window.
- Repo/task lists are shared live across windows.
- Restoring windows and selections on relaunch is part of this feature.
- SQLite `settings` is the persistence layer for the workspace snapshot.

## Implementation Notes

- Reuse the existing app data flow for shared task state instead of building a second source of truth.
- Keep the new window feature off of webview-local persistence mechanisms for shared restore state.
- Prefer a narrow window-workspace module over scattering window-awareness across unrelated task logic.
