# Diff Viewer Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file-preview-style search to the diff viewer for the currently loaded patch, including file names, hunk headers, and diff line text.

**Architecture:** Keep search state in `DiffView.vue`, build a structured search index from parsed patch metadata, and apply active/inactive match classes into each `FileDiff` shadow root after render. This avoids backend changes and avoids brittle free-form text wrapping across the renderer DOM.

**Tech Stack:** Vue 3, Vitest, happy-dom, `@pierre/diffs`, vue-i18n

---

### Task 1: Add Failing Tests For Diff Search UX

**Files:**
- Modify: `apps/desktop/src/components/__tests__/DiffView.test.ts`
- Test: `apps/desktop/src/components/__tests__/DiffView.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("opens diff search with slash and focuses the input", async () => {
  // Mount DiffView, dispatch "/", expect .search-input to exist and be focused.
});

it("returns focus to the diff modal after confirming search with Enter", async () => {
  // Open search, enter a query, press Enter, expect focus on .diff-view.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm test -- src/components/__tests__/DiffView.test.ts`
Expected: FAIL because `DiffView` does not yet render a search UI.

- [ ] **Step 3: Write minimal implementation**

```ts
// Add search state, input rendering, and focus handoff in DiffView.vue.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm test -- src/components/__tests__/DiffView.test.ts`
Expected: PASS for the new search-focus tests.

### Task 2: Add Failing Tests For Patch Search Indexing

**Files:**
- Create: `apps/desktop/src/utils/diffSearch.ts`
- Create: `apps/desktop/src/utils/diffSearch.test.ts`
- Modify: `apps/desktop/src/components/DiffView.vue`
- Test: `apps/desktop/src/utils/diffSearch.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("finds matches in file names, hunk headers, and diff lines", () => {
  // Build a parsed patch fixture and expect ordered search targets across all three target types.
});

it("returns zero matches for an empty query", () => {
  // Expect no results and current match reset behavior.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm test -- src/utils/diffSearch.test.ts`
Expected: FAIL because the helper does not yet exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export function buildDiffSearchIndex(...) { ... }
export function findDiffSearchMatches(...) { ... }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm test -- src/utils/diffSearch.test.ts`
Expected: PASS.

### Task 3: Wire Search Results Into Diff Rendering

**Files:**
- Modify: `apps/desktop/src/components/DiffView.vue`
- Modify: `apps/desktop/src/i18n/locales/en.json`
- Modify: `apps/desktop/src/i18n/locales/ja.json`
- Modify: `apps/desktop/src/i18n/locales/ko.json`
- Test: `apps/desktop/src/components/__tests__/DiffView.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("marks the active diff search result in the rendered diff", async () => {
  // Mock FileDiff rendering with searchable header/line nodes, navigate to a match,
  // and expect active/inactive classes on the right target.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm test -- src/components/__tests__/DiffView.test.ts`
Expected: FAIL because DiffView does not yet map search results into rendered nodes.

- [ ] **Step 3: Write minimal implementation**

```ts
// Apply search result classes after each render and on current-match changes.
// Add i18n strings for search shortcuts and empty-state labels.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm test -- src/components/__tests__/DiffView.test.ts`
Expected: PASS.

### Task 4: Run Focused Verification

**Files:**
- Modify: `apps/desktop/src/components/DiffView.vue`
- Modify: `apps/desktop/src/components/__tests__/DiffView.test.ts`
- Modify: `apps/desktop/src/utils/diffSearch.ts`
- Modify: `apps/desktop/src/utils/diffSearch.test.ts`

- [ ] **Step 1: Run focused frontend tests**

```bash
cd apps/desktop && pnpm test -- src/components/__tests__/DiffView.test.ts src/utils/diffSearch.test.ts
```

- [ ] **Step 2: Run TypeScript verification**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 3: Review the diff for scope**

```bash
git diff -- apps/desktop/src/components/DiffView.vue apps/desktop/src/components/__tests__/DiffView.test.ts apps/desktop/src/utils/diffSearch.ts apps/desktop/src/utils/diffSearch.test.ts apps/desktop/src/i18n/locales/en.json apps/desktop/src/i18n/locales/ja.json apps/desktop/src/i18n/locales/ko.json
```
