# Headless Xterm Terminal Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move task terminal recovery from frontend `localStorage` into a daemon-owned headless `xterm.js` sidecar that survives task terminal unmounts, daemon restarts, and app relaunches.

**Architecture:** Add a standalone Node-based recovery service binary that the Rust daemon supervises as an internal dependency. The daemon mirrors PTY output into the recovery service, serves snapshots through a new Tauri command, and keeps the frontend limited to “restore from daemon snapshot, then attach live.”

**Tech Stack:** Rust daemon + Tauri commands, TypeScript Node service using headless `xterm.js` and `@xterm/addon-serialize`, Bun test/build tooling, Tauri `externalBin` packaging.

---

## File Structure

### New Files

- `packages/terminal-recovery/package.json`
  - Dedicated workspace package for the recovery service build, tests, and standalone binary packaging.
- `packages/terminal-recovery/tsconfig.json`
  - TypeScript config for the recovery service.
- `packages/terminal-recovery/src/protocol.ts`
  - Internal daemon-to-recovery JSON protocol types and parsing helpers.
- `packages/terminal-recovery/src/sessionMirror.ts`
  - One headless terminal per session, sequence tracking, resize handling, and serialization via `@xterm/addon-serialize`.
- `packages/terminal-recovery/src/snapshotStore.ts`
  - Atomic snapshot file read/write helpers under the daemon data directory.
- `packages/terminal-recovery/src/server.ts`
  - Stdio JSON server that handles `StartSession`, `WriteOutput`, `ResizeSession`, `EndSession`, `GetSnapshot`, and `FlushAndShutdown`.
- `packages/terminal-recovery/src/index.ts`
  - Recovery service entrypoint.
- `packages/terminal-recovery/src/sessionMirror.test.ts`
  - Unit tests for headless terminal mirror behavior and serialization.
- `packages/terminal-recovery/src/snapshotStore.test.ts`
  - Unit tests for snapshot persistence and atomic reload behavior.
- `packages/terminal-recovery/src/server.test.ts`
  - Unit tests for protocol handling and `GetSnapshot`/`FlushAndShutdown`.
- `crates/daemon/src/recovery.rs`
  - Daemon-side recovery supervisor, request/response IPC, sequence counters, and degrade-cleanly behavior.
- `crates/daemon/tests/recovery_service.rs`
  - Integration coverage for daemon-side recovery supervision and shutdown behavior.
- `apps/desktop/src/composables/sessionRecoveryState.ts`
  - Frontend helper for fetching and validating daemon-owned recovery snapshots.
- `apps/desktop/src/composables/sessionRecoveryState.test.ts`
  - Unit tests for snapshot compatibility checks and daemon result handling.

### Modified Files

- `package.json`
  - Add the new workspace package if needed by workspace tooling.
- `apps/desktop/package.json`
  - Build and stage the recovery service binary alongside existing sidecars.
- `apps/desktop/src-tauri/tauri.conf.json`
  - Bundle the recovery service as a Tauri `externalBin`.
- `apps/desktop/src-tauri/src/lib.rs`
  - Resolve and launch the recovery binary through the daemon lifecycle assumptions already used for worktrees and sidecars.
- `apps/desktop/src-tauri/src/commands/daemon.rs`
  - Add `get_session_recovery_state` Tauri command and daemon bridge wiring.
- `apps/desktop/src/composables/useTerminal.ts`
  - Replace browser-owned task snapshot persistence with daemon snapshot restore, while keeping live attach logic.
- `apps/desktop/src/composables/terminalSessionRecovery.ts`
  - Remove task-terminal `localStorage` assumptions and keep only policy helpers that still belong in the frontend.
- `apps/desktop/src/composables/terminalStateCache.ts`
  - Narrow or remove frontend task-terminal cache support.
- `apps/desktop/src/composables/terminalStateCache.test.ts`
  - Narrow or remove tests if cache becomes shell-only or obsolete.
- `crates/daemon/Cargo.toml`
  - Add any daemon-side dependencies needed for recovery supervision.
- `crates/daemon/src/main.rs`
  - Instantiate `RecoveryManager`, mirror PTY output, flush on shutdown, and restart the sidecar on demand.
- `scripts/stage-sidecars.sh`
  - Stage the recovery service binary together with `kanna-daemon` and `kanna-cli`.

## Task 1: Scaffold The Recovery Service Workspace And Binary Packaging

**Files:**
- Create: `packages/terminal-recovery/package.json`
- Create: `packages/terminal-recovery/tsconfig.json`
- Create: `packages/terminal-recovery/src/index.ts`
- Modify: `package.json`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `scripts/stage-sidecars.sh`

- [ ] **Step 1: Write the failing packaging test by asserting the new sidecar name is referenced everywhere**

Add assertions like this to a new lightweight build-config test file if one does not exist, or use a temporary targeted script in the task branch before implementation:

```ts
import { expect, test } from "vitest";
import tauriConf from "../../../apps/desktop/src-tauri/tauri.conf.json";
import desktopPkg from "../../../apps/desktop/package.json";

test("desktop bundle includes the recovery sidecar", () => {
  expect(tauriConf.bundle.externalBin).toContain("binaries/kanna-terminal-recovery");
  expect(desktopPkg.scripts["build:sidecars"]).toContain("kanna-terminal-recovery");
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `cd apps/desktop && bun test src/composables/sessionRecoveryState.test.ts`

Expected: FAIL because the test file or referenced packaging entries do not exist yet.

- [ ] **Step 3: Add the recovery workspace package and binary build script**

Create `packages/terminal-recovery/package.json` with a standalone build target:

```json
{
  "name": "@kanna/terminal-recovery",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "bun build ./src/index.ts --outdir dist --target node",
    "build:bin": "bun x pkg ./dist/index.js --targets node20-macos-arm64 --output ../../apps/desktop/src-tauri/binaries/kanna-terminal-recovery-aarch64-apple-darwin",
    "test": "bun test",
    "typecheck": "bun tsc --noEmit"
  },
  "dependencies": {
    "@xterm/addon-serialize": "0.15.0-beta.195",
    "@xterm/headless": "6.1.0-beta.195"
  },
  "devDependencies": {
    "pkg": "^5.8.1",
    "typescript": "~5.6.2"
  }
}
```

Update `apps/desktop/package.json` so `build:sidecars` also builds the recovery binary before staging, and update `apps/desktop/src-tauri/tauri.conf.json` so `bundle.externalBin` includes `"binaries/kanna-terminal-recovery"`.

- [ ] **Step 4: Teach sidecar staging about the recovery binary**

Update `scripts/stage-sidecars.sh` so the binary loop includes the new sidecar:

```bash
for BIN in kanna-daemon kanna-cli kanna-terminal-recovery; do
    SRC="$SRC_DIR/$BIN"
    DEST="$BINARIES_DIR/${BIN}-${TARGET}"
    if [[ ! -f "$SRC" ]]; then
        echo "Error: $SRC not found. Build it first." >&2
        exit 1
    fi
    cp "$SRC" "$DEST"
    chmod +x "$DEST"
done
```

If the compiled recovery binary is produced in a package-local `dist/` first, add an explicit copy step before this loop so `SRC_DIR` resolves to `.build/.../kanna-terminal-recovery`.

- [ ] **Step 5: Run the packaging test and a dry-run sidecar build**

Run: `cd packages/terminal-recovery && bun test`

Expected: PASS or “0 tests” until Task 2 adds real tests.

Run: `cd apps/desktop && bun run build:sidecars`

Expected: PASS and `apps/desktop/src-tauri/binaries/kanna-terminal-recovery-aarch64-apple-darwin` exists.

- [ ] **Step 6: Commit**

```bash
git add package.json apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json scripts/stage-sidecars.sh packages/terminal-recovery
git commit -m "build: package terminal recovery sidecar"
```

## Task 2: Implement Headless Xterm Mirrors And Snapshot Persistence

**Files:**
- Create: `packages/terminal-recovery/src/protocol.ts`
- Create: `packages/terminal-recovery/src/sessionMirror.ts`
- Create: `packages/terminal-recovery/src/snapshotStore.ts`
- Create: `packages/terminal-recovery/src/server.ts`
- Create: `packages/terminal-recovery/src/index.ts`
- Create: `packages/terminal-recovery/src/sessionMirror.test.ts`
- Create: `packages/terminal-recovery/src/snapshotStore.test.ts`
- Create: `packages/terminal-recovery/src/server.test.ts`

- [ ] **Step 1: Write the failing mirror and snapshot-store tests**

Add tests like:

```ts
import { describe, expect, it } from "vitest";
import { SessionMirror } from "./sessionMirror";

describe("SessionMirror", () => {
  it("serializes headless xterm state after writes", () => {
    const mirror = new SessionMirror({ sessionId: "task-1", cols: 80, rows: 24 });
    mirror.write(new Uint8Array(Buffer.from("\u001b[2Jhello\r\nworld")));
    const snapshot = mirror.snapshot();
    expect(snapshot.serialized).toContain("hello");
    expect(snapshot.cols).toBe(80);
    expect(snapshot.rows).toBe(24);
  });
});
```

```ts
import { describe, expect, it } from "vitest";
import { SnapshotStore } from "./snapshotStore";

describe("SnapshotStore", () => {
  it("round-trips the latest snapshot", async () => {
    const store = new SnapshotStore("/tmp/kanna-recovery-test");
    await store.write({
      sessionId: "task-1",
      serialized: "cached",
      cols: 80,
      rows: 24,
      savedAt: 1,
      sequence: 7,
    });
    await expect(store.read("task-1")).resolves.toMatchObject({ sequence: 7 });
  });
});
```

- [ ] **Step 2: Run the package tests to verify they fail**

Run: `cd packages/terminal-recovery && bun test`

Expected: FAIL with missing exports or missing files for `SessionMirror` and `SnapshotStore`.

- [ ] **Step 3: Implement protocol and the headless terminal mirror**

Create `packages/terminal-recovery/src/protocol.ts`:

```ts
export interface StartSessionCommand {
  type: "StartSession";
  sessionId: string;
  cols: number;
  rows: number;
}

export interface WriteOutputCommand {
  type: "WriteOutput";
  sessionId: string;
  data: number[];
  sequence: number;
}

export type RecoveryCommand =
  | StartSessionCommand
  | WriteOutputCommand
  | { type: "ResizeSession"; sessionId: string; cols: number; rows: number }
  | { type: "EndSession"; sessionId: string }
  | { type: "GetSnapshot"; sessionId: string }
  | { type: "FlushAndShutdown" };
```

Create `packages/terminal-recovery/src/sessionMirror.ts`:

```ts
import { Terminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";

export interface RecoverySnapshot {
  sessionId: string;
  serialized: string;
  cols: number;
  rows: number;
  savedAt: number;
  sequence: number;
}

export class SessionMirror {
  private readonly terminal: Terminal;
  private readonly serializeAddon = new SerializeAddon();
  private sequence = 0;

  constructor(private readonly session: { sessionId: string; cols: number; rows: number }) {
    this.terminal = new Terminal({
      cols: session.cols,
      rows: session.rows,
      scrollback: 10000,
      allowProposedApi: true,
    });
    this.terminal.loadAddon(this.serializeAddon);
  }

  write(data: Uint8Array, sequence?: number): void {
    this.terminal.write(data);
    if (typeof sequence === "number") this.sequence = sequence;
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
    this.session = { ...this.session, cols, rows };
  }

  snapshot(): RecoverySnapshot {
    return {
      sessionId: this.session.sessionId,
      serialized: this.serializeAddon.serialize(),
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      savedAt: Date.now(),
      sequence: this.sequence,
    };
  }
}
```

- [ ] **Step 4: Implement atomic snapshot persistence and the stdio server**

Create `packages/terminal-recovery/src/snapshotStore.ts`:

```ts
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecoverySnapshot } from "./sessionMirror";

export class SnapshotStore {
  constructor(private readonly root: string) {}

  private filePath(sessionId: string): string {
    return join(this.root, `${sessionId}.json`);
  }

  async write(snapshot: RecoverySnapshot): Promise<void> {
    const file = this.filePath(snapshot.sessionId);
    const temp = `${file}.tmp`;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temp, JSON.stringify(snapshot), "utf8");
    await rename(temp, file);
  }

  async read(sessionId: string): Promise<RecoverySnapshot | null> {
    try {
      return JSON.parse(await readFile(this.filePath(sessionId), "utf8")) as RecoverySnapshot;
    } catch {
      return null;
    }
  }

  async remove(sessionId: string): Promise<void> {
    await rm(this.filePath(sessionId), { force: true });
  }
}
```

Create `packages/terminal-recovery/src/server.ts` with a session map, debounce-based flushing, and line-delimited JSON on stdin/stdout.

- [ ] **Step 5: Run package tests and typecheck**

Run: `cd packages/terminal-recovery && bun test`

Expected: PASS for mirror/store/server tests.

Run: `cd packages/terminal-recovery && bun run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/terminal-recovery
git commit -m "feat: add headless terminal recovery service"
```

## Task 3: Add Daemon Recovery Supervision, Mirroring, And Swap Shutdown

**Files:**
- Create: `crates/daemon/src/recovery.rs`
- Create: `crates/daemon/tests/recovery_service.rs`
- Modify: `crates/daemon/Cargo.toml`
- Modify: `crates/daemon/src/main.rs`
- Modify: `crates/daemon/src/lib.rs`

- [ ] **Step 1: Write the failing daemon-side tests**

Add tests like:

```rust
#[tokio::test]
async fn returns_none_when_recovery_snapshot_is_missing() {
    let manager = RecoveryManager::disconnected();
    let snapshot = manager.get_snapshot("task-1").await.unwrap();
    assert!(snapshot.is_none());
}

#[tokio::test]
async fn sequence_increments_for_each_forwarded_chunk() {
    let manager = RecoveryManager::new_for_test();
    assert_eq!(manager.next_sequence("task-1"), 1);
    assert_eq!(manager.next_sequence("task-1"), 2);
}
```

- [ ] **Step 2: Run the daemon tests to verify they fail**

Run: `cd crates/daemon && cargo test recovery_service -- --test-threads=1`

Expected: FAIL because `RecoveryManager` and the test helpers do not exist yet.

- [ ] **Step 3: Implement the recovery supervisor module**

Create `crates/daemon/src/recovery.rs` around a small API:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RecoverySnapshot {
    pub serialized: String,
    pub cols: u16,
    pub rows: u16,
    pub saved_at: u64,
    pub sequence: u64,
}

#[derive(Clone)]
pub struct RecoveryManager {
    inner: std::sync::Arc<tokio::sync::Mutex<RecoveryState>>,
}

impl RecoveryManager {
    pub async fn start() -> Self { /* spawn sidecar and hold pipes */ }
    pub fn next_sequence(&self, session_id: &str) -> u64 { /* per-session counter */ }
    pub async fn start_session(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> { /* send StartSession */ }
    pub async fn write_output(&self, session_id: &str, data: &[u8], sequence: u64) { /* best-effort */ }
    pub async fn resize_session(&self, session_id: &str, cols: u16, rows: u16) { /* best-effort */ }
    pub async fn end_session(&self, session_id: &str) { /* best-effort */ }
    pub async fn get_snapshot(&self, session_id: &str) -> Result<Option<RecoverySnapshot>, String> { /* request/response */ }
    pub async fn flush_and_shutdown(&self) { /* best-effort graceful stop */ }
}
```

Keep the implementation in a dedicated module rather than adding more unrelated logic to `crates/daemon/src/main.rs`.

- [ ] **Step 4: Wire the daemon output loop and shutdown path**

Modify `crates/daemon/src/main.rs` so PTY lifecycle calls into `RecoveryManager`:

```rust
let sequence = recovery_manager.next_sequence(&session_id);
recovery_manager.write_output(&session_id, &data, sequence).await;
```

On session creation:

```rust
recovery_manager.start_session(&session_id, cols as u16, rows as u16).await.ok();
```

On resize:

```rust
recovery_manager.resize_session(&session_id, cols as u16, rows as u16).await;
```

On exit or kill:

```rust
recovery_manager.end_session(&session_id).await;
```

On daemon swap / shutdown:

```rust
recovery_manager.flush_and_shutdown().await;
```

- [ ] **Step 5: Run daemon tests, format, and lint**

Run: `cd crates/daemon && cargo test recovery_service -- --test-threads=1`

Expected: PASS.

Run: `cd crates/daemon && cargo fmt --all`

Expected: PASS with formatted files.

Run: `cd crates/daemon && cargo clippy --all-targets -- -D warnings`

Expected: PASS with no warnings.

- [ ] **Step 6: Commit**

```bash
git add crates/daemon
git commit -m "feat: mirror pty output into recovery service"
```

## Task 4: Expose Recovery Snapshots Through Tauri And Restore Them In The Frontend

**Files:**
- Create: `apps/desktop/src/composables/sessionRecoveryState.ts`
- Create: `apps/desktop/src/composables/sessionRecoveryState.test.ts`
- Modify: `apps/desktop/src-tauri/src/commands/daemon.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/composables/useTerminal.ts`
- Modify: `apps/desktop/src/composables/terminalSessionRecovery.ts`
- Modify: `apps/desktop/src/composables/terminalStateCache.ts`
- Modify: `apps/desktop/src/composables/terminalStateCache.test.ts`

- [ ] **Step 1: Write the failing frontend recovery tests**

Add tests like:

```ts
import { describe, expect, it } from "vitest";
import { shouldApplyRecoverySnapshot } from "./sessionRecoveryState";

describe("shouldApplyRecoverySnapshot", () => {
  it("accepts a snapshot when geometry matches", () => {
    expect(
      shouldApplyRecoverySnapshot(
        { serialized: "cached", cols: 80, rows: 24, savedAt: 1, sequence: 2 },
        { cols: 80, rows: 24 },
      ),
    ).toBe(true);
  });
});
```

Add a command test in Rust for the new Tauri command:

```rust
#[tokio::test]
async fn get_session_recovery_state_returns_null_when_missing() {
    let app = test_app_handle();
    let result = get_session_recovery_state(app, "missing".into()).await.unwrap();
    assert!(result.is_none());
}
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `cd apps/desktop && bun test src/composables/sessionRecoveryState.test.ts`

Expected: FAIL because the helper does not exist.

Run: `cd apps/desktop/src-tauri && cargo test get_session_recovery_state -- --nocapture`

Expected: FAIL because the command does not exist.

- [ ] **Step 3: Implement the new daemon command and frontend helper**

Add to `apps/desktop/src-tauri/src/commands/daemon.rs`:

```rust
#[tauri::command]
pub async fn get_session_recovery_state(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<Option<crate::recovery::RecoverySnapshot>, String> {
    let state = app.state::<crate::RecoveryStateHandle>();
    state.manager.get_snapshot(&session_id).await
}
```

Create `apps/desktop/src/composables/sessionRecoveryState.ts`:

```ts
import { invoke } from "../invoke";

export interface SessionRecoveryState {
  serialized: string;
  cols: number;
  rows: number;
  savedAt: number;
  sequence: number;
}

export function shouldApplyRecoverySnapshot(
  snapshot: SessionRecoveryState | null,
  geometry: { cols: number; rows: number },
): boolean {
  if (!snapshot?.serialized) return false;
  if (geometry.cols > 0 && snapshot.cols !== geometry.cols) return false;
  if (geometry.rows > 0 && snapshot.rows !== geometry.rows) return false;
  return true;
}

export async function loadSessionRecoveryState(sessionId: string): Promise<SessionRecoveryState | null> {
  return invoke<SessionRecoveryState | null>("get_session_recovery_state", { sessionId });
}
```

- [ ] **Step 4: Replace browser task snapshot persistence in `useTerminal.ts`**

Refactor task-terminal restore to:

```ts
const snapshot = shouldRestoreCachedTerminalState(spawnOptions, options)
  ? await loadSessionRecoveryState(sessionId)
  : null;

if (snapshot && shouldApplyRecoverySnapshot(snapshot, { cols: term.cols, rows: term.rows })) {
  term.write(snapshot.serialized);
  restoredCachedState = true;
}
```

Remove `saveCachedTerminalState()` and `loadCachedTerminalState()` from the task PTY path. If shell terminals still use the browser cache, isolate that behavior explicitly so task PTY terminals no longer depend on `localStorage`.

- [ ] **Step 5: Run frontend and Tauri tests**

Run: `cd apps/desktop && bun test src/composables/sessionRecoveryState.test.ts src/composables/terminalSessionRecovery.test.ts`

Expected: PASS.

Run: `cd apps/desktop && bun tsc --noEmit`

Expected: PASS.

Run: `cd apps/desktop/src-tauri && cargo test get_session_recovery_state -- --nocapture`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/composables apps/desktop/src-tauri/src/commands/daemon.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat: restore task terminals from daemon snapshots"
```

## Task 5: Verify End-To-End Recovery, Daemon Swap Behavior, And Cleanup

**Files:**
- Modify: `crates/daemon/tests/recovery_service.rs`
- Modify: `apps/desktop/src/composables/terminalStateCache.ts`
- Modify: `apps/desktop/src/composables/terminalStateCache.test.ts`
- Modify: `apps/desktop/src/composables/useTerminal.ts`
- Modify: `apps/desktop/src/composables/terminalSessionRecovery.ts`

- [ ] **Step 1: Add the failing end-to-end and degrade-mode tests**

Extend daemon and frontend tests with scenarios like:

```rust
#[tokio::test]
async fn flushes_snapshots_before_recovery_shutdown() {
    let manager = RecoveryManager::new_for_test();
    manager.start_session("task-1", 80, 24).await.unwrap();
    manager.write_output("task-1", b"hello", 1).await;
    manager.flush_and_shutdown().await;
    assert!(manager.snapshot_file_for_test("task-1").exists());
}
```

```ts
it("falls back to live attach when daemon snapshot is unavailable", async () => {
  mockInvoke("get_session_recovery_state", null);
  const state = await loadSessionRecoveryState("task-1");
  expect(state).toBeNull();
});
```

- [ ] **Step 2: Run the focused test suite to verify the new cases fail**

Run: `cd crates/daemon && cargo test recovery_service -- --test-threads=1`

Expected: FAIL until the flush behavior and test helpers are complete.

Run: `cd apps/desktop && bun test src/composables/sessionRecoveryState.test.ts`

Expected: FAIL until the fallback case is wired.

- [ ] **Step 3: Finish cleanup of obsolete frontend cache logic**

If `terminalStateCache.ts` is now shell-only, make that explicit:

```ts
export function saveShellTerminalState(sessionId: string, state: CachedTerminalState): void {
  localStorage.setItem(getStorageKey(`shell:${sessionId}`), JSON.stringify(state));
}
```

If it is fully obsolete, delete the file and update imports and tests so no task-terminal code path references it.

- [ ] **Step 4: Run the full verification matrix**

Run: `cd packages/terminal-recovery && bun test && bun run typecheck`

Expected: PASS.

Run: `cd crates/daemon && cargo test -- --test-threads=1`

Expected: PASS.

Run: `cd crates/daemon && cargo clippy --all-targets -- -D warnings`

Expected: PASS.

Run: `cd apps/desktop && bun test src/composables/terminalSessionRecovery.test.ts src/composables/sessionRecoveryState.test.ts`

Expected: PASS.

Run: `cd apps/desktop && bun tsc --noEmit`

Expected: PASS.

Run: `./scripts/dev.sh restart`

Expected: PASS, with the worktree dev server restarting cleanly.

Manual smoke test:

1. Open a task terminal.
2. Produce visible scrollback.
3. Switch away and back to the task.
4. Restart the app or trigger daemon swap.
5. Confirm the terminal restores from daemon-owned scrollback before live output resumes.

- [ ] **Step 5: Commit**

```bash
git add packages/terminal-recovery crates/daemon apps/desktop/src/composables apps/desktop/src-tauri/src/commands/daemon.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json scripts/stage-sidecars.sh
git commit -m "feat: add daemon-owned terminal recovery"
```

## Self-Review

### Spec Coverage

- Daemon-owned recovery: covered in Tasks 2 and 3
- Headless `xterm.js` sidecar: covered in Tasks 1 and 2
- New daemon-facing recovery API: covered in Task 4
- Frontend unaware of storage details: covered in Task 4
- Daemon swap flush-and-restart behavior: covered in Tasks 3 and 5
- Timer-only persistence: covered in Task 2
- Best-effort degraded mode: covered in Tasks 3 and 5

No uncovered spec requirements remain.

### Placeholder Scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Each task names exact files, commands, and concrete test or code snippets.

### Type Consistency

- Snapshot payload name is consistently `SessionRecoveryState` in the frontend and `RecoverySnapshot` in the daemon/service.
- IPC command names are consistently `StartSession`, `WriteOutput`, `ResizeSession`, `EndSession`, `GetSnapshot`, and `FlushAndShutdown`.
- Frontend restore helper consistently uses `loadSessionRecoveryState()` and `shouldApplyRecoverySnapshot()`.
