# File Picker Escape Flow Design

## Goal

Make the file picker and file preview feel less sticky by separating the two exit paths:

- `Escape` should close inline search first, then jump all the way back to zero open file modals.
- `q` inside the file preview should close only the preview and return to the picker when the preview was opened from it.

## Current Behavior

The app-level dismiss handler in `apps/desktop/src/App.vue` closes the preview before the picker. When the preview was opened from the picker, the preview close handler reopens the picker, so `Escape` effectively requires two presses to leave the file flow.

The preview already binds `q` through `useLessScroll`, but that close path shares the same modal-close behavior as `Escape`, so it does not express a distinct intent at the app layer.

## Desired Behavior

- `Escape` in the file preview:
  - closes inline search first if search is active
  - otherwise closes the preview and the picker together
  - clears file-flow bookkeeping so the picker does not reopen as a side effect
- `Escape` in the picker:
  - still closes the picker
- `q` in the file preview:
  - still closes the preview through the preview-local close path
  - reopens the picker when `previewFromPicker` is true

## Scope

Keep this change inside the existing file modal flow:

- `apps/desktop/src/App.vue`
- `apps/desktop/src/components/FilePreviewModal.vue`
- targeted tests covering the two behaviors

No new shortcut definitions, no modal stack refactor, and no changes to tree explorer or diff modal dismissal.

## Data Flow Impact

- `FilePreviewModal.dismiss()` remains responsible for preview-local layered behavior such as closing inline search first.
- `App.vue` becomes responsible for the higher-level “exit the entire file flow” behavior when the centralized dismiss shortcut handles `Escape`.
- `previewFromPicker` remains the source of truth for whether a preview close should reveal the picker again, but the app-level escape path explicitly clears it before closing to avoid reopening.

## Testing

Add coverage for:

- app-level dismiss while preview and picker are both part of the file flow, verifying that `Escape` lands on zero open file modals
- preview-local `q`, verifying that it closes the preview and returns to the picker
- preview-local `Escape` while inline search is open, verifying that it closes search before closing the modal

## Risks

- The app-level dismiss path could accidentally bypass inline search teardown if it stops calling the preview’s exposed `dismiss()` method.
- Clearing the picker/preview state in the wrong order could leave `previewHidden` or `previewFromPicker` stale and break `⌘P` toggling afterward.

The implementation should therefore keep the preview’s own dismiss logic intact and only special-case the file-flow reset in `App.vue` after the preview reports that it should actually close.
