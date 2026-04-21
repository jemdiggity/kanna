# Context Shortcut Subgroups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add finer-grained labeled subgroups to context shortcut menus so modal-specific shortcuts are easier to scan without reintroducing cross-tool clutter.

**Architecture:** Extend context shortcut registrations with subgroup metadata, then teach `useShortcutContext` and `KeyboardShortcutsModal` to render those subgroup labels inside the existing three-column context layout. Shared subgroup titles come from i18n so the file preview, diff, tree, graph, and new-task menus can all reuse the same labels.

**Tech Stack:** Vue 3, TypeScript, Vue I18n, Vitest

---

### Task 1: Add failing tests for subgrouped context shortcuts

**Files:**
- Modify: `apps/desktop/src/composables/useShortcutContext.test.ts`
- Modify: `apps/desktop/src/components/__tests__/KeyboardShortcutsModal.test.ts`
- Test: `apps/desktop/src/composables/useShortcutContext.test.ts`
- Test: `apps/desktop/src/components/__tests__/KeyboardShortcutsModal.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("groups file context shortcuts into search, navigation, view, and help sections", () => {
  register("file", [
    { label: "Search", display: "/", groupKey: "shortcuts.groupSearch" },
    { label: "Next / Prev match", display: "n / N", groupKey: "shortcuts.groupSearch" },
    { label: "Line ↓/↑", display: "j / k", groupKey: "shortcuts.groupNavigation" },
    { label: "Toggle line numbers", display: "l", groupKey: "shortcuts.groupViews" },
  ]);

  const result = getContextShortcutGroups((key) => key, "file");

  expect(result.map((group) => group.key)).toEqual([
    "shortcuts.groupWorkspace",
    "shortcuts.groupAppHelp",
    "shortcuts.groupSearch",
    "shortcuts.groupNavigation",
    "shortcuts.groupViews",
  ]);
});
```

```ts
it("renders file context subgroup headers in separate context sections", () => {
  setContextShortcuts("file", [
    { label: "filePreview.shortcutSearch", display: "/", groupKey: "shortcuts.groupSearch" },
    { label: "filePreview.shortcutLineUpDown", display: "j / k", groupKey: "shortcuts.groupNavigation" },
    { label: "filePreview.shortcutToggleLineNumbers", display: "l", groupKey: "shortcuts.groupViews" },
  ]);

  const wrapper = mount(KeyboardShortcutsModal, {
    props: { context: "file" },
  });

  expect(wrapper.text()).toContain("shortcuts.groupSearch");
  expect(wrapper.text()).toContain("shortcuts.groupNavigation");
  expect(wrapper.text()).toContain("shortcuts.groupViews");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/desktop exec vitest run src/composables/useShortcutContext.test.ts src/components/__tests__/KeyboardShortcutsModal.test.ts`

Expected: FAIL because context shortcuts do not yet support subgroup metadata or render subgroup headers.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ContextShortcut {
  label: string;
  display: string;
  groupKey?: string;
}
```

```ts
const groupKey = s.groupKey ?? extraGroupKey;
const existing = result.get(groupKey) ?? [];
existing.push({ keys: s.display, action: resolveAction(s.label, false) });
result.set(groupKey, existing);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir apps/desktop exec vitest run src/composables/useShortcutContext.test.ts src/components/__tests__/KeyboardShortcutsModal.test.ts`

Expected: PASS with subgroup ordering and modal rendering coverage green.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/composables/useShortcutContext.ts apps/desktop/src/composables/useShortcutContext.test.ts apps/desktop/src/components/KeyboardShortcutsModal.vue apps/desktop/src/components/__tests__/KeyboardShortcutsModal.test.ts
git commit -m "feat: add context shortcut subgroups"
```

### Task 2: Register translated subgroup labels for context-specific menus

**Files:**
- Modify: `apps/desktop/src/components/FilePreviewModal.vue`
- Modify: `apps/desktop/src/components/DiffView.vue`
- Modify: `apps/desktop/src/components/TreeExplorerModal.vue`
- Modify: `apps/desktop/src/components/CommitGraphView.vue`
- Modify: `apps/desktop/src/components/NewTaskModal.vue`
- Modify: `apps/desktop/src/i18n/locales/en.json`
- Modify: `apps/desktop/src/i18n/locales/ja.json`
- Modify: `apps/desktop/src/i18n/locales/ko.json`
- Test: `apps/desktop/src/composables/useShortcutContext.test.ts`
- Test: `apps/desktop/src/components/__tests__/KeyboardShortcutsModal.test.ts`

- [ ] **Step 1: Add shared subgroup titles to locale files**

```json
"groupSearch": "Search",
"groupActions": "Actions"
```

- [ ] **Step 2: Update context registrations to assign subgroup keys**

```ts
registerContextShortcuts("file", [
  { label: t("filePreview.shortcutSearch"), display: "/", groupKey: "shortcuts.groupSearch" },
  { label: t("filePreview.shortcutNextPrevMatch"), display: "n / N", groupKey: "shortcuts.groupSearch" },
  { label: t("filePreview.shortcutLineUpDown"), display: "j / k", groupKey: "shortcuts.groupNavigation" },
  { label: t("filePreview.shortcutToggleLineNumbers"), display: "l", groupKey: "shortcuts.groupViews" },
  { label: t("filePreview.shortcutOpenIDE"), display: "⌘O", groupKey: "shortcuts.groupActions" },
  { label: t("filePreview.shortcutClose"), display: "q", groupKey: "shortcuts.groupActions" },
]);
```

- [ ] **Step 3: Run focused verification**

Run: `pnpm --dir apps/desktop exec vitest run src/composables/useShortcutContext.test.ts src/components/__tests__/KeyboardShortcutsModal.test.ts src/components/__tests__/DiffView.test.ts`

Expected: PASS with subgrouped context menus still preserving help placement and cross-tool filtering.

- [ ] **Step 4: Run desktop typecheck**

Run: `pnpm exec tsc --noEmit`

Expected: PASS from `apps/desktop`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/FilePreviewModal.vue apps/desktop/src/components/DiffView.vue apps/desktop/src/components/TreeExplorerModal.vue apps/desktop/src/components/CommitGraphView.vue apps/desktop/src/components/NewTaskModal.vue apps/desktop/src/i18n/locales/en.json apps/desktop/src/i18n/locales/ja.json apps/desktop/src/i18n/locales/ko.json
git commit -m "feat: group context shortcuts by task"
```
