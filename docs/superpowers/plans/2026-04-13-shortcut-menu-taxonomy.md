# Shortcut Menu Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the full keyboard shortcuts menu into workflow-first categories without changing the modal layout or shortcut behavior.

**Architecture:** Keep the shortcut modal rendering path intact and move the taxonomy change into the shortcut definition/grouping layer. Add tests around full-menu group titles, ordering, and membership so the category rethink is enforced in one place.

**Tech Stack:** Vue 3, TypeScript, Vitest, vue-i18n

---

### Task 1: Define the expected taxonomy in tests

**Files:**
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.ts`
- Create: `apps/desktop/src/composables/useKeyboardShortcuts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("groups full-menu shortcuts by workflow-first categories", () => {
  const groups = getShortcutGroups((key) => key);
  expect(groups.map((group) => group.title)).toEqual([
    "shortcuts.groupCreateOrganize",
    "shortcuts.groupMoveAround",
    "shortcuts.groupOpenInspect",
    "shortcuts.groupWorkspace",
    "shortcuts.groupAppHelp",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/src/composables/useKeyboardShortcuts.test.ts`
Expected: FAIL because the old group keys and memberships still produce the previous taxonomy.

- [ ] **Step 3: Write minimal implementation**

```ts
const groupOrder = [
  "shortcuts.groupCreateOrganize",
  "shortcuts.groupMoveAround",
  "shortcuts.groupOpenInspect",
  "shortcuts.groupWorkspace",
  "shortcuts.groupAppHelp",
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/desktop/src/composables/useKeyboardShortcuts.test.ts`
Expected: PASS

### Task 2: Reassign shortcuts to the new categories

**Files:**
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.ts`
- Modify: `apps/desktop/src/i18n/locales/en.json`
- Modify: `apps/desktop/src/i18n/locales/ja.json`
- Modify: `apps/desktop/src/i18n/locales/ko.json`
- Test: `apps/desktop/src/composables/useKeyboardShortcuts.test.ts`

- [ ] **Step 1: Extend the failing test with group membership assertions**

```ts
expect(groupMap["shortcuts.groupOpenInspect"]).toEqual([
  "shortcuts.filePicker",
  "shortcuts.viewDiff",
  "shortcuts.commitGraph",
  "shortcuts.shellTerminal",
  "shortcuts.shellRepoRoot",
  "shortcuts.openInIDE",
  "shortcuts.treeExplorer",
]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/src/composables/useKeyboardShortcuts.test.ts`
Expected: FAIL because the affected shortcuts still belong to the previous buckets.

- [ ] **Step 3: Update group keys and translations**

```ts
{ action: "openFile", labelKey: "shortcuts.filePicker", groupKey: "shortcuts.groupOpenInspect", ... }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/desktop/src/composables/useKeyboardShortcuts.test.ts`
Expected: PASS

### Task 3: Verify the unchanged modal wiring against the new taxonomy

**Files:**
- Modify: `apps/desktop/src/components/KeyboardShortcutsModal.vue`
- Test: `apps/desktop/src/composables/useKeyboardShortcuts.test.ts`

- [ ] **Step 1: Confirm no layout logic depends on the old category names**

```ts
const groups = computed(() => getShortcutGroups(t));
```

- [ ] **Step 2: Run targeted tests and typecheck**

Run: `pnpm exec vitest run apps/desktop/src/composables/useKeyboardShortcuts.test.ts apps/desktop/src/composables/useShortcutContext.test.ts`
Expected: PASS

Run: `pnpm exec tsc --noEmit`
Expected: PASS
