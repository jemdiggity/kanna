# Daemon Atomic Attach Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Auto-select `superpowers:subagent-driven-development` or `superpowers:executing-plans` based on task coupling, subagent availability, and whether execution should stay in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daemon integration regression test that proves attach-with-snapshot does not lose pre-attach PTY bytes that are not represented in the sidecar snapshot.

**Architecture:** Extend the existing daemon socket-level reconnect test harness rather than routing through Tauri. Use a deterministic PTY program that emits one marker only in the raw pre-attach byte stream, then overwrites it before attach so the marker is absent from the terminal snapshot. Verify plain `Attach` preserves the full sequence and `AttachSnapshot` is checked against the combined `snapshot.vt` plus post-attach output stream.

**Tech Stack:** Rust integration tests, real `kanna-daemon` binary, Unix socket protocol, PTY-backed shell/perl helper process.

---

### Task 1: Trace The Existing Attach Semantics

**Files:**
- Read: `crates/daemon/src/main.rs`
- Read: `crates/daemon/src/sidecar.rs`
- Read: `apps/desktop/src-tauri/src/commands/daemon.rs`
- Read: `crates/daemon/tests/reconnect.rs`
- Read: `crates/daemon/tests/handoff.rs`
- Read: `crates/daemon/tests/recovery_service.rs`

- [ ] **Step 1: Confirm the attach invariants in the daemon**

Read the `Attach` and `AttachSnapshot` handlers and note:

```text
Attach:
- adds writer
- sends Ok
- removes pre_attach_buffer and flushes buffered bytes as Output

AttachSnapshot:
- builds session.sidecar.snapshot()
- removes pre_attach_buffer
- discards buffered bytes
- sends Snapshot
```

- [ ] **Step 2: Confirm the existing integration boundary**

Read `crates/daemon/tests/reconnect.rs` and confirm it already:

```text
- starts a real daemon process
- talks to the Unix socket protocol directly
- spawns PTY sessions
- has helpers for Attach, AttachSnapshot, Input, and Output collection
```

### Task 2: Write The Failing Regression Test First

**Files:**
- Modify: `crates/daemon/tests/reconnect.rs`

- [ ] **Step 1: Extend the harness minimally**

Add a typed snapshot payload and a helper that returns the snapshot instead of discarding it:

```rust
#[derive(Debug, Deserialize)]
struct SnapshotPayload {
    version: u32,
    rows: u16,
    cols: u16,
    cursor_row: u16,
    cursor_col: u16,
    cursor_visible: bool,
    vt: String,
}

fn attach_snapshot(conn: &mut ClientConn, session_id: &str) -> SnapshotPayload {
    // send AttachSnapshot and return the snapshot payload
}
```

- [ ] **Step 2: Add a deterministic PTY source**

Spawn a shell/perl helper that emits:

```text
EARLY-HIDDEN-0001
\rSNAPSHOT-VISIBLE-0001\n
```

then blocks on stdin and finally emits:

```text
AFTER-ATTACH-0001\n
```

The `\r` overwrite ensures `EARLY-HIDDEN-0001` is present in the raw pre-attach byte stream but absent from the serialized snapshot.

- [ ] **Step 3: Write the plain Attach assertion**

Add a test that:

```text
1. spawns the scripted PTY session
2. attaches normally
3. asserts the received Output stream contains EARLY-HIDDEN-0001
4. sends stdin to release the helper
5. asserts the later output contains AFTER-ATTACH-0001
```

- [ ] **Step 4: Write the AttachSnapshot assertion**

Add a second test or a shared helper that:

```text
1. spawns the same scripted PTY session
2. attaches with snapshot
3. asserts snapshot.vt contains SNAPSHOT-VISIBLE-0001
4. asserts snapshot.vt does not contain EARLY-HIDDEN-0001
5. sends stdin to release the helper
6. combines snapshot.vt with later Output bytes
7. asserts the combined observed stream still contains EARLY-HIDDEN-0001 and AFTER-ATTACH-0001
```

Expected red result on the current suspected implementation:

```text
plain Attach passes
AttachSnapshot fails because EARLY-HIDDEN-0001 was discarded with the pre_attach_buffer
```

### Task 3: Verify The Narrow Target

**Files:**
- Modify: `crates/daemon/tests/reconnect.rs`

- [ ] **Step 1: Run the new reconnect test target and observe red/green**

Run:

```bash
cd crates/daemon && cargo test --test reconnect atomic_attach -- --nocapture
```

Expected:

```text
If the bug is real, the attach-snapshot regression test fails with a missing EARLY-HIDDEN-0001 assertion.
```

- [ ] **Step 2: If the target name filtering is too narrow, run the full reconnect integration test**

Run:

```bash
cd crates/daemon && cargo test --test reconnect -- --nocapture
```

Expected:

```text
Existing reconnect coverage still runs, and the new regression test gives a clear pass/fail signal.
```
