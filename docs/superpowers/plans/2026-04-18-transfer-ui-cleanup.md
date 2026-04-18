# Transfer UI Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the main-window footer action bar, expose `Push to Machine` from the command palette, and keep `Advance Stage` on its existing shortcut/palette path.

**Architecture:** The main-window footer is deleted from the `App.vue` composition so the task view no longer renders transfer/stage buttons. `Push to Machine` is reintroduced as a dynamic command generated in `App.vue` and passed into `CommandPaletteModal`, reusing the existing peer-picker flow. Tests move from footer-specific assertions to command-palette behavior assertions.

**Tech Stack:** Vue 3, Vitest, Vue Test Utils, Pinia

---

### Task 1: Replace Footer Coverage With Command Palette Coverage

**Files:**
- Modify: `apps/desktop/src/App.test.ts`
- Delete: `apps/desktop/src/components/__tests__/ActionBar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("adds Push to Machine to command palette commands for active tasks", async () => {
  // Mount App with an active current item, open the command palette,
  // and assert the CommandPaletteModal receives a dynamic command
  // labeled "Push to Machine".
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts -t "Push to Machine to command palette commands"`
Expected: FAIL because `App.vue` does not yet inject the command into `CommandPaletteModal`.

- [ ] **Step 3: Write minimal implementation**

```ts
const paletteDynamicCommands = computed<DynamicCommand[]>(() => {
  const item = store.currentItem;
  if (!item || item.stage === "done") return [];
  return [{
    id: "push-to-machine",
    label: t("taskTransfer.pushToMachine"),
    execute: () => openPeerPicker(item.id),
  }];
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts -t "Push to Machine to command palette commands"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.test.ts apps/desktop/src/App.vue apps/desktop/src/components/__tests__/ActionBar.test.ts
git commit -m "Move task transfer action into command palette"
```

### Task 2: Remove Main-Window Footer Action Bar

**Files:**
- Modify: `apps/desktop/src/App.vue`
- Delete: `apps/desktop/src/components/ActionBar.vue`

- [ ] **Step 1: Write the failing test**

```ts
it("does not render the footer action bar for the current task view", async () => {
  // Mount App with a current item and assert no ActionBar component is rendered.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts -t "does not render the footer action bar"`
Expected: FAIL because `App.vue` still renders `ActionBar`.

- [ ] **Step 3: Write minimal implementation**

```vue
<!-- Remove ActionBar import and template usage -->
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts -t "does not render the footer action bar"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/App.vue apps/desktop/src/components/ActionBar.vue
git commit -m "Remove task view footer action bar"
```

### Task 3: Verify Full UI Cleanup Slice

**Files:**
- Modify: `apps/desktop/src/App.test.ts`

- [ ] **Step 1: Run focused UI tests**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts`
Expected: PASS

- [ ] **Step 2: Run transfer regression tests**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/kannaTransfer.test.ts`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `cd apps/desktop && pnpm exec vue-tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/App.test.ts apps/desktop/src/App.vue
git commit -m "Clean up transfer UI entry points"
```
