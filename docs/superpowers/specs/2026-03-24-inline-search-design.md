# Inline Search for File Preview

**Date:** 2026-03-24
**Status:** Approved

## Summary

Add vim/less-style inline search (`/` to open, `n/N` to navigate) to the file preview modal. Uses Shiki's `decorations` API for zero-DOM-manipulation highlighting. Packaged as a reusable `useInlineSearch` composable for future use in other preview modals.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search style | Vim/less: `/` to open, `n/N` to navigate | Matches existing `useLessScroll` keybindings |
| Pattern matching | Plain text, case-insensitive | Simple — no regex complexity |
| Navigation during search | `n/N` jump matches, `j/k` scroll normally | Standard vim/less behavior |
| Dismiss behavior | `Esc` closes bar and clears highlights | Simplest mental model |
| Match counter | Shown ("3/12") | Cheap to implement, useful feedback |
| Highlight method | Shiki decorations API | No DOM manipulation, clean integration |
| Markdown mode | Search disabled; user switches to raw first | Rendered markdown uses markdown-it, not Shiki |
| Architecture | `useInlineSearch` composable + FilePreviewModal integration | Clean separation, reusable |
| Search bar position | Bottom of modal, absolute positioned | Vim/less convention |

## Architecture

### New: `useInlineSearch` composable

**File:** `apps/desktop/src/composables/useInlineSearch.ts`

```ts
interface InlineSearchReturn {
  // State
  isSearching: Ref<boolean>       // search bar visible
  query: Ref<string>              // current search text
  matchCount: Ref<number>         // total matches
  currentMatch: Ref<number>       // 1-based index of active match

  // Shiki decorations (consumers pass these to codeToHtml)
  decorations: ComputedRef<ShikiDecoration[]>

  // Actions
  openSearch: () => void          // show bar, focus input
  closeSearch: () => void         // hide bar, clear highlights
  nextMatch: () => void           // jump to next
  prevMatch: () => void           // jump to previous

  // Keyboard handler (for useLessScroll extraHandler chain)
  handleSearchKeys: (e: KeyboardEvent) => boolean
}

function useInlineSearch(rawText: Ref<string>): InlineSearchReturn
```

**Responsibilities:**
- Owns search state (query, matches, current index)
- Scans `rawText` for case-insensitive matches on query change (debounced ~150ms)
- Converts match character offsets to `{ line, character }` positions
- Produces Shiki-compatible decoration descriptors: all matches get `class: 'search-hl'`, active match gets `class: 'search-hl-active'`
- Handles search-related keyboard events

**Does NOT own:**
- Shiki calls or HTML generation (the component does that)
- DOM references or scrolling (the component handles scrollIntoView after re-render)

### Modified: `FilePreviewModal.vue`

**Integration points:**

1. **Composable setup:** Call `useInlineSearch(content)` alongside existing composables
2. **Shiki re-rendering:** The existing `loadFile()` function produces `highlighted.value`. This becomes reactive to search decorations — when decorations change, re-run `codeToHtml` with the new decorations array. The Shiki highlighter caches tokenization, so re-rendering with different decorations is fast.
3. **Extra handler chain:** `handleSearchKeys` is called first in the `extraHandler` passed to `useLessScroll`. If it returns `true`, the existing handlers (`⌘O`, `l`, `m`) are skipped.
4. **Scroll to active match:** After `highlighted.value` updates, `nextTick(() => contentRef.value?.querySelector('.search-hl-active')?.scrollIntoView({ block: 'center' }))`.
5. **Markdown gate:** When `renderMarkdown` is true, `handleSearchKeys` returns `false` for `/` (search disabled in rendered mode).
6. **Shortcut registration:** Add `{ label: "Search", display: "/" }` and `{ label: "Next/prev match", display: "n / N" }` to `registerContextShortcuts`.

### Keyboard behavior

| Key | Context | Action |
|-----|---------|--------|
| `/` | Not searching, not in rendered markdown | Open search bar, focus input |
| `Escape` | Search bar open | Close search bar, clear highlights |
| `Enter` | Search input focused | Jump to next match |
| `Shift+Enter` | Search input focused | Jump to previous match |
| `n` | Not searching, matches exist | Jump to next match |
| `N` (Shift+n) | Not searching, matches exist | Jump to previous match |
| `j/k/f/b/d/u/g/G` | Always | Normal scroll (unaffected by search) |

**Note:** When search input is focused, `useLessScroll`'s `isInputTarget` check naturally prevents scroll keys from firing — typing works without conflict.

### Search bar UI

- Position: `absolute; bottom: 0; left: 0; right: 0` inside `.preview-modal`
- Layout: single row — `/` prefix label, `<input>`, match counter text
- Styling: `background: #1e1e1e; border-top: 1px solid #333`; monospace 12px; matches modal header aesthetic
- Match counter: "3/12" when matches found, "No matches" when query has no hits, hidden when query is empty
- Input auto-focuses on open
- When hidden, no space is reserved — content area is unaffected

### CSS classes

```css
.search-hl {
  background: rgba(255, 200, 0, 0.25);
  border-radius: 2px;
}

.search-hl-active {
  background: rgba(255, 200, 0, 0.55);
  border-radius: 2px;
  outline: 1px solid rgba(255, 200, 0, 0.8);
}
```

### Data flow

```
User presses "/" → openSearch() → isSearching = true → search bar renders, input focuses
User types query → query ref updates (debounced 150ms)
  → scan rawText for matches → compute decorations array
  → FilePreviewModal re-runs codeToHtml(code, { decorations })
  → highlighted.value updates → Vue re-renders
  → nextTick → scrollIntoView('.search-hl-active')
User presses Enter/n → nextMatch() → currentMatch increments → decorations recompute (active class moves)
User presses Esc → closeSearch() → query = "", isSearching = false → decorations = [] → clean re-render
```

### Edge cases

- **Empty query:** decorations array is empty, match count shows nothing
- **No matches:** counter shows "No matches", `n/N` are no-ops
- **File changes (navigation):** `rawText` ref changes → `query` persists but matches recompute. `closeSearch()` should be called on file change (when `filePath` prop changes).
- **Large files:** Shiki tokenization is cached; re-rendering with new decorations is O(tokens). For files under 10k lines, this is near-instant with 150ms debounce.
- **Rendered markdown mode:** `/` is a no-op; if search is open when user presses `m`, close search first.

## Reusability

The composable is generic — it takes raw text and returns decorations + state. Any component that uses Shiki for rendering can drop it in. The keyboard handler integrates with `useLessScroll`'s `extraHandler` pattern. Future preview modals (e.g., diff preview) can reuse this composable by:

1. Calling `useInlineSearch(rawText)`
2. Passing `decorations.value` to their Shiki `codeToHtml` call
3. Chaining `handleSearchKeys` into their key handler

## Files to create/modify

| File | Action |
|------|--------|
| `apps/desktop/src/composables/useInlineSearch.ts` | Create |
| `apps/desktop/src/components/FilePreviewModal.vue` | Modify |
| i18n locale files | Add search-related strings |

## Testing

- Unit test `useInlineSearch`: verify match finding, decoration generation, navigation cycling, edge cases (empty query, no matches, wrap-around)
- Manual test in FilePreviewModal: `/` opens bar, typing highlights, `n/N` navigate, `Esc` clears, markdown mode disables search
