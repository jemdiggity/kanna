# Task Fuzzy Search

Replace the "Add Repo" button in the sidebar footer with a persistent search input that fuzzy-filters tasks by title, branch name, or prompt.

## Changes

### 1. Sidebar Footer

- Remove the "Add Repo" button and `add-repo` emit from `Sidebar.vue`
- Replace with a text input bound to a local `searchQuery` ref
- Placeholder: "Search tasks..." with `⌘F` hint
- `Escape` clears the query and blurs the input
- Repo creation remains available via `⌘I` / `⇧⌘I`

### 2. Fuzzy Matching

- Reuse `fuzzyMatch()` from `utils/fuzzyMatch.ts` (already used by the file picker)
- For each `PipelineItem`, match the query against four fields: `display_name`, `issue_title`, `prompt`, `branch`
- An item passes the filter if any field produces a non-null `fuzzyMatch` result
- Items that don't match are excluded from the sidebar
- Repos with zero matching items hide entirely (header + list)
- Within each category group (pinned, merge, PR, in-progress, blocked), matched items keep their existing sort order (no re-ranking by score)
- When the query is cleared, the full sidebar restores immediately

### 3. Keyboard Shortcut

- `⌘F` focuses the search input (added to `useKeyboardShortcuts.ts`)
- Sidebar exposes a `focusSearch()` method via `defineExpose`

### 4. Parent Cleanup

- Remove `@add-repo` handler from the parent component that renders `<Sidebar>`
- Remove any dead code associated with the old button

## Files Modified

- `apps/desktop/src/components/Sidebar.vue` — replace footer, add search filtering
- `apps/desktop/src/composables/useKeyboardShortcuts.ts` — add `⌘F` binding
- Parent of Sidebar (likely `App.vue`) — remove `@add-repo` handler
- `apps/desktop/src/i18n/locales/en.json` — add search placeholder string, remove `addRepo` string
- `apps/desktop/src/i18n/locales/ja.json` — same
- `apps/desktop/src/i18n/locales/ko.json` — same

## Non-Goals

- No match highlighting in the sidebar (items are already truncated to 40 chars)
- No re-ranking by score within categories
- No search across closed/done tasks
- No new dependencies
