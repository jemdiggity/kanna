# New Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-window Kanna workspaces with shared live repo/task data, window-local selected repo/task state, and restore-on-relaunch for the open window set.

**Architecture:** Keep repo/task data in the existing SQLite + daemon event flow, and add a thin frontend `windowWorkspace` layer for window bootstrap, restore snapshots, and app-wide invalidation events. Move `selectedRepoId` and `selectedItemId` out of global DB settings and make them window-local presentation state that is initialized from bootstrap and persisted only inside the restorable workspace snapshot.

**Tech Stack:** Vue 3, Pinia, Tauri v2 webview APIs, `@tauri-apps/api/event`, `@tauri-apps/api/webviewWindow`, Vitest, happy-dom, WebDriver E2E

---

## File Structure

- Create: `apps/desktop/src/windowWorkspace.ts`
  Purpose: parse window bootstrap params, load/save `window_workspace_v1`, open secondary windows, restore saved windows, publish/listen for shared invalidation.
- Create: `apps/desktop/src/windowWorkspace.test.ts`
  Purpose: unit coverage for bootstrap parsing, snapshot reconciliation, and restore window filtering.
- Create: `apps/desktop/src/emit.ts`
  Purpose: mirror `listen.ts` with a browser/mock-safe `emit` wrapper.
- Modify: `apps/desktop/src/tauri-mock.ts`
  Purpose: add `mockEmit` so browser-mode tests can exercise the workspace event bus.
- Modify: `apps/desktop/src/main.ts`
  Purpose: create the `windowWorkspace` controller before mount, provide it to the app, and trigger restore for the primary window.
- Modify: `apps/desktop/src/stores/state.ts`
  Purpose: add window-workspace types to store context and hold initial selection bootstrap.
- Modify: `apps/desktop/src/stores/selection.ts`
  Purpose: remove global `selected_repo_id` / `selected_item_id` writes and persist selection through the window workspace controller instead.
- Modify: `apps/desktop/src/stores/init.ts`
  Purpose: initialize selection from bootstrap, reconcile stale selections, and listen for workspace invalidation events.
- Create: `apps/desktop/src/stores/selection.test.ts`
  Purpose: verify window-local selection and selection persistence handoff to the workspace layer.
- Modify: `apps/desktop/src/stores/init.test.ts`
  Purpose: cover bootstrap-driven restore and fallback behavior.
- Modify: `apps/desktop/src/App.vue`
  Purpose: route `newWindow` through the workspace controller and emit invalidation after shared mutations that originate in the UI.
- Modify: `apps/desktop/src/App.test.ts`
  Purpose: verify the `newWindow` action and shared invalidation hooks.
- Modify: `apps/desktop/src-tauri/src/lib.rs`
  Purpose: attach the focus-restore handler to all Kanna windows instead of only the `"main"` window.
- Create: `apps/desktop/tests/e2e/mock/new-window.test.ts`
  Purpose: cover two-window selection independence and restore-on-relaunch.
- Modify: `apps/desktop/tests/e2e/helpers/webdriver.ts`
  Purpose: add helpers for multiple window handles.

### Task 1: Add Window Workspace Primitives

**Files:**
- Create: `apps/desktop/src/windowWorkspace.ts`
- Create: `apps/desktop/src/windowWorkspace.test.ts`
- Create: `apps/desktop/src/emit.ts`
- Modify: `apps/desktop/src/tauri-mock.ts`
- Modify: `apps/desktop/src/main.ts`

- [ ] **Step 1: Write the failing unit tests for bootstrap parsing and workspace snapshot reconciliation**

```ts
import { describe, expect, it } from "vitest";
import {
  parseWindowBootstrap,
  reconcileWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "./windowWorkspace";

describe("windowWorkspace", () => {
  it("parses bootstrap selection from the query string", () => {
    expect(
      parseWindowBootstrap("?windowId=win-2&selectedRepoId=repo-1&selectedItemId=task-9"),
    ).toEqual({
      windowId: "win-2",
      selectedRepoId: "repo-1",
      selectedItemId: "task-9",
    });
  });

  it("adds a missing window record without disturbing saved order", () => {
    const snapshot: WorkspaceSnapshot = {
      windows: [{ windowId: "main", selectedRepoId: "repo-1", selectedItemId: "task-1", order: 0, sidebarHidden: false }],
    };

    expect(reconcileWorkspaceSnapshot(snapshot, "win-2")).toEqual({
      windows: [
        { windowId: "main", selectedRepoId: "repo-1", selectedItemId: "task-1", order: 0, sidebarHidden: false },
        { windowId: "win-2", selectedRepoId: null, selectedItemId: null, order: 1, sidebarHidden: false },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the workspace unit test to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run src/windowWorkspace.test.ts`

Expected: FAIL with `Cannot find module './windowWorkspace'` or missing export errors for `parseWindowBootstrap` / `reconcileWorkspaceSnapshot`.

- [ ] **Step 3: Write the minimal workspace module and event wrapper**

```ts
// apps/desktop/src/windowWorkspace.ts
import { getSetting, setSetting, type DbHandle } from "@kanna/db";
import { isTauri } from "./tauri-mock";
import { emit } from "./emit";

export interface WindowBootstrap {
  windowId: string;
  selectedRepoId: string | null;
  selectedItemId: string | null;
}

export interface WorkspaceWindowState extends WindowBootstrap {
  sidebarHidden: boolean;
  order: number;
}

export interface WorkspaceSnapshot {
  windows: WorkspaceWindowState[];
}

export const WINDOW_WORKSPACE_SETTINGS_KEY = "window_workspace_v1";
export const WINDOW_WORKSPACE_INVALIDATED_EVENT = "kanna://window-workspace-invalidated";

export function parseWindowBootstrap(search: string): WindowBootstrap {
  const params = new URLSearchParams(search);
  return {
    windowId: params.get("windowId") ?? "main",
    selectedRepoId: params.get("selectedRepoId"),
    selectedItemId: params.get("selectedItemId"),
  };
}

export function reconcileWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  windowId: string,
): WorkspaceSnapshot {
  const existing = snapshot.windows.find((entry) => entry.windowId === windowId);
  if (existing) return snapshot;
  return {
    windows: [
      ...snapshot.windows,
      { windowId, selectedRepoId: null, selectedItemId: null, sidebarHidden: false, order: snapshot.windows.length },
    ],
  };
}
```

```ts
// apps/desktop/src/emit.ts
import { isTauri, mockEmit } from "./tauri-mock";

export const emit: (event: string, payload?: unknown) => Promise<void> =
  isTauri
    ? (await import("@tauri-apps/api/event")).emit
    : mockEmit;
```

```ts
// apps/desktop/src/tauri-mock.ts
export async function mockEmit(event: string, payload: Record<string, unknown> = {}): Promise<void> {
  emitMockEvent(event, payload);
}
```

- [ ] **Step 4: Run the workspace unit test to verify it passes**

Run: `cd apps/desktop && pnpm exec vitest run src/windowWorkspace.test.ts`

Expected: PASS with both `windowWorkspace` tests green.

- [ ] **Step 5: Commit the workspace primitives**

```bash
git add apps/desktop/src/windowWorkspace.ts apps/desktop/src/windowWorkspace.test.ts apps/desktop/src/emit.ts apps/desktop/src/tauri-mock.ts apps/desktop/src/main.ts
git commit -m "feat: add window workspace primitives"
```

### Task 2: Move Selection To Window-Local Presentation State

**Files:**
- Modify: `apps/desktop/src/stores/state.ts`
- Modify: `apps/desktop/src/stores/selection.ts`
- Modify: `apps/desktop/src/stores/init.ts`
- Create: `apps/desktop/src/stores/selection.test.ts`
- Modify: `apps/desktop/src/stores/init.test.ts`

- [ ] **Step 1: Write failing tests for window-local selection bootstrap and persistence handoff**

```ts
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { createStoreContext, createStoreState } from "./state";
import { createSelectionApi } from "./selection";

describe("createSelectionApi", () => {
  it("persists selection through the window workspace instead of global selected_item_id settings", async () => {
    const state = createStoreState();
    state.items.value = [{ id: "task-1", repo_id: "repo-1", stage: "in progress", pinned: 0, created_at: "2026-04-29T00:00:00Z", agent_type: "sdk", tags: "[]" }] as any;
    state.repos.value = [{ id: "repo-1", path: "/tmp/repo", name: "repo", default_branch: "main" }] as any;
    state.selectedRepoId.value = "repo-1";

    const persistSelection = vi.fn(async () => {});
    const context = createStoreContext(state, { toasts: ref([]), dismiss: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }, {
      windowWorkspace: { persistSelection },
    } as any);

    await createSelectionApi(context).selectItem("task-1");

    expect(persistSelection).toHaveBeenCalledWith({ selectedRepoId: "repo-1", selectedItemId: "task-1" });
  });
});
```

```ts
it("restores selected repo and task from bootstrap before falling back to defaults", async () => {
  // in apps/desktop/src/stores/init.test.ts
  expect(state.selectedRepoId.value).toBe("repo-2");
  expect(state.selectedItemId.value).toBe("task-9");
});
```

- [ ] **Step 2: Run the selection/init tests to verify they fail**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/selection.test.ts src/stores/init.test.ts`

Expected: FAIL because `windowWorkspace` is not part of the store context yet and `init()` still reads `selected_repo_id` / `selected_item_id` from global settings.

- [ ] **Step 3: Implement bootstrap-driven selection and remove the global selection settings writes**

```ts
// apps/desktop/src/stores/state.ts
import type { WindowBootstrap, WindowWorkspaceController } from "../windowWorkspace";

export interface StoreState {
  initialWindowBootstrap: Ref<WindowBootstrap | null>;
  // existing fields...
}

export interface StoreServices {
  windowWorkspace?: WindowWorkspaceController;
  // existing fields...
}
```

```ts
// apps/desktop/src/stores/selection.ts
async function selectRepo(repoId: string) {
  context.state.selectedRepoId.value = repoId;
  context.state.selectedItemId.value = context.state.lastSelectedItemByRepo.value[repoId] ?? null;
  await context.services.windowWorkspace?.persistSelection({
    selectedRepoId: context.state.selectedRepoId.value,
    selectedItemId: context.state.selectedItemId.value,
  });
}

async function selectItem(itemId: string) {
  // existing nav + beginTaskSwitch logic...
  await context.services.windowWorkspace?.persistSelection({
    selectedRepoId: item?.repo_id ?? context.state.selectedRepoId.value,
    selectedItemId: itemId,
  });
}
```

```ts
// apps/desktop/src/stores/init.ts
async function init(db: DbHandle) {
  // existing eager repo/task load...
  const bootstrap = context.state.initialWindowBootstrap.value;
  if (bootstrap?.selectedRepoId && eagerRepos.some((repo) => repo.id === bootstrap.selectedRepoId)) {
    context.state.selectedRepoId.value = bootstrap.selectedRepoId;
  } else if (eagerRepos.length === 1) {
    context.state.selectedRepoId.value = eagerRepos[0].id;
  }

  if (bootstrap?.selectedItemId && eagerItems.some((item) => item.id === bootstrap.selectedItemId && item.stage !== "done")) {
    requireService(context.services.restoreSelection, "restoreSelection")(bootstrap.selectedItemId);
  }
}
```

- [ ] **Step 4: Run the selection/init tests to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run src/stores/selection.test.ts src/stores/init.test.ts`

Expected: PASS with the new window-local selection tests green and no reads/writes to `selected_repo_id` / `selected_item_id`.

- [ ] **Step 5: Commit the selection refactor**

```bash
git add apps/desktop/src/stores/state.ts apps/desktop/src/stores/selection.ts apps/desktop/src/stores/init.ts apps/desktop/src/stores/selection.test.ts apps/desktop/src/stores/init.test.ts
git commit -m "refactor: make task selection window local"
```

### Task 3: Wire New Window, Live Invalidation, And Restore

**Files:**
- Modify: `apps/desktop/src/windowWorkspace.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/App.vue`
- Modify: `apps/desktop/src/App.test.ts`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing tests for the new-window action and restore startup**

```ts
it("opens a new window through the workspace controller using the current selection", async () => {
  store.selectedRepoId = "repo-1";
  store.selectedItemId = "task-1";
  const openWindow = vi.fn(async () => {});
  mockWorkspace.openWindow = openWindow;

  await capturedKeyboardActions?.newWindow();

  expect(openWindow).toHaveBeenCalledWith({
    selectedRepoId: "repo-1",
    selectedItemId: "task-1",
  });
});
```

```ts
it("restores extra windows only from the primary window", async () => {
  const restoreWindows = vi.fn(async () => {});
  await startWindowWorkspace({ bootstrap: { windowId: "main", selectedRepoId: null, selectedItemId: null }, restoreWindows } as any);
  expect(restoreWindows).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the app and workspace tests to verify they fail**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts src/windowWorkspace.test.ts`

Expected: FAIL because `newWindow` still creates a raw `WebviewWindow` directly and startup does not yet restore saved secondary windows.

- [ ] **Step 3: Implement the workspace controller wiring, restore flow, and app-wide invalidation**

```ts
// apps/desktop/src/windowWorkspace.ts
export interface WindowWorkspaceController {
  bootstrap: WindowBootstrap;
  openWindow(selection: { selectedRepoId: string | null; selectedItemId: string | null }): Promise<void>;
  persistSelection(selection: { selectedRepoId: string | null; selectedItemId: string | null }): Promise<void>;
  persistSidebarHidden(hidden: boolean): Promise<void>;
  invalidateSharedData(reason: string): Promise<void>;
  restoreAdditionalWindows(): Promise<void>;
  onSharedInvalidation(handler: () => Promise<void> | void): Promise<() => void>;
}

// openWindow(): append record, persist snapshot, create WebviewWindow with
// `url: \`/?windowId=${windowId}&selectedRepoId=${repoId ?? ""}&selectedItemId=${itemId ?? ""}\``
// restoreAdditionalWindows(): only when bootstrap.windowId === "main"
// invalidateSharedData(): await emit(WINDOW_WORKSPACE_INVALIDATED_EVENT, { reason, sourceWindowId: bootstrap.windowId })
```

```ts
// apps/desktop/src/main.ts
const bootstrap = parseWindowBootstrap(window.location.search);
const workspace = createWindowWorkspace({ db, bootstrap });
app.provide("windowWorkspace", workspace);
app.provide("windowBootstrap", bootstrap);
await workspace.restoreAdditionalWindows();
```

```ts
// apps/desktop/src/App.vue
const windowWorkspace = inject<WindowWorkspaceController>("windowWorkspace")!;

const keyboardActions = {
  newWindow: async () => {
    await windowWorkspace.openWindow({
      selectedRepoId: store.selectedRepoId,
      selectedItemId: store.selectedItemId,
    });
  },
};

async function withWorkspaceInvalidation<T>(reason: string, run: () => Promise<T>): Promise<T> {
  const result = await run();
  await windowWorkspace.invalidateSharedData(reason);
  return result;
}
```

```rust
// apps/desktop/src-tauri/src/lib.rs
fn install_focus_restore_for_window(window: tauri::WebviewWindow) {
    let cloned = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(true) = event {
            let current = cloned.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(100));
                let webview: &tauri::Webview<_> = current.as_ref();
                let _ = webview.set_focus();
                let _ = webview.eval("window.__kannaRestoreFocus?.()");
            });
        }
    });
}
```

- [ ] **Step 4: Run the app and workspace tests to verify they pass**

Run: `cd apps/desktop && pnpm exec vitest run src/App.test.ts src/windowWorkspace.test.ts`

Expected: PASS with the new-window action using the workspace controller and restore-on-startup behavior covered.

- [ ] **Step 5: Commit the window wiring**

```bash
git add apps/desktop/src/windowWorkspace.ts apps/desktop/src/main.ts apps/desktop/src/App.vue apps/desktop/src/App.test.ts apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: wire multi-window workspace restore"
```

### Task 4: Add Two-Window Regression Coverage And Final Verification

**Files:**
- Modify: `apps/desktop/tests/e2e/helpers/webdriver.ts`
- Create: `apps/desktop/tests/e2e/mock/new-window.test.ts`
- Modify: `apps/desktop/src/windowWorkspace.test.ts`

- [ ] **Step 1: Write the failing E2E scenario for independent selection and restore**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebDriverClient } from "../helpers/webdriver";

describe("new window", () => {
  const client = new WebDriverClient();

  beforeAll(async () => {
    await client.createSession();
  });

  afterAll(async () => {
    await client.deleteSession();
  });

  it("keeps task selection independent between restored windows", async () => {
    await client.executeSync(`
      return window.__KANNA_E2E__?.setupState?.windowWorkspace?.openWindow({
        selectedRepoId: "repo-1",
        selectedItemId: "task-1",
      });
    `);

    const handles = await client.getWindowHandles();
    expect(handles).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the targeted E2E test to verify it fails**

Run: `cd apps/desktop && pnpm exec vitest run tests/e2e/mock/new-window.test.ts --config tests/e2e/vitest.config.ts`

Expected: FAIL because `WebDriverClient` does not yet expose multi-window helpers and the test cannot observe the second window.

- [ ] **Step 3: Implement the WebDriver helpers and finish the E2E coverage**

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
it("restores two windows with independent task selections", async () => {
  await client.executeSync(`
    const state = window.__KANNA_E2E__?.setupState;
    await state.createRepo?.("Repo", "/tmp/repo");
    state.items.push(
      { id: "task-1", repo_id: "repo-1", prompt: "Task 1", stage: "in progress", activity: "idle", tags: "[]", pinned: 0, created_at: "2026-04-29T00:00:00Z" },
      { id: "task-2", repo_id: "repo-1", prompt: "Task 2", stage: "in progress", activity: "idle", tags: "[]", pinned: 0, created_at: "2026-04-29T00:01:00Z" },
    );
    await state.windowWorkspace.openWindow({ selectedRepoId: "repo-1", selectedItemId: "task-2" });
  `);

  const [firstHandle, secondHandle] = await client.getWindowHandles();
  await client.switchToWindow(firstHandle);
  await client.executeSync(`window.__KANNA_E2E__?.setupState?.handleSelectItem?.("task-1");`);
  await client.switchToWindow(secondHandle);
  await client.executeSync(`window.__KANNA_E2E__?.setupState?.handleSelectItem?.("task-2");`);
});
```

- [ ] **Step 4: Run the full verification suite**

Run: `cd apps/desktop && pnpm exec vitest run src/windowWorkspace.test.ts src/stores/selection.test.ts src/stores/init.test.ts src/App.test.ts`

Expected: PASS with all new unit coverage green.

Run: `cd apps/desktop && pnpm exec vitest run tests/e2e/mock/new-window.test.ts --config tests/e2e/vitest.config.ts`

Expected: PASS with two-window selection independence and restore covered.

Run: `cd apps/desktop && pnpm exec vue-tsc --noEmit`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit the regression coverage**

```bash
git add apps/desktop/tests/e2e/helpers/webdriver.ts apps/desktop/tests/e2e/mock/new-window.test.ts apps/desktop/src/windowWorkspace.test.ts apps/desktop/src/stores/selection.test.ts apps/desktop/src/stores/init.test.ts apps/desktop/src/App.test.ts
git commit -m "test: cover multi-window workspace behavior"
```

## Self-Review

### Spec Coverage

- New window bootstraps from the current selection: Task 3.
- Shared repo/task data updates live across windows: Tasks 2 and 3.
- Selected repo/task remains window-local presentation state: Task 2.
- Restore open windows and saved selections on relaunch: Tasks 1 and 3.
- Best-effort fallback for stale repo/task references: Tasks 1 and 2.
- E2E verification for two-window behavior: Task 4.

### Placeholder Scan

- No `TODO`, `TBD`, or “implement later” markers remain.
- Each test step names an exact command and expected failure mode.
- Each implementation step names exact files and concrete exported APIs.

### Type Consistency

- `WindowBootstrap`, `WorkspaceSnapshot`, and `WindowWorkspaceController` are used consistently across tasks.
- `persistSelection({ selectedRepoId, selectedItemId })` is the single selection persistence API.
- `WINDOW_WORKSPACE_INVALIDATED_EVENT` is the single cross-window invalidation event name.
