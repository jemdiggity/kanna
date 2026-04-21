# Shortcut Modal Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every shortcut menu use the same visual structure as the main shortcut menu while keeping context views filtered to their relevant shortcuts.

**Architecture:** Keep `KeyboardShortcutsModal.vue` as the single source of truth for shortcut-menu presentation. Build shared display entries for both full and context modes, then render both modes through the same grid/entry primitives so styling, spacing, alignment, and keycaps stay consistent.

**Tech Stack:** Vue 3, TypeScript, Vitest, Vue Test Utils

---

### Task 1: Add a failing regression test for context-mode layout cohesion

**Files:**
- Modify: `apps/desktop/src/components/__tests__/KeyboardShortcutsModal.test.ts`
- Test: `apps/desktop/src/components/__tests__/KeyboardShortcutsModal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("renders context-mode shortcuts with the shared shortcut-entry layout", () => {
  const wrapper = mount(KeyboardShortcutsModal, {
    props: {
      context: "diff",
    },
  });

  const contextEntries = wrapper.findAll(".shortcut-entry");
  expect(contextEntries.length).toBeGreaterThan(0);
  expect(wrapper.find(".context-shortcuts").exists()).toBe(false);
  expect(contextEntries.some((entry) => entry.text().includes("diffView.shortcutSearch"))).toBe(true);
  expect(contextEntries.some((entry) => entry.text().includes("diffView.shortcutClose"))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/desktop exec vitest run src/components/__tests__/KeyboardShortcutsModal.test.ts`

Expected: FAIL because context mode still renders `.context-shortcuts` rows instead of `.shortcut-entry` items.

- [ ] **Step 3: Write minimal implementation**

```ts
interface ShortcutDisplayEntrySection {
  kind: "section";
  key: string;
  text: string;
}

interface ShortcutDisplayEntryItem {
  kind: "item";
  key: string;
  action: string;
  keys: string;
}

type ShortcutDisplayEntry = ShortcutDisplayEntrySection | ShortcutDisplayEntryItem;

const contextModeEntries = computed((): ShortcutDisplayEntry[] => [
  {
    kind: "section",
    key: `${props.context}-section`,
    text: contextTitle.value,
  },
  ...contextItems.value.map((shortcut) => ({
    kind: "item" as const,
    key: `${props.context}-${shortcut.action}-${shortcut.keys}`,
    action: shortcut.action,
    keys: shortcut.keys,
  })),
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/desktop exec vitest run src/components/__tests__/KeyboardShortcutsModal.test.ts`

Expected: PASS with the new context-mode regression test and existing full-mode grid test both green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/__tests__/KeyboardShortcutsModal.test.ts apps/desktop/src/components/KeyboardShortcutsModal.vue
git commit -m "fix: unify shortcut modal layouts"
```

### Task 2: Render both shortcut modes through one shared modal layout

**Files:**
- Modify: `apps/desktop/src/components/KeyboardShortcutsModal.vue`
- Test: `apps/desktop/src/components/__tests__/KeyboardShortcutsModal.test.ts`

- [ ] **Step 1: Replace the split templates with one shared entry renderer**

```vue
<div :class="showFullMode ? 'shortcuts-grid' : 'context-grid'">
  <div
    v-for="entry in visibleEntries"
    :key="entry.key"
    :class="['shortcut-entry', `shortcut-entry--${entry.kind}`]"
    :style="showFullMode ? { gridColumn: `${entry.column}`, gridRow: `${entry.row}` } : undefined"
  >
    <template v-if="entry.kind === 'section'">
      <h4>{{ entry.text }}</h4>
    </template>
    <template v-else>
      <span class="shortcut-action">{{ entry.action }}</span>
      <span class="shortcut-keys">
        <kbd v-for="(k, i) in splitKeys(entry.keys)" :key="i">{{ k }}</kbd>
      </span>
    </template>
  </div>
</div>
```

- [ ] **Step 2: Add focused styles for the shared layout**

```css
.context-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-auto-rows: minmax(28px, auto);
  row-gap: 9px;
  margin-bottom: 12px;
}

.shortcut-entry {
  min-height: 28px;
  display: flex;
  align-items: center;
}

.shortcut-entry--item {
  font-size: 13px;
}
```

- [ ] **Step 3: Run the focused modal test suite**

Run: `pnpm --dir apps/desktop exec vitest run src/components/__tests__/KeyboardShortcutsModal.test.ts`

Expected: PASS with both full-mode and context-mode coverage green.

- [ ] **Step 4: Run the related diff-view regression suite**

Run: `pnpm --dir apps/desktop exec vitest run src/components/__tests__/DiffView.test.ts`

Expected: PASS to confirm the diff context still registers the expected shortcuts and no modal-adjacent regressions were introduced.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/KeyboardShortcutsModal.vue apps/desktop/src/components/__tests__/KeyboardShortcutsModal.test.ts
git commit -m "fix: share shortcut modal layout across contexts"
```
