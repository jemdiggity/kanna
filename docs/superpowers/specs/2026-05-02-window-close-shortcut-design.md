# Window Close Shortcut Design

## Summary

Add `Cmd+W` as a first-class multi-window shortcut in Kanna. It should close whichever Kanna window is focused, including the first-created window, and it should keep the app process alive even when the last window closes. Because no webview remains to handle frontend shortcuts after the last close, Kanna also needs a native app-level `Cmd+N` path that can reopen a window when the app is still running with zero windows.

## Goals

- Let users close the focused Kanna window with `Cmd+W`.
- Treat every Kanna window the same; there is no special protected main window.
- Keep the app running after the last window closes.
- Keep workspace snapshot restore accurate when windows are closed manually.
- Preserve the ability to open a new window with `Cmd+N` when no windows are open.

## Non-Goals

- Rework the broader multi-window data model.
- Add minimize-to-tray or dockless behavior changes.
- Introduce per-window confirmation prompts on close.
- Change how shared repo/task data sync works across open windows.

## Product Behavior

### Close Window

- `Cmd+W` closes the focused Kanna window.
- This applies to any Kanna window, regardless of creation order.
- The closed window is removed from the persisted workspace snapshot before the native close completes.

### Last Window

- Closing the last remaining window does not quit the app.
- The app remains available in the normal macOS app lifecycle so the user can invoke `Cmd+N` again.
- The persisted workspace snapshot may become empty while the app remains running.

### Reopen After Last Close

- `Cmd+N` must work even when no Kanna window is open.
- When invoked with no open windows, it opens a fresh Kanna window using the normal bootstrap path with default fallback selection behavior.
- When invoked while windows are open, it continues to open a new window from the focused window's current selection.

## Architecture

### Frontend Workspace Layer

Extend the existing `windowWorkspace` controller with a `closeWindow()` operation.

Responsibilities:

- Remove the current window from `window_workspace_v1`
- Renumber remaining window order
- Trigger native close for the current webview

The frontend shortcut layer remains responsible for catching `Cmd+W` while a webview is focused, including terminal-focused contexts.

### Native App Layer

Add an app-level new-window entry point in Tauri that does not depend on any existing webview being mounted.

Responsibilities:

- Create a new Kanna window when `Cmd+N` is invoked from the app menu or native accelerator with zero open windows
- Reuse the same window bootstrap and snapshot rules already used by the multi-window workspace flow
- Avoid treating `"main"` as a privileged long-lived window label

## Data Flow

### `Cmd+W`

1. The focused window receives `Cmd+W` through the existing shortcut system.
2. The frontend calls `windowWorkspace.closeWindow()`.
3. `closeWindow()` loads the current workspace snapshot.
4. It removes the current `windowId`, normalizes order, and saves the updated snapshot.
5. It asks Tauri to close the current webview window.
6. Remaining windows keep their own local presentation state unchanged.

### Native `Cmd+N` With Zero Windows

1. The user invokes `Cmd+N` from the app-level accelerator.
2. Tauri creates a fresh Kanna window even though no existing webview can handle the shortcut.
3. The new window boots through the same workspace bootstrap flow as other windows.
4. If the workspace snapshot is empty, the new window claims a fresh window record and falls back to normal repo/task initialization rules.

## Persistence Rules

- Closed windows must be removed from `window_workspace_v1` immediately as part of window close.
- If the last window closes, the snapshot may legitimately contain zero windows.
- Reopening from zero windows should create a new snapshot entry instead of assuming an old `"main"` record still exists.

## Failure Handling

- If snapshot persistence fails during `Cmd+W`, log the error and do not silently corrupt the saved workspace state.
- If native window close fails after snapshot update, the next persistence write should reconcile the still-open window back into the snapshot.
- If native `Cmd+N` creation fails while no windows are open, log the failure and keep the app process alive.

## Testing

### Frontend Tests

- `Cmd+W` is recognized as an app shortcut in the same contexts as other global workspace shortcuts.
- `windowWorkspace.closeWindow()` removes the current window from the saved snapshot and preserves the remaining order.

### Tauri / Native Tests

- Native app-level `Cmd+N` can create a window when zero Kanna windows are open.
- Closing the last window does not terminate the app process.

### End-to-End Tests

- Open a second window and close it with `Cmd+W`; verify the source window remains open.
- Close the currently focused source window with `Cmd+W`; verify another Kanna window can still be opened afterward.
- Close the last remaining window, invoke native `Cmd+N`, and verify a fresh Kanna window appears.

## Open Questions Resolved

- `Cmd+W` should close whichever Kanna window is focused.
- The first-created window is not special.
- Closing the last window should leave the app running.
- Supporting that last-window behavior requires a native app-level `Cmd+N` path in addition to the frontend shortcut.
