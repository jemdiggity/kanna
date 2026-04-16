# Diff Viewer Search Design

## Goal

Add inline search to the diff viewer so users can search the currently loaded patch with the same interaction model as the file preview modal: `/` and `Cmd+F` open a transient bottom search bar, `Enter` confirms, `n` and `N` navigate matches, and `Escape` closes search before closing the modal.

## Scope

This feature applies to the existing diff modal in `apps/desktop/src/components/DiffView.vue`.

Search covers the currently loaded patch for the selected scope and working filter:

- File names
- Hunk headers
- Diff line text

Search is case-insensitive and resets when the loaded patch changes because the scope or working filter changes.

## Constraints

- The diff renderer is `@pierre/diffs`, which renders into a `diffs-container` custom element with shadow DOM.
- `FileDiff` does not expose a first-class search/highlight API for arbitrary diff text.
- The implementation must not move search state into the store or backend because this is modal-local UI state over already-fetched data.
- Existing less-style keyboard navigation in the diff modal must keep working.

## Architecture

The feature lives in three layers:

1. `DiffView.vue` owns search state and modal interaction.
2. A focused search helper builds a structured search index from parsed patch metadata.
3. Post-render DOM application maps active and inactive matches into the rendered `FileDiff` shadow DOM using stable `data-*` attributes from `@pierre/diffs`.

This keeps diff fetching, search indexing, and DOM highlight application separate.

## Match Model

Each parsed file contributes matchable targets:

- `file-header`: the rendered file title
- `hunk-header`: the raw `@@ ... @@` header, anchored to the first rendered row of that hunk
- `line`: a rendered diff row, keyed by side and `data-line-index`

Search returns an ordered flat list of matches across all files in display order. The current match index drives navigation and active styling.

## Rendering Strategy

`DiffView.vue` continues to render files with `FileDiff`.

After each render:

- file header matches receive classes on the shadow DOM header title node
- line matches receive classes on both the shadow DOM gutter row and content row
- hunk header matches reuse the first rendered row of the hunk as the navigation anchor because hunk headers are not otherwise rendered in the current viewer configuration

Active and inactive matches use separate classes so the current result stands out while preserving context for other hits.

## Error Handling

- If diff loading fails, search remains available only as an empty state and reports zero matches.
- If the patch is empty, opening search shows no matches without throwing.
- If scope or working filter changes invalidate the current match, search resets to the first result in the new patch.

## Testing

Add coverage for:

- opening search with `/` and focusing the input
- confirming search with `Enter` and returning focus to the diff modal
- indexing file names, hunk headers, and line text
- rebuilding matches when the loaded patch changes
- applying active result styling to the correct rendered row/header target
