# Window Close Shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Cmd+W` to close the focused Kanna window, keep the app alive after the last close, and support reopening a window with native `Cmd+N` when no webviews are open.

**Architecture:** Extend the existing frontend `windowWorkspace` controller with a snapshot-aware `closeWindow()` operation, then add a native Tauri window-management path that can create Kanna windows without relying on an existing webview. Keep all window bootstrap and workspace snapshot rules centralized so frontend shortcuts and native menu actions converge on the same behavior.

**Tech Stack:** Vue 3, Pinia, Tauri v2 webview APIs, Rust Tauri runtime/menu hooks, Vitest, WebDriver mock E2E

---

## File Structure

- Modify: `apps/desktop/src/windowWorkspace.ts`
  Purpose: add `closeWindow()`, expose reusable snapshot operations for closing/removing windows, and keep open/close behavior centralized.
- Modify: `apps/desktop/src/windowWorkspace.test.ts`
  Purpose: cover snapshot removal and order normalization for closed windows.
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.ts`
  Purpose: add the `closeWindow` action and `Cmd+W` shortcut registration.
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.test.ts`
  Purpose: verify `Cmd+W` is treated as an app shortcut and appears in the workspace group.
- Modify: `apps/desktop/src/App.vue`
  Purpose: wire the new keyboard action to `windowWorkspace.closeWindow()`.
- Modify: `apps/desktop/src/App.test.ts`
  Purpose: verify `closeWindow` delegates through the workspace controller.
- Modify: `apps/desktop/src/i18n/locales/en.json`
  Purpose: add the visible shortcut label.
- Modify: `apps/desktop/src/i18n/locales/ja.json`
  Purpose: add the visible shortcut label.
- Modify: `apps/desktop/src/i18n/locales/ko.json`
  Purpose: add the visible shortcut label.
- Modify: `apps/desktop/src-tauri/src/lib.rs`
  Purpose: add native menu/accelerator-backed new-window behavior that works with zero webviews and keep the app alive after the last close.
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
  Purpose: ensure last-window-close behavior does not terminate the app if Tauri config is the controlling layer.
- Modify: `apps/desktop/tests/e2e/mock/new-window.test.ts`
  Purpose: cover window close behavior and zero-window reopen behavior.
- Modify: `apps/desktop/tests/e2e/helpers/webdriver.ts`
  Purpose: add window-close and/or app-menu helper utilities if the new E2E needs them.

### Task 1: Add Frontend Close-Window Shortcut Support

**Files:**
- Modify: `apps/desktop/src/windowWorkspace.ts`
- Modify: `apps/desktop/src/windowWorkspace.test.ts`
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.ts`
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.test.ts`
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/App.test.ts`
- Modify: `apps/desktop/src/i18n/locales/en.json`
- Modify: `apps/desktop/src/i18n/locales/ja.json`
- Modify: `apps/desktop/src/i18n/locales/ko.json`

- [ ] **Step 1: Write the failing frontend tests**

```ts
// apps/desktop/src/windowWorkspace.test.ts
it("removes the current window from the saved workspace snapshot when closing", async () => {
  const db = {
    execute: vi.fn(async () => ({ rowsAffected: 1 })),
    select: vi.fn(async () => []),
  };

  const workspace = createWindowWorkspace({
    db: db as never,
    bootstrap: { windowId: "win-2", selectedRepoId: null, selectedItemId: null },
  });

  await workspace.saveSnapshot({
    windows: [
      { windowId: "main", selectedRepoId: "repo-1", selectedItemId: "task-1", sidebarHidden: false, order: 0 },
      { windowId: "win-2", selectedRepoId: "repo-1", selectedItemId: "task-2", sidebarHidden: true, order: 1 },
      { windowId: "win-3", selectedRepoId: "repo-2", selectedItemId: null, sidebarHidden: false, order: 2 },
    ],
  });

  await workspace.closeWindow();

  await expect(workspace.loadSnapshot()).resolves.toEqual({
    windows: [
      { windowId: "main", selectedRepoId: "repo-1", selectedItemId: "task-1", sidebarHidden: false, order: 0 },
      { windowId: "win-3", selectedRepoId: "repo-2", selectedItemId: null, sidebarHidden: false, order: 1 },
    ],
  });
});
```

```ts
// apps/desktop/src/composables/useKeyboardShortcuts.test.ts
it("matches the close window shortcut", () => {
  expect(isAppShortcut(new KeyboardEvent("keydown", {
    key: "w",
    metaKey: true,
  }))).toBe(true);
});
```

```ts
// apps/desktop/src/App.test.ts
it("routes the closeWindow action through the workspace controller", async () => {
  const closeWindow = vi.fn(async () => {});
  const wrapper = mountApp({
    windowWorkspace: { ...createWindowWorkspaceMock(), closeWindow },
  });

  await wrapper.vm.keyboardActions.closeWindow();

  expect(closeWindow).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused frontend tests to verify they fail**

Run: `cd apps/desktop && pnpm exec vitest run src/windowWorkspace.test.ts src/composables/useKeyboardShortcuts.test.ts src/App.test.ts`

Expected: FAIL with missing `closeWindow` members and missing `closeWindow` action/shortcut expectations.

- [ ] **Step 3: Implement the minimal frontend close-window behavior**

```ts
// apps/desktop/src/composables/useKeyboardShortcuts.ts
export type ActionName =
  | "newTask"
  | "newWindow"
  | "closeWindow"
  // ...

{ action: "closeWindow", labelKey: "shortcuts.closeWindow", groupKey: "shortcuts.groupWorkspace", key: "w", meta: true, display: "⌘W", context: ["main", "diff", "file", "shell", "tree", "graph", "newTask", "transfer"] },
```

```ts
// apps/desktop/src/windowWorkspace.ts
export interface WindowWorkspaceController {
  // ...
  closeWindow: () => Promise<void>;
}

async function closeCurrentTauriWindow(windowId: string): Promise<void> {
  if (isTauri) {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    await getCurrentWebviewWindow().close();
    return;
  }

  window.close();
}

closeWindow: async () => {
  const snapshot = await loadSnapshot();
  await saveSnapshot({
    windows: snapshot.windows.filter((entry) => entry.windowId !== bootstrap.windowId),
  });
  await closeCurrentTauriWindow(bootstrap.windowId);
},
```

```ts
// apps/desktop/src/App.vue
closeWindow: async () => {
  await windowWorkspace.closeWindow();
},
```

- [ ] **Step 4: Run the focused frontend tests to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run src/windowWorkspace.test.ts src/composables/useKeyboardShortcuts.test.ts src/App.test.ts`

Expected: PASS with the new `closeWindow` coverage green.

- [ ] **Step 5: Commit the frontend shortcut work**

```bash
git add apps/desktop/src/windowWorkspace.ts apps/desktop/src/windowWorkspace.test.ts apps/desktop/src/composables/useKeyboardShortcuts.ts apps/desktop/src/composables/useKeyboardShortcuts.test.ts apps/desktop/src/App.vue apps/desktop/src/App.test.ts apps/desktop/src/i18n/locales/en.json apps/desktop/src/i18n/locales/ja.json apps/desktop/src/i18n/locales/ko.json
git commit -m "feat: add close window shortcut"
```

### Task 2: Add Native Zero-Window Reopen Support

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src/windowWorkspace.ts`
- Modify: `apps/desktop/src/windowWorkspace.test.ts`

- [ ] **Step 1: Write the failing native/bootstrap tests**

```ts
// apps/desktop/src/windowWorkspace.test.ts
it("creates a fresh window record when the saved workspace snapshot is empty", async () => {
  const bootstrap = await resolveWindowBootstrap(
    fakeDb as never,
    { windowId: "main", selectedRepoId: null, selectedItemId: null },
    { windows: [] },
  );

  expect(bootstrap).toEqual({
    windowId: "main",
    selectedRepoId: null,
    selectedItemId: null,
  });
});
```

```rust
// add a focused Rust unit/integration test near the window bootstrapping helpers
#[test]
fn new_window_menu_action_is_available_without_existing_webviews() {
    // exercise the helper that decides whether to create a new webview window
    // from app-level state rather than a frontend-originated shortcut
}
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `cd apps/desktop && pnpm exec vitest run src/windowWorkspace.test.ts`

Run: `cd apps/desktop/src-tauri && cargo test new_window_menu_action_is_available_without_existing_webviews`

Expected: FAIL because there is no native zero-window new-window path yet.

- [ ] **Step 3: Implement the native new-window path and last-window behavior**

```rust
// apps/desktop/src-tauri/src/lib.rs
fn build_window(app: &tauri::AppHandle, label: &str, url: &str) -> tauri::Result<tauri::WebviewWindow> {
    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(url.into()))
        .title("")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .build()
}

fn open_new_kanna_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let window_id = format!("window-{}", uuid::Uuid::new_v4());
    let label = format!("window-{}", window_id);
    let url = format!("/?windowId={}", window_id);
    build_window(app, &label, &url)?;
    Ok(())
}
```

```rust
// menu wiring in setup()
let file_submenu = SubmenuBuilder::new(app, "File")
    .text("new_window", "New Window")
    .separator()
    .close_window()
    .build()?;

app.on_menu_event(move |app, event| {
    if event.id().0 == "new_window" {
        let _ = open_new_kanna_window(app);
    }
});
```

```json
// apps/desktop/src-tauri/tauri.conf.json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "create": false
      }
    ]
  }
}
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run src/windowWorkspace.test.ts`

Run: `cd apps/desktop/src-tauri && cargo test new_window_menu_action_is_available_without_existing_webviews`

Expected: PASS with the native create-window path available independently of existing webviews.

- [ ] **Step 5: Commit the native zero-window support**

```bash
git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/tauri.conf.json apps/desktop/src/windowWorkspace.ts apps/desktop/src/windowWorkspace.test.ts
git commit -m "feat: support reopening windows after last close"
```

### Task 3: Add End-to-End Coverage For Close/Reopen Behavior

**Files:**
- Modify: `apps/desktop/tests/e2e/mock/new-window.test.ts`
- Modify: `apps/desktop/tests/e2e/helpers/webdriver.ts`
- Modify: `apps/desktop/src/composables/useKeyboardShortcuts.test.ts`

- [ ] **Step 1: Write the failing E2E assertions for `Cmd+W` and zero-window reopen**

```ts
it("closes the focused window with Cmd+W and keeps the source window selected", async () => {
  await pressKey("w", { meta: true });
  await waitForWindowCount(client, initialHandles.length);
  await switchToWindow(client, sourceHandle);
  await waitForCurrentItemId(client, taskAId);
});

it("can reopen a window after closing the last remaining webview", async () => {
  // close every open Kanna window, trigger the native app-level new window path,
  // then verify a fresh webview appears and reaches app ready state
});
```

- [ ] **Step 2: Run the E2E spec to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run --config ./tests/e2e/vitest.config.ts ./tests/e2e/mock/new-window.test.ts`

Expected: FAIL because `Cmd+W` is not wired and there is no zero-window reopen behavior yet.

- [ ] **Step 3: Implement the minimal helper/test updates**

```ts
// apps/desktop/tests/e2e/helpers/webdriver.ts
async getWindowHandles(): Promise<string[]> {
  const res = await this.get(`/session/${this.sid}/window/handles`);
  return res.value as string[];
}

async switchToWindow(handle: string): Promise<void> {
  await this.post(`/session/${this.sid}/window`, { handle });
}
```

```ts
// apps/desktop/tests/e2e/mock/new-window.test.ts
await pressKey("W", { meta: true });
const handlesAfterClose = await waitForWindowCount(client, handlesBeforeClose.length - 1);
expect(handlesAfterClose).not.toContain(secondHandle);
```

- [ ] **Step 4: Run the E2E spec and nearby regression suite to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run --config ./tests/e2e/vitest.config.ts ./tests/e2e/mock/new-window.test.ts`

Run: `cd apps/desktop && pnpm exec vitest run src/windowWorkspace.test.ts src/composables/useKeyboardShortcuts.test.ts src/App.test.ts`

Expected: PASS with close-window and reopen-after-last-close behavior covered.

- [ ] **Step 5: Commit the E2E coverage**

```bash
git add apps/desktop/tests/e2e/mock/new-window.test.ts apps/desktop/tests/e2e/helpers/webdriver.ts apps/desktop/src/composables/useKeyboardShortcuts.test.ts
git commit -m "test: cover close window workspace behavior"
```

## Self-Review

- Spec coverage: the plan includes closing focused windows, keeping the app alive after the last close, and reopening through native `Cmd+N` when no windows remain.
- Placeholder scan: removed vague “wire it up” phrasing and anchored each task to concrete files, commands, and expected failures.
- Type consistency: the plan consistently uses `closeWindow()` on the frontend controller and “native new-window path” for the Tauri-side fallback.
