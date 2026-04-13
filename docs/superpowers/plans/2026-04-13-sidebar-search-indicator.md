# Sidebar Search Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it visually obvious when the sidebar search query is actively filtering tasks, especially when the filter reduces the visible list to a surprising subset.

**Architecture:** Keep the change inside the existing `Sidebar.vue` search UI so the active filter state is derived from the same local `searchQuery` ref that already drives filtering. Instead of a separate callout banner, make the sidebar itself enter a subtle filtered visual mode and show filtered/total repo counts, while preserving a search-aware empty state.

**Tech Stack:** Vue 3, Vue Test Utils, Vitest, vue-i18n

---

### Task 1: Add test coverage for active search filtering

**Files:**
- Create: `apps/desktop/src/components/__tests__/Sidebar.test.ts`
- Modify: `apps/desktop/src/components/Sidebar.vue`
- Modify: `apps/desktop/src/i18n/locales/en.json`

- [ ] **Step 1: Write the failing test**

Add a component test that mounts `Sidebar.vue`, types into the search input, and expects:
1. a visible active-filter indicator containing the query
2. a clear action
3. a search-aware empty state when no tasks match

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm test -- src/components/__tests__/Sidebar.test.ts`
Expected: FAIL because the filter indicator and filtered empty-state copy do not exist yet.

### Task 2: Implement the sidebar filter indicator

**Files:**
- Modify: `apps/desktop/src/components/Sidebar.vue`
- Modify: `apps/desktop/src/i18n/locales/en.json`

- [ ] **Step 1: Add derived search state**

Derive trimmed search text once and reuse it for matching, active-filter visibility, and the filtered empty state.

- [ ] **Step 2: Render the indicator and clear action**

Show a compact banner/chip above the repo list whenever the trimmed query is non-empty. Include the query text and a `Clear` button that resets the search.

- [ ] **Step 3: Render a search-aware empty state**

When a repo has zero visible tasks because of the active query, replace the generic `No tasks` message with copy that explicitly says no tasks match the current query.

### Task 3: Verify the change

**Files:**
- Test: `apps/desktop/src/components/__tests__/Sidebar.test.ts`

- [ ] **Step 1: Run the focused component test**

Run: `cd apps/desktop && pnpm test -- src/components/__tests__/Sidebar.test.ts`
Expected: PASS

- [ ] **Step 2: Run lightweight TypeScript/UI verification**

Run: `pnpm exec tsc --noEmit`
Expected: PASS
