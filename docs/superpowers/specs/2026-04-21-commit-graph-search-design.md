# Commit Graph Search

## Summary

Add transient keyboard-driven search to the commit graph modal. Search should behave like the existing search in the diff viewer and file previewer: open on demand with `/` or `Cmd+F`, keep the graph visible, jump between matches with `Enter` or `n` / `N`, and close search before closing the modal.

## Context

The commit graph already renders commit metadata returned by `git_graph`: message, full hash, short hash, author, parent hashes, refs, and timestamp. The modal supports navigation and mode switching (`auto` / `all`), but there is currently no way to quickly locate a commit by text.

Kanna already has an established search interaction in two adjacent views:

- `DiffView.vue` uses a transient bottom search bar, preserves the rendered content, and navigates matches without filtering.
- `FilePreviewModal.vue` uses `useInlineSearch` with the same `/`, `Cmd+F`, `Enter`, `n`, `N`, and `Escape` contract.

The commit graph should align with that contract rather than introducing a third search style.

## Design

### 1. Frontend-Only Search

Search is implemented entirely in `apps/desktop/src/components/CommitGraphView.vue`.

No changes are needed in:

- `apps/desktop/src-tauri/src/commands/git.rs`
- `apps/desktop/src/utils/commitGraph.ts`

Reasoning:

- `git_graph` already returns every field needed for matching.
- Search behavior is view-state and navigation, not repository-state.
- Avoiding a backend query keeps search responsive and scoped to whatever graph is already loaded in the current mode.

### 2. Searchable Surface

Each rendered commit row contributes one searchable text blob assembled from:

- commit message
- full hash
- short hash
- author
- ref names

Matching is case-insensitive substring search.

This mirrors the lightweight search model already used elsewhere in the app. No fuzzy ranking, regex mode, tokenization, or field-specific filters are included.

Example searchable text for a commit:

```text
feat: add commit graph search
ab12cd34ef56...
ab12cd3
Jeremy Hale
main origin/main v0.3.2
```

### 3. Search Bar Interaction

`CommitGraphView.vue` gains transient search UI rendered at the bottom of the modal, matching the visual placement used in diff and file preview.

Behavior:

- `/` opens search and focuses the input
- `Cmd+F` also opens search and focuses the input
- typing updates the query live
- the graph remains fully visible; commits are never hidden or filtered
- the count label shows `current/total` when matches exist
- when the query is non-empty and there are no matches, the bar shows a no-matches label

The search bar is hidden when inactive and does not consume permanent vertical space.

### 4. Match Navigation

Search navigates through matching commits rather than highlighting text fragments inside the rendered row.

State in `CommitGraphView.vue`:

- `isSearching: boolean`
- `searchQuery: string`
- `currentMatch: number`
- `searchMatches: Array<{ hash: string; row: number }>`

Navigation rules:

- `Enter` moves to the next match
- `Shift+Enter` moves to the previous match
- after `Enter`, focus returns to the graph container, matching diff/file-preview behavior
- `n` moves to the next match while search is open
- `N` moves to the previous match while search is open
- navigation wraps at the ends

When the query changes:

- recompute matches immediately
- reset `currentMatch` to the first match when matches exist
- scroll the graph to the active match

### 5. Active Match Presentation

Because commit graph rows are rendered as simple text spans rather than tokenized rich content, search does not try to decorate the exact matching substring.

Instead, matching is shown at the row level:

- active row gets a stronger background tint or outline
- other matches get a softer background tint

This preserves readability and gives the user spatial feedback when stepping through results.

### 6. Scrolling Behavior

`CommitGraphView.vue` already knows how to center a specific row when opening at `HEAD`. Reuse the same pattern for search navigation.

Add a helper:

```ts
function scrollToCommit(hash: string): void
```

Responsibilities:

- locate the commit in `layout.value.commits`
- compute the row position with the existing `py()` helper
- center that row in the scroll viewport

Search uses `scrollToCommit()` whenever:

- the query changes and the first match becomes active
- `Enter` / `Shift+Enter` advances to another match
- `n` / `N` advances to another match

If a query produces zero matches, scrolling does not change.

Search only considers commits currently loaded in the active graph mode. In `"auto"` mode, matches are limited to the `HEAD`-reachable graph already shown. In `"all"` mode, matches cover the full loaded graph.

### 7. Keyboard and Dismiss Semantics

The commit graph currently uses `useLessScroll()` for navigation and modal close behavior. Search should integrate with that layered dismissal model.

Rules:

- `Escape` closes the search bar first when it is open
- only after search is closed should dismiss close the modal
- `q` continues to close the modal when search is not open
- graph navigation keys (`j`, `k`, `f`, `b`, `d`, `u`, `g`, `G`) keep working when focus is on the graph container
- the existing space toggle for `auto` / `all` mode continues to work outside the search input

When the search input itself has focus:

- `Escape` closes search and returns focus to the graph container
- `Enter` / `Shift+Enter` navigates matches and returns focus to the graph container

### 8. Shortcut Help and Copy

The `"graph"` shortcut context should expose search shortcuts in the help overlay.

Add entries for:

- search: `/`
- search alt: `⌘F`
- next / previous match: `n / N`

Add new i18n strings for:

- commit graph search placeholder
- commit graph no matches
- commit graph search shortcut labels

The placeholder text should mirror the actual search surface, for example:

```text
Search commits, hashes, authors, and refs
```

### 9. Testing

Add component tests for `CommitGraphView.vue` covering:

- `/` opens the search bar and focuses the input
- `Cmd+F` opens the search bar and focuses the input
- query matching includes message, author, full hash or short hash, and refs
- `Enter` advances to the first or next match and returns focus to the graph container
- `Shift+Enter` moves backward
- `n` / `N` navigate while search is open
- `Escape` closes search before closing the modal
- no-match queries show the no-matches label

No backend tests are required because the feature does not change the Tauri command contract.

## Files Changed

| File | Change |
|------|--------|
| `apps/desktop/src/components/CommitGraphView.vue` | Add search state, search bar UI, keyboard handling, row highlighting, scroll-to-match behavior |
| `apps/desktop/src/components/CommitGraphModal.vue` | No behavior change expected unless dismiss exposure needs to remain layered |
| `apps/desktop/src/i18n/locales/en.json` | Add commit graph search strings |
| `apps/desktop/src/i18n/locales/ja.json` | Add commit graph search strings |
| `apps/desktop/src/i18n/locales/ko.json` | Add commit graph search strings |
| `apps/desktop/src/components/__tests__/CommitGraphView.test.ts` or equivalent new test file | Add search interaction coverage |

## Non-Goals

- filtering the graph down to matching commits
- backend search endpoints or git-side query support
- fuzzy search or ranked matching
- search result panels or indexed sidebars
- highlighting exact matching substrings within commit row text
