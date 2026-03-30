# Xterm Scrollback Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve PTY terminal scrollback across app restart and daemon handoff by caching xterm state locally and restoring it before reattaching to the live PTY.

**Architecture:** Keep the daemon as the source of truth for live PTY state, but move visual continuity into the frontend. Use xterm's serialize addon to snapshot the local terminal buffer per `sessionId`, persist that payload in app-local storage, hydrate it on mount before reconnect, and clear it when the task/session exits or is closed.

**Tech Stack:** Vue 3, xterm.js, `@xterm/addon-serialize`, browser/Tauri local storage APIs, existing PTY reconnect flow in `useTerminal`

---

### Task 1: Add a focused terminal-state cache module

**Files:**
- Create: `apps/desktop/src/composables/terminalStateCache.ts`
- Test: `apps/desktop/src/composables/terminalStateCache.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import {
  clearCachedTerminalState,
  loadCachedTerminalState,
  saveCachedTerminalState,
} from "./terminalStateCache";

describe("terminalStateCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips serialized terminal state by session id", () => {
    saveCachedTerminalState("task-1", {
      serialized: "\u001b[2Jhello",
      cols: 120,
      rows: 40,
      savedAt: 123,
    });

    expect(loadCachedTerminalState("task-1")).toEqual({
      serialized: "\u001b[2Jhello",
      cols: 120,
      rows: 40,
      savedAt: 123,
    });
  });

  it("returns null for missing or malformed entries", () => {
    localStorage.setItem("kanna:terminal-state:task-2", "{bad json");

    expect(loadCachedTerminalState("missing")).toBeNull();
    expect(loadCachedTerminalState("task-2")).toBeNull();
  });

  it("removes cached state by session id", () => {
    saveCachedTerminalState("task-3", {
      serialized: "cached",
      cols: 80,
      rows: 24,
      savedAt: 456,
    });

    clearCachedTerminalState("task-3");

    expect(loadCachedTerminalState("task-3")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test ./src/composables/terminalStateCache.test.ts`
Expected: FAIL because `terminalStateCache.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface CachedTerminalState {
  serialized: string;
  cols: number;
  rows: number;
  savedAt: number;
}

const STORAGE_PREFIX = "kanna:terminal-state:";

function getStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function saveCachedTerminalState(sessionId: string, state: CachedTerminalState): void {
  localStorage.setItem(getStorageKey(sessionId), JSON.stringify(state));
}

export function loadCachedTerminalState(sessionId: string): CachedTerminalState | null {
  const raw = localStorage.getItem(getStorageKey(sessionId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedTerminalState;
    if (
      typeof parsed.serialized !== "string" ||
      typeof parsed.cols !== "number" ||
      typeof parsed.rows !== "number" ||
      typeof parsed.savedAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCachedTerminalState(sessionId: string): void {
  localStorage.removeItem(getStorageKey(sessionId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test ./src/composables/terminalStateCache.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/composables/terminalStateCache.ts apps/desktop/src/composables/terminalStateCache.test.ts
git commit -m "feat: add local terminal state cache"
```

### Task 2: Add serialization and restore hooks to `useTerminal`

**Files:**
- Modify: `apps/desktop/src/composables/useTerminal.ts`
- Test: `apps/desktop/src/composables/terminalSessionRecovery.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases to `apps/desktop/src/composables/terminalSessionRecovery.test.ts`:

```ts
import {
  shouldRestoreCachedTerminalState,
  shouldPersistTerminalStateOnUnmount,
} from "./terminalSessionRecovery";

describe("shouldRestoreCachedTerminalState", () => {
  it("restores cached state for attach-only task terminals", () => {
    expect(
      shouldRestoreCachedTerminalState(
        { cwd: "/tmp/task", prompt: "do work", spawnFn: async () => {} },
        { agentProvider: "codex", worktreePath: "/tmp/task" },
      )
    ).toBe(true);
  });

  it("does not restore cached state for shell terminals", () => {
    expect(
      shouldRestoreCachedTerminalState(
        { cwd: "/tmp/repo", prompt: "", spawnFn: async () => {} },
        undefined,
      )
    ).toBe(false);
  });
});

describe("shouldPersistTerminalStateOnUnmount", () => {
  it("persists state for attach-only task terminals", () => {
    expect(
      shouldPersistTerminalStateOnUnmount(
        { cwd: "/tmp/task", prompt: "do work", spawnFn: async () => {} },
        { agentProvider: "claude", worktreePath: "/tmp/task" },
      )
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test ./src/composables/terminalSessionRecovery.test.ts`
Expected: FAIL because the new policy helpers do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add small policy helpers in `apps/desktop/src/composables/terminalSessionRecovery.ts`:

```ts
export function shouldRestoreCachedTerminalState(
  spawnOptions?: SpawnOptions,
  options?: TerminalOptions,
): boolean {
  return getTerminalRecoveryMode(spawnOptions, options) === "attach-only";
}

export function shouldPersistTerminalStateOnUnmount(
  spawnOptions?: SpawnOptions,
  options?: TerminalOptions,
): boolean {
  return getTerminalRecoveryMode(spawnOptions, options) === "attach-only";
}
```

Update `apps/desktop/src/composables/useTerminal.ts` to:

```ts
import { SerializeAddon } from "@xterm/addon-serialize";
import {
  clearCachedTerminalState,
  loadCachedTerminalState,
  saveCachedTerminalState,
} from "./terminalStateCache";
```

Inside `useTerminal`:

```ts
const serializeAddon = new SerializeAddon();
let restoredCachedState = false;
```

Inside `init`:

```ts
term.loadAddon(serializeAddon);

if (!restoredCachedState && shouldRestoreCachedTerminalState(spawnOptions, options)) {
  const cached = loadCachedTerminalState(sessionId);
  if (cached?.serialized) {
    term.write(cached.serialized);
    restoredCachedState = true;
  }
}
```

Add a helper:

```ts
function persistTerminalState() {
  if (!terminal.value || !shouldPersistTerminalStateOnUnmount(spawnOptions, options)) return;
  saveCachedTerminalState(sessionId, {
    serialized: serializeAddon.serialize(),
    cols: terminal.value.cols,
    rows: terminal.value.rows,
    savedAt: Date.now(),
  });
}
```

Call `persistTerminalState()` from `dispose()` before `terminal.value?.dispose()`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && bun test ./src/composables/terminalSessionRecovery.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `cd apps/desktop && bun x tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/composables/useTerminal.ts apps/desktop/src/composables/terminalSessionRecovery.ts apps/desktop/src/composables/terminalSessionRecovery.test.ts
git commit -m "feat: restore cached xterm state on task reconnect"
```

### Task 3: Clear cached state when PTY sessions actually end

**Files:**
- Modify: `apps/desktop/src/composables/useTerminal.ts`
- Modify: `apps/desktop/src/stores/kanna.ts`
- Test: `apps/desktop/src/composables/terminalStateCache.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases to `apps/desktop/src/composables/terminalStateCache.test.ts`:

```ts
import { clearCachedTerminalState, loadCachedTerminalState, saveCachedTerminalState } from "./terminalStateCache";

it("can be cleared after session exit cleanup", () => {
  saveCachedTerminalState("task-exit", {
    serialized: "cached",
    cols: 80,
    rows: 24,
    savedAt: 1,
  });

  clearCachedTerminalState("task-exit");

  expect(loadCachedTerminalState("task-exit")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test ./src/composables/terminalStateCache.test.ts`
Expected: FAIL until the cleanup paths actually import and use the helper.

- [ ] **Step 3: Write minimal implementation**

In `apps/desktop/src/composables/useTerminal.ts`, clear cache on real session exit:

```ts
listen("session_exit", (event) => {
  const sid = event.payload.session_id;
  if ((sid === sessionId || sid === `td-${sessionId}`) && !sid.startsWith("td-")) {
    clearCachedTerminalState(sessionId);
  }
});
```

In `apps/desktop/src/stores/kanna.ts`, clear cache when the task is explicitly closed:

```ts
import { clearCachedTerminalState } from "../composables/terminalStateCache";
```

and call:

```ts
clearCachedTerminalState(item.id);
```

in the `closeTask` path after `closePipelineItem(...)` succeeds.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && bun test ./src/composables/terminalStateCache.test.ts && bun test ./src/composables/terminalSessionRecovery.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `cd apps/desktop && bun x tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/composables/terminalStateCache.test.ts apps/desktop/src/composables/useTerminal.ts apps/desktop/src/stores/kanna.ts
git commit -m "fix: clear cached terminal state on task exit"
```

### Task 4: Manual verification sweep

**Files:**
- Modify: none
- Test: app runtime only

- [ ] **Step 1: Verify fresh sessions**

Run these checks in the desktop app:

```text
1. Start a fresh Claude task and confirm terminal output appears normally.
2. Start a fresh Copilot task and confirm Shift+Enter still works.
3. Start a fresh Codex task and confirm rendering still matches the improved baseline.
```

- [ ] **Step 2: Verify restart restoration**

Run these checks in the desktop app:

```text
1. Restart the app while Claude, Copilot, and Codex tasks are active.
2. Confirm each terminal shows pre-restart scrollback immediately on open.
3. Confirm Copilot/Claude redraw their current UI after reconnect.
4. Confirm Codex no longer shows a blank screen; cached scrollback should remain visible even if Codex only redraws its prompt.
```

- [ ] **Step 3: Verify cleanup behavior**

Run these checks in the desktop app:

```text
1. Close a task and confirm reopening a different task does not show stale scrollback from the closed session id.
2. Let a PTY session exit and confirm a new task with a different session id does not inherit old cached state.
```

- [ ] **Step 4: Final verification**

Run: `cd apps/desktop && bun test ./src/composables/terminalStateCache.test.ts && bun test ./src/composables/terminalSessionRecovery.test.ts && bun x tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: verify xterm scrollback cache integration"
```

