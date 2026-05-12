# Resizable Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable desktop sidebar resize handle whose width is remembered per app window.

**Architecture:** `App.vue` owns layout resize state and drag handling because it already controls sidebar visibility and window workspace persistence. `windowWorkspace.ts` stores an optional `sidebarWidth` on each per-window snapshot entry, validates legacy snapshots, and exposes `persistSidebarWidth()`.

**Tech Stack:** Vue 3 Composition API, Vitest, Vue Test Utils, TypeScript, existing SQLite-backed workspace settings.

---

## File Structure

- Modify `apps/desktop/src/windowWorkspace.ts`: add `sidebarWidth` to `WorkspaceWindowState`, normalize it, and persist it per window.
- Modify `apps/desktop/src/windowWorkspace.test.ts`: cover legacy defaults, valid saved width preservation, invalid width fallback, and `persistSidebarWidth()`.
- Modify `apps/desktop/src/App.vue`: add sidebar width state, drag handlers, workspace hydration, inline sidebar sizing, and desktop-only resize handle.
- Modify `apps/desktop/src/App.test.ts`: cover restored width, drag persistence, clamping, and mobile handle omission.

## Constants

Use these values in `App.vue` and `windowWorkspace.ts`:

```ts
const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
```

### Task 1: Workspace Persistence

**Files:**
- Modify: `apps/desktop/src/windowWorkspace.ts`
- Test: `apps/desktop/src/windowWorkspace.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert snapshots default `sidebarWidth` to 260, preserve valid widths, clamp invalid widths back to 260, and `persistSidebarWidth(320)` updates only the current window.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --dir apps/desktop test src/windowWorkspace.test.ts`

Expected: FAIL because `sidebarWidth` and `persistSidebarWidth` do not exist.

- [ ] **Step 3: Implement persistence**

Add `sidebarWidth` to `WorkspaceWindowState`, normalize values with a helper, include it in new window records, preserve it in normalization, and expose `persistSidebarWidth(width: number)`.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --dir apps/desktop test src/windowWorkspace.test.ts`

Expected: PASS.

### Task 2: App Resize Behavior

**Files:**
- Modify: `apps/desktop/src/App.vue`
- Test: `apps/desktop/src/App.test.ts`

- [ ] **Step 1: Write failing app tests**

Add tests that mount the app, verify a saved `sidebarWidth` applies to the sidebar container, drag the resize handle to persist a new width, clamp below 220 and above 420, and verify the handle is absent in mobile mode.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --dir apps/desktop test src/App.test.ts`

Expected: FAIL because the resize wrapper and handle do not exist.

- [ ] **Step 3: Implement resize behavior**

In `App.vue`, add `sidebarWidth`, drag start/move/end handlers, pointer capture cleanup, workspace hydration from the current window entry, and a wrapper around `Sidebar` that applies `width`, `minWidth`, and `maxWidth`.

- [ ] **Step 4: Run app tests to verify pass**

Run: `pnpm --dir apps/desktop test src/App.test.ts`

Expected: PASS.

### Task 3: Focused Verification

**Files:**
- Verify: `apps/desktop/src/windowWorkspace.test.ts`
- Verify: `apps/desktop/src/App.test.ts`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --dir apps/desktop test src/windowWorkspace.test.ts src/App.test.ts
```

Expected: PASS.

- [ ] **Step 2: Inspect git diff**

Run: `git diff --stat && git diff -- apps/desktop/src/windowWorkspace.ts apps/desktop/src/App.vue`

Expected: changes are limited to sidebar width persistence and resize UI.
