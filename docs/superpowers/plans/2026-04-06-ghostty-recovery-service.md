# Ghostty Recovery Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Kanna's disk-backed terminal recovery-service architecture and replace the old headless xterm/Node engine with a Rust/Ghostty recovery service behind the same narrow protocol.

**Architecture:** Bring back `main`'s recovery-manager and frontend recovery flow as the stable boundary, then swap the recovery service implementation from Node/xterm to Rust/Ghostty without changing the daemon/frontend contract. The daemon mirrors PTY output into the recovery sidecar, the sidecar persists per-session snapshots to disk, and the frontend restores from that durable source before attaching live output.

**Tech Stack:** Rust, Tokio, Tauri v2, xterm.js frontend, libghostty-vt, ghostty-xterm-compat-serialize, Bun test runner

---

## File Structure

### Restore/reuse daemon recovery boundary

- Modify: `crates/daemon/src/lib.rs`
- Modify: `crates/daemon/src/main.rs`
- Modify: `crates/daemon/src/protocol.rs`
- Modify: `crates/daemon/src/session.rs`
- Modify: `crates/daemon/src/recovery.rs`
- Modify: `crates/daemon/src/sidecar.rs`
- Test: `crates/daemon/tests/recovery_service.rs`
- Test: `crates/daemon/tests/handoff.rs`

Responsibilities:
- `recovery.rs` owns recovery-sidecar lifecycle, request/response protocol, tracked-session replay, and durable snapshot fetch.
- `main.rs` mirrors session lifecycle/output/resize into recovery manager and stops using direct daemon-side snapshots for UI restore.
- `sidecar.rs` remains a live mirror for daemon-owned terminal semantics, not the authoritative restore source.

### Replace Node runtime with Rust recovery sidecar

- Create: `packages/terminal-recovery/Cargo.toml`
- Create: `packages/terminal-recovery/src/main.rs`
- Create: `packages/terminal-recovery/src/protocol.rs`
- Create: `packages/terminal-recovery/src/service.rs`
- Create: `packages/terminal-recovery/src/session_mirror.rs`
- Create: `packages/terminal-recovery/src/snapshot_store.rs`
- Test: `packages/terminal-recovery/tests/protocol.rs`
- Test: `packages/terminal-recovery/tests/session_mirror.rs`
- Test: `packages/terminal-recovery/tests/snapshot_store.rs`

Responsibilities:
- `main.rs` is the sidecar entrypoint that serves the same stdin/stdout protocol as `main`.
- `service.rs` handles request dispatch and session registry.
- `session_mirror.rs` owns Ghostty terminal mirrors plus xterm-compatible serialization.
- `snapshot_store.rs` owns atomic on-disk persistence.

### Restore frontend/Tauri recovery path

- Modify: `apps/desktop/src-tauri/src/commands/daemon.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/composables/useTerminal.ts`
- Modify: `apps/desktop/src/composables/daemonTerminalSnapshot.ts`
- Modify: `apps/desktop/src/composables/terminalSessionRecovery.ts`
- Modify: `apps/desktop/src/composables/sessionRecoveryState.ts`
- Modify: `apps/desktop/src/tauri-mock.ts`
- Test: `apps/desktop/src/composables/sessionRecoveryState.test.ts`
- Test: `apps/desktop/src/composables/daemonTerminalSnapshot.test.ts`
- Test: `apps/desktop/src/composables/terminalSessionRecovery.test.ts`

Responsibilities:
- Tauri commands fetch durable recovery snapshots through `RecoveryManager`, not direct daemon-side live sidecar state.
- frontend reset-and-restore behavior remains destructive and idempotent.
- `sessionRecoveryState.ts` becomes the stable recovery payload parser/store again, but the payload content comes from Ghostty-backed serialization.

### Build and packaging

- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/sidecars.test.ts`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `scripts/stage-sidecars.sh`
- Modify: `scripts/ship.sh`

Responsibilities:
- bundle the Rust recovery sidecar as a normal sidecar binary
- remove Node runtime staging from the headless recovery path
- preserve worktree-aware sidecar staging behavior

### Docs

- Modify: `docs/superpowers/specs/2026-04-06-ghostty-recovery-service-design.md`
- Create: `docs/superpowers/plans/2026-04-06-ghostty-recovery-service.md`

Responsibilities:
- keep the design and plan aligned with the implementation split

## Task 1: Restore the Recovery Manager Boundary

**Files:**
- Modify: `crates/daemon/src/lib.rs`
- Modify: `crates/daemon/src/main.rs`
- Modify: `crates/daemon/src/recovery.rs`
- Modify: `crates/daemon/tests/recovery_service.rs`
- Test: `crates/daemon/tests/handoff.rs`

- [ ] **Step 1: Write the failing daemon recovery test**

```rust
#[tokio::test]
async fn daemon_fetches_restore_snapshot_from_recovery_manager() {
    let recovery = RecoveryManager::new_for_test().await.unwrap();
    recovery.start_session("session-1", 80, 24, false).await.unwrap();
    recovery.write_output("session-1", b"hello from recovery\r\n", 1).await;

    let snapshot = recovery.get_snapshot("session-1").await.unwrap().unwrap();

    assert!(snapshot.serialized.contains("hello from recovery"));
}
```

- [ ] **Step 2: Run the daemon recovery test to verify the current tree is missing the old recovery path**

Run: `GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo test --manifest-path crates/daemon/Cargo.toml recovery_service -- --nocapture`

Expected: FAIL because the rebased branch currently removed `crates/daemon/src/recovery.rs` and related recovery tests.

- [ ] **Step 3: Reintroduce the recovery manager module and wire it back into the daemon**

```rust
// crates/daemon/src/lib.rs
pub mod recovery;

// crates/daemon/src/main.rs
use crate::recovery::RecoveryManager;

struct AppState {
    sessions: SessionManager,
    recovery: RecoveryManager,
}

// On spawn:
state.recovery.start_session(&session_id, cols, rows, false).await?;

// On output:
let sequence = state.recovery.next_sequence(&session_id);
state.recovery.write_output(&session_id, &buffer[..n], sequence).await;

// On resize:
state.recovery.resize_session(&session_id, cols, rows).await;

// On session exit:
state.recovery.end_session(&session_id).await;
```

- [ ] **Step 4: Rewire snapshot fetch to use `RecoveryManager` instead of direct daemon-side sidecar snapshots**

```rust
// crates/daemon/src/main.rs
match command {
    Command::Snapshot { session_id } => {
        let snapshot = state
            .recovery
            .get_snapshot(&session_id)
            .await
            .map_err(|message| message)?;

        if let Some(snapshot) = snapshot {
            send_event(Event::Snapshot {
                session_id,
                rows: snapshot.rows,
                cols: snapshot.cols,
                cursor_row: 0,
                cursor_col: 0,
                cursor_visible: true,
                vt: snapshot.serialized,
            })?;
        } else {
            return Err("session not found".into());
        }
    }
}
```

- [ ] **Step 5: Run daemon recovery and handoff tests**

Run: `GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo test --manifest-path crates/daemon/Cargo.toml recovery_service handoff -- --nocapture`

Expected: PASS, with recovery-sidecar requests exercising disk-backed snapshot retrieval instead of direct live sidecar snapshotting.

- [ ] **Step 6: Commit**

```bash
git add crates/daemon/src/lib.rs crates/daemon/src/main.rs crates/daemon/src/recovery.rs crates/daemon/tests/recovery_service.rs crates/daemon/tests/handoff.rs
git commit -m "feat: restore daemon recovery manager boundary"
```

## Task 2: Implement the Rust/Ghostty Recovery Sidecar

**Files:**
- Create: `packages/terminal-recovery/Cargo.toml`
- Create: `packages/terminal-recovery/src/main.rs`
- Create: `packages/terminal-recovery/src/protocol.rs`
- Create: `packages/terminal-recovery/src/service.rs`
- Create: `packages/terminal-recovery/src/session_mirror.rs`
- Create: `packages/terminal-recovery/src/snapshot_store.rs`
- Test: `packages/terminal-recovery/tests/protocol.rs`
- Test: `packages/terminal-recovery/tests/session_mirror.rs`
- Test: `packages/terminal-recovery/tests/snapshot_store.rs`

- [ ] **Step 1: Write the failing session-mirror test for Ghostty-backed persistence**

```rust
#[test]
fn mirror_serializes_full_scrollback_after_multiple_writes() {
    let mut mirror = SessionMirror::new(120, 45).unwrap();
    mirror.write_output(b"line 1\r\n").unwrap();
    mirror.write_output(b"line 2\r\n").unwrap();
    mirror.write_output(b"prompt>").unwrap();

    let snapshot = mirror.snapshot().unwrap();

    assert!(snapshot.serialized.contains("line 1"));
    assert!(snapshot.serialized.contains("line 2"));
    assert!(snapshot.serialized.contains("prompt>"));
}
```

- [ ] **Step 2: Run the new package tests to verify the crate does not exist yet**

Run: `cargo test --manifest-path packages/terminal-recovery/Cargo.toml`

Expected: FAIL because the Rust recovery-sidecar crate has not been created.

- [ ] **Step 3: Create the Rust sidecar package and preserve the existing recovery protocol**

```rust
// packages/terminal-recovery/src/protocol.rs
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RecoveryCommand {
    StartSession { session_id: String, cols: u16, rows: u16, resume_from_disk: bool },
    WriteOutput { session_id: String, data: Vec<u8>, sequence: u64 },
    ResizeSession { session_id: String, cols: u16, rows: u16 },
    EndSession { session_id: String },
    GetSnapshot { session_id: String },
    FlushAndShutdown,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RecoveryResponse {
    Ok,
    Error { message: String },
    Snapshot { session_id: String, serialized: String, cols: u16, rows: u16, saved_at: u64, sequence: u64 },
    NotFound,
}
```

- [ ] **Step 4: Implement the Ghostty-backed mirror and atomic snapshot store**

```rust
// packages/terminal-recovery/src/session_mirror.rs
pub struct SessionMirror {
    terminal: Box<Terminal<'static, 'static>>,
    cols: u16,
    rows: u16,
    sequence: u64,
}

impl SessionMirror {
    pub fn write_output(&mut self, bytes: &[u8], sequence: u64) -> Result<()> {
        if sequence <= self.sequence {
            return Ok(());
        }
        self.terminal.vt_write(bytes);
        self.sequence = sequence;
        Ok(())
    }

    pub fn snapshot(&self) -> Result<RecoverySnapshot> {
        let serialized = serialize_terminal(&self.terminal, None)?.serialized_candidate;
        Ok(RecoverySnapshot {
            serialized,
            cols: self.cols,
            rows: self.rows,
            saved_at: now_millis(),
            sequence: self.sequence,
        })
    }
}

// packages/terminal-recovery/src/snapshot_store.rs
pub fn write_snapshot_atomic(path: &Path, snapshot: &RecoverySnapshot) -> Result<()> {
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec(snapshot)?)?;
    std::fs::rename(temp, path)?;
    Ok(())
}
```

- [ ] **Step 5: Implement the sidecar service loop on stdin/stdout**

```rust
// packages/terminal-recovery/src/service.rs
pub async fn serve(snapshot_dir: PathBuf) -> Result<()> {
    let mut sessions = HashMap::<String, SessionMirror>::new();
    let stdin = BufReader::new(tokio::io::stdin());
    let mut lines = stdin.lines();

    while let Some(line) = lines.next_line().await? {
        let command: RecoveryCommand = serde_json::from_str(&line)?;
        let response = handle_command(&mut sessions, &snapshot_dir, command).await;
        println!("{}", serde_json::to_string(&response?)?);
    }

    Ok(())
}
```

- [ ] **Step 6: Run the package tests**

Run: `cargo test --manifest-path packages/terminal-recovery/Cargo.toml`

Expected: PASS, including protocol roundtrip, session-mirror persistence, and atomic snapshot-store tests.

- [ ] **Step 7: Commit**

```bash
git add packages/terminal-recovery/Cargo.toml packages/terminal-recovery/src/main.rs packages/terminal-recovery/src/protocol.rs packages/terminal-recovery/src/service.rs packages/terminal-recovery/src/session_mirror.rs packages/terminal-recovery/src/snapshot_store.rs packages/terminal-recovery/tests/protocol.rs packages/terminal-recovery/tests/session_mirror.rs packages/terminal-recovery/tests/snapshot_store.rs
git commit -m "feat: add ghostty recovery sidecar"
```

## Task 3: Point the Daemon Recovery Manager at the Rust Sidecar

**Files:**
- Modify: `crates/daemon/src/recovery.rs`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `scripts/stage-sidecars.sh`
- Test: `apps/desktop/src/sidecars.test.ts`

- [ ] **Step 1: Write the failing sidecar packaging test for the Rust recovery binary**

```ts
it("stages the daemon, cli, and terminal recovery sidecars", async () => {
  const content = await readFile("apps/desktop/src-tauri/tauri.conf.json", "utf8");
  expect(content).toContain("kanna-daemon");
  expect(content).toContain("kanna-cli");
  expect(content).toContain("kanna-terminal-recovery");
});
```

- [ ] **Step 2: Run the packaging test to verify the recovery sidecar is not staged yet**

Run: `cd apps/desktop && bun test src/sidecars.test.ts`

Expected: FAIL because the current rebased branch removed `kanna-terminal-recovery` from staging.

- [ ] **Step 3: Change the recovery launcher from Node script detection to the Rust sidecar binary**

```rust
// crates/daemon/src/recovery.rs
fn detect_launcher() -> Option<RecoveryLauncher> {
    if let Ok(path) = std::env::var("KANNA_TERMINAL_RECOVERY_BIN") {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Some(RecoveryLauncher { program: candidate, args: Vec::new() });
        }
    }

    bundled_runtime_launcher().or_else(workspace_binary_launcher)
}

fn workspace_binary_launcher() -> Option<RecoveryLauncher> {
    let root = workspace_root()?;
    let bin = root.join(".build/debug/kanna-terminal-recovery");
    bin.exists().then(|| RecoveryLauncher { program: bin, args: Vec::new() })
}
```

- [ ] **Step 4: Restore build/staging of the recovery sidecar**

```json
// apps/desktop/package.json
{
  "scripts": {
    "build:sidecars": "cargo build --manifest-path ../../crates/daemon/Cargo.toml && cargo build --manifest-path ../../crates/kanna-cli/Cargo.toml && cargo build --manifest-path ../../packages/terminal-recovery/Cargo.toml && ../../scripts/stage-sidecars.sh"
  }
}
```

```bash
# scripts/stage-sidecars.sh
copy_if_different \
  "$BUILD_DIR/kanna-terminal-recovery" \
  "$BIN_DIR/kanna-terminal-recovery-$TARGET_TRIPLE"
```

- [ ] **Step 5: Run the packaging/build verification**

Run: `cd apps/desktop && bun test src/sidecars.test.ts && GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty bun run build:sidecars`

Expected: PASS, with the staged binaries including `kanna-terminal-recovery-$TARGET_TRIPLE`.

- [ ] **Step 6: Commit**

```bash
git add crates/daemon/src/recovery.rs apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json scripts/stage-sidecars.sh apps/desktop/src/sidecars.test.ts
git commit -m "build: bundle ghostty recovery sidecar"
```

## Task 4: Restore the Frontend Recovery Flow

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/daemon.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/composables/sessionRecoveryState.ts`
- Modify: `apps/desktop/src/composables/sessionRecoveryState.test.ts`
- Modify: `apps/desktop/src/composables/useTerminal.ts`
- Modify: `apps/desktop/src/composables/terminalSessionRecovery.ts`
- Modify: `apps/desktop/src/tauri-mock.ts`

- [ ] **Step 1: Write the failing frontend recovery-state test**

```ts
it("parses Ghostty-backed recovery snapshots without changing the public recovery shape", () => {
  const snapshot = parseSessionRecoveryState({
    serialized: "\u001b[2Jhello",
    cols: 120,
    rows: 45,
    savedAt: 123,
    sequence: 7,
  });

  expect(snapshot?.serialized).toContain("hello");
  expect(snapshot?.cols).toBe(120);
  expect(snapshot?.rows).toBe(45);
});
```

- [ ] **Step 2: Run the frontend recovery tests to verify the old recovery path is absent**

Run: `cd apps/desktop && bun test src/composables/sessionRecoveryState.test.ts src/composables/terminalSessionRecovery.test.ts`

Expected: FAIL because the rebased branch removed or bypassed the `sessionRecoveryState` flow.

- [ ] **Step 3: Restore Tauri snapshot fetching through the recovery manager**

```rust
// apps/desktop/src-tauri/src/commands/daemon.rs
#[tauri::command]
pub async fn get_session_recovery_state(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Option<RecoverySnapshotPayload>, String> {
    let snapshot = state
        .daemon
        .recovery
        .get_snapshot(&session_id)
        .await?;

    Ok(snapshot.map(|snapshot| RecoverySnapshotPayload {
        serialized: snapshot.serialized,
        cols: snapshot.cols,
        rows: snapshot.rows,
        saved_at: snapshot.saved_at,
        sequence: snapshot.sequence,
    }))
}
```

- [ ] **Step 4: Restore the frontend recovery composable path while keeping destructive snapshot apply**

```ts
// apps/desktop/src/composables/useTerminal.ts
const recoveryState = await invoke<SessionRecoveryState | null>("get_session_recovery_state", { sessionId });

if (recoveryState && terminal.value) {
  terminal.value.reset();
  terminal.value.write(recoveryState.serialized, () => {
    console.warn("[terminal][connect] recovery:applied", { sessionId, sequence: recoveryState.sequence });
  });
}
```

- [ ] **Step 5: Run focused frontend checks**

Run: `cd apps/desktop && bun test src/composables/sessionRecoveryState.test.ts src/composables/terminalSessionRecovery.test.ts src/composables/useKeyboardShortcuts.test.ts src/composables/useShortcutContext.test.ts src/sidecars.test.ts src/components/__tests__/terminalSessionConfig.test.ts && bun tsc --noEmit`

Expected: PASS, with the recovery flow back on the stable `main` interface and no render exceptions.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/daemon.rs apps/desktop/src-tauri/src/lib.rs apps/desktop/src/composables/sessionRecoveryState.ts apps/desktop/src/composables/sessionRecoveryState.test.ts apps/desktop/src/composables/useTerminal.ts apps/desktop/src/composables/terminalSessionRecovery.ts apps/desktop/src/tauri-mock.ts
git commit -m "feat: restore frontend recovery flow"
```

## Task 5: Remove the Temporary Direct Snapshot Path

**Files:**
- Modify: `crates/daemon/src/sidecar.rs`
- Modify: `crates/daemon/src/protocol.rs`
- Modify: `apps/desktop/src/composables/daemonTerminalSnapshot.ts`
- Modify: `apps/desktop/src/composables/daemonTerminalSnapshot.test.ts`
- Test: `crates/daemon/tests/handoff.rs`

- [ ] **Step 1: Write the failing daemon regression test that codifies disk-backed recovery as authoritative**

```rust
#[tokio::test]
async fn restart_restore_uses_recovery_service_not_live_handoff_snapshot() {
    let recovery = RecoveryManager::new_for_test().await.unwrap();
    recovery.start_session("session-1", 120, 45, false).await.unwrap();
    recovery.write_output("session-1", b"full history\r\nprompt>", 1).await;

    let snapshot = recovery.get_snapshot("session-1").await.unwrap().unwrap();

    assert!(snapshot.serialized.contains("full history"));
}
```

- [ ] **Step 2: Run daemon recovery and handoff tests**

Run: `GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo test --manifest-path crates/daemon/Cargo.toml handoff recovery_service -- --nocapture`

Expected: PASS after the recovery-service path is authoritative; FAIL beforehand if any direct handoff snapshot code still leaks into restore.

- [ ] **Step 3: Delete the temporary direct snapshot plumbing**

```rust
// crates/daemon/src/sidecar.rs
// Keep live sidecar terminal semantics for daemon-only behavior, but stop using
// TerminalSidecar::snapshot() as the restore source for frontend reconnect.

// apps/desktop/src/composables/daemonTerminalSnapshot.ts
// Remove once all frontend restore reads use sessionRecoveryState again.
```

- [ ] **Step 4: Run full targeted verification**

Run: `GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo test --manifest-path crates/daemon/Cargo.toml -- --test-threads=1 && cd apps/desktop && bun test src/composables/sessionRecoveryState.test.ts src/composables/terminalSessionRecovery.test.ts src/sidecars.test.ts && bun tsc --noEmit`

Expected: PASS, with no direct-daemon snapshot path left in the reconnect flow.

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/sidecar.rs crates/daemon/src/protocol.rs apps/desktop/src/composables/daemonTerminalSnapshot.ts apps/desktop/src/composables/daemonTerminalSnapshot.test.ts crates/daemon/tests/handoff.rs
git commit -m "refactor: make recovery service authoritative for restore"
```

## Task 6: Verify the Real App Restart Path

**Files:**
- Modify: `apps/desktop/src/composables/useTerminal.ts`
- Modify: `crates/daemon/src/main.rs`
- Test: manual restart validation only

- [ ] **Step 1: Add the final focused instrumentation needed for restart verification**

```ts
console.warn("[terminal][connect] recovery:applied", {
  sessionId,
  sequence: recoveryState?.sequence ?? null,
  serializedLength: recoveryState?.serialized.length ?? null,
});
```

```rust
log::info!(
    "[recovery] mirrored session={} sequence={} bytes={}",
    session_id,
    sequence,
    data.len()
);
```

- [ ] **Step 2: Run the live worktree dev flow**

Run: `KANNA_DEV_PORT=1718 GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty ./scripts/dev.sh restart`

Expected: Vite on `http://localhost:1718/`, desktop app boots, daemon connects, recovery sidecar starts without Node runtime.

- [ ] **Step 3: Reproduce the prior failure shape on a real task**

Run:

```bash
KANNA_DEV_PORT=1718 GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty ./scripts/dev.sh restart
./scripts/dev.sh log | tail -n 200
tail -n 200 /tmp/kanna-webview-task-68c08eaa.log
ls -1t .kanna-daemon/kanna-daemon_*.log | head -n 2
```

Expected:
- recovery snapshot fetched from disk-backed service
- frontend applies full serialized history before attach
- prompt-sized live redraw does not replace history

- [ ] **Step 4: Commit final instrumentation cleanup or retention decision**

```bash
git add apps/desktop/src/composables/useTerminal.ts crates/daemon/src/main.rs
git commit -m "test: verify ghostty recovery restart path"
```

## Self-Review

- Spec coverage:
  - recovery-service architecture restoration: covered by Tasks 1, 4, and 5
  - Rust/Ghostty sidecar replacement: covered by Tasks 2 and 3
  - packaging/runtime cleanup: covered by Task 3
  - restart fidelity regression coverage: covered by Tasks 5 and 6
- Placeholder scan:
  - removed generic “add tests/error handling later” wording
  - each task includes concrete files, commands, and code targets
- Type consistency:
  - kept `RecoveryManager`, `RecoverySnapshot`, `StartSession/WriteOutput/...` vocabulary stable
  - frontend recovery shape consistently uses `serialized`, `cols`, `rows`, `savedAt`, `sequence`
