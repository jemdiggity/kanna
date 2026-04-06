# Defensive Daemon Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make daemon handoff preserve live PTY sessions even when snapshot serialization fails, so restarted daemons can still attach to those sessions instead of returning `session not found`.

**Architecture:** Decouple PTY transfer from snapshot availability. `HandoffReady` carries PTY ownership plus optional snapshot metadata and explicit geometry, and the new daemon always adopts live PTYs. Snapshot restoration and recovery seeding become best-effort enhancements instead of prerequisites for session survival.

**Tech Stack:** Rust, Tokio, serde, Unix socket handoff protocol, raw PTY fd transfer, daemon integration tests.

---

### Task 1: Add protocol support for degraded handoff sessions

**Files:**
- Modify: `crates/daemon/src/protocol.rs`
- Test: `crates/daemon/src/protocol.rs`

- [ ] **Step 1: Write the failing protocol round-trip test**

Add this test near the existing snapshot/handoff protocol tests in `crates/daemon/src/protocol.rs`:

```rust
    #[test]
    fn test_handoff_ready_roundtrip_without_snapshot() {
        let evt = Event::HandoffReady {
            sessions: vec![HandoffSession {
                session_id: "sess-1".to_string(),
                pid: 42,
                cwd: "/tmp".to_string(),
                rows: 24,
                cols: 80,
                snapshot: None,
            }],
        };

        let json = serde_json::to_string(&evt).unwrap();
        let decoded: Event = serde_json::from_str(&json).unwrap();

        match decoded {
            Event::HandoffReady { sessions } => {
                assert_eq!(sessions.len(), 1);
                assert_eq!(sessions[0].session_id, "sess-1");
                assert_eq!(sessions[0].rows, 24);
                assert_eq!(sessions[0].cols, 80);
                assert!(sessions[0].snapshot.is_none());
            }
            other => panic!("wrong variant: {:?}", other),
        }
    }
```

- [ ] **Step 2: Run the protocol test to verify it fails**

Run:

```bash
cargo test --manifest-path crates/daemon/Cargo.toml test_handoff_ready_roundtrip_without_snapshot -- --nocapture
```

Expected: FAIL because `HandoffSession` still requires a non-optional snapshot and has no standalone `rows`/`cols`.

- [ ] **Step 3: Make handoff snapshot optional and add geometry fields**

Update `crates/daemon/src/protocol.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HandoffSession {
    pub session_id: String,
    pub pid: u32,
    pub cwd: String,
    pub rows: u16,
    pub cols: u16,
    pub snapshot: Option<TerminalSnapshot>,
}
```

Leave existing `TerminalSnapshot` unchanged.

- [ ] **Step 4: Run the protocol test to verify it passes**

Run:

```bash
cargo test --manifest-path crates/daemon/Cargo.toml test_handoff_ready_roundtrip_without_snapshot -- --nocapture
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add crates/daemon/src/protocol.rs
git commit -m "refactor: allow handoff sessions without snapshots"
```

### Task 2: Make old-daemon handoff preserve PTYs when snapshotting fails

**Files:**
- Modify: `crates/daemon/src/main.rs`
- Test: `crates/daemon/tests/handoff.rs`

- [ ] **Step 1: Write the failing degraded-handoff integration test**

Add this test to `crates/daemon/tests/handoff.rs`:

```rust
#[test]
fn test_handoff_keeps_live_session_when_snapshot_fails() {
    let dir = test_dir("snapshot-failure");

    let daemon_a = DaemonHandle::start_in(&dir);
    let mut conn_a = daemon_a.connect();

    conn_a.send(&Cmd::Spawn {
        session_id: "sess-degraded".to_string(),
        executable: "/bin/sh".to_string(),
        args: vec![
            "-c".to_string(),
            "printf '\\033[?2026h'; exec /bin/cat".to_string(),
        ],
        cwd: "/tmp".to_string(),
        env: HashMap::new(),
        cols: 80,
        rows: 24,
    });
    match conn_a.recv() {
        Evt::SessionCreated { .. } => {}
        other => panic!("expected SessionCreated, got: {:?}", other),
    }

    attach(&mut conn_a, "sess-degraded");
    conn_a.drain_output(Duration::from_millis(500));
    drop(conn_a);

    let daemon_b = DaemonHandle::start_in(&dir);
    let mut conn_b = daemon_b.connect();
    attach(&mut conn_b, "sess-degraded");
    send_input(&mut conn_b, "sess-degraded", b"after-handoff\n");

    let output = conn_b.collect_output(13);
    let output_str = String::from_utf8_lossy(&output);
    assert!(
        output_str.contains("after-handoff"),
        "degraded session should survive handoff, got: {:?}",
        output_str
    );

    drop(daemon_b);
    cleanup(&dir);
}
```

- [ ] **Step 2: Run the degraded handoff test to verify it fails**

Run:

```bash
GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo test --manifest-path crates/daemon/Cargo.toml --test handoff test_handoff_keeps_live_session_when_snapshot_fails -- --nocapture
```

Expected: FAIL because the old daemon still skips the session on snapshot failure and the new daemon returns `attach failed: session not found`.

- [ ] **Step 3: Change old-daemon handoff to always detach live PTYs**

In `crates/daemon/src/main.rs`, update `handle_handoff()` so snapshot failure no longer `continue`s. Replace the session collection block with logic of this shape:

```rust
                let snapshot = match session.sidecar.snapshot() {
                    Ok(snapshot) => {
                        log::info!(
                            "[handoff] snapshot session={} rows={} cols={} cursor=({}, {}) visible={} vt_len={}",
                            id,
                            snapshot.rows,
                            snapshot.cols,
                            snapshot.cursor_row,
                            snapshot.cursor_col,
                            snapshot.cursor_visible,
                            snapshot.vt.len()
                        );
                        Some(snapshot)
                    }
                    Err(error) => {
                        log::error!(
                            "[handoff] failed to snapshot session {} (pid={}, cwd={}): {}",
                            id,
                            pid,
                            cwd,
                            error
                        );
                        None
                    }
                };
                let (fd, rows, cols) = session.pty.detach_for_handoff();
```

Then emit:

```rust
                infos.push(protocol::HandoffSession {
                    session_id: id.clone(),
                    pid,
                    cwd,
                    rows,
                    cols,
                    snapshot,
                });
```

Do not skip the session when snapshot is `None`.

- [ ] **Step 4: Update `PtySession::detach_for_handoff()` to return geometry**

In the PTY implementation file that defines `detach_for_handoff()` (the existing code currently returns `(fd, _, _)`), make sure the method returns `(RawFd, u16, u16)` where the last two values are the current PTY `rows` and `cols`. Preserve existing callers by updating them in the same task.

- [ ] **Step 5: Run the degraded handoff test to verify it passes**

Run:

```bash
GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo test --manifest-path crates/daemon/Cargo.toml --test handoff test_handoff_keeps_live_session_when_snapshot_fails -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/daemon/src/main.rs crates/daemon/src/protocol.rs crates/daemon/src/pty.rs crates/daemon/tests/handoff.rs
git commit -m "fix: preserve live ptys when handoff snapshots fail"
```

### Task 3: Adopt degraded sessions in the new daemon

**Files:**
- Modify: `crates/daemon/src/main.rs`
- Test: `crates/daemon/tests/handoff.rs`

- [ ] **Step 1: Write the failing adoption-path assertion**

Extend `test_handoff_keeps_live_session_when_snapshot_fails` with a second restart:

```rust
    drop(conn_b);
    let daemon_c = DaemonHandle::start_in(&dir);
    let mut conn_c = daemon_c.connect();
    attach(&mut conn_c, "sess-degraded");
    send_input(&mut conn_c, "sess-degraded", b"after-second-handoff\n");

    let output = conn_c.collect_output(19);
    let output_str = String::from_utf8_lossy(&output);
    assert!(
        output_str.contains("after-second-handoff"),
        "degraded session should remain live after adoption, got: {:?}",
        output_str
    );

    drop(daemon_c);
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo test --manifest-path crates/daemon/Cargo.toml --test handoff test_handoff_keeps_live_session_when_snapshot_fails -- --nocapture
```

Expected: FAIL because the new daemon still assumes every adopted session has a snapshot.

- [ ] **Step 3: Make adopted-session restoration best-effort**

In `crates/daemon/src/main.rs`, change `HandoffResult.adopted` and the adoption loop to carry `Option<protocol::TerminalSnapshot>`.

Update the adoption loop to:

```rust
        for (session_id, pty_session, snapshot) in handoff_result.adopted {
            let (sidecar, seeded_snapshot) = match snapshot.as_ref() {
                Some(snapshot) => {
                    let sidecar = sidecar::TerminalSidecar::from_snapshot(&snapshot, 10_000)
                        .expect("failed to restore terminal sidecar for adopted session");
                    let seeded = SeededRecoverySnapshot {
                        serialized: snapshot.vt.clone(),
                        cols: snapshot.cols,
                        rows: snapshot.rows,
                        cursor_row: snapshot.cursor_row,
                        cursor_col: snapshot.cursor_col,
                        cursor_visible: snapshot.cursor_visible,
                    };
                    (sidecar, Some(seeded))
                }
                None => {
                    let sidecar = sidecar::TerminalSidecar::new(
                        pty_session.cols(),
                        pty_session.rows(),
                        10_000,
                    ).expect("failed to create blank sidecar for adopted session");
                    (sidecar, None)
                }
            };

            if let Some(seeded) = seeded_snapshot {
                if let Err(error) = recovery_manager.seed_snapshot(&session_id, &seeded) {
                    log::warn!(
                        "[recovery] failed to seed adopted snapshot for session {}: {}",
                        session_id,
                        error
                    );
                }
            } else {
                log::warn!(
                    "[handoff] adopted session {} without snapshot; recovery state unavailable",
                    session_id
                );
            }

            mgr.insert(
                session_id,
                SessionRecord {
                    pty: pty_session,
                    sidecar,
                    stream_control: None,
                },
            );
        }
```

This task also requires simple accessors on `PtySession`:

```rust
pub fn cols(&self) -> u16 { self.cols }
pub fn rows(&self) -> u16 { self.rows }
```

Use the existing stored geometry fields if they already exist instead of duplicating state.

- [ ] **Step 4: Update handoff receive path to accept optional snapshots**

In `attempt_handoff()`, make the adopted tuple type `Vec<(String, pty::PtySession, Option<protocol::TerminalSnapshot>)>`. Preserve every received session even when `snapshot` is `None`.

- [ ] **Step 5: Run the degraded handoff test to verify it passes**

Run:

```bash
GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo test --manifest-path crates/daemon/Cargo.toml --test handoff test_handoff_keeps_live_session_when_snapshot_fails -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/daemon/src/main.rs crates/daemon/src/pty.rs crates/daemon/tests/handoff.rs
git commit -m "refactor: adopt handed off sessions without snapshots"
```

### Task 4: Verify the full daemon handoff suite and recovery behavior

**Files:**
- Modify: `crates/daemon/tests/handoff.rs` (only if assertion text or helper cleanup is needed)
- Verify: `crates/daemon/tests/recovery_service.rs`

- [ ] **Step 1: Run the full handoff test suite**

Run:

```bash
GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo test --manifest-path crates/daemon/Cargo.toml --test handoff -- --nocapture
```

Expected: PASS.

- [ ] **Step 2: Run recovery service tests to ensure degraded adoption did not break seeding behavior**

Run:

```bash
GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo test --manifest-path crates/daemon/Cargo.toml --test recovery_service -- --nocapture
```

Expected: PASS.

- [ ] **Step 3: Run daemon lint and compile checks**

Run:

```bash
GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo check --manifest-path crates/daemon/Cargo.toml
GHOSTTY_SOURCE_DIR=/Users/jeremyhale/Documents/work/jemdiggity/ghostty cargo clippy --manifest-path crates/daemon/Cargo.toml -- -D warnings
```

Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add crates/daemon
git commit -m "test: harden daemon handoff against snapshot failure"
```

## Self-Review

- Spec coverage: the plan covers optional handoff snapshots, PTY-preserving handoff on snapshot failure, best-effort adoption without recovery state, and full daemon verification.
- Placeholder scan: no `TODO`/`TBD` markers remain; each task contains explicit code or commands.
- Type consistency: `HandoffSession.snapshot` is consistently `Option<TerminalSnapshot>` and geometry is consistently carried as `rows`/`cols`.
