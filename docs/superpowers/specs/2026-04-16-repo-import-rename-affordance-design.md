# Repo Import Rename Affordance

## Summary

Change the local-repo import flow in `AddRepoModal.vue` from an always-visible repository name input to the lighter inline pattern used elsewhere in the app: show the detected name as static text and expose a separate `change` link that reveals the input only when the user chooses to rename it.

The goal is to make importing feel consistent with the modal's existing resolved-path rows and with other Kanna UI that keeps the common case collapsed until the user explicitly edits it.

## Goals

- Remove the always-visible repository name field from the local import happy path.
- Preserve the ability to rename an imported repository before submission.
- Reuse the app's existing "value plus `change` link" interaction style instead of introducing a new inline-edit pattern.
- Keep the behavior scoped to `AddRepoModal.vue` and its tests unless implementation shows a clear need for extraction.

## Non-Goals

- Redesigning the clone flow.
- Changing how imported repo names are stored in the database.
- Changing import validation, branch detection, or remote detection.
- Adding a generalized inline-edit component.

## Current State

When the user selects or pastes a local Git repository path in the Import tab, the modal:

1. detects whether the path exists and is a Git repo
2. resolves the default branch and remote
3. renders a repository name input prefilled from the folder name

This works functionally, but it makes the local import path feel heavier than nearby controls. The user asked to align it with the usual Kanna modal style: show the default value first, then let the user opt into editing via a separate `change` link.

## Requirements

### Functional

1. After a local Git repo is detected, the modal must display the resolved repository name even when the user has not entered edit mode.
2. A separate `change` link must be rendered next to the displayed name.
3. Clicking `change` must replace the static name row with the existing text input, prefilled with the current effective name.
4. `Enter` must commit the edited name.
5. `Escape` must cancel the in-progress edit and restore the previously committed name.
6. Blur must commit the edited name.
7. Import submission must continue to emit the effective repository name and detected default branch unchanged.

### UX

1. The default, non-editing state should be lighter than the current full input.
2. The rename affordance should be explicit via the low-emphasis `change` link rather than making the label itself clickable.
3. Focus should move into the input and select its contents when rename mode opens.
4. If the user never edits the name, the displayed derived folder name should be the value used during import.

## Design

### 1. Local Import Name Row

When `AddRepoModal.vue` has a valid local Git repository and is not currently renaming the repo name, render a compact name row instead of the input:

- a muted label reading `Repository name`
- the current effective repository name as plain text
- a separate `change` link aligned with the row

The row should use the same visual vocabulary already used in the modal for resolved paths and other lightweight editable values.

### 2. Rename Mode

Add local UI state to distinguish:

- the committed effective repository name
- whether the row is currently in rename mode

Entering rename mode should:

- copy the current effective name into the existing input model
- focus the input on the next tick
- select the full text for quick replacement

While rename mode is active, the static row is replaced by the same text input used today. No new backend or store behavior is required.

### 3. Commit and Cancel Rules

The component should treat the displayed name as the source of truth for submit behavior.

- `Enter` commits the trimmed input value and exits rename mode.
- Blur commits the trimmed input value and exits rename mode.
- `Escape` exits rename mode without changing the committed value.

If the trimmed edited value is empty, the component should fall back to the derived folder name rather than allowing an empty import name. This preserves the current requirement that import submission uses a non-empty name.

### 4. Derived Name Synchronization

The derived folder name is still computed from the selected local path during inspection.

- Before any rename, the committed effective name should track the derived folder name.
- After the user commits a custom rename, later re-renders should preserve that custom value for the current selected path.
- If the user chooses a different local folder, the modal should reset rename mode and replace the effective name with the newly derived folder name for that folder.

This keeps the interaction predictable without introducing hidden cross-path state.

## Error Handling

- Non-Git folders still show the existing inline error and never expose the rename row.
- If branch or remote detection fails, existing fallback behavior remains unchanged.
- Empty edited values collapse back to the derived folder name instead of producing an invalid submit state.

## Testing

Update `apps/desktop/src/components/__tests__/AddRepoModal.test.ts` to cover:

- local import shows the derived repository name in collapsed form after detection
- the collapsed state exposes a separate `change` link
- clicking `change` opens the input, focuses it, and selects the text
- committing a renamed value updates the emitted import payload
- pressing `Escape` cancels an in-progress rename and restores the prior committed value
- selecting a different local folder resets the effective name to that folder's derived default

Run focused component tests and TypeScript verification during implementation.

## Files Expected To Change

- `apps/desktop/src/components/AddRepoModal.vue`
- `apps/desktop/src/components/__tests__/AddRepoModal.test.ts`

## Open Decisions Resolved

- Rename affordance: separate `change` link
- Default state: static name row, not an always-visible input
- Scope: local import flow only
