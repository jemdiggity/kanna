# Resizable Sidebar Design

## Goal

Make the desktop sidebar width adjustable by dragging its right edge. The chosen width is remembered per app window and restored after restart. Existing sidebar hide/show behavior remains unchanged.

## Behavior

- The sidebar starts at the existing default width of 260px when no saved width exists.
- A slim resize handle appears on the right edge of the desktop sidebar.
- Dragging the handle updates the sidebar width live.
- Width is clamped between 220px and 420px.
- Releasing the pointer persists the final width for the current workspace window.
- Toggling the sidebar with Cmd+B hides or shows it without losing the remembered width.
- Mobile layout keeps the sidebar at full width and does not expose the resize handle.

## Architecture

`App.vue` owns the layout-level resize state because it already mounts the sidebar, controls sidebar visibility, and coordinates per-window workspace persistence. `Sidebar.vue` remains focused on repo and task list behavior.

`windowWorkspace.ts` extends each `WorkspaceWindowState` with an optional `sidebarWidth` field. Snapshot normalization validates saved widths, preserves backwards compatibility with existing snapshots, and defaults missing or invalid widths to 260px.

## Testing

- Unit tests cover workspace snapshot normalization and per-window sidebar width persistence.
- App tests cover drag behavior at the component boundary: dragging the handle updates width, clamps bounds, and persists the current window width.
- Mobile behavior is covered by ensuring the handle is not rendered when the app is in mobile layout.
