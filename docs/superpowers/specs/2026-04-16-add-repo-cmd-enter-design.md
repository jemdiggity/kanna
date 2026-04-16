# Add Repo Cmd+Enter Submission

## Summary

Update `AddRepoModal.vue` so `Cmd+Enter` submits the active modal workflow from any text input in the modal, including the create-repo name field, the import-or-clone input, and the local repo rename input.

The local repo rename field keeps its current plain `Enter` behavior of committing the inline edit only. When the user presses `Cmd+Enter` while editing that field, the modal must first commit the current draft repo name and then immediately submit the import action using the edited value.

## Goals

- Make `Cmd+Enter` a reliable submit shortcut even when focus is inside a text input in `AddRepoModal.vue`.
- Preserve existing plain `Enter` behavior for the inline local repo rename field.
- Ensure submit-from-rename uses the current draft value rather than the previously committed value.
- Keep the change scoped to `AddRepoModal.vue` and its focused component tests.

## Non-Goals

- Changing submission behavior in other modals.
- Changing plain `Enter` behavior in create or import fields.
- Refactoring modal keyboard handling into a shared abstraction.
- Changing clone or import business logic outside the modal.

## Current State

`AddRepoModal.vue` already has a window-level `handleKeydown()` that submits on `Enter`, but the local repo rename input intercepts `Enter` with `@keydown.enter.stop.prevent="commitLocalRepoRename"`. Because of that input-level handler, `Cmd+Enter` is currently treated like plain `Enter` inside the rename field: it commits the edit but does not submit.

The user wants the standard submit shortcut to work from all text inputs in the modal. For the rename field specifically, `Cmd+Enter` should behave as a combined "commit this draft and import now" action.

## Requirements

### Functional

1. Pressing `Cmd+Enter` in the create-repo name input must submit the create flow.
2. Pressing `Cmd+Enter` in the import-or-clone input must submit the current valid import or clone flow.
3. Pressing `Cmd+Enter` in the local repo rename input must:
   - commit the current draft repo name
   - fall back to the derived folder name if the draft trims to empty
   - immediately submit the import flow
4. Plain `Enter` in the local repo rename input must continue to commit the inline edit without submitting.
5. Plain `Escape` in the local repo rename input must continue to cancel the inline edit without submitting.

### UX

1. `Cmd+Enter` should feel consistent across all Add Repo text inputs.
2. The rename field should not lose its lightweight inline-edit semantics for plain `Enter`.
3. The resulting import payload should reflect exactly what the user sees in the rename draft at the moment `Cmd+Enter` is pressed.

## Design

### 1. Input-Level Cmd+Enter Handling

Handle `Cmd+Enter` explicitly on the modal's text inputs rather than relying on the window-level key handler to win event ordering.

This keeps the fix local and avoids disturbing the current inline-edit handlers that intentionally intercept plain `Enter` and `Escape`.

### 2. Rename Field Submission

Add a dedicated helper in `AddRepoModal.vue` for the local repo rename field:

- commit the draft into the committed repo name using the existing fallback rules
- call the existing modal submit path immediately after the commit

That helper becomes the `Cmd+Enter` path for the rename input, while plain `Enter` remains bound to commit-only.

## Error Handling

- `Cmd+Enter` should still respect the existing disabled or invalid states by routing through the normal submit logic.
- If the rename draft is empty, submit must use the same derived-name fallback already defined for rename commit.
- Clone flow remains unchanged apart from gaining reliable `Cmd+Enter` submission from its input field.

## Testing

Update `apps/desktop/src/components/__tests__/AddRepoModal.test.ts` to cover:

- `Cmd+Enter` in the create input emits `create`
- `Cmd+Enter` in the clone/import input emits the same payload as the current submit path
- `Cmd+Enter` in the local repo rename input emits `import` immediately and includes the edited draft value
- plain `Enter` in the local repo rename input still commits without immediate submit

Run the focused modal test file and app-level TypeScript verification during implementation.

## Files Expected To Change

- `apps/desktop/src/components/AddRepoModal.vue`
- `apps/desktop/src/components/__tests__/AddRepoModal.test.ts`

## Open Decisions Resolved

- Shortcut scope: all Add Repo text inputs
- Rename-field behavior: `Cmd+Enter` commits draft and submits immediately
- Plain rename-field behavior: unchanged
