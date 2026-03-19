# Maximize Toggle Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers-extended-cc:subagent-driven-development (if subagents available) or superpowers-extended-cc:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Shift+Cmd+Enter shortcut that toggles full-window maximization of the agent terminal, shell modal, or diff modal.

**Architecture:** Three independent boolean refs (`agentMaximized`, `shellMaximized`, `diffMaximized`) in App.vue. The shortcut toggles whichever is topmost (diff > shell > agent). CSS classes hide chrome or expand modals to full-bleed. Mirrors existing zen mode pattern.

**Tech Stack:** Vue 3, CSS, existing `useKeyboardShortcuts` composable

---

### Task 1: Add `toggleMaximize` shortcut definition

**Files:**
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.ts:3-16` (ActionName type)
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.ts:41-60` (shortcuts array)

- [ ] **Step 1: Add `toggleMaximize` to the `ActionName` union type**

```typescript
// In useKeyboardShortcuts.ts, add "toggleMaximize" to the ActionName union:
export type ActionName =
  | "newTask"
  | "openFile"
  | "makePR"
  | "merge"
  | "closeTask"
  | "navigateUp"
  | "navigateDown"
  | "toggleZen"
  | "dismiss"
  | "openShell"
  | "showDiff"
  | "showShortcuts"
  | "openPreferences"
  | "toggleMaximize";
```

- [ ] **Step 2: Add the shortcut definition to the `shortcuts` array**

Add after the `showDiff` entry, in a new "Window" section:

```typescript
  // Window
  { action: "toggleMaximize", label: "Toggle Maximize", group: "Window", key: "Enter", meta: true, shift: true, display: "Shift+Cmd+Enter" },
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | head -20`
Expected: Type error in App.vue because `useKeyboardShortcuts` now requires `toggleMaximize` in the actions object. This confirms the type system enforces the new action.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/composables/useKeyboardShortcuts.ts
git commit -m "feat: add toggleMaximize shortcut definition (Shift+Cmd+Enter)"
```

---

### Task 2: Add maximize state and handler to App.vue

**Files:**
- Modify: `apps/desktop/src/App.vue:59-67` (refs section)
- Modify: `apps/desktop/src/App.vue:178-201` (useKeyboardShortcuts call)
- Modify: `apps/desktop/src/App.vue:444-516` (template)
- Modify: `apps/desktop/src/App.vue:546-556` (scoped styles)

- [ ] **Step 1: Add three maximize refs after the existing modal refs**

After line 67 (`const zenMode = ref(false);`), add:

```typescript
const agentMaximized = ref(false);
const shellMaximized = ref(false);
const diffMaximized = ref(false);
```

- [ ] **Step 2: Add `toggleMaximize` handler to useKeyboardShortcuts**

In the `useKeyboardShortcuts` call (line 178), add:

```typescript
  toggleMaximize: () => {
    if (showDiffModal.value) { diffMaximized.value = !diffMaximized.value; }
    else if (showShellModal.value) { shellMaximized.value = !shellMaximized.value; }
    else { agentMaximized.value = !agentMaximized.value; }
  },
```

- [ ] **Step 3: Reset maximize state when modals close**

Update the `showDiff` and `openShell` toggle handlers to reset maximize when closing:

```typescript
  openShell: () => {
    showShellModal.value = !showShellModal.value;
    if (!showShellModal.value) shellMaximized.value = false;
  },
  showDiff: () => {
    showDiffModal.value = !showDiffModal.value;
    if (!showDiffModal.value) diffMaximized.value = false;
  },
```

Also update the `dismiss` handler — when closing diff or shell via Escape, reset their maximize state:

```typescript
  dismiss: () => {
    if (showShortcutsModal.value) { showShortcutsModal.value = false; return; }
    if (showFilePickerModal.value) { showFilePickerModal.value = false; return; }
    if (showDiffModal.value) { showDiffModal.value = false; diffMaximized.value = false; return; }
    if (showShellModal.value) { showShellModal.value = false; shellMaximized.value = false; focusAgentTerminal(); return; }
    if (showNewTaskModal.value) { showNewTaskModal.value = false; return; }
    if (showImportRepoModal.value) { showImportRepoModal.value = false; return; }
    if (showPreferencesPanel.value) { showPreferencesPanel.value = false; return; }
    if (zenMode.value) { zenMode.value = false; }
  },
```

- [ ] **Step 4: Update template — pass maximized props and hide sidebar**

Hide sidebar when agent is maximized (extend the existing `v-if`):

```html
<Sidebar v-if="!zenMode && !agentMaximized" ... />
```

Pass `maximized` prop to MainPanel:

```html
<MainPanel :maximized="agentMaximized" ... />
```

Pass `maximized` prop to ShellModal:

```html
<ShellModal :maximized="shellMaximized" ... />
```

Pass `maximized` prop to DiffModal:

```html
<DiffModal :maximized="diffMaximized" ... />
```

Update `@close` handlers on ShellModal and DiffModal to reset maximize state:

```html
<ShellModal ... @close="showShellModal = false; shellMaximized = false; focusAgentTerminal()" />
<DiffModal ... @close="showDiffModal = false; diffMaximized = false" />
```

- [ ] **Step 5: Verify TypeScript compilation passes**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | head -20`
Expected: May show errors from MainPanel/DiffModal/ShellModal not yet accepting `maximized` prop — that's fine, we'll fix those next.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/App.vue
git commit -m "feat: add maximize state, handler, and prop passing in App.vue"
```

---

### Task 3: Update MainPanel to support maximized mode

**Files:**
- Modify: `apps/desktop/src/components/MainPanel.vue:7-11` (props)
- Modify: `apps/desktop/src/components/MainPanel.vue:22-45` (template)

- [ ] **Step 1: Add `maximized` prop**

```typescript
defineProps<{
  item: PipelineItem | null;
  repoPath?: string;
  spawnPtySession?: (sessionId: string, cwd: string, prompt: string, cols: number, rows: number) => Promise<void>;
  maximized?: boolean;
}>();
```

- [ ] **Step 2: Conditionally hide TaskHeader and ActionBar**

```html
<template v-if="item">
  <TaskHeader v-if="!maximized" :item="item" />
  <TerminalTabs ... />
  <ActionBar v-if="!maximized" ... />
</template>
```

- [ ] **Step 3: Verify it compiles**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | head -20`
Expected: Clean or only errors from DiffModal/ShellModal (next tasks).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/components/MainPanel.vue
git commit -m "feat: hide header/action bar when MainPanel is maximized"
```

---

### Task 4: Update DiffModal to support maximized mode

**Files:**
- Modify: `apps/desktop/src/components/DiffModal.vue:4-8` (props)
- Modify: `apps/desktop/src/components/DiffModal.vue:17-21` (template)
- Modify: `apps/desktop/src/components/DiffModal.vue:24-44` (styles)

- [ ] **Step 1: Add `maximized` prop**

```typescript
defineProps<{
  repoPath: string;
  worktreePath?: string;
  initialScope?: "branch" | "commit" | "working";
  maximized?: boolean;
}>();
```

- [ ] **Step 2: Add maximized class to modal container**

```html
<div class="modal-overlay" :class="{ maximized }" @click.self="emit('close')">
  <div class="diff-modal">
    ...
  </div>
</div>
```

- [ ] **Step 3: Add maximized CSS**

```css
.modal-overlay.maximized {
  background: none;
}

.modal-overlay.maximized .diff-modal {
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  border: none;
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | head -20`
Expected: Clean or only ShellModal errors (next task).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/DiffModal.vue
git commit -m "feat: support maximized mode in DiffModal"
```

---

### Task 5: Update ShellModal to support maximized mode

**Files:**
- Modify: `apps/desktop/src/components/ShellModal.vue:6-9` (props)
- Modify: `apps/desktop/src/components/ShellModal.vue:33-43` (template)
- Modify: `apps/desktop/src/components/ShellModal.vue:45-67` (styles)

- [ ] **Step 1: Add `maximized` prop**

```typescript
const props = defineProps<{
  sessionId: string;
  cwd: string;
  maximized?: boolean;
}>();
```

- [ ] **Step 2: Add maximized class to modal container**

```html
<div class="modal-overlay" :class="{ maximized: props.maximized }" @click.self="emit('close')">
  <div class="shell-modal">
    ...
  </div>
</div>
```

- [ ] **Step 3: Add maximized CSS**

```css
.modal-overlay.maximized {
  background: none;
}

.modal-overlay.maximized .shell-modal {
  width: 100vw;
  height: 100vh;
  border-radius: 0;
  border: none;
  padding: 0;
}
```

- [ ] **Step 4: Verify full TypeScript compilation passes**

Run: `cd apps/desktop && bunx tsc --noEmit 2>&1 | head -20`
Expected: Clean — all props now match.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/ShellModal.vue
git commit -m "feat: support maximized mode in ShellModal"
```

---

### Task 6: Manual smoke test

- [ ] **Step 1: Start the dev server**

Run: `bun dev` (or use the existing tmux session)

- [ ] **Step 2: Test agent terminal maximize**

1. Select a task with an active agent terminal
2. Press Shift+Cmd+Enter — sidebar, header, action bar should disappear; terminal fills window
3. Press Shift+Cmd+Enter again — everything restores

- [ ] **Step 3: Test diff modal maximize**

1. Press Cmd+D to open diff
2. Press Shift+Cmd+Enter — diff should go full-bleed
3. Press Shift+Cmd+Enter — diff returns to normal size
4. Press Cmd+D to close diff

- [ ] **Step 4: Test shell modal maximize**

1. Press Cmd+J to open shell
2. Press Shift+Cmd+Enter — shell should go full-bleed
3. Press Shift+Cmd+Enter — shell returns to normal size
4. Press Cmd+J to close shell

- [ ] **Step 5: Test layering**

1. Press Shift+Cmd+Enter to maximize agent terminal
2. Press Cmd+D — diff opens at normal size over maximized agent
3. Press Shift+Cmd+Enter — diff maximizes
4. Press Shift+Cmd+Enter — diff un-maximizes (agent still maximized underneath)
5. Press Escape — diff closes, agent still maximized
6. Press Shift+Cmd+Enter — agent un-maximizes

- [ ] **Step 6: Verify shortcut appears in modal**

Press Cmd+/ — "Toggle Maximize" should appear under the "Window" group with "Shift+Cmd+Enter"
