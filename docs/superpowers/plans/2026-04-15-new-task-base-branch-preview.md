# New Task Base Branch Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone dev-only preview for the compact base-branch dropdown so the interaction can be evaluated before changing the production new-task modal.

**Architecture:** Mount a dedicated preview component from `main.ts` when a specific browser query parameter is present in development. Keep the branch dropdown behavior self-contained in the preview component, but reuse the existing base-branch ordering and fuzzy filtering helpers so the mock exercises real branch-search behavior instead of a fake implementation.

**Tech Stack:** Vue 3, TypeScript, Vitest, Vue Test Utils

---

### Task 1: Add red tests for the preview entrypoint and compact dropdown

**Files:**
- Create: `apps/desktop/src/components/__tests__/BaseBranchDropdownPreview.test.ts`
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Write the failing preview mount test**

Assert that when the URL contains a dev preview query flag, `main.ts` mounts the preview component instead of the full app shell.

- [ ] **Step 2: Write the failing dropdown behavior tests**

Assert that the preview renders:
1. a compact trigger row
2. a search input inside the dropdown
3. a results list with a fixed max-height style representing about 7 visible rows
4. keyboard and click selection behavior that updates the selected branch label

- [ ] **Step 3: Run the focused tests to verify they fail**

Run: `cd apps/desktop && pnpm test -- src/components/__tests__/BaseBranchDropdownPreview.test.ts src/main.preview.test.ts`
Expected: FAIL because the preview component and dev-only mount path do not exist yet.

### Task 2: Implement the standalone preview

**Files:**
- Create: `apps/desktop/src/components/BaseBranchDropdownPreview.vue`
- Create: `apps/desktop/src/main.preview.test.ts`
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Add a preview component**

Build a browser-only page that shows the proposed new-task layout fragment with a compact base-branch dropdown, seeded with a large branch list.

- [ ] **Step 2: Reuse existing branch filtering**

Use `filterBaseBranchCandidates()` and `getDefaultBaseBranch()` from `apps/desktop/src/utils/baseBranchPicker.ts` so the preview reflects the real branch ranking and fuzzy search behavior.

- [ ] **Step 3: Add dev-only mount wiring**

Teach `main.ts` to inspect a query parameter such as `?preview=base-branch-dropdown` and mount the preview component in development without affecting normal app startup.

### Task 3: Verify the preview end to end

**Files:**
- Test: `apps/desktop/src/components/__tests__/BaseBranchDropdownPreview.test.ts`
- Test: `apps/desktop/src/main.preview.test.ts`

- [ ] **Step 1: Run the focused preview tests**

Run: `cd apps/desktop && pnpm test -- src/components/__tests__/BaseBranchDropdownPreview.test.ts src/main.preview.test.ts`
Expected: PASS

- [ ] **Step 2: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit`
Expected: PASS
